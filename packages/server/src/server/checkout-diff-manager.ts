import type pino from "pino";
import type { SubscribeCheckoutDiffRequest, SessionOutboundMessage } from "./messages.js";
import type { WorkspaceGitRuntimeSnapshot, WorkspaceGitService } from "./workspace-git-service.js";
import { expandTilde } from "../utils/path.js";
import { toCheckoutError } from "./checkout-git-utils.js";
import type { GitActivityPolicyService } from "./git-activity/policy.js";

const CHECKOUT_DIFF_WATCH_DEBOUNCE_MS = 150;

/**
 * Why an automatic Git read was refused. Reuses the existing NOT_ALLOWED code —
 * the closed CheckoutErrorCode union is not extended for this feature.
 */
const GIT_ACTIVITY_PAUSED_MESSAGE =
  "Automatic Git updates are paused for this workspace. Refresh to read Git state.";

type CheckoutDiffWorkspace = Pick<
  WorkspaceGitService,
  | "getCheckoutDiff"
  | "getSnapshot"
  | "peekSnapshot"
  | "registerWorkspace"
  | "requestWorkingTreeWatch"
>;

export type CheckoutDiffCompareInput = SubscribeCheckoutDiffRequest["compare"];

export type CheckoutDiffSnapshotPayload = Omit<
  Extract<SessionOutboundMessage, { type: "checkout_diff_update" }>["payload"],
  "subscriptionId"
>;

export interface CheckoutDiffMetrics {
  checkoutDiffTargetCount: number;
  checkoutDiffSubscriptionCount: number;
  checkoutDiffWatcherCount: number;
  checkoutDiffFallbackRefreshTargetCount: number;
}

interface CheckoutDiffWatchTarget {
  key: string;
  cwd: string;
  diffCwd: string;
  compare: CheckoutDiffCompareInput;
  listeners: Set<(snapshot: CheckoutDiffSnapshotPayload) => void>;
  workingTreeWatchUnsubscribe: (() => void) | null;
  workspaceGitUnsubscribe: (() => void) | null;
  latestWorkspaceStructureFingerprint: string | null;
  latestWorkspaceWorktreeFingerprint: string | null;
  latestWorkspaceForgeFingerprint: string | null;
  debounceTimer: NodeJS.Timeout | null;
  pendingDebounceForce: boolean;
  refreshPromise: Promise<void> | null;
  refreshQueued: boolean;
  refreshQueuedForce: boolean;
  latestPayload: CheckoutDiffSnapshotPayload | null;
  latestFingerprint: string | null;
  openPromise: Promise<void> | null;
}

export interface CheckoutDiffSubscriptionRequest {
  cwd: string;
  compare: CheckoutDiffCompareInput;
  signal?: AbortSignal;
}

export interface CheckoutDiffSubscription {
  initial: CheckoutDiffSnapshotPayload;
  unsubscribe: () => void;
}

export class CheckoutDiffManager {
  private readonly workspaceGitService: CheckoutDiffWorkspace;
  private readonly targets = new Map<string, CheckoutDiffWatchTarget>();

  private readonly gitActivity: GitActivityPolicyService | undefined;

  constructor(options: {
    logger: pino.Logger;
    paseoHome: string;
    workspaceGitService: CheckoutDiffWorkspace;
    /** Host-global Git activity admission. See `git-activity/policy.ts`. */
    gitActivity?: GitActivityPolicyService;
  }) {
    this.workspaceGitService = options.workspaceGitService;
    this.gitActivity = options.gitActivity;
  }

  /**
   * The payload a legacy automatic diff request gets on a manual workspace.
   *
   * Already-cached state is returned as-is, so a client that legitimately has a
   * previous diff keeps seeing it. With nothing cached the client gets the
   * existing parseable error shape with a paused refresh marker rather than a
   * computed result: the empty file list is an absence of data, never a
   * "no changes" fact.
   *
   * The lookup is keyed by cwd **and compare**. Matching on cwd alone would
   * serve whatever diff happens to be cached for that directory -- uncommitted
   * files to a caller that asked to compare against `main`, for instance --
   * presenting one comparison's result as another's. A request with no exactly
   * matching cache gets the paused payload instead.
   */
  private buildManualDiffPayload(
    cwd: string,
    compare: CheckoutDiffCompareInput,
  ): CheckoutDiffSnapshotPayload {
    const targetKey = this.buildTargetKey(cwd, compare);
    const exact = this.targets.get(targetKey);
    if (exact?.latestPayload) {
      return exact.latestPayload;
    }
    return {
      cwd,
      files: [],
      error: {
        code: "NOT_ALLOWED",
        message: GIT_ACTIVITY_PAUSED_MESSAGE,
      },
    };
  }

