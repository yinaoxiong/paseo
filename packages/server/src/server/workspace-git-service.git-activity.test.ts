import path from "node:path";
import type pino from "pino";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { FileObserver } from "./file-observer/index.js";
import { WorkspaceGitServiceImpl } from "./workspace-git-service.js";
import {
  createAllowingGitActivityPolicy,
  createManualGitActivityPolicy,
} from "./test-utils/workspace-git-service-stub.js";
import type { GitActivityPolicyService } from "./git-activity/policy.js";
import { createGitActivityPolicyService } from "./git-activity/policy.js";
import type { FilesystemClassifier } from "./git-activity/filesystem.js";

const REPO_CWD = path.resolve("/tmp/paseo-git-activity-repo");
const GIT_DIR = path.join(REPO_CWD, ".git");

interface WatchEvent {
  path: string;
  type: "create" | "update" | "delete";
}

interface WatchRecord {
  directory: string;
  callback: (error: Error | null, events: WatchEvent[]) => void;
  ignore: Array<string | RegExp>;
  updateIgnore: ReturnType<typeof vi.fn>;
  unsubscribe: ReturnType<typeof vi.fn>;
}

function createWatcherHarness() {
  const records: WatchRecord[] = [];
  const subscribe = vi.fn(
    async (
      directory: string,
      callback: WatchRecord["callback"],
      options?: { ignore?: Array<string | RegExp> },
    ) => {
      const updateIgnore = vi.fn(async (paths: string[]) => {
        const record = records.find((candidate) => candidate.updateIgnore === updateIgnore);
        if (record) record.ignore = paths;
      });
      const unsubscribe = vi.fn(async () => {});
      records.push({
        directory,
        callback,
        ignore: options?.ignore ?? [],
        updateIgnore,
        unsubscribe,
      });
      return {
        updateIgnore,
        unsubscribe,
      };
    },
  );

  return { subscribe, records };
}

function createLogger(): pino.Logger {
  const logger = {
    child: () => logger,
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  };
  return logger as unknown as pino.Logger;
}

function createService(
  watcher: ReturnType<typeof createWatcherHarness>,
  gitActivity?: GitActivityPolicyService,
) {
  return new WorkspaceGitServiceImpl({
    logger: createLogger(),
    paseoHome: "/tmp/paseo-home",
    fileObserver: {
      subscribe: watcher.subscribe,
      close: async () => {},
      getDiagnostics: () => ({
        activeObservationCount: watcher.records.length,
        nativeHandleCount: 0,
        nativeTrackedFileCount: 0,
        pendingEventCount: 0,
        pendingReconciliationWorkCount: 0,
        reconciliationInFlightCount: 0,
        reconciliationCount: 0,
        scopedReconciliationCount: 0,
        fullReconciliationCount: 0,
        reconciliationFailureCount: 0,
        observerFailureCount: 0,
        directoryLimitFailureCount: 0,
        nativeEventCount: 0,
        nativeChangeEventCount: 0,
        nativeRenameEventCount: 0,
        nativePathlessEventCount: 0,
        nativeClassificationCount: 0,
        nativeShallowScanCount: 0,
        lastReconciliationDurationMs: 0,
        maxReconciliationDurationMs: 0,
      }),
    } as unknown as FileObserver,
    ...(gitActivity ? { gitActivity } : {}),
    deps: {
      subscribe: watcher.subscribe,
      getCheckoutSnapshotFacts: vi.fn(async (cwd: string) => ({
        cwd,
        isGit: true,
        worktreeRoot: cwd,
        absoluteGitDir: GIT_DIR,
        gitCommonDir: GIT_DIR,
        repoRoot: cwd,
        remoteUrl: null,
        upstreamStatus: null,
        currentBranch: "main",
      })),
      getCheckoutStatus: vi.fn(async (cwd: string) => ({
        isGit: true,
        repoRoot: cwd,
        mainRepoRoot: cwd,
        currentBranch: "main",
        remoteUrl: null,
        isPaseoOwnedWorktree: false,
        isDirty: false,
      })),
      getCheckoutShortstat: vi.fn(async () => ({ additions: 0, deletions: 0 })),
      resolveAbsoluteGitDir: vi.fn(async () => GIT_DIR),
      hasOriginRemote: vi.fn(async () => false),
      runGitCommand: vi.fn(async () => ({
        stdout: `${REPO_CWD}\n`,
        stderr: "",
        truncated: false,
        exitCode: 0,
        signal: null,
      })),
      createWatcherLivenessCanary: vi.fn(() => ({
        path: path.join(GIT_DIR, "paseo", ".watcher-canary"),
        filterEvents: (events: WatchEvent[]) => events,
        verify: vi.fn(async () => {}),
      })),
      resolveObservationRootAliases: async (root: string) => [root],
    } as never,
  });
}

