import { describe, expect, test, vi } from "vitest";
import type { Logger } from "pino";
import type { GitActivityPolicy } from "@getpaseo/protocol/messages";
import { createGitActivityPolicyService } from "./policy.js";
import type { FilesystemClassifier, WorkspaceFilesystemVerdict } from "./filesystem.js";

function createLogger(): Logger {
  const logger = {
    child: () => logger,
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  };
  return logger as unknown as Logger;
}

const FIXED_NOW = 1_700_000_000_000;

function verdict(fields: Partial<WorkspaceFilesystemVerdict>): WorkspaceFilesystemVerdict {
  return {
    class: "local",
    reason: "verified_local_mounts",
    mountFsType: "ext4",
    checkedAt: FIXED_NOW,
    ...fields,
  };
}

function createClassifierStub(classify: (cwd: string) => Promise<WorkspaceFilesystemVerdict>) {
  return {
    classify,
    invalidate: vi.fn(),
    invalidateMountTable: vi.fn(),
    dispose: vi.fn(),
  } as unknown as FilesystemClassifier & {
    invalidate: ReturnType<typeof vi.fn>;
    invalidateMountTable: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
  };
}

function createPolicy(options: {
  policy: GitActivityPolicy;
  classify?: (cwd: string) => Promise<WorkspaceFilesystemVerdict>;
  now?: () => number;
  cacheTtlMs?: number;
  maxEntries?: number;
}) {
  let policy: GitActivityPolicy = options.policy;
  const classifier = createClassifierStub(options.classify ?? (async () => verdict({})));
  const service = createGitActivityPolicyService({
    classifier,
    logger: createLogger(),
    getPolicy: () => policy,
    now: options.now ?? (() => FIXED_NOW),
    ...(options.cacheTtlMs === undefined ? {} : { cacheTtlMs: options.cacheTtlMs }),
    ...(options.maxEntries === undefined ? {} : { maxEntries: options.maxEntries }),
  });
  return {
    service,
    classifier,
    setPolicy(next: GitActivityPolicy) {
      policy = next;
      service.refreshPolicy();
    },
  };
}