  async read(
    params: Omit<CheckoutDiffSubscriptionRequest, "signal">,
  ): Promise<CheckoutDiffSnapshotPayload> {
    // An explicit read must bypass the cache: manual workspaces have no watcher
    // to invalidate it after edits made outside Paseo.
    return this.computeCheckoutDiffSnapshot(params.cwd, this.normalizeCompare(params.compare), {
      force: true,
      reason: "manual-diff-read",
    });
  }

  async subscribe(
    params: CheckoutDiffSubscriptionRequest,
    listener: (snapshot: CheckoutDiffSnapshotPayload) => void,
  ): Promise<CheckoutDiffSubscription> {
    const cwd = params.cwd;
    const compare = this.normalizeCompare(params.compare);
    // Old clients still send subscribe_checkout_diff_request, including on every
    // reconnect. That request carries no explicit user intent, so a manual
    // workspace must give it ZERO Git reads — not merely "no observer". Serving a
    // bounded read here would let a reconnect storm run one full diff per event.
    if (this.gitActivity && !this.gitActivity.isAutomatic(cwd)) {
      return {
        initial: this.buildManualDiffPayload(cwd, compare),
        unsubscribe: () => {},
      };
    }
    const target = this.ensureTarget(cwd, compare);
    target.listeners.add(listener);
    target.openPromise ??= this.openTarget(target);

    let isSubscribed = true;
    const unsubscribe = () => {
      if (!isSubscribed) {
        return;
      }
      isSubscribed = false;
      params.signal?.removeEventListener("abort", unsubscribe);
      this.removeListener(target, listener);
    };
    params.signal?.addEventListener("abort", unsubscribe, { once: true });
    if (params.signal?.aborted) {
      unsubscribe();
    }

    try {
      await target.openPromise;
      const initial =
        target.latestPayload ??
        (await this.computeCheckoutDiffSnapshot(target.cwd, target.compare, {
          diffCwd: target.diffCwd,
        }));
      target.latestPayload = initial;
      target.latestFingerprint = JSON.stringify(initial);
      return { initial, unsubscribe };
    } catch (error) {
      unsubscribe();
      throw error;
    }
  }

  scheduleRefreshForCwd(cwd: string): void {
    const resolvedCwd = expandTilde(cwd);
    // Automatic refresh only. An explicit mutation follow-up must not re-arm a
    // live subscription on a manual workspace.
    if (this.gitActivity && !this.gitActivity.isAutomatic(resolvedCwd)) {
      return;
    }
    for (const target of this.targets.values()) {
      if (target.cwd !== resolvedCwd && target.diffCwd !== resolvedCwd) {
        continue;
      }
      this.scheduleTargetRefresh(target);
    }
  }

  getMetrics(): CheckoutDiffMetrics {
    let checkoutDiffSubscriptionCount = 0;

    for (const target of this.targets.values()) {
      checkoutDiffSubscriptionCount += target.listeners.size;
    }

    return {
      checkoutDiffTargetCount: this.targets.size,
      checkoutDiffSubscriptionCount,
      checkoutDiffWatcherCount: 0,
      checkoutDiffFallbackRefreshTargetCount: 0,
    };
  }

  dispose(): void {
    for (const target of this.targets.values()) {
      this.closeTarget(target);
    }
    this.targets.clear();
  }

  private normalizeCompare(compare: CheckoutDiffCompareInput): CheckoutDiffCompareInput {
    const ignoreWhitespace = compare.ignoreWhitespace === true;
    if (compare.mode === "uncommitted") {
      return { mode: "uncommitted", ignoreWhitespace };
    }
    const trimmedBaseRef = compare.baseRef?.trim();
    return trimmedBaseRef
      ? { mode: "base", baseRef: trimmedBaseRef, ignoreWhitespace }
      : { mode: "base", ignoreWhitespace };
  }

