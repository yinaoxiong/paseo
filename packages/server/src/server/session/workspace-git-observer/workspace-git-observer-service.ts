import { resolve } from "node:path";
import type pino from "pino";
import type { WorkspaceDescriptorPayload } from "../../messages.js";
import type {
  WorkspaceGitRuntimeSnapshot,
  WorkspaceGitService,
} from "../../workspace-git-service.js";
import type { GitActivityPolicyService } from "../../git-activity/policy.js";

interface WorkspaceGitWatchTarget {
  workspaceIds: Set<string>;
}

interface WorkspaceGitWatchState {
  cwd: string;
  lastBranchName: string | null;
}

export interface WorkspaceGitObserverMetrics {
  watchedDirectoryCount: number;
  workspaceRecordCount: number;
  subscriptionCount: number;
}

/**
 * Observes a workspace's git state on disk (via WorkspaceGitService) and drives the
 * live update fan-out: branch-change notifications, workspace-card refreshes, and
 * checkout status updates. It owns the per-cwd watch targets and the WorkspaceGitService
 * subscription handles. Filesystem subscriptions are keyed by cwd while descriptor and
 * branch state remain keyed by workspace id, so same-directory workspace records share one
 * watch without sharing identity or teardown lifetime.
 *
 * Branch changes reach `onBranchChanged` from two paths that share `lastBranchName`: the
 * on-disk snapshot listener (handleBranchSnapshot) and the workspace-emit loop's Git runtime
 * projection (recordDescriptorState). Both stay inside this module so the shared state is coherent.
 */
export interface WorkspaceGitObserverService {
  syncObservers(workspaces: Iterable<WorkspaceDescriptorPayload>): void;
  reconcileObservers(
    workspaces: Iterable<
      Pick<WorkspaceDescriptorPayload, "id" | "workspaceDirectory" | "workspaceKind">
    >,
  ): void;
  recordDescriptorState(workspaceId: string, workspace: WorkspaceDescriptorPayload | null): void;
  handleBranchSnapshot(cwd: string, branchName: string | null): void;
  getMetrics(): WorkspaceGitObserverMetrics;
  removeForWorkspaceId(workspaceId: string): void;
  dispose(): void;
}