describe("git activity policy", () => {
  test("manual never invokes the classifier", async () => {
    const classify = vi.fn(async () => verdict({}));
    const { service } = createPolicy({ policy: "manual", classify });

    const state = await service.resolve("/tmp/repo");

    expect(classify).not.toHaveBeenCalled();
    expect(state.configuredPolicy).toBe("manual");
    expect(state.effectiveMode).toBe("manual");
    expect(state.reason).toBe("policy_manual");
    expect(state.lastCheckedAt).toBeNull();
    expect(service.isAutomatic("/tmp/repo")).toBe(false);
  });

  test("enabled skips the classifier and is automatic", async () => {
    const classify = vi.fn(async () => verdict({ class: "network" }));
    const { service } = createPolicy({ policy: "enabled", classify });

    const state = await service.resolve("/mnt/jfs_gy/repo");

    expect(classify).not.toHaveBeenCalled();
    expect(state.effectiveMode).toBe("automatic");
    expect(state.reason).toBe("policy_enabled");
    expect(service.isAutomatic("/mnt/jfs_gy/repo")).toBe(true);
  });

  test("auto with a verified local workspace is automatic", async () => {
    const { service } = createPolicy({ policy: "auto" });

    const state = await service.resolve("/tmp/repo");

    expect(state.effectiveMode).toBe("automatic");
    expect(state.reason).toBe("storage_local");
    expect(state.lastCheckedAt).toBe(new Date(FIXED_NOW).toISOString());
    expect(service.isAutomatic("/tmp/repo")).toBe(true);
  });

  test("auto on network and unknown storage is manual, not automatic", async () => {
    const { service } = createPolicy({
      policy: "auto",
      classify: async (cwd) =>
        cwd === "/mnt/jfs_gy/repo"
          ? verdict({
              class: "network",
              reason: "cwd_on_network_mount",
              mountFsType: "fuse.juicefs",
            })
          : verdict({ class: "unknown", reason: "mount_table_unavailable", mountFsType: null }),
    });

    const network = await service.resolve("/mnt/jfs_gy/repo");
    const unknown = await service.resolve("/mnt/mystery/repo");

    expect(network.effectiveMode).toBe("manual");
    expect(network.reason).toBe("storage_network");
    expect(unknown.effectiveMode).toBe("manual");
    expect(unknown.reason).toBe("storage_unknown");
    expect(service.isAutomatic("/mnt/jfs_gy/repo")).toBe(false);
    expect(service.isAutomatic("/mnt/mystery/repo")).toBe(false);
  });

  test("an unclassified auto workspace is unknown and never automatic", () => {
    const { service } = createPolicy({ policy: "auto" });

    const state = service.peek("/tmp/repo");

    expect(state.effectiveMode).toBe("unknown");
    expect(state.reason).toBe("classification_pending");
    expect(state.lastCheckedAt).toBeNull();
    // The whole point: no caller may treat "not yet classified" as permission.
    expect(service.isAutomatic("/tmp/repo")).toBe(false);
  });

  test("a classification failure leaves the workspace unknown", async () => {
    const { service } = createPolicy({
      policy: "auto",
      classify: async () => {
        throw new Error("probe exploded");
      },
    });

    const state = await service.resolve("/tmp/repo");

    expect(state.effectiveMode).toBe("unknown");
    expect(state.reason).toBe("classification_pending");
    expect(service.isAutomatic("/tmp/repo")).toBe(false);
  });

  test("concurrent resolve calls classify once and share the verdict", async () => {
    let release: (value: WorkspaceFilesystemVerdict) => void = () => {};
    const gate = new Promise<WorkspaceFilesystemVerdict>((resolvePromise) => {
      release = resolvePromise;
    });
    const classify = vi.fn(() => gate);
    const { service } = createPolicy({ policy: "auto", classify });

    const first = service.resolve("/tmp/repo");
    const second = service.resolve("/tmp/repo");
    release(verdict({}));
    const [a, b] = await Promise.all([first, second]);

    expect(classify).toHaveBeenCalledTimes(1);
    expect(a.effectiveMode).toBe("automatic");
    expect(b.effectiveMode).toBe("automatic");
  });

  test("a verdict computed under a retired policy is not stored", async () => {
    let release: (value: WorkspaceFilesystemVerdict) => void = () => {};
    const gate = new Promise<WorkspaceFilesystemVerdict>((resolvePromise) => {
      release = resolvePromise;
    });
    const { service, setPolicy } = createPolicy({ policy: "auto", classify: () => gate });

    const pending = service.resolve("/tmp/repo");
    setPolicy("manual");
    release(verdict({}));
    const state = await pending;

    // The local verdict arrived after manual took effect; it must not be
    // admitted, or old automatic work would re-arm from the cache.
    expect(state.effectiveMode).toBe("manual");
    expect(service.isAutomatic("/tmp/repo")).toBe(false);
  });

  test("a live policy change flips admission without re-classifying", async () => {
    const classify = vi.fn(async () => verdict({}));
    const { service, setPolicy } = createPolicy({ policy: "auto", classify });

    await service.resolve("/tmp/repo");
    expect(service.isAutomatic("/tmp/repo")).toBe(true);

    setPolicy("manual");
    expect(service.isAutomatic("/tmp/repo")).toBe(false);
    expect(service.peek("/tmp/repo").configuredPolicy).toBe("manual");

    setPolicy("auto");
    expect(service.isAutomatic("/tmp/repo")).toBe(true);
    expect(classify).toHaveBeenCalledTimes(1);

    setPolicy("enabled");
    expect(service.isAutomatic("/mnt/jfs_gy/repo")).toBe(true);
  });

  test("invalidate and invalidateMountTable drop cached verdicts", async () => {
    const classify = vi.fn(async () => verdict({}));
    const { service, classifier } = createPolicy({ policy: "auto", classify });

    await service.resolve("/tmp/repo");
    await service.resolve("/tmp/other");
    expect(classify).toHaveBeenCalledTimes(2);

    service.invalidate("/tmp/repo");
    await service.resolve("/tmp/repo");
    expect(classify).toHaveBeenCalledTimes(3);

    service.invalidateMountTable();
    expect(classifier.invalidateMountTable).toHaveBeenCalledTimes(1);
    await service.resolve("/tmp/other");
    expect(classify).toHaveBeenCalledTimes(4);
  });

  test("dispose releases the classifier", () => {
    const { service, classifier } = createPolicy({ policy: "auto" });
    service.dispose();
    expect(classifier.dispose).toHaveBeenCalledTimes(1);
  });
});