  private buildTargetKey(cwd: string, compare: CheckoutDiffCompareInput): string {
    return JSON.stringify([
      cwd,
      compare.mode,
      compare.mode === "base" ? (compare.baseRef ?? "") : "",
      compare.ignoreWhitespace === true,
    ]);
  }

  private closeTarget(target: CheckoutDiffWatchTarget): void {
    if (target.debounceTimer) {
      clearTimeout(target.debounceTimer);
      target.debounceTimer = null;
    }
    target.workingTreeWatchUnsubscribe?.();
    target.workingTreeWatchUnsubscribe = null;
    target.workspaceGitUnsubscribe?.();
    target.workspaceGitUnsubscribe = null;
    target.listeners.clear();
  }

  private rememberWorkspaceSnapshot(
    target: CheckoutDiffWatchTarget,
    snapshot: WorkspaceGitRuntimeSnapshot,
  ): void {
    const structureFingerprint = JSON.stringify({
      isGit: snapshot.git.isGit,
      repoRoot: snapshot.git.repoRoot,
      mainRepoRoot: snapshot.git.mainRepoRoot,
      currentBranch: snapshot.git.currentBranch,
      remoteUrl: snapshot.git.remoteUrl,
      isPaseoOwnedWorktree: snapshot.git.isPaseoOwnedWorktree,
      baseRef: snapshot.git.baseRef,
      aheadBehind: snapshot.git.aheadBehind,
      aheadOfOrigin: snapshot.git.aheadOfOrigin,
      behindOfOrigin: snapshot.git.behindOfOrigin,
      hasRemote: snapshot.git.hasRemote,
    });
    const worktreeFingerprint = JSON.stringify({
      isDirty: snapshot.git.isDirty,
      diffStat: snapshot.git.diffStat,
    });
    const forgeFingerprint = JSON.stringify(snapshot.forge);
    const previousStructureFingerprint = target.latestWorkspaceStructureFingerprint;
    const previousWorktreeFingerprint = target.latestWorkspaceWorktreeFingerprint;
    const previousForgeFingerprint = target.latestWorkspaceForgeFingerprint;
    target.latestWorkspaceStructureFingerprint = structureFingerprint;
    target.latestWorkspaceWorktreeFingerprint = worktreeFingerprint;
    target.latestWorkspaceForgeFingerprint = forgeFingerprint;

    if (previousStructureFingerprint === null) {
      return;
    }
    const structureChanged = structureFingerprint !== previousStructureFingerprint;
    const worktreeChanged = worktreeFingerprint !== previousWorktreeFingerprint;
    const forgeChanged = forgeFingerprint !== previousForgeFingerprint;
    if (structureChanged || (!worktreeChanged && !forgeChanged)) {
      this.scheduleTargetRefresh(target, false);
    }
  }

  private removeListener(
    target: CheckoutDiffWatchTarget,
    listener: (snapshot: CheckoutDiffSnapshotPayload) => void,
  ): void {
    target.listeners.delete(listener);
    if (target.listeners.size > 0) {
      return;
    }
    this.closeTarget(target);
    if (this.targets.get(target.key) === target) {
      this.targets.delete(target.key);
    }
  }

  private scheduleTargetRefresh(target: CheckoutDiffWatchTarget, force = true): void {
    target.pendingDebounceForce ||= force;
    if (target.debounceTimer) {
      clearTimeout(target.debounceTimer);
    }
    target.debounceTimer = setTimeout(() => {
      target.debounceTimer = null;
      const pendingForce = target.pendingDebounceForce;
      target.pendingDebounceForce = false;
      void this.refreshTarget(target, pendingForce);
    }, CHECKOUT_DIFF_WATCH_DEBOUNCE_MS);
  }