export function createWorkspaceGitObserverService(deps: {
  workspaceGitService: Pick<WorkspaceGitService, "registerWorkspace" | "onGitActivityStateChanged">;
  emitWorkspaceUpdateForCwd: (cwd: string) => Promise<void>;
  emitStatusUpdate: (cwd: string, snapshot: WorkspaceGitRuntimeSnapshot) => void;
  onBranchChanged?: (
    workspaceId: string,
    oldBranch: string | null,
    newBranch: string | null,
  ) => void;
  logger: pino.Logger;
  /**
   * Host-global Git activity admission. Without it every workspace is observed,
   * which is the pre-policy behaviour the daemon must not keep.
   */
  gitActivity?: GitActivityPolicyService;
}): WorkspaceGitObserverService {
  const {
    workspaceGitService,
    emitWorkspaceUpdateForCwd,
    emitStatusUpdate,
    onBranchChanged,
    logger,
    gitActivity,
  } = deps;

  const watchTargets = new Map<string, WorkspaceGitWatchTarget>();
  const workspaceStates = new Map<string, WorkspaceGitWatchState>();
  const subscriptions = new Map<string, () => void>();
  /**
   * Desired targets from incremental syncs and subscription reconciliation.
   *
   * A workspace the policy refuses is dropped, and nothing would otherwise ask
   * again: `fetch_workspaces` is a client request, not a policy event. Keeping
   * the last set lets a self-driven admission change — an `auto`
   * classification landing — re-run the same sync that dropped it.
   */
  const lastSyncedDescriptors = new Map<
    string,
    Pick<WorkspaceDescriptorPayload, "id" | "workspaceDirectory" | "workspaceKind">
  >();
  let disposed = false;
  const unsubscribers: Array<() => void> = [];

  function rememberDescriptorState(
    workspaceId: string,
    workspace: WorkspaceDescriptorPayload | null,
  ): void {
    const state = workspaceStates.get(workspaceId);
    if (!state) {
      return;
    }
    const currentBranch = workspace?.gitRuntime?.currentBranch;
    if (currentBranch !== undefined) {
      state.lastBranchName = currentBranch;
    }
  }

  function removeForCwd(cwd: string): void {
    const normalizedCwd = resolve(cwd);
    const target = watchTargets.get(normalizedCwd);
    for (const workspaceId of target?.workspaceIds ?? []) {
      workspaceStates.delete(workspaceId);
    }
    watchTargets.delete(normalizedCwd);
    subscriptions.get(normalizedCwd)?.();
    subscriptions.delete(normalizedCwd);
  }

  function removeForWorkspaceId(workspaceId: string): void {
    const state = workspaceStates.get(workspaceId);
    if (!state) {
      return;
    }
    workspaceStates.delete(workspaceId);
    const target = watchTargets.get(state.cwd);
    target?.workspaceIds.delete(workspaceId);
    if (target?.workspaceIds.size === 0) {
      removeForCwd(state.cwd);
    }
  }

  function handleBranchSnapshot(cwd: string, branchName: string | null): void {
    const target = watchTargets.get(resolve(cwd));
    if (!target) {
      return;
    }

    for (const workspaceId of target.workspaceIds) {
      const state = workspaceStates.get(workspaceId);
      if (!state) {
        continue;
      }
      const previousBranchName = state.lastBranchName;
      if (branchName === previousBranchName) {
        continue;
      }
      state.lastBranchName = branchName;
      onBranchChanged?.(workspaceId, previousBranchName, branchName);
    }
  }

  const undecidedClassificationRequests = new Map<string, Promise<void>>();

  /**
   * Ask the policy service to settle a workspace whose storage is not yet
   * classified. Bounded to one in-flight request per path, and never awaited
   * here: classification reads the mount table rather than the workspace tree,
   * but it is still asynchronous work, so awaiting it would put another caller's
   * timing on this path.
   */
  function requestClassificationWhenUndecided(normalizedCwd: string): void {
    if (!gitActivity) {
      return;
    }
    if (undecidedClassificationRequests.has(normalizedCwd)) {
      return;
    }
    const state = gitActivity.peek(normalizedCwd);
    // `manual` is a decision; only an undetermined verdict can still change.
    if (state.effectiveMode !== "unknown") {
      return;
    }
    const pending = gitActivity
      .ensureClassification(normalizedCwd)
      .then(() => {
        if (disposed || !syncDesiredObservers(normalizedCwd)) return undefined;
        return emitWorkspaceUpdateForCwd(normalizedCwd);
      })
      .catch((error: unknown) => {
        logger.warn(
          { err: error, cwd: normalizedCwd },
          "Filesystem classification failed; workspace stays manual",
        );
      })
      .finally(() => {
        if (undecidedClassificationRequests.get(normalizedCwd) === pending) {
          undecidedClassificationRequests.delete(normalizedCwd);
        }
      });
    undecidedClassificationRequests.set(normalizedCwd, pending);
  }

  function syncObserver(cwd: string, options: { isGit: boolean; workspaceId: string }): void {
    const normalizedCwd = resolve(cwd);
    // Registering a workspace installs watchers, fetch and polls: that is exactly
    // what a manual policy forbids. Identity and cached state stay intact, so the
    // workspace still renders and an explicit refresh still works.
    if (gitActivity && !gitActivity.isAutomatic(normalizedCwd)) {
      removeForWorkspaceId(options.workspaceId);
      // "Not automatic" covers two very different states: a host decision, and
      // a workspace that simply has not been classified yet. Under `auto` the
      // second one is the normal case on first sight, and nothing else would
      // ever ask for the real answer -- `fetch_workspaces` is a client request,
      // not a policy event. Kick the bounded classification off here; when it
      // lands, its completion re-runs the still-requested observations.
      requestClassificationWhenUndecided(normalizedCwd);
      return;
    }
    const currentState = workspaceStates.get(options.workspaceId);
    if (currentState && currentState.cwd !== normalizedCwd) {
      removeForWorkspaceId(options.workspaceId);
    }
    if (!options.isGit) {
      removeForWorkspaceId(options.workspaceId);
      return;
    }

    const target = watchTargets.get(normalizedCwd) ?? {
      workspaceIds: new Set<string>(),
    };
    watchTargets.set(normalizedCwd, target);
    target.workspaceIds.add(options.workspaceId);
    if (!workspaceStates.has(options.workspaceId)) {
      workspaceStates.set(options.workspaceId, {
        cwd: normalizedCwd,
        lastBranchName: null,
      });
    }

    if (subscriptions.has(normalizedCwd)) {
      return;
    }

    let subscription: ReturnType<WorkspaceGitService["registerWorkspace"]>;
    try {
      subscription = workspaceGitService.registerWorkspace({ cwd: normalizedCwd }, (snapshot) => {
        handleBranchSnapshot(normalizedCwd, snapshot.git.currentBranch ?? null);
        void emitWorkspaceUpdateForCwd(normalizedCwd).catch((error) => {
          logger.warn(
            { err: error, cwd: normalizedCwd },
            "Failed to emit workspace update after git branch snapshot",
          );
        });
        emitStatusUpdate(normalizedCwd, snapshot);
      });
    } catch (error) {
      removeForWorkspaceId(options.workspaceId);
      throw error;
    }
    subscriptions.set(normalizedCwd, subscription.unsubscribe);
  }

  function syncObservers(workspaces: Iterable<WorkspaceDescriptorPayload>): void {
    for (const workspace of workspaces) {
      lastSyncedDescriptors.set(workspace.id, workspace);
      syncObserver(workspace.workspaceDirectory, {
        isGit: workspace.workspaceKind !== "directory",
        workspaceId: workspace.id,
      });
      rememberDescriptorState(workspace.id, workspace);
    }
  }

  function syncDesiredObservers(cwd: string): boolean {
    let affected = false;
    for (const workspace of lastSyncedDescriptors.values()) {
      if (resolve(workspace.workspaceDirectory) !== cwd) continue;
      affected = true;
      syncObserver(workspace.workspaceDirectory, {
        isGit: workspace.workspaceKind !== "directory",
        workspaceId: workspace.id,
      });
    }
    return affected;
  }

  // This observer owns both resubscription and projection notifications, so
  // dispose releases the only activity listener that captures the session.
  const stateChangeSubscription = workspaceGitService.onGitActivityStateChanged((cwd) => {
    if (disposed) return;
    const normalizedCwd = resolve(cwd);
    if (!syncDesiredObservers(normalizedCwd)) return;
    void emitWorkspaceUpdateForCwd(normalizedCwd).catch((error) => {
      logger.warn({ err: error, cwd: normalizedCwd }, "Failed to emit Git activity update");
    });
  });
  unsubscribers.push(() => stateChangeSubscription.unsubscribe());
  return {
    reconcileObservers(workspaces) {
      const retained = new Map([...workspaces].map((workspace) => [workspace.id, workspace]));
      for (const workspaceId of lastSyncedDescriptors.keys()) {
        if (!retained.has(workspaceId)) lastSyncedDescriptors.delete(workspaceId);
      }
      for (const workspaceId of workspaceStates.keys()) {
        if (!retained.has(workspaceId)) removeForWorkspaceId(workspaceId);
      }
      for (const workspace of retained.values()) {
        lastSyncedDescriptors.set(workspace.id, workspace);
        syncObserver(workspace.workspaceDirectory, {
          isGit: workspace.workspaceKind !== "directory",
          workspaceId: workspace.id,
        });
      }
    },
    syncObservers,
    recordDescriptorState(workspaceId, nextWorkspace) {
      const state = workspaceStates.get(workspaceId);
      const newBranchName = nextWorkspace?.gitRuntime?.currentBranch;
      if (state && onBranchChanged && newBranchName !== undefined) {
        if (newBranchName !== state.lastBranchName) {
          onBranchChanged(workspaceId, state.lastBranchName, newBranchName);
        }
      }
      rememberDescriptorState(workspaceId, nextWorkspace);
    },

    handleBranchSnapshot,

    getMetrics() {
      return {
        watchedDirectoryCount: watchTargets.size,
        workspaceRecordCount: workspaceStates.size,
        subscriptionCount: subscriptions.size,
      };
    },

    removeForWorkspaceId(workspaceId) {
      lastSyncedDescriptors.delete(workspaceId);
      removeForWorkspaceId(workspaceId);
    },

    dispose() {
      disposed = true;
      for (const unsubscribe of unsubscribers.splice(0)) {
        unsubscribe();
      }
      for (const unsubscribe of subscriptions.values()) {
        unsubscribe();
      }
      subscriptions.clear();
      watchTargets.clear();
      workspaceStates.clear();
      lastSyncedDescriptors.clear();
      undecidedClassificationRequests.clear();
    },
  };
}