describe("git activity policy cache freshness and invalidation", () => {
  test("a verdict older than the TTL is not served and triggers one bounded re-check", async () => {
    let clock = 0;
    let calls = 0;
    const { service } = createPolicy({
      policy: "auto",
      now: () => clock,
      cacheTtlMs: 1_000,
      classify: async () => {
        calls += 1;
        return verdict({ checkedAt: clock });
      },
    });

    expect(await service.resolve("/tmp/repo")).toMatchObject({ effectiveMode: "automatic" });
    expect(calls).toBe(1);

    // Inside the TTL: no re-classification.
    clock += 500;
    expect(await service.resolve("/tmp/repo")).toMatchObject({ effectiveMode: "automatic" });
    expect(calls).toBe(1);

    // Aged out: the old permission is not reused, and exactly one probe runs.
    clock += 600;
    const aged = await service.resolve("/tmp/repo");
    expect(aged.effectiveMode).toBe("automatic");
    expect(calls).toBe(2);
  });

  test("an expired verdict reads as unknown until it is re-checked", async () => {
    let clock = 0;
    const { service } = createPolicy({
      policy: "auto",
      now: () => clock,
      cacheTtlMs: 1_000,
      classify: async () => verdict({ checkedAt: clock }),
    });

    await service.resolve("/tmp/repo");
    clock += 1_500;

    // Conservative: stale permission is never granted, even transiently.
    expect(service.isAutomatic("/tmp/repo")).toBe(false);
    const peeked = service.peek("/tmp/repo");
    expect(peeked.effectiveMode).toBe("unknown");
    expect(peeked.reason).toBe("classification_expired");
    // lastCheckedAt still reports the last completed check, not "never".
    expect(peeked.lastCheckedAt).not.toBeNull();
  });

  test("a network verdict recovers after invalidation followed by a local reclassify", async () => {
    let storage: WorkspaceFilesystemVerdict["class"] = "network";
    const { service } = createPolicy({
      policy: "auto",
      classify: async () => verdict({ class: storage }),
    });

    expect(await service.resolve("/mnt/jfs_gy/repo")).toMatchObject({ effectiveMode: "manual" });

    // The mount was replaced with a local disk and the caller invalidated.
    storage = "local";
    service.invalidate("/mnt/jfs_gy/repo");
    expect(await service.resolve("/mnt/jfs_gy/repo")).toMatchObject({ effectiveMode: "automatic" });
  });

  test("an unknown verdict recovers after the TTL instead of sticking forever", async () => {
    let clock = 0;
    let storage: WorkspaceFilesystemVerdict["class"] = "unknown";
    const { service } = createPolicy({
      policy: "auto",
      now: () => clock,
      cacheTtlMs: 1_000,
      classify: async () => verdict({ class: storage }),
    });

    expect(await service.resolve("/tmp/repo")).toMatchObject({ effectiveMode: "manual" });

    storage = "local";
    clock += 1_500;
    expect(await service.resolve("/tmp/repo")).toMatchObject({ effectiveMode: "automatic" });
  });

  test("the verdict cache is bounded", async () => {
    const { service } = createPolicy({ policy: "auto", maxEntries: 3 });
    for (let index = 0; index < 10; index += 1) {
      await service.resolve(`/tmp/repo-${index}`);
    }
    // Older entries were evicted rather than growing without bound; the newest
    // three survive.
    expect(service.isAutomatic("/tmp/repo-9")).toBe(true);
    expect(service.isAutomatic("/tmp/repo-8")).toBe(true);
    expect(service.isAutomatic("/tmp/repo-7")).toBe(true);
    expect(service.isAutomatic("/tmp/repo-0")).toBe(false);
  });

  test("invalidate during an in-flight classification prevents the stale verdict landing", async () => {
    let release: ((value: WorkspaceFilesystemVerdict) => void) | null = null;
    const gate = new Promise<WorkspaceFilesystemVerdict>((resolvePromise) => {
      release = resolvePromise;
    });
    const { service } = createPolicy({ policy: "auto", classify: () => gate });

    const pending = service.resolve("/tmp/repo");
    // The mount changed while the probe was still running.
    service.invalidate("/tmp/repo");
    release?.(verdict({}));
    const state = await pending;

    // The late local verdict must not re-enable a workspace that was just
    // invalidated; the caller asked for it to be dropped.
    expect(state.effectiveMode).toBe("unknown");
    expect(service.isAutomatic("/tmp/repo")).toBe(false);
  });

  test("an auto -> manual -> auto switch does not admit a verdict from before the switch", async () => {
    let release: ((value: WorkspaceFilesystemVerdict) => void) | null = null;
    const gate = new Promise<WorkspaceFilesystemVerdict>((resolvePromise) => {
      release = resolvePromise;
    });
    const { service, setPolicy } = createPolicy({ policy: "auto", classify: () => gate });

    const pending = service.resolve("/tmp/repo");
    // Away and back, so the policy value is "auto" again by the time the probe
    // lands. Comparing values would wrongly admit it.
    setPolicy("manual");
    setPolicy("auto");
    release?.(verdict({}));
    const state = await pending;

    expect(state.effectiveMode).toBe("unknown");
    expect(service.isAutomatic("/tmp/repo")).toBe(false);
  });

  test("a policy switch invalidates every in-flight classification", async () => {
    let release: ((value: WorkspaceFilesystemVerdict) => void) | null = null;
    const gate = new Promise<WorkspaceFilesystemVerdict>((resolvePromise) => {
      release = resolvePromise;
    });
    const { service, setPolicy } = createPolicy({ policy: "auto", classify: () => gate });

    const pending = service.resolve("/tmp/repo");
    setPolicy("manual");
    release?.(verdict({}));
    const state = await pending;

    expect(state.effectiveMode).toBe("manual");
    expect(service.isAutomatic("/tmp/repo")).toBe(false);
  });

  test("dispose stops a late classification from re-enabling anything", async () => {
    let release: ((value: WorkspaceFilesystemVerdict) => void) | null = null;
    const gate = new Promise<WorkspaceFilesystemVerdict>((resolvePromise) => {
      release = resolvePromise;
    });
    const { service } = createPolicy({ policy: "auto", classify: () => gate });

    const pending = service.resolve("/tmp/repo");
    service.dispose();
    release?.(verdict({}));
    const state = await pending;

    expect(state.effectiveMode).toBe("manual");
    expect(service.isAutomatic("/tmp/repo")).toBe(false);
    // Disposed is terminal: even a fresh verdict cannot resurrect admission.
    expect(service.peek("/tmp/repo").effectiveMode).toBe("manual");
  });

  test("invalidate(cwd) also invalidates the underlying classifier", async () => {
    const { service, classifier } = createPolicy({ policy: "auto" });
    service.invalidate("/tmp/repo");
    expect(classifier.invalidate).toHaveBeenCalledWith("/tmp/repo");
  });

  test("dispose is idempotent and releases the classifier once", () => {
    const { service, classifier } = createPolicy({ policy: "auto" });
    service.dispose();
    service.dispose();
    expect(classifier.dispose).toHaveBeenCalledTimes(1);
  });

  test("ensureClassification reports only the workspaces it newly admits", async () => {
    const { service } = createPolicy({ policy: "auto" });

    // First call actually decides the workspace: unknown -> automatic.
    const first = await service.ensureClassification("/tmp/repo");
    expect(first).toEqual({ cwd: "/tmp/repo", automatic: true });

    // A caller that restarts observation must not do it twice for a workspace
    // that is already running, so an unchanged verdict reports false.
    const second = await service.ensureClassification("/tmp/repo");
    expect(second).toEqual({ cwd: "/tmp/repo", automatic: false });

    expect(service.isAutomatic("/tmp/repo")).toBe(true);
  });

  test("ensureClassification converges a storm of callers onto one probe", async () => {
    let calls = 0;
    const { service } = createPolicy({
      policy: "auto",
      classify: async () => {
        calls += 1;
        return verdict({});
      },
    });

    const results = await Promise.all(
      Array.from({ length: 25 }, () => service.ensureClassification("/tmp/repo")),
    );

    expect(calls).toBe(1);
    // Exactly one caller is told to start: the rest see an already-admitted
    // workspace and must not each start observation.
    expect(results.filter((result) => result.automatic).length).toBe(1);
  });

  test("ensureClassification collapses repeated calls once settled", async () => {
    let calls = 0;
    const { service } = createPolicy({
      policy: "auto",
      classify: async () => {
        calls += 1;
        return verdict({ class: "unknown", reason: "mount_table_unavailable" });
      },
    });

    // An undecidable workspace stays manual on every attempt.
    const first = await service.ensureClassification("/tmp/repo");
    expect(first.automatic).toBe(false);
    const second = await service.ensureClassification("/tmp/repo");
    expect(second.automatic).toBe(false);
    expect(service.isAutomatic("/tmp/repo")).toBe(false);
    // One probe, not one per caller: the in-flight slot is the bound.
    expect(calls).toBe(1);
  });

  test("an expired verdict drops admission until it is re-checked", async () => {
    let clock = 0;
    let calls = 0;
    const { service } = createPolicy({
      policy: "auto",
      now: () => clock,
      cacheTtlMs: 1_000,
      classify: async () => {
        calls += 1;
        return verdict({ checkedAt: clock });
      },
    });

    await service.resolve("/tmp/repo");
    expect(service.isAutomatic("/tmp/repo")).toBe(true);

    // TTL expiry: stale permission must never be granted.
    clock += 1_500;
    expect(service.isAutomatic("/tmp/repo")).toBe(false);
    expect(service.peek("/tmp/repo").reason).toBe("classification_expired");

    // Re-checking restores admission, and the caller is told it changed.
    const result = await service.ensureClassification("/tmp/repo");
    expect(result.automatic).toBe(true);
    expect(service.isAutomatic("/tmp/repo")).toBe(true);
    expect(calls).toBe(2);
  });

  test("an expired verdict that reclassifies as network stays manual", async () => {
    let clock = 0;
    let network = false;
    const { service } = createPolicy({
      policy: "auto",
      now: () => clock,
      cacheTtlMs: 1_000,
      classify: async () =>
        network
          ? verdict({ class: "network", reason: "cwd_on_network_mount", checkedAt: clock })
          : verdict({ checkedAt: clock }),
    });

    await service.resolve("/tmp/repo");
    expect(service.isAutomatic("/tmp/repo")).toBe(true);

    // The mount changed underneath us: the workspace is now on network storage.
    clock += 1_500;
    network = true;
    const result = await service.ensureClassification("/tmp/repo");

    expect(result.automatic).toBe(false);
    expect(service.isAutomatic("/tmp/repo")).toBe(false);
  });

  test("TTL expiry does not start a new probe for every workspace at once", async () => {
    let clock = 0;
    let calls = 0;
    const { service } = createPolicy({
      policy: "auto",
      now: () => clock,
      cacheTtlMs: 1_000,
      classify: async () => {
        calls += 1;
        return verdict({ checkedAt: clock });
      },
    });

    for (const cwd of ["/tmp/a", "/tmp/b", "/tmp/c"]) {
      await service.resolve(cwd);
    }
    clock += 1_500;
    const before = calls;

    // Expired peeks are conservative reads; they arm at most one probe each and
    // never a burst per caller.
    for (let index = 0; index < 20; index += 1) {
      service.peek("/tmp/a");
      service.peek("/tmp/b");
      service.peek("/tmp/c");
    }
    expect(calls - before).toBe(3);
  });

  test("a probe that completes after eviction and re-registration cannot land (ABA)", async () => {
    let clock = 0;
    // One deferred per classify() call, in call order, so the test decides
    // exactly which probe completes and when.
    const probes: Array<(v: WorkspaceFilesystemVerdict) => void> = [];
    let classifyCalls = 0;
    const { service } = createPolicy({
      policy: "auto",
      now: () => clock,
      cacheTtlMs: 10_000,
      // Single-entry bookkeeping: adding a second key evicts the first's.
      maxEntries: 1,
      classify: () => {
        classifyCalls += 1;
        return new Promise<WorkspaceFilesystemVerdict>((resolve) => {
          probes.push(resolve);
        });
      },
    });
    const flush = () => new Promise((done) => setImmediate(done));

    // Probe 1 starts for /tmp/repo and stays in flight. It captured version 0.
    const first = service.resolve("/tmp/repo");
    await flush();
    expect(classifyCalls).toBe(1);
    expect(probes).toHaveLength(1);

    // The caller drops this workspace: version bumps to 1 and the in-flight slot
    // goes with it.
    service.invalidate("/tmp/repo");

    // Classifying another key overflows the single-entry bookkeeping, evicting
    // /tmp/repo's version entry entirely.
    const other = service.resolve("/tmp/other");
    await flush();
    expect(probes).toHaveLength(2);
    probes[1]?.(verdict({ checkedAt: clock }));
    await other;

    // /tmp/repo is probed again. Its version entry is gone, so it is registered
    // as 0 once more -- the exact value probe 1 captured.
    const second = service.resolve("/tmp/repo");
    await flush();
    expect(classifyCalls).toBe(3);
    expect(probes).toHaveLength(3);

    // Probe 1 now completes late with a *local* verdict. By version number alone
    // it matches (0 === 0) and would grant admission from a stale probe; it is
    // rejected because its attempt is no longer the live one.
    probes[0]?.(verdict({ checkedAt: clock }));
    await first;

    expect(service.isAutomatic("/tmp/repo"), "stale probe must not grant admission").toBe(false);

    // The current probe still can, so the mechanism is not simply refusing all.
    probes[2]?.(verdict({ checkedAt: clock }));
    await second;
    expect(service.isAutomatic("/tmp/repo")).toBe(true);
  });

  test("a global invalidate rejects an in-flight probe for a key that never had a verdict", async () => {
    let release: ((v: WorkspaceFilesystemVerdict) => void) | null = null;
    const { service } = createPolicy({
      policy: "auto",
      // Never-classified key: it has no version entry at all.
      classify: () =>
        new Promise<WorkspaceFilesystemVerdict>((resolve) => {
          release = resolve;
        }),
    });

    const pending = service.resolve("/tmp/never-classified");
    // Nothing has been stored for this key yet.
    expect(service.peek("/tmp/never-classified").effectiveMode).toBe("unknown");

    service.invalidate();

    // The probe completes after the global drop: it must not be admitted.
    release?.(verdict({}));
    await pending;

    expect(service.isAutomatic("/tmp/never-classified")).toBe(false);
    expect(service.peek("/tmp/never-classified").effectiveMode).toBe("unknown");
  });

  test("invalidateMountTable rejects in-flight probes too", async () => {
    let release: ((v: WorkspaceFilesystemVerdict) => void) | null = null;
    const { service } = createPolicy({
      policy: "auto",
      classify: () =>
        new Promise<WorkspaceFilesystemVerdict>((resolve) => {
          release = resolve;
        }),
    });

    const pending = service.resolve("/tmp/mount-change");
    service.invalidateMountTable();
    release?.(verdict({}));
    await pending;

    expect(service.isAutomatic("/tmp/mount-change")).toBe(false);
  });

  test("a stale probe cannot grant admission when the mount became network", async () => {
    // One deferred per classify() call, so the test controls completion order.
    const probes: Array<(v: WorkspaceFilesystemVerdict) => void> = [];
    const { service } = createPolicy({
      policy: "auto",
      classify: () =>
        new Promise<WorkspaceFilesystemVerdict>((resolve) => {
          probes.push(resolve);
        }),
    });

    const pending = service.resolve("/tmp/repo");
    await new Promise((done) => setImmediate(done));

    // The topology changes while the probe is in flight; everything is dropped.
    service.invalidateMountTable();

    // The probe still reports "local", from before the change.
    probes[0]?.(verdict({ checkedAt: 0 }));
    await pending;

    expect(service.isAutomatic("/tmp/repo"), "stale verdict refused").toBe(false);
  });

  test("repeated peeks on an expired verdict do not start a probe per caller", async () => {
    let clock = 0;
    let calls = 0;
    const { service } = createPolicy({
      policy: "auto",
      now: () => clock,
      cacheTtlMs: 1_000,
      classify: async () => {
        calls += 1;
        return verdict({ checkedAt: clock });
      },
    });

    await service.resolve("/tmp/repo");
    clock += 1_500;
    const callsBeforeStorm = calls;
    // A reconnect storm of synchronous peeks: bounded, not one probe each.
    for (let index = 0; index < 50; index += 1) {
      service.peek("/tmp/repo");
    }
    expect(calls - callsBeforeStorm).toBe(1);
  });
});