async function flushPromises(): Promise<void> {
  for (let index = 0; index < 10; index += 1) {
    await Promise.resolve();
  }
}

/**
 * The acceptance bar: manual mode must create zero automatic Git. Watcher
 * subscriptions are the observable proxy — every watcher in this service exists
 * only to drive automatic Git work.
 */
describe("WorkspaceGitService git activity admission", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("a manual workspace registers a listener without any watcher, fetch or snapshot", async () => {
    const watcher = createWatcherHarness();
    const service = createService(watcher, createManualGitActivityPolicy());
    const snapshotListener = vi.fn();

    service.registerWorkspace({ cwd: REPO_CWD }, snapshotListener);
    await flushPromises();
    await vi.advanceTimersByTimeAsync(5_000);
    await flushPromises();

    expect(watcher.subscribe).not.toHaveBeenCalled();
    expect(watcher.records).toHaveLength(0);
    expect(snapshotListener).not.toHaveBeenCalled();

    const metrics = service.getMetrics();
    expect(metrics.workingTreeWatchTargetCount).toBe(0);
    expect(metrics.repositoryTargetCount).toBe(0);
    // The workspace is still known: identity and cached state survive.
    expect(metrics.workspaceTargetCount).toBe(1);
    expect(metrics.workspaceListenerCount).toBe(1);

    await service.dispose();
  });

  test("an admitted workspace still installs observation", async () => {
    const watcher = createWatcherHarness();
    const service = createService(watcher, createAllowingGitActivityPolicy());

    service.registerWorkspace({ cwd: REPO_CWD }, vi.fn());
    await flushPromises();
    await vi.advanceTimersByTimeAsync(1_000);
    await flushPromises();

    expect(watcher.subscribe).toHaveBeenCalled();
    expect(service.getMetrics().workingTreeWatchTargetCount).toBeGreaterThan(0);

    await service.dispose();
  });

  test("requestWorkingTreeWatch refuses to install a watcher on a manual workspace", async () => {
    const watcher = createWatcherHarness();
    const service = createService(watcher, createManualGitActivityPolicy());

    const result = await service.requestWorkingTreeWatch(REPO_CWD, vi.fn());
    await flushPromises();

    expect(result.repoRoot).toBeNull();
    expect(watcher.subscribe).not.toHaveBeenCalled();
    // Unsubscribe stays safe to call, which is what unsubscribe paths require.
    expect(() => result.unsubscribe()).not.toThrow();

    await service.dispose();
  });

  test("an explicit refresh still runs Git but arms no observation", async () => {
    const watcher = createWatcherHarness();
    const service = createService(watcher, createManualGitActivityPolicy());
    const listener = vi.fn();

    service.registerWorkspace({ cwd: REPO_CWD }, listener);
    await flushPromises();

    await service.refresh(REPO_CWD);
    await flushPromises();
    await vi.advanceTimersByTimeAsync(2_000);
    await flushPromises();

    // The user asked for it, so the snapshot was produced and delivered.
    expect(listener).toHaveBeenCalled();
    expect(service.peekSnapshot(REPO_CWD)).not.toBeNull();
    // ...but nothing was left running.
    expect(watcher.subscribe).not.toHaveBeenCalled();
    expect(service.getMetrics().workingTreeWatchTargetCount).toBe(0);

    await service.dispose();
  });

  test("agent-driven state changes do not schedule Git work on a manual workspace", async () => {
    const watcher = createWatcherHarness();
    const service = createService(watcher, createManualGitActivityPolicy());

    service.registerWorkspace({ cwd: REPO_CWD }, vi.fn());
    await flushPromises();

    service.onWorkspaceStateMayHaveChanged(REPO_CWD);
    service.scheduleRefreshForCwd(REPO_CWD);
    await flushPromises();
    await vi.advanceTimersByTimeAsync(5_000);
    await flushPromises();

    expect(watcher.subscribe).not.toHaveBeenCalled();
    expect(service.peekSnapshot(REPO_CWD)).toBeNull();

    await service.dispose();
  });

  test("a live policy disable closes admission before teardown and releases watchers", async () => {
    const watcher = createWatcherHarness();
    const allowed = { value: true };
    const policy: GitActivityPolicyService = {
      isAutomatic: () => allowed.value,
      peek: () => ({
        configuredPolicy: allowed.value ? "enabled" : "manual",
        effectiveMode: allowed.value ? "automatic" : "manual",
        reason: allowed.value ? "policy_enabled" : "policy_manual",
        lastCheckedAt: null,
      }),
      resolve: async () => ({
        configuredPolicy: allowed.value ? "enabled" : "manual",
        effectiveMode: allowed.value ? "automatic" : "manual",
        reason: "policy_enabled",
        lastCheckedAt: null,
      }),
      // This policy already answers every call synchronously, so there is
      // nothing for a classification to settle.
      ensureClassification: async (cwd: string) => ({ cwd, automatic: false }),
      refreshPolicy: () => {},
      invalidate: () => {},
      invalidateMountTable: () => {},
      dispose: () => {},
    };
    const service = createService(watcher, policy);

    service.registerWorkspace({ cwd: REPO_CWD }, vi.fn());
    await flushPromises();
    await vi.advanceTimersByTimeAsync(1_000);
    await flushPromises();
    expect(service.getMetrics().workingTreeWatchTargetCount).toBeGreaterThan(0);

    // Flip to manual. Admission closes synchronously: any automatic source
    // asking after this point is refused, even before teardown resolves.
    allowed.value = false;
    service.applyGitActivityPolicy();

    expect(policy.isAutomatic(REPO_CWD)).toBe(false);
    await flushPromises();
    await vi.advanceTimersByTimeAsync(5_000);
    await flushPromises();

    // The watcher was released, but the workspace identity remains.
    expect(service.getMetrics().workingTreeWatchTargetCount).toBe(0);
    expect(service.getMetrics().workspaceTargetCount).toBe(1);

    await service.dispose();
  });

  test("re-enable rebuilds observation once for still-subscribed workspaces only", async () => {
    const watcher = createWatcherHarness();
    const allowed = { value: false };
    const policy: GitActivityPolicyService = {
      isAutomatic: () => allowed.value,
      peek: () => ({
        configuredPolicy: allowed.value ? "enabled" : "manual",
        effectiveMode: allowed.value ? "automatic" : "manual",
        reason: "policy_enabled",
        lastCheckedAt: null,
      }),
      resolve: async () => ({
        configuredPolicy: allowed.value ? "enabled" : "manual",
        effectiveMode: allowed.value ? "automatic" : "manual",
        reason: "policy_enabled",
        lastCheckedAt: null,
      }),
      // This policy already answers every call synchronously, so there is
      // nothing for a classification to settle.
      ensureClassification: async (cwd: string) => ({ cwd, automatic: false }),
      refreshPolicy: () => {},
      invalidate: () => {},
      invalidateMountTable: () => {},
      dispose: () => {},
    };
    const service = createService(watcher, policy);

    service.registerWorkspace({ cwd: REPO_CWD }, vi.fn());
    await flushPromises();
    expect(watcher.subscribe).not.toHaveBeenCalled();

    allowed.value = true;
    const result = service.applyGitActivityPolicy();
    await flushPromises();
    await vi.advanceTimersByTimeAsync(2_000);
    await flushPromises();

    // Rebuilt for the workspace that is still subscribed.
    expect(result.restarted).toContain(REPO_CWD);
    expect(service.getMetrics().workingTreeWatchTargetCount).toBeGreaterThan(0);

    await service.dispose();
  });

  test("a shared repository stays open while any workspace on it is admitted", async () => {
    const watcher = createWatcherHarness();
    const admitted = new Set<string>([REPO_CWD]);
    const policy: GitActivityPolicyService = {
      isAutomatic: (cwd: string) => admitted.has(cwd),
      peek: () => ({
        configuredPolicy: "auto",
        effectiveMode: "automatic",
        reason: "storage_local",
        lastCheckedAt: null,
      }),
      resolve: async () => ({
        configuredPolicy: "auto",
        effectiveMode: "automatic",
        reason: "storage_local",
        lastCheckedAt: null,
      }),
      ensureClassification: async (cwd: string) => ({ cwd, automatic: false }),
      refreshPolicy: () => {},
      invalidate: () => {},
      invalidateMountTable: () => {},
      dispose: () => {},
    };
    const service = createService(watcher, policy);
    const secondCwd = path.resolve("/tmp/paseo-git-activity-second");

    service.registerWorkspace({ cwd: REPO_CWD }, vi.fn());
    // A second workspace resolves to the same repo (both facts return GIT_DIR).
    service.registerWorkspace({ cwd: secondCwd }, vi.fn());
    await flushPromises();
    await vi.advanceTimersByTimeAsync(1_000);
    await flushPromises();

    expect(service.getMetrics().repositoryTargetCount).toBe(1);

    // Withdrawing only the second workspace must not close the shared repo:
    // the first one is still admitted.
    admitted.delete(secondCwd);
    service.applyGitActivityPolicy();
    await flushPromises();

    expect(service.getMetrics().repositoryTargetCount).toBe(1);

    await service.dispose();
  });

  /**
   * B1: the pending-classification slot must be released by identity.
   *
   * Storing a derived promise and comparing against the un-derived one never
   * matches, so the map says "already pending" forever and a workspace that
   * classified as `unknown` — or whose probe threw — can never try again. These
   * tests drive the real service, not the policy service in isolation.
   */
  /**
   * The real policy service (not a stub) on the real service, driven by a
   * controllable clock so the verdict TTL actually expires.
   *
   * This is the end-to-end statement of the guarantee: a workspace that starts
   * `unknown` must converge on its own, rearm observation, and tell the
   * projection — including after a verdict has aged out, which is the case a
   * second-registration stub cannot exercise.
   */
  test("a real policy service reclassifies after the verdict TTL expires and rearms", async () => {
    const watcher = createWatcherHarness();
    let clock = 0;
    let local = false;
    let classifyCalls = 0;
    const classifier: FilesystemClassifier = {
      classify: async () => {
        classifyCalls += 1;
        return {
          class: local ? "local" : "unknown",
          reason: local ? "verified_local_mounts" : "mount_table_unavailable",
          mountFsType: local ? "ext4" : null,
          checkedAt: clock,
        };
      },
      invalidate: () => {},
      invalidateMountTable: () => {},
      dispose: () => {},
    };
    const policy = createGitActivityPolicyService({
      classifier,
      logger: createLogger(),
      getPolicy: () => "auto",
      now: () => clock,
      cacheTtlMs: 1_000,
    });
    const service = createService(watcher, policy);
    const notified: string[] = [];
    const subscription = service.onGitActivityStateChanged((cwd) => notified.push(cwd));

    // First sight: undecidable, so nothing starts.
    service.registerWorkspace({ cwd: REPO_CWD }, vi.fn());
    await flushPromises();
    expect(classifyCalls).toBe(1);
    expect(service.getMetrics().workingTreeWatchTargetCount).toBe(0);

    // The verdict ages out. Critically, nothing re-classifies in the
    // background: an untouched workspace is not periodically re-probed.
    clock += 1_500;
    await flushPromises();
    expect(classifyCalls, "no background reclassification").toBe(1);
    expect(service.getMetrics().workingTreeWatchTargetCount).toBe(0);

    // Storage is now verifiably local, and a registration asks again.
    local = true;
    service.registerWorkspace({ cwd: REPO_CWD }, vi.fn());
    await flushPromises();
    await vi.advanceTimersByTimeAsync(1_000);
    await flushPromises();

    expect(classifyCalls).toBe(2);
    expect(policy.isAutomatic(REPO_CWD)).toBe(true);
    // Observation actually started, and the projection was told once.
    expect(service.getMetrics().workingTreeWatchTargetCount).toBeGreaterThan(0);
    expect(notified).toEqual([REPO_CWD]);

    subscription.unsubscribe();
    await service.dispose();
  });

  test("a workspace that first classifies unknown retries on the next registration", async () => {
    const watcher = createWatcherHarness();
    let classificationCalls = 0;
    let admitted = false;
    const policy: GitActivityPolicyService = {
      isAutomatic: () => admitted,
      peek: () => ({
        configuredPolicy: "auto",
        effectiveMode: admitted ? "automatic" : "unknown",
        reason: admitted ? "storage_local" : "classification_pending",
        lastCheckedAt: null,
      }),
      resolve: async () => ({
        configuredPolicy: "auto",
        effectiveMode: admitted ? "automatic" : "unknown",
        reason: "classification_pending",
        lastCheckedAt: null,
      }),
      ensureClassification: async (cwd: string) => {
        classificationCalls += 1;
        // Settles to local only on the second attempt: the first verdict is
        // genuinely undecided, which is the normal auto-mode first sight.
        if (classificationCalls >= 2) admitted = true;
        return { cwd, automatic: admitted };
      },
      refreshPolicy: () => {},
      invalidate: () => {},
      invalidateMountTable: () => {},
      dispose: () => {},
    };
    const service = createService(watcher, policy);

    // First registration: unknown, so nothing starts.
    service.registerWorkspace({ cwd: REPO_CWD }, vi.fn());
    await flushPromises();
    expect(classificationCalls).toBe(1);
    expect(service.getMetrics().workingTreeWatchTargetCount).toBe(0);

    // Second registration must be allowed to retry. If the slot leaked, this is
    // a no-op and the workspace stays manual forever.
    service.registerWorkspace({ cwd: REPO_CWD }, vi.fn());
    await flushPromises();
    await vi.advanceTimersByTimeAsync(1_000);
    await flushPromises();

    expect(classificationCalls).toBe(2);
    expect(service.getMetrics().workingTreeWatchTargetCount).toBeGreaterThan(0);

    await service.dispose();
  });

  test("a failed classification releases its slot so the next registration retries", async () => {
    const watcher = createWatcherHarness();
    let attempts = 0;
    const policy: GitActivityPolicyService = {
      isAutomatic: () => false,
      peek: () => ({
        configuredPolicy: "auto",
        effectiveMode: "unknown",
        reason: "classification_pending",
        lastCheckedAt: null,
      }),
      resolve: async () => ({
        configuredPolicy: "auto",
        effectiveMode: "unknown",
        reason: "classification_pending",
        lastCheckedAt: null,
      }),
      ensureClassification: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("probe crashed");
        return { cwd: REPO_CWD, automatic: false };
      },
      refreshPolicy: () => {},
      invalidate: () => {},
      invalidateMountTable: () => {},
      dispose: () => {},
    };
    const service = createService(watcher, policy);

    service.registerWorkspace({ cwd: REPO_CWD }, vi.fn());
    await flushPromises();
    expect(attempts).toBe(1);

    // The first attempt threw; the slot must still be free to retry.
    service.registerWorkspace({ cwd: REPO_CWD }, vi.fn());
    await flushPromises();
    expect(attempts).toBe(2);

    await service.dispose();
  });

  test("late reclassification starts observation and notifies the projection", async () => {
    const watcher = createWatcherHarness();
    let admitted = false;
    const policy: GitActivityPolicyService = {
      isAutomatic: () => admitted,
      peek: () => ({
        configuredPolicy: "auto",
        effectiveMode: admitted ? "automatic" : "unknown",
        reason: admitted ? "storage_local" : "classification_pending",
        lastCheckedAt: null,
      }),
      resolve: async () => ({
        configuredPolicy: "auto",
        effectiveMode: admitted ? "automatic" : "unknown",
        reason: "classification_pending",
        lastCheckedAt: null,
      }),
      ensureClassification: async (cwd: string) => {
        admitted = true;
        return { cwd, automatic: true };
      },
      refreshPolicy: () => {},
      invalidate: () => {},
      invalidateMountTable: () => {},
      dispose: () => {},
    };
    const service = createService(watcher, policy);
    const notified: string[] = [];
    const subscription = service.onGitActivityStateChanged((cwd) => notified.push(cwd));

    // Nothing starts while undecided.
    service.registerWorkspace({ cwd: REPO_CWD }, vi.fn());
    await flushPromises();
    expect(watcher.subscribe).not.toHaveBeenCalled();

    // The verdict lands late: observation must actually start now, and the
    // session's projection listener must be told so the UI stops showing
    // "undetermined".
    await vi.advanceTimersByTimeAsync(1_000);
    await flushPromises();

    expect(service.getMetrics().workingTreeWatchTargetCount).toBeGreaterThan(0);
    expect(notified).toEqual([REPO_CWD]);

    subscription.unsubscribe();
    await service.dispose();
  });
});