  private async computeCheckoutDiffSnapshot(
    cwd: string,
    compare: CheckoutDiffCompareInput,
    options?: { diffCwd?: string; force?: boolean; reason?: string },
  ): Promise<CheckoutDiffSnapshotPayload> {
    const diffCwd = options?.diffCwd ?? cwd;
    try {
      const diffResult = await this.workspaceGitService.getCheckoutDiff(
        diffCwd,
        {
          mode: compare.mode,
          baseRef: compare.baseRef,
          ignoreWhitespace: compare.ignoreWhitespace,
          includeStructured: true,
        },
        options?.force
          ? { force: true, reason: options.reason ?? "checkout-diff-refresh" }
          : undefined,
      );
      if (diffResult.diffTooLarge) {
        return {
          cwd,
          files: [],
          diffTooLarge: true,
          error: toCheckoutError(new Error("Diff too large to display")),
        };
      }
      const files = [...(diffResult.structured ?? [])];
      files.sort((a, b) => {
        if (a.path === b.path) return 0;
        return a.path < b.path ? -1 : 1;
      });
      return {
        cwd,
        files,
        error: null,
      };
    } catch (error) {
      return {
        cwd,
        files: [],
        error: toCheckoutError(error),
      };
    }
  }

  private async refreshTarget(target: CheckoutDiffWatchTarget, force: boolean): Promise<void> {
    if (target.refreshPromise) {
      target.refreshQueued = true;
      target.refreshQueuedForce ||= force;
      return;
    }

    target.refreshPromise = (async () => {
      let currentForce = force;
      do {
        target.refreshQueued = false;
        target.refreshQueuedForce = false;
        const snapshot = await this.computeCheckoutDiffSnapshot(target.cwd, target.compare, {
          diffCwd: target.diffCwd,
          force: currentForce,
          ...(currentForce ? { reason: "working-tree-watch" } : {}),
        });
        target.latestPayload = snapshot;
        const fingerprint = JSON.stringify(snapshot);
        if (fingerprint !== target.latestFingerprint) {
          target.latestFingerprint = fingerprint;
          for (const listener of target.listeners) {
            listener(snapshot);
          }
        }
        currentForce = target.refreshQueuedForce;
      } while (target.refreshQueued);
    })();

    try {
      await target.refreshPromise;
    } finally {
      target.refreshPromise = null;
    }
  }

  private ensureTarget(cwd: string, compare: CheckoutDiffCompareInput): CheckoutDiffWatchTarget {
    const targetKey = this.buildTargetKey(cwd, compare);
    const existing = this.targets.get(targetKey);
    if (existing) {
      return existing;
    }

    const target: CheckoutDiffWatchTarget = {
      key: targetKey,
      cwd,
      diffCwd: cwd,
      compare,
      listeners: new Set(),
      workingTreeWatchUnsubscribe: null,
      workspaceGitUnsubscribe: null,
      latestWorkspaceStructureFingerprint: null,
      latestWorkspaceWorktreeFingerprint: null,
      latestWorkspaceForgeFingerprint: null,
      debounceTimer: null,
      pendingDebounceForce: false,
      refreshPromise: null,
      refreshQueued: false,
      refreshQueuedForce: false,
      latestPayload: null,
      latestFingerprint: null,
      openPromise: null,
    };
    this.targets.set(targetKey, target);
    return target;
  }

  private async openTarget(target: CheckoutDiffWatchTarget): Promise<void> {
    if (target.compare.mode === "base") {
      const snapshot =
        this.workspaceGitService.peekSnapshot(target.cwd) ??
        (await this.workspaceGitService.getSnapshot(target.cwd, { includeForge: false }));
      target.diffCwd = snapshot.git.repoRoot ?? target.cwd;
      if (this.targets.get(target.key) !== target || target.listeners.size === 0) {
        return;
      }
      this.rememberWorkspaceSnapshot(target, snapshot);
      const workspaceSubscription = this.workspaceGitService.registerWorkspace(
        { cwd: target.cwd },
        (nextSnapshot) => this.rememberWorkspaceSnapshot(target, nextSnapshot),
      );
      if (this.targets.get(target.key) !== target || target.listeners.size === 0) {
        workspaceSubscription.unsubscribe();
        return;
      }
      target.workspaceGitUnsubscribe = workspaceSubscription.unsubscribe;
      return;
    }

    const { repoRoot, unsubscribe } = await this.workspaceGitService.requestWorkingTreeWatch(
      target.cwd,
      () => this.scheduleTargetRefresh(target),
    );
    target.diffCwd = repoRoot ?? target.cwd;
    if (this.targets.get(target.key) !== target || target.listeners.size === 0) {
      unsubscribe();
      return;
    }
    target.workingTreeWatchUnsubscribe = unsubscribe;
  }
}
