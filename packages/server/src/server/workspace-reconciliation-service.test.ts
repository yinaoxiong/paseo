import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { GitActivityPolicy, ProjectCheckoutLitePayload } from "@getpaseo/protocol/messages";
import type pino from "pino";
import { afterEach, describe, expect, test } from "vitest";
import {
  createPersistedProjectRecord,
  createPersistedWorkspaceRecord,
} from "./workspace-registry.js";
import type {
  PersistedProjectRecord,
  PersistedWorkspaceRecord,
  ProjectRegistry,
  WorkspaceRegistry,
} from "./workspace-registry.js";
import {
  type ProjectRootWatch,
  type ReconciliationChange,
  type ReconciliationClock,
  type ReconciliationGitActivity,
  type ReconciliationTimer,
  WorkspaceReconciliationService,
} from "./workspace-reconciliation-service.js";
import { deriveProjectKey } from "./project-key.js";
import { createGitActivityPolicyService } from "./git-activity/policy.js";
import type {
  FilesystemClassifier,
  WorkspaceFilesystemVerdict,
} from "./git-activity/filesystem.js";

function canonicalLocalProjectKey(rootPath: string): string {
  return deriveProjectKey({
    rootPath,
    remoteUrl: null,
    worktreeRoot: null,
    mainRepoRoot: null,
  });
}

function createTestRegistries() {
  const projects = new Map<string, PersistedProjectRecord>();
  const workspaces = new Map<string, PersistedWorkspaceRecord>();

  const projectRegistry: ProjectRegistry = {
    initialize: async () => {},
    existsOnDisk: async () => true,
    list: async () => Array.from(projects.values()),
    get: async (id: string) => projects.get(id) ?? null,
    getOrCreateActiveByRoot: async (input) => {
      const existing = Array.from(projects.values()).find(
        (project) => !project.archivedAt && project.rootPath === input.rootPath,
      );
      if (existing) return existing;
      const record = createPersistedProjectRecord({
        projectId: `prj_${projects.size}`,
        rootPath: input.rootPath,
        kind: input.kind,
        displayName: input.displayName,
        createdAt: input.timestamp,
        updatedAt: input.timestamp,
      });
      projects.set(record.projectId, record);
      return record;
    },
    upsert: async (record: PersistedProjectRecord) => {
      projects.set(record.projectId, record);
    },
    archive: async (id: string, archivedAt: string) => {
      const existing = projects.get(id);
      if (existing) {
        projects.set(id, { ...existing, archivedAt, updatedAt: archivedAt });
      }
    },
    remove: async (id: string) => {
      projects.delete(id);
    },
  };

  const workspaceRegistry: WorkspaceRegistry = {
    initialize: async () => {},
    existsOnDisk: async () => true,
    list: async () => Array.from(workspaces.values()),
    get: async (id: string) => workspaces.get(id) ?? null,
    update: async (id, updater) => {
      const existing = workspaces.get(id);
      if (!existing) return null;
      const updated = updater(existing);
      workspaces.set(id, updated);
      return updated;
    },
    upsert: async (record: PersistedWorkspaceRecord) => {
      workspaces.set(record.workspaceId, record);
    },
    archive: async (id: string, archivedAt: string) => {
      const existing = workspaces.get(id);
      if (existing) {
        workspaces.set(id, { ...existing, archivedAt, updatedAt: archivedAt });
      }
    },
    remove: async (id: string) => {
      workspaces.delete(id);
    },
  };

  return { projects, workspaces, projectRegistry, workspaceRegistry };
}

function createTestLogger() {
  const logger = {
    child: () => logger,
    trace: () => undefined,
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
  return logger as unknown as pino.Logger;
}

interface CapturedLogRecord {
  message: string;
  payload: unknown;
}

function createCapturingLogger() {
  const infoRecords: CapturedLogRecord[] = [];
  const logger = {
    child: () => logger,
    trace: () => undefined,
    debug: () => undefined,
    info: (payload: unknown, message?: string) => {
      infoRecords.push({ payload, message: message ?? "" });
    },
    warn: () => undefined,
    error: () => undefined,
  };
  return { logger: logger as unknown as pino.Logger, infoRecords };
}

function createWorkspaceGitServiceStub(
  metadataByCwd: Record<
    string,
    {
      projectKind: "git" | "directory";
      projectDisplayName: string;
      workspaceDisplayName: string;
      gitRemote?: string | null;
      currentBranch?: string | null;
    }
  >,
) {
  return {
    getCheckout: async (cwd: string) => {
      const metadata = metadataByCwd[cwd];
      if (!metadata) {
        return {
          cwd,
          isGit: false as const,
          currentBranch: null,
          remoteUrl: null,
          worktreeRoot: null,
          isPaseoOwnedWorktree: false,
          mainRepoRoot: null,
        };
      }
      return {
        cwd,
        isGit: metadata.projectKind === "git",
        currentBranch: metadata.currentBranch ?? metadata.workspaceDisplayName,
        remoteUrl: metadata.gitRemote ?? null,
        worktreeRoot: null,
        isPaseoOwnedWorktree: false,
        mainRepoRoot: null,
      };
    },
  };
}

function createCheckout(
  cwd: string,
  overrides: Partial<ProjectCheckoutLitePayload> = {},
): ProjectCheckoutLitePayload {
  return {
    cwd,
    isGit: false,
    currentBranch: null,
    remoteUrl: null,
    worktreeRoot: null,
    isPaseoOwnedWorktree: false,
    mainRepoRoot: null,
    ...overrides,
  };
}

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void;
  const promise = new Promise<void>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

interface TestTimer extends ReconciliationTimer {
  callback: () => void | Promise<void>;
  dueAt: number;
  intervalMs: number | null;
}

/** Drives the rescan interval without waiting on wall-clock time. */
class TestClock implements ReconciliationClock {
  private now = 0;
  private readonly timers = new Set<TestTimer>();

  setTimeout(callback: () => void | Promise<void>, delayMs: number): TestTimer {
    return this.add(callback, delayMs, null);
  }

  clearTimeout(timer: ReconciliationTimer): void {
    this.timers.delete(timer as TestTimer);
  }

  setInterval(callback: () => void | Promise<void>, delayMs: number): TestTimer {
    return this.add(callback, delayMs, delayMs);
  }

  clearInterval(timer: ReconciliationTimer): void {
    this.timers.delete(timer as TestTimer);
  }

  /** Fires every timer due within `elapsedMs`, in due order, awaiting each. */
  async advanceBy(elapsedMs: number): Promise<void> {
    const target = this.now + elapsedMs;
    for (;;) {
      const next = [...this.timers]
        .filter((timer) => timer.dueAt <= target)
        .sort((left, right) => left.dueAt - right.dueAt)[0];
      if (!next) break;
      this.now = next.dueAt;
      if (next.intervalMs === null) this.timers.delete(next);
      else next.dueAt += next.intervalMs;
      await next.callback();
    }
    this.now = target;
  }

  private add(
    callback: () => void | Promise<void>,
    delayMs: number,
    intervalMs: number | null,
  ): TestTimer {
    const timer = { callback, dueAt: this.now + delayMs, intervalMs, unref: () => undefined };
    this.timers.add(timer);
    return timer;
  }
}

/**
 * The real policy service over a scripted classifier, so the gate is exercised
 * against actual `unknown`/`manual`/`automatic` transitions and the real 60s
 * verdict TTL rather than a stub that hardcodes a boolean.
 */
function createTestGitActivity(options: {
  policy: GitActivityPolicy;
  classify?: (cwd: string) => Promise<WorkspaceFilesystemVerdict>;
  cacheTtlMs?: number;
}): {
  gitActivity: ReconciliationGitActivity;
  ensureCalls: () => string[];
  setPolicy: (next: GitActivityPolicy) => void;
  advanceClock: (elapsedMs: number) => void;
  /** Settles a verdict without counting as a request from the service. */
  settle: (cwd: string) => Promise<boolean>;
} {
  let clock = 0;
  let policy: GitActivityPolicy = options.policy;
  const ensureCalls: string[] = [];
  const classifier: FilesystemClassifier = {
    classify: options.classify ?? (async () => localVerdict()),
    invalidate: () => undefined,
    invalidateMountTable: () => undefined,
    dispose: () => undefined,
  } as unknown as FilesystemClassifier;
  const service = createGitActivityPolicyService({
    classifier,
    logger: createTestLogger(),
    getPolicy: () => policy,
    now: () => clock,
    ...(options.cacheTtlMs === undefined ? {} : { cacheTtlMs: options.cacheTtlMs }),
  });
  return {
    gitActivity: {
      isAutomatic: (cwd) => service.isAutomatic(cwd),
      peek: (cwd) => service.peek(cwd),
      ensureClassification: async (cwd) => {
        ensureCalls.push(cwd);
        return service.ensureClassification(cwd);
      },
    },
    ensureCalls: () => ensureCalls,
    setPolicy(next: GitActivityPolicy) {
      policy = next;
      service.refreshPolicy();
    },
    advanceClock(elapsedMs: number) {
      clock += elapsedMs;
    },
    async settle(cwd: string) {
      const result = await service.ensureClassification(cwd);
      return result.automatic;
    },
  };
}

type SeededProjectFields = Partial<Pick<PersistedProjectRecord, "kind" | "projectKey">>;

function seedProject(
  projects: Map<string, PersistedProjectRecord>,
  rootPath: string,
  fields: SeededProjectFields = {},
): PersistedProjectRecord {
  const project = createPersistedProjectRecord({
    projectId: "p1",
    rootPath,
    kind: fields.kind ?? "git",
    displayName: path.basename(rootPath),
    projectKey: fields.projectKey ?? null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  projects.set(project.projectId, project);
  return project;
}

type SeededWorkspaceFields = Partial<
  Pick<PersistedWorkspaceRecord, "kind" | "worktreeRoot" | "mainRepoRoot" | "isPaseoOwnedWorktree">
>;

function seedWorkspace(
  workspaces: Map<string, PersistedWorkspaceRecord>,
  workspaceId: string,
  projectId: string,
  cwd: string,
  fields: SeededWorkspaceFields = {},
): PersistedWorkspaceRecord {
  const workspace = createPersistedWorkspaceRecord({
    workspaceId,
    projectId,
    cwd,
    kind: fields.kind ?? "local_checkout",
    displayName: path.basename(cwd),
    worktreeRoot: fields.worktreeRoot ?? null,
    mainRepoRoot: fields.mainRepoRoot ?? null,
    isPaseoOwnedWorktree: fields.isPaseoOwnedWorktree ?? false,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  workspaces.set(workspace.workspaceId, workspace);
  return workspace;
}

function localVerdict(
  overrides: Partial<WorkspaceFilesystemVerdict> = {},
): WorkspaceFilesystemVerdict {
  return {
    class: "local",
    reason: "verified_local_mounts",
    mountFsType: "ext4",
    checkedAt: 0,
    ...overrides,
  };
}

/**
 * Lets the policy service's own classification chain settle. The service never
 * awaits the probe it kicks off, so a test that needs the landed verdict has to
 * give the microtask queue room to drain.
 */
async function flushMicrotasks(rounds = 20): Promise<void> {
  for (let index = 0; index < rounds; index += 1) {
    await Promise.resolve();
  }
}

/** A root watcher that never fires; reconciliation is driven by the clock. */
function inertRootWatch(): ProjectRootWatch {
  return () => ({ close: () => undefined });
}

function createErrno(code: string, message: string): NodeJS.ErrnoException {
  const error = new Error(message) as NodeJS.ErrnoException;
  error.code = code;
  return error;
}

function presentDirectory(): { isDirectory(): boolean } {
  return { isDirectory: () => true };
}

class TestCheckouts {
  readonly reads: string[] = [];
  private readonly checkouts = new Map<string, ProjectCheckoutLitePayload>();

  set(cwd: string, checkout: ProjectCheckoutLitePayload): void {
    this.checkouts.set(cwd, checkout);
  }

  async getCheckout(cwd: string): Promise<ProjectCheckoutLitePayload> {
    this.reads.push(cwd);
    return this.checkouts.get(cwd) ?? createCheckout(cwd);
  }
}

function initGitRepoInDir(dir: string): void {
  execFileSync("git", ["init", "-b", "main"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["add", "."], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "init"], { cwd: dir, stdio: "ignore" });
}

function createTempGitRepo(prefix: string): string {
  const raw = mkdtempSync(path.join(tmpdir(), prefix));
  const dir = realpathSync(raw);
  execFileSync("git", ["init", "-b", "main"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: dir, stdio: "ignore" });
  writeFileSync(path.join(dir, "README.md"), "# Test\n");
  execFileSync("git", ["add", "."], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "init"], { cwd: dir, stdio: "ignore" });
  return dir;
}

const timestamp = "2025-01-01T00:00:00.000Z";

describe("WorkspaceReconciliationService", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  test("preserves workspace archival that lands during boot reconciliation", async () => {
    const workspaceRoot = realpathSync(mkdtempSync(path.join(tmpdir(), "reconcile-archive-race-")));
    tempDirs.push(workspaceRoot);
    const { projects, workspaces, projectRegistry, workspaceRegistry } = createTestRegistries();
    projects.set(
      "p1",
      createPersistedProjectRecord({
        projectId: "p1",
        rootPath: workspaceRoot,
        kind: "git",
        displayName: "archive-race",
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    );
    workspaces.set(
      "w1",
      createPersistedWorkspaceRecord({
        workspaceId: "w1",
        projectId: "p1",
        cwd: workspaceRoot,
        kind: "local_checkout",
        displayName: "archive-race",
        branch: "old-branch",
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    );
    const readStarted = deferred();
    const allowRead = deferred();
    const service = new WorkspaceReconciliationService({
      projectRegistry,
      workspaceRegistry,
      logger: createTestLogger(),
      workspaceGitService: {
        getCheckout: async (cwd) => {
          readStarted.resolve();
          await allowRead.promise;
          return createCheckout(cwd, {
            isGit: true,
            currentBranch: "new-branch",
            worktreeRoot: cwd,
          });
        },
      },
    });

    const reconciliation = service.reconcileGitMetadata();
    await readStarted.promise;
    const archivedAt = "2025-01-02T00:00:00.000Z";
    await workspaceRegistry.archive("w1", archivedAt);
    allowRead.resolve();
    await reconciliation;

    expect(workspaces.get("w1")).toMatchObject({
      archivedAt,
      branch: "new-branch",
    });
  });

  test("metadata reconciliation leaves missing workspaces active while a full pass archives them", async () => {
    const projectRoot = realpathSync(mkdtempSync(path.join(tmpdir(), "reconcile-metadata-only-")));
    const missingWorkspace = path.join(projectRoot, "missing-workspace");
    tempDirs.push(projectRoot);
    const { projects, workspaces, projectRegistry, workspaceRegistry } = createTestRegistries();

    projects.set(
      "p1",
      createPersistedProjectRecord({
        projectId: "p1",
        rootPath: projectRoot,
        kind: "non_git",
        displayName: "metadata-only",
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    );
    workspaces.set(
      "w1",
      createPersistedWorkspaceRecord({
        workspaceId: "w1",
        projectId: "p1",
        cwd: missingWorkspace,
        kind: "directory",
        displayName: "missing-workspace",
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    );
    const service = new WorkspaceReconciliationService({
      projectRegistry,
      workspaceRegistry,
      logger: createTestLogger(),
    });

    const metadataResult = await service.reconcileGitMetadata();
    const projectKey = deriveProjectKey({
      rootPath: projectRoot,
      remoteUrl: null,
      worktreeRoot: null,
      mainRepoRoot: null,
    });

    expect(metadataResult.changesApplied).toEqual([
      {
        kind: "project_updated",
        projectId: "p1",
        directory: projectRoot,
        fields: { projectKey },
      },
    ]);
    expect(workspaces.get("w1")?.archivedAt).toBeNull();

    const fullResult = await service.runOnce();

    expect(fullResult.changesApplied).toEqual([
      {
        kind: "workspace_archived",
        workspaceId: "w1",
        directory: missingWorkspace,
        reason: "directory_missing",
      },
    ]);
    expect(workspaces.get("w1")?.archivedAt).toEqual(expect.any(String));
  });

  test("full reconciliation archives missing directories but keeps unreadable ones active", async () => {
    const projectRoot = "/tmp/reconcile-unreadable-root";
    const unreadableWorkspace = "/tmp/reconcile-unreadable-workspace";
    const missingWorkspace = "/tmp/reconcile-missing-workspace";
    const { projects, workspaces, projectRegistry, workspaceRegistry } = createTestRegistries();
    const projectKey = deriveProjectKey({
      rootPath: projectRoot,
      remoteUrl: null,
      worktreeRoot: null,
      mainRepoRoot: null,
    });

    projects.set(
      "p1",
      createPersistedProjectRecord({
        projectId: "p1",
        rootPath: projectRoot,
        kind: "non_git",
        displayName: "unreadable",
        projectKey,
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    );
    workspaces.set(
      "unreadable",
      createPersistedWorkspaceRecord({
        workspaceId: "unreadable",
        projectId: "p1",
        cwd: unreadableWorkspace,
        kind: "directory",
        displayName: "unreadable-workspace",
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    );
    workspaces.set(
      "missing",
      createPersistedWorkspaceRecord({
        workspaceId: "missing",
        projectId: "p1",
        cwd: missingWorkspace,
        kind: "directory",
        displayName: "missing-workspace",
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    );

    const service = new WorkspaceReconciliationService({
      projectRegistry,
      workspaceRegistry,
      logger: createTestLogger(),
      statDirectory: async (targetPath) => {
        if (targetPath === unreadableWorkspace) {
          throw createErrno("EIO", "Input/output error");
        }
        if (targetPath === missingWorkspace) {
          throw createErrno("ENOENT", "No such file or directory");
        }
        return presentDirectory();
      },
    });

    const metadataResult = await service.reconcileGitMetadata();
    expect(metadataResult.changesApplied).toEqual([]);
    expect(workspaces.get("unreadable")?.archivedAt).toBeNull();
    expect(workspaces.get("missing")?.archivedAt).toBeNull();

    const fullResult = await service.runOnce();
    expect(fullResult.changesApplied).toEqual([
      {
        kind: "workspace_archived",
        workspaceId: "missing",
        directory: missingWorkspace,
        reason: "directory_missing",
      },
    ]);
    expect(workspaces.get("unreadable")?.archivedAt).toBeNull();
    expect(workspaces.get("missing")?.archivedAt).toEqual(expect.any(String));
  });

  test("treats a timed-out directory inspection as unreadable instead of missing", async () => {
    const projectRoot = "/tmp/reconcile-timeout-root";
    const hungWorkspace = "/tmp/reconcile-timeout-workspace";
    const { projects, workspaces, projectRegistry, workspaceRegistry } = createTestRegistries();
    const projectKey = deriveProjectKey({
      rootPath: projectRoot,
      remoteUrl: null,
      worktreeRoot: null,
      mainRepoRoot: null,
    });

    projects.set(
      "p1",
      createPersistedProjectRecord({
        projectId: "p1",
        rootPath: projectRoot,
        kind: "non_git",
        displayName: "timeout",
        projectKey,
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    );
    workspaces.set(
      "w1",
      createPersistedWorkspaceRecord({
        workspaceId: "w1",
        projectId: "p1",
        cwd: hungWorkspace,
        kind: "directory",
        displayName: "hung-workspace",
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    );

    const service = new WorkspaceReconciliationService({
      projectRegistry,
      workspaceRegistry,
      logger: createTestLogger(),
      directoryStatTimeoutMs: 20,
      statDirectory: async (targetPath) => {
        if (targetPath === hungWorkspace) return new Promise(() => {});
        return presentDirectory();
      },
    });

    const result = await service.runOnce();
    expect(result.changesApplied).toEqual([]);
    expect(workspaces.get("w1")?.archivedAt).toBeNull();
  });

  test("inspects equivalent project and workspace paths once per pass", async () => {
    const sharedPath = "/tmp/reconcile-shared-root";
    const { projects, workspaces, projectRegistry, workspaceRegistry } = createTestRegistries();
    const projectKey = deriveProjectKey({
      rootPath: sharedPath,
      remoteUrl: null,
      worktreeRoot: null,
      mainRepoRoot: null,
    });
    const inspected: string[] = [];

    projects.set(
      "p1",
      createPersistedProjectRecord({
        projectId: "p1",
        rootPath: sharedPath,
        kind: "non_git",
        displayName: "shared",
        projectKey,
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    );
    workspaces.set(
      "w1",
      createPersistedWorkspaceRecord({
        workspaceId: "w1",
        projectId: "p1",
        cwd: `${sharedPath}/`,
        kind: "directory",
        displayName: "shared-workspace",
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    );

    const service = new WorkspaceReconciliationService({
      projectRegistry,
      workspaceRegistry,
      logger: createTestLogger(),
      statDirectory: async (targetPath) => {
        inspected.push(targetPath);
        return presentDirectory();
      },
    });

    await service.runOnce();
    expect(inspected).toEqual([`${sharedPath}/`]);
  });

  test("inspects workspace directories with bounded concurrency", async () => {
    const projectRoot = "/tmp/reconcile-concurrency-root";
    const firstWorkspace = "/tmp/reconcile-concurrency-one";
    const secondWorkspace = "/tmp/reconcile-concurrency-two";
    const { projects, workspaces, projectRegistry, workspaceRegistry } = createTestRegistries();
    const projectKey = deriveProjectKey({
      rootPath: projectRoot,
      remoteUrl: null,
      worktreeRoot: null,
      mainRepoRoot: null,
    });
    let started = 0;
    let inFlight = 0;
    let peakInFlight = 0;
    const firstTwoStarted = deferred();
    const release = deferred();

    projects.set(
      "p1",
      createPersistedProjectRecord({
        projectId: "p1",
        rootPath: projectRoot,
        kind: "non_git",
        displayName: "concurrency",
        projectKey,
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    );
    workspaces.set(
      "w1",
      createPersistedWorkspaceRecord({
        workspaceId: "w1",
        projectId: "p1",
        cwd: firstWorkspace,
        kind: "directory",
        displayName: "one",
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    );
    workspaces.set(
      "w2",
      createPersistedWorkspaceRecord({
        workspaceId: "w2",
        projectId: "p1",
        cwd: secondWorkspace,
        kind: "directory",
        displayName: "two",
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    );

    const service = new WorkspaceReconciliationService({
      projectRegistry,
      workspaceRegistry,
      logger: createTestLogger(),
      directoryStatConcurrency: 2,
      statDirectory: async () => {
        started += 1;
        inFlight += 1;
        peakInFlight = Math.max(peakInFlight, inFlight);
        if (started === 2) firstTwoStarted.resolve();
        await release.promise;
        inFlight -= 1;
        return presentDirectory();
      },
    });

    const running = service.runOnce();
    await firstTwoStarted.promise;
    await Promise.resolve();
    expect(started).toBe(2);
    expect(peakInFlight).toBe(2);
    release.resolve();
    await running;
    expect(started).toBe(3);
    expect(peakInFlight).toBe(2);
  });

  test("reads fresh checkout facts on every metadata pass", async () => {
    const projectRoot = realpathSync(mkdtempSync(path.join(tmpdir(), "reconcile-fresh-git-")));
    tempDirs.push(projectRoot);
    const { projects, projectRegistry, workspaceRegistry } = createTestRegistries();
    const git = new TestCheckouts();
    git.set(projectRoot, createCheckout(projectRoot));
    projects.set(
      "p1",
      createPersistedProjectRecord({
        projectId: "p1",
        rootPath: projectRoot,
        kind: "non_git",
        displayName: "fresh-git",
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    );
    const service = new WorkspaceReconciliationService({
      projectRegistry,
      workspaceRegistry,
      logger: createTestLogger(),
      workspaceGitService: git,
    });

    const beforeGitInit = await service.reconcileGitMetadata();
    git.set(
      projectRoot,
      createCheckout(projectRoot, {
        isGit: true,
        currentBranch: "main",
        worktreeRoot: projectRoot,
      }),
    );
    const afterGitInit = await service.reconcileGitMetadata();
    const projectKey = deriveProjectKey({
      rootPath: projectRoot,
      remoteUrl: null,
      worktreeRoot: null,
      mainRepoRoot: null,
    });

    expect(beforeGitInit.changesApplied).toEqual([
      {
        kind: "project_updated",
        projectId: "p1",
        directory: projectRoot,
        fields: { projectKey },
      },
    ]);
    expect(afterGitInit.changesApplied).toEqual([
      {
        kind: "project_updated",
        projectId: "p1",
        directory: projectRoot,
        fields: { kind: "git" },
      },
    ]);
    expect(git.reads).toEqual([projectRoot, projectRoot]);
    expect(projects.get("p1")?.kind).toBe("git");
  });

  test("deduplicates equivalent project and workspace paths across legacy duplicate projects", async () => {
    const projectRoot = realpathSync(mkdtempSync(path.join(tmpdir(), "reconcile-global-root-")));
    const workspaceRoot = realpathSync(
      mkdtempSync(path.join(tmpdir(), "reconcile-global-workspace-")),
    );
    tempDirs.push(projectRoot, workspaceRoot);
    const equivalentProjectRoot = `${projectRoot}${path.sep}.`;
    const equivalentWorkspaceRoot = `${workspaceRoot}${path.sep}.`;
    const { projects, workspaces, projectRegistry, workspaceRegistry } = createTestRegistries();
    const git = new TestCheckouts();
    const projectCheckout = createCheckout(projectRoot, {
      isGit: true,
      currentBranch: "main",
      worktreeRoot: projectRoot,
    });
    const workspaceCheckout = createCheckout(workspaceRoot, {
      isGit: true,
      currentBranch: "topic",
      worktreeRoot: workspaceRoot,
    });
    git.set(projectRoot, projectCheckout);
    git.set(equivalentProjectRoot, projectCheckout);
    git.set(workspaceRoot, workspaceCheckout);
    git.set(equivalentWorkspaceRoot, workspaceCheckout);

    for (const [projectId, rootPath] of [
      ["p1", projectRoot],
      ["p2", equivalentProjectRoot],
    ] as const) {
      projects.set(
        projectId,
        createPersistedProjectRecord({
          projectId,
          rootPath,
          kind: "git",
          displayName: projectId,
          createdAt: timestamp,
          updatedAt: timestamp,
        }),
      );
    }
    for (const [workspaceId, projectId, cwd] of [
      ["w1", "p1", workspaceRoot],
      ["w2", "p2", equivalentWorkspaceRoot],
    ] as const) {
      workspaces.set(
        workspaceId,
        createPersistedWorkspaceRecord({
          workspaceId,
          projectId,
          cwd,
          kind: "local_checkout",
          displayName: workspaceId,
          branch: "topic",
          worktreeRoot: workspaceRoot,
          createdAt: timestamp,
          updatedAt: timestamp,
        }),
      );
    }
    const service = new WorkspaceReconciliationService({
      projectRegistry,
      workspaceRegistry,
      logger: createTestLogger(),
      workspaceGitService: git,
    });

    const result = await service.reconcileGitMetadata();

    expect(result.changesApplied).toEqual([
      {
        kind: "project_updated",
        projectId: "p1",
        directory: projectRoot,
        fields: { projectKey: canonicalLocalProjectKey(projectRoot) },
      },
      {
        kind: "project_updated",
        projectId: "p2",
        directory: equivalentProjectRoot,
        fields: { projectKey: canonicalLocalProjectKey(projectRoot) },
      },
    ]);
    expect(git.reads).toEqual([projectRoot, workspaceRoot]);
  });

  test("updates mutable Git facts without changing project or workspace identity", async () => {
    const projectRoot = realpathSync(mkdtempSync(path.join(tmpdir(), "reconcile-stable-project-")));
    const workspaceRoot = realpathSync(
      mkdtempSync(path.join(tmpdir(), "reconcile-explicit-workspace-")),
    );
    tempDirs.push(projectRoot, workspaceRoot);
    const { projects, workspaces, projectRegistry, workspaceRegistry } = createTestRegistries();
    const originalProject = createPersistedProjectRecord({
      projectId: "p1",
      rootPath: projectRoot,
      kind: "non_git",
      displayName: "Stable project name",
      customName: "Pinned project name",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const originalWorkspace = createPersistedWorkspaceRecord({
      workspaceId: "w1",
      projectId: "p1",
      cwd: workspaceRoot,
      kind: "local_checkout",
      displayName: "Stable workspace name",
      title: "Pinned workspace name",
      branch: "stale-branch",
      baseBranch: "main",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    projects.set(originalProject.projectId, originalProject);
    workspaces.set(originalWorkspace.workspaceId, originalWorkspace);
    const git = new TestCheckouts();
    git.set(
      projectRoot,
      createCheckout(projectRoot, {
        isGit: true,
        currentBranch: "main",
        worktreeRoot: projectRoot,
      }),
    );
    git.set(workspaceRoot, createCheckout(workspaceRoot));
    const service = new WorkspaceReconciliationService({
      projectRegistry,
      workspaceRegistry,
      logger: createTestLogger(),
      workspaceGitService: git,
    });

    const result = await service.reconcileGitMetadata();

    expect(result.changesApplied).toEqual(
      expect.arrayContaining([
        {
          kind: "project_updated",
          projectId: "p1",
          directory: projectRoot,
          fields: { kind: "git", projectKey: canonicalLocalProjectKey(projectRoot) },
        },
        {
          kind: "workspace_updated",
          workspaceId: "w1",
          directory: workspaceRoot,
          fields: {
            branch: null,
            kind: "directory",
          },
        },
      ]),
    );
    expect(result.changesApplied).toHaveLength(2);
    expect(projects.get("p1")).toEqual({
      ...originalProject,
      kind: "git",
      projectKey: canonicalLocalProjectKey(projectRoot),
      updatedAt: expect.any(String),
    });
    expect(workspaces.get("w1")).toEqual({
      ...originalWorkspace,
      kind: "directory",
      branch: null,
      updatedAt: expect.any(String),
    });
  });

  test("archives workspaces whose directories no longer exist", async () => {
    const projectRoot = realpathSync(
      mkdtempSync(path.join(tmpdir(), "reconcile-missing-workspace-")),
    );
    const missingWorkspace = path.join(projectRoot, "missing-workspace");
    tempDirs.push(projectRoot);
    const { projects, workspaces, projectRegistry, workspaceRegistry } = createTestRegistries();
    const archivedWorkspaceIds: string[] = [];

    projects.set(
      "p1",
      createPersistedProjectRecord({
        projectId: "p1",
        rootPath: projectRoot,
        projectKey: canonicalLocalProjectKey(projectRoot),
        kind: "non_git",
        displayName: "ghost",
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    );
    workspaces.set(
      "w1",
      createPersistedWorkspaceRecord({
        workspaceId: "w1",
        projectId: "p1",
        cwd: missingWorkspace,
        kind: "directory",
        displayName: "ghost",
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    );

    const service = new WorkspaceReconciliationService({
      projectRegistry,
      workspaceRegistry,
      logger: createTestLogger(),
      onWorkspaceArchived: (workspaceId) => {
        archivedWorkspaceIds.push(workspaceId);
      },
    });

    const result = await service.runOnce();

    expect(result.changesApplied).toEqual([
      {
        kind: "workspace_archived",
        workspaceId: "w1",
        directory: missingWorkspace,
        reason: "directory_missing",
      },
    ]);
    expect(archivedWorkspaceIds).toEqual(["w1"]);
    expect(workspaces.get("w1")?.archivedAt).toEqual(expect.any(String));
  });

  test("keeps workspaces whose project root is missing with them", async () => {
    const mountParent = realpathSync(mkdtempSync(path.join(tmpdir(), "reconcile-unmounted-")));
    tempDirs.push(mountParent);
    // The external volume is not mounted, so nothing under it resolves.
    const projectRoot = path.join(mountParent, "ExternalSSD", "repo");
    const { projects, workspaces, projectRegistry, workspaceRegistry } = createTestRegistries();

    projects.set(
      "p1",
      createPersistedProjectRecord({
        projectId: "p1",
        rootPath: projectRoot,
        kind: "non_git",
        displayName: "repo",
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    );
    workspaces.set(
      "w1",
      createPersistedWorkspaceRecord({
        workspaceId: "w1",
        projectId: "p1",
        cwd: projectRoot,
        kind: "directory",
        displayName: "repo",
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    );

    const service = new WorkspaceReconciliationService({
      projectRegistry,
      workspaceRegistry,
      logger: createTestLogger(),
    });

    const result = await service.runOnce();

    expect(result.changesApplied).toEqual([]);
    expect(workspaces.get("w1")?.archivedAt).toBeNull();
  });

  test("keeps a project active after all its workspaces are archived", async () => {
    const projectRoot = realpathSync(mkdtempSync(path.join(tmpdir(), "reconcile-orphan-project-")));
    const missingWorkspace = path.join(projectRoot, "missing-workspace");
    tempDirs.push(projectRoot);
    const { projects, workspaces, projectRegistry, workspaceRegistry } = createTestRegistries();

    const project = createPersistedProjectRecord({
      projectId: "p1",
      rootPath: projectRoot,
      projectKey: canonicalLocalProjectKey(projectRoot),
      kind: "non_git",
      displayName: "orphan",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    projects.set(project.projectId, project);
    workspaces.set(
      "w1",
      createPersistedWorkspaceRecord({
        workspaceId: "w1",
        projectId: "p1",
        cwd: missingWorkspace,
        kind: "directory",
        displayName: "orphan",
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    );

    const service = new WorkspaceReconciliationService({
      projectRegistry,
      workspaceRegistry,
      logger: createTestLogger(),
    });

    const result = await service.runOnce();

    expect(result.changesApplied).toEqual([
      {
        kind: "workspace_archived",
        workspaceId: "w1",
        directory: missingWorkspace,
        reason: "directory_missing",
      },
    ]);
    expect(workspaces.get("w1")).toEqual({
      workspaceId: "w1",
      projectId: "p1",
      cwd: missingWorkspace,
      kind: "directory",
      displayName: "orphan",
      title: null,
      pinnedAt: null,
      branch: null,
      worktreeRoot: null,
      baseBranch: null,
      isPaseoOwnedWorktree: false,
      mainRepoRoot: null,
      createdAt: timestamp,
      updatedAt: expect.any(String),
      archivedAt: expect.any(String),
      autoArchivedChangeRequestUrl: null,
    });
    expect(projects.get("p1")).toEqual(project);
  });

  test("updates project kind when a directory becomes a git repo", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "reconcile-git-init-"));
    const resolved = realpathSync(dir);
    tempDirs.push(resolved);
    writeFileSync(path.join(resolved, "README.md"), "# Test\n");

    const { projects, workspaces, projectRegistry, workspaceRegistry } = createTestRegistries();

    projects.set(
      "p1",
      createPersistedProjectRecord({
        projectId: "p1",
        rootPath: resolved,
        kind: "non_git",
        displayName: path.basename(resolved),
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    );
    workspaces.set(
      "w1",
      createPersistedWorkspaceRecord({
        workspaceId: "w1",
        projectId: "p1",
        cwd: resolved,
        kind: "local_checkout",
        displayName: path.basename(resolved),
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    );

    initGitRepoInDir(resolved);

    const service = new WorkspaceReconciliationService({
      projectRegistry,
      workspaceRegistry,
      logger: createTestLogger(),
      workspaceGitService: createWorkspaceGitServiceStub({
        [resolved]: {
          projectKind: "git",
          projectDisplayName: path.basename(resolved),
          workspaceDisplayName: "main",
        },
      }),
    });

    const result = await service.runOnce();

    const projUpdate = result.changesApplied.find((c) => c.kind === "project_updated");
    expect(projUpdate).toBeDefined();
    expect(projects.get("p1")!.kind).toBe("git");
  });

  test("updates workspace kind when a directory becomes a git repo", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "reconcile-ws-kind-"));
    const resolved = realpathSync(dir);
    tempDirs.push(resolved);
    writeFileSync(path.join(resolved, "README.md"), "# Test\n");

    const { projects, workspaces, projectRegistry, workspaceRegistry } = createTestRegistries();

    projects.set(
      "p1",
      createPersistedProjectRecord({
        projectId: "p1",
        rootPath: resolved,
        kind: "non_git",
        displayName: path.basename(resolved),
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    );
    workspaces.set(
      "w1",
      createPersistedWorkspaceRecord({
        workspaceId: "w1",
        projectId: "p1",
        cwd: resolved,
        kind: "directory",
        displayName: path.basename(resolved),
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    );

    initGitRepoInDir(resolved);

    const service = new WorkspaceReconciliationService({
      projectRegistry,
      workspaceRegistry,
      logger: createTestLogger(),
      workspaceGitService: createWorkspaceGitServiceStub({
        [resolved]: {
          projectKind: "git",
          projectDisplayName: path.basename(resolved),
          workspaceDisplayName: "main",
        },
      }),
    });

    await service.runOnce();

    expect(projects.get("p1")!.kind).toBe("git");
    expect(workspaces.get("w1")!.kind).toBe("local_checkout");
  });

  test("keeps legacy duplicate projects and workspace membership intact", async () => {
    const repoDir = createTempGitRepo("reconcile-duplicate-project-");
    tempDirs.push(repoDir);
    const canonicalWorktreeDir = path.join(repoDir, ".paseo", "worktrees", "focused-bat");
    const duplicateWorktreeDir = path.join(repoDir, ".paseo", "worktrees", "gigantic-blowfish");
    mkdirSync(canonicalWorktreeDir, { recursive: true });
    mkdirSync(duplicateWorktreeDir, { recursive: true });
    const { projects, workspaces, projectRegistry, workspaceRegistry } = createTestRegistries();

    projects.set(
      "remote:github.com/blank-dot-page/editor",
      createPersistedProjectRecord({
        projectId: "remote:github.com/blank-dot-page/editor",
        rootPath: repoDir,
        kind: "git",
        displayName: "blank-dot-page/editor",
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    );
    projects.set(
      repoDir,
      createPersistedProjectRecord({
        projectId: repoDir,
        rootPath: repoDir,
        kind: "git",
        displayName: "editor",
        customName: "Editor",
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    );
    workspaces.set(
      "focused-bat",
      createPersistedWorkspaceRecord({
        workspaceId: "focused-bat",
        projectId: "remote:github.com/blank-dot-page/editor",
        cwd: canonicalWorktreeDir,
        kind: "worktree",
        displayName: "update-og-image",
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    );
    workspaces.set(
      "gigantic-blowfish",
      createPersistedWorkspaceRecord({
        workspaceId: "gigantic-blowfish",
        projectId: repoDir,
        cwd: duplicateWorktreeDir,
        kind: "worktree",
        displayName: "markdown-view",
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    );

    const service = new WorkspaceReconciliationService({
      projectRegistry,
      workspaceRegistry,
      logger: createTestLogger(),
      workspaceGitService: createWorkspaceGitServiceStub({
        [repoDir]: {
          projectKind: "git",
          projectDisplayName: "blank-dot-page/editor",
          workspaceDisplayName: "main",
          gitRemote: "git@github.com:blank-dot-page/editor.git",
        },
        [canonicalWorktreeDir]: {
          projectKind: "git",
          projectDisplayName: "blank-dot-page/editor",
          workspaceDisplayName: "update-og-image",
          gitRemote: "git@github.com:blank-dot-page/editor.git",
        },
        [duplicateWorktreeDir]: {
          projectKind: "git",
          projectDisplayName: "blank-dot-page/editor",
          workspaceDisplayName: "markdown-view",
          gitRemote: "git@github.com:blank-dot-page/editor.git",
        },
      }),
    });

    const result = await service.runOnce();

    expect(result.changesApplied.map((change) => change.kind).sort()).toEqual([
      "project_updated",
      "project_updated",
      "workspace_updated",
      "workspace_updated",
    ]);
    expect(projects.get("remote:github.com/blank-dot-page/editor")).toMatchObject({
      projectId: "remote:github.com/blank-dot-page/editor",
      rootPath: repoDir,
      displayName: "blank-dot-page/editor",
      customName: null,
      projectKey: "remote:github.com/blank-dot-page/editor",
      archivedAt: null,
    });
    expect(projects.get(repoDir)).toMatchObject({
      projectId: repoDir,
      rootPath: repoDir,
      displayName: "editor",
      customName: "Editor",
      projectKey: "remote:github.com/blank-dot-page/editor",
      archivedAt: null,
    });
    expect(workspaces.get("focused-bat")).toMatchObject({
      projectId: "remote:github.com/blank-dot-page/editor",
      archivedAt: null,
    });
    expect(workspaces.get("gigantic-blowfish")).toMatchObject({
      projectId: repoDir,
      archivedAt: null,
    });
  });

  test("backfills a missing project key while keeping the project display name stable", async () => {
    const dir = createTempGitRepo("reconcile-remote-");
    tempDirs.push(dir);

    const { projects, workspaces, projectRegistry, workspaceRegistry } = createTestRegistries();

    projects.set(
      "p1",
      createPersistedProjectRecord({
        projectId: "p1",
        rootPath: dir,
        kind: "git",
        displayName: "old-owner/old-repo",
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    );
    workspaces.set(
      "w1",
      createPersistedWorkspaceRecord({
        workspaceId: "w1",
        projectId: "p1",
        cwd: dir,
        kind: "local_checkout",
        displayName: "main",
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    );

    // Change the remote
    execFileSync("git", ["remote", "add", "origin", "git@github.com:new-owner/new-repo.git"], {
      cwd: dir,
      stdio: "ignore",
    });

    const service = new WorkspaceReconciliationService({
      projectRegistry,
      workspaceRegistry,
      logger: createTestLogger(),
      workspaceGitService: createWorkspaceGitServiceStub({
        [dir]: {
          projectKind: "git",
          projectDisplayName: "new-owner/new-repo",
          workspaceDisplayName: "main",
          gitRemote: "git@github.com:new-owner/new-repo.git",
        },
      }),
    });

    const result = await service.runOnce();

    expect(result.changesApplied.find((c) => c.kind === "project_updated")).toMatchObject({
      fields: { projectKey: "remote:github.com/new-owner/new-repo" },
    });
    expect(projects.get("p1")!.displayName).toBe("old-owner/old-repo");
    expect(projects.get("p1")!.projectKey).toBe("remote:github.com/new-owner/new-repo");
  });

  test("refreshes an empty project's persisted key when its Git remote changes", async () => {
    const dir = createTempGitRepo("reconcile-empty-remote-change-");
    tempDirs.push(dir);
    const { projects, projectRegistry, workspaceRegistry } = createTestRegistries();

    projects.set(
      "p1",
      createPersistedProjectRecord({
        projectId: "p1",
        projectKey: "remote:github.com/old-owner/old-repo",
        rootPath: dir,
        kind: "git",
        displayName: "old-owner/old-repo",
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    );

    const service = new WorkspaceReconciliationService({
      projectRegistry,
      workspaceRegistry,
      logger: createTestLogger(),
      workspaceGitService: createWorkspaceGitServiceStub({
        [dir]: {
          projectKind: "git",
          projectDisplayName: "new-owner/new-repo",
          workspaceDisplayName: "main",
          gitRemote: "git@github.com:new-owner/new-repo.git",
        },
      }),
    });

    const result = await service.runOnce();

    expect(result.changesApplied).toEqual([
      expect.objectContaining({
        kind: "project_updated",
        fields: { projectKey: "remote:github.com/new-owner/new-repo" },
      }),
    ]);
    expect(projects.get("p1")?.projectKey).toBe("remote:github.com/new-owner/new-repo");
  });

  test("refreshes a persisted project key when a Git remote disappears", async () => {
    const dir = createTempGitRepo("reconcile-removed-remote-");
    tempDirs.push(dir);
    const { projects, workspaces, projectRegistry, workspaceRegistry } = createTestRegistries();

    projects.set(
      "p1",
      createPersistedProjectRecord({
        projectId: "p1",
        projectKey: "remote:github.com/acme/old-repo",
        rootPath: dir,
        kind: "git",
        displayName: "acme/old-repo",
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    );
    workspaces.set(
      "w1",
      createPersistedWorkspaceRecord({
        workspaceId: "w1",
        projectId: "p1",
        cwd: dir,
        kind: "local_checkout",
        displayName: "main",
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    );

    const service = new WorkspaceReconciliationService({
      projectRegistry,
      workspaceRegistry,
      logger: createTestLogger(),
      workspaceGitService: createWorkspaceGitServiceStub({
        [dir]: {
          projectKind: "git",
          projectDisplayName: "old-repo",
          workspaceDisplayName: "main",
          gitRemote: null,
        },
      }),
    });

    await service.runOnce();

    expect(projects.get("p1")?.projectKey).toBe(canonicalLocalProjectKey(dir));
  });

  test("keeps custom and default names stable when the remote changes", async () => {
    const dir = createTempGitRepo("reconcile-customname-");
    tempDirs.push(dir);

    const { projects, workspaces, projectRegistry, workspaceRegistry } = createTestRegistries();

    projects.set(
      "p1",
      createPersistedProjectRecord({
        projectId: "p1",
        rootPath: dir,
        kind: "git",
        displayName: "old-owner/old-repo",
        customName: "My Fork",
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    );
    workspaces.set(
      "w1",
      createPersistedWorkspaceRecord({
        workspaceId: "w1",
        projectId: "p1",
        cwd: dir,
        kind: "local_checkout",
        displayName: "main",
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    );

    execFileSync("git", ["remote", "add", "origin", "git@github.com:new-owner/new-repo.git"], {
      cwd: dir,
      stdio: "ignore",
    });

    const service = new WorkspaceReconciliationService({
      projectRegistry,
      workspaceRegistry,
      logger: createTestLogger(),
      workspaceGitService: createWorkspaceGitServiceStub({
        [dir]: {
          projectKind: "git",
          projectDisplayName: "new-owner/new-repo",
          workspaceDisplayName: "main",
          gitRemote: "git@github.com:new-owner/new-repo.git",
        },
      }),
    });

    await service.runOnce();

    expect(projects.get("p1")!.displayName).toBe("old-owner/old-repo");
    expect(projects.get("p1")!.customName).toBe("My Fork");
  });

  test("keeps persisted Git metadata when a workspace checkout read fails", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "reconcile-checkout-read-project-"));
    const workspaceRoot = path.join(projectRoot, "workspace");
    mkdirSync(workspaceRoot);
    tempDirs.push(projectRoot);
    const { projects, workspaces, projectRegistry, workspaceRegistry } = createTestRegistries();
    const project = createPersistedProjectRecord({
      projectId: "p1",
      rootPath: projectRoot,
      kind: "non_git",
      displayName: "project",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const workspace = createPersistedWorkspaceRecord({
      workspaceId: "w1",
      projectId: project.projectId,
      cwd: workspaceRoot,
      kind: "local_checkout",
      displayName: "workspace",
      branch: "feature",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    projects.set(project.projectId, project);
    workspaces.set(workspace.workspaceId, workspace);
    const service = new WorkspaceReconciliationService({
      projectRegistry,
      workspaceRegistry,
      logger: createTestLogger(),
      workspaceGitService: {
        getCheckout: async (cwd) => {
          if (cwd === workspaceRoot) throw new Error("Git read failed");
          return createCheckout(cwd, { isGit: true, currentBranch: "main", worktreeRoot: cwd });
        },
      },
    });

    const result = await service.reconcileGitMetadata();

    expect(result.changesApplied).toEqual([]);
    expect(projects.get(project.projectId)).toEqual(project);
    expect(workspaces.get(workspace.workspaceId)).toEqual(workspace);
  });

  test("archives non-directory workspaces without blocking sibling reconciliation", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "reconcile-file-workspace-"));
    const replacedWorkspace = path.join(projectRoot, "replaced-workspace");
    const siblingWorkspace = path.join(projectRoot, "sibling-workspace");
    writeFileSync(replacedWorkspace, "not a directory\n");
    mkdirSync(siblingWorkspace);
    tempDirs.push(projectRoot);

    const { projects, workspaces, projectRegistry, workspaceRegistry } = createTestRegistries();
    projects.set(
      "p1",
      createPersistedProjectRecord({
        projectId: "p1",
        rootPath: projectRoot,
        kind: "non_git",
        displayName: "project",
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    );
    workspaces.set(
      "replaced",
      createPersistedWorkspaceRecord({
        workspaceId: "replaced",
        projectId: "p1",
        cwd: replacedWorkspace,
        kind: "directory",
        displayName: "replaced-workspace",
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    );
    workspaces.set(
      "sibling",
      createPersistedWorkspaceRecord({
        workspaceId: "sibling",
        projectId: "p1",
        cwd: siblingWorkspace,
        kind: "directory",
        displayName: "sibling-workspace",
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    );

    const service = new WorkspaceReconciliationService({
      projectRegistry,
      workspaceRegistry,
      logger: createTestLogger(),
      workspaceGitService: {
        getCheckout: async (cwd) => {
          if (cwd === replacedWorkspace) {
            throw new Error("Git cannot use a regular file as cwd");
          }
          return createCheckout(cwd, {
            isGit: true,
            currentBranch: cwd === siblingWorkspace ? "feature/sibling" : "main",
            worktreeRoot: cwd,
          });
        },
      },
    });

    const result = await service.runOnce();

    expect(result.changesApplied).toEqual([
      {
        kind: "workspace_archived",
        workspaceId: "replaced",
        directory: replacedWorkspace,
        reason: "directory_missing",
      },
      {
        kind: "project_updated",
        projectId: "p1",
        directory: projectRoot,
        fields: { kind: "git", projectKey: canonicalLocalProjectKey(projectRoot) },
      },
      {
        kind: "workspace_updated",
        workspaceId: "sibling",
        directory: siblingWorkspace,
        fields: {
          kind: "local_checkout",
          branch: "feature/sibling",
          worktreeRoot: siblingWorkspace,
        },
      },
    ]);
    expect(workspaces.get("replaced")?.archivedAt).toEqual(expect.any(String));
    expect(workspaces.get("sibling")).toMatchObject({
      kind: "local_checkout",
      branch: "feature/sibling",
    });
  });

  test("updates workspace branch metadata without clobbering the workspace name", async () => {
    const dir = createTempGitRepo("reconcile-branch-");
    tempDirs.push(dir);

    execFileSync("git", ["checkout", "-b", "feature-branch"], { cwd: dir, stdio: "ignore" });

    const { projects, workspaces, projectRegistry, workspaceRegistry } = createTestRegistries();

    projects.set(
      "p1",
      createPersistedProjectRecord({
        projectId: "p1",
        rootPath: dir,
        kind: "git",
        displayName: path.basename(dir),
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    );
    workspaces.set(
      "w1",
      createPersistedWorkspaceRecord({
        workspaceId: "w1",
        projectId: "p1",
        cwd: dir,
        kind: "local_checkout",
        displayName: "Human workspace title",
        branch: "main",
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    );

    const service = new WorkspaceReconciliationService({
      projectRegistry,
      workspaceRegistry,
      logger: createTestLogger(),
      workspaceGitService: createWorkspaceGitServiceStub({
        [dir]: {
          projectKind: "git",
          projectDisplayName: path.basename(dir),
          workspaceDisplayName: "feature-branch",
          currentBranch: "feature-branch",
        },
      }),
    });

    const result = await service.runOnce();

    const wsUpdate = result.changesApplied.find((c) => c.kind === "workspace_updated");
    expect(wsUpdate).toBeDefined();
    expect(wsUpdate).toMatchObject({
      kind: "workspace_updated",
      fields: { branch: "feature-branch" },
    });
    expect(workspaces.get("w1")!.displayName).toBe("Human workspace title");
    expect(workspaces.get("w1")!.branch).toBe("feature-branch");
  });

  test("does not modify already-archived records", async () => {
    const { projects, workspaces, projectRegistry, workspaceRegistry } = createTestRegistries();

    projects.set(
      "p1",
      createPersistedProjectRecord({
        projectId: "p1",
        rootPath: "/tmp/does-not-exist-archived",
        kind: "non_git",
        displayName: "archived",
        createdAt: timestamp,
        updatedAt: timestamp,
        archivedAt: timestamp,
      }),
    );
    workspaces.set(
      "w1",
      createPersistedWorkspaceRecord({
        workspaceId: "w1",
        projectId: "p1",
        cwd: "/tmp/does-not-exist-archived",
        kind: "directory",
        displayName: "archived",
        createdAt: timestamp,
        updatedAt: timestamp,
        archivedAt: timestamp,
      }),
    );

    const service = new WorkspaceReconciliationService({
      projectRegistry,
      workspaceRegistry,
      logger: createTestLogger(),
    });

    const result = await service.runOnce();

    expect(result.changesApplied).toHaveLength(0);
  });

  test("calls onChanges callback when changes are applied", async () => {
    const projectRoot = realpathSync(mkdtempSync(path.join(tmpdir(), "reconcile-callback-")));
    const missingWorkspace = path.join(projectRoot, "missing-workspace");
    tempDirs.push(projectRoot);
    const { projects, workspaces, projectRegistry, workspaceRegistry } = createTestRegistries();

    projects.set(
      "p1",
      createPersistedProjectRecord({
        projectId: "p1",
        rootPath: projectRoot,
        projectKey: canonicalLocalProjectKey(projectRoot),
        kind: "non_git",
        displayName: "ghost",
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    );
    workspaces.set(
      "w1",
      createPersistedWorkspaceRecord({
        workspaceId: "w1",
        projectId: "p1",
        cwd: missingWorkspace,
        kind: "directory",
        displayName: "ghost",
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    );

    const reportedChanges: ReconciliationChange[] = [];
    const service = new WorkspaceReconciliationService({
      projectRegistry,
      workspaceRegistry,
      logger: createTestLogger(),
      onChanges: (changes) => reportedChanges.push(...changes),
    });

    await service.runOnce();

    expect(reportedChanges).toEqual([
      {
        kind: "workspace_archived",
        workspaceId: "w1",
        directory: missingWorkspace,
        reason: "directory_missing",
      },
    ]);
  });

  test("logs reconciliation changes with affected paths and reasons", async () => {
    const projectRoot = realpathSync(mkdtempSync(path.join(tmpdir(), "reconcile-log-")));
    const missingWorkspace = path.join(projectRoot, "missing-workspace");
    tempDirs.push(projectRoot);
    const { projects, workspaces, projectRegistry, workspaceRegistry } = createTestRegistries();
    const { logger, infoRecords } = createCapturingLogger();

    projects.set(
      "p1",
      createPersistedProjectRecord({
        projectId: "p1",
        rootPath: projectRoot,
        projectKey: canonicalLocalProjectKey(projectRoot),
        kind: "non_git",
        displayName: "ghost",
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    );
    workspaces.set(
      "w1",
      createPersistedWorkspaceRecord({
        workspaceId: "w1",
        projectId: "p1",
        cwd: missingWorkspace,
        kind: "directory",
        displayName: "ghost",
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    );

    const service = new WorkspaceReconciliationService({
      projectRegistry,
      workspaceRegistry,
      logger,
    });

    await service.runOnce();

    expect(infoRecords).toEqual([
      {
        message: "Workspace reconciliation applied changes",
        payload: expect.objectContaining({
          changeCount: 1,
          changes: expect.arrayContaining([
            {
              kind: "workspace_archived",
              workspaceId: "w1",
              directory: missingWorkspace,
              reason: "directory_missing",
            },
          ]),
          durationMs: expect.any(Number),
        }),
      },
    ]);
    expect(projects.get("p1")!.archivedAt).toBeFalsy();
  });

  test("does not log reconciliation when no changes are applied", async () => {
    const { projectRegistry, workspaceRegistry } = createTestRegistries();
    const { logger, infoRecords } = createCapturingLogger();

    const service = new WorkspaceReconciliationService({
      projectRegistry,
      workspaceRegistry,
      logger,
    });

    await service.runOnce();

    expect(infoRecords).toEqual([]);
  });

  test("an unclassified root converges and reconciles on a later tick", async () => {
    const rootPath = realpathSync(mkdtempSync(path.join(tmpdir(), "reconcile-converge-")));
    tempDirs.push(rootPath);
    const { projects, workspaces, projectRegistry, workspaceRegistry } = createTestRegistries();
    seedProject(projects, rootPath, { kind: "non_git" });
    seedWorkspace(workspaces, "w1", "p1", rootPath, { kind: "directory" });

    const git = new TestCheckouts();
    git.set(rootPath, createCheckout(rootPath, { isGit: true, worktreeRoot: rootPath }));
    const clock = new TestClock();
    const policy = createTestGitActivity({ policy: "auto" });
    const service = new WorkspaceReconciliationService({
      projectRegistry,
      workspaceRegistry,
      logger: createTestLogger(),
      workspaceGitService: git,
      gitActivity: policy.gitActivity,
      clock,
      rescanIntervalMs: 5_000,
      watchProjectRoot: inertRootWatch(),
    });
    await service.start();

    // First tick: the root has no verdict, so it is skipped, and the skip asks
    // the policy service to settle it.
    await clock.advanceBy(5_000);
    expect(git.reads).toEqual([]);
    expect(policy.ensureCalls()).toEqual([rootPath]);
    expect(projects.get("p1")?.kind).toBe("non_git");

    // Second tick: classification landed, so the same timer reconciles.
    await clock.advanceBy(5_000);
    expect(git.reads).toEqual([rootPath]);
    expect(projects.get("p1")?.kind).toBe("git");
    expect(workspaces.get("w1")?.kind).toBe("local_checkout");
    service.dispose();
  });

  test("convergence requests classification at most once in flight per root", async () => {
    const rootPath = realpathSync(mkdtempSync(path.join(tmpdir(), "reconcile-inflight-")));
    tempDirs.push(rootPath);
    const { projects, workspaces, projectRegistry, workspaceRegistry } = createTestRegistries();
    seedProject(projects, rootPath);
    seedWorkspace(workspaces, "w1", "p1", rootPath);

    let release!: () => void;
    const held = new Promise<void>((accept) => {
      release = accept;
    });
    const clock = new TestClock();
    const policy = createTestGitActivity({
      policy: "auto",
      classify: async () => {
        await held;
        return localVerdict();
      },
    });
    const service = new WorkspaceReconciliationService({
      projectRegistry,
      workspaceRegistry,
      logger: createTestLogger(),
      workspaceGitService: new TestCheckouts(),
      gitActivity: policy.gitActivity,
      clock,
      rescanIntervalMs: 1_000,
      watchProjectRoot: inertRootWatch(),
    });
    await service.start();

    // Many ticks while the probe is stalled: one in-flight request, not one per tick.
    await clock.advanceBy(1_000);
    await clock.advanceBy(1_000);
    await clock.advanceBy(1_000);
    expect(policy.ensureCalls()).toEqual([rootPath]);

    release();
    await clock.advanceBy(1_000);
    await clock.advanceBy(1_000);
    // The stalled probe settled as automatic, so no further request is needed.
    expect(policy.ensureCalls()).toEqual([rootPath]);
    service.dispose();
  });

  test("convergence never fires under a manual policy", async () => {
    const rootPath = realpathSync(mkdtempSync(path.join(tmpdir(), "reconcile-manual-")));
    tempDirs.push(rootPath);
    const { projects, workspaces, projectRegistry, workspaceRegistry } = createTestRegistries();
    seedProject(projects, rootPath);
    seedWorkspace(workspaces, "w1", "p1", rootPath);

    const clock = new TestClock();
    const policy = createTestGitActivity({ policy: "manual" });
    const service = new WorkspaceReconciliationService({
      projectRegistry,
      workspaceRegistry,
      logger: createTestLogger(),
      workspaceGitService: new TestCheckouts(),
      gitActivity: policy.gitActivity,
      clock,
      rescanIntervalMs: 1_000,
      watchProjectRoot: inertRootWatch(),
    });
    await service.start();

    await clock.advanceBy(1_000);
    await clock.advanceBy(1_000);
    await clock.advanceBy(1_000);

    // Non-vacuity: this pins the unknown-only guard. Under `manual` the root is
    // also "not automatic", so without the `peek` check the skipped read would
    // call ensureClassification and this would be 3, not 0.
    //
    // The guard needs `peek` rather than `isAutomatic` because the two answers
    // differ exactly where it matters: `isAutomatic` is false for both "the host
    // said no" and "not classified yet", and only `peek` separates them. That is
    // why reconciliation takes the policy service and not a boolean.
    expect(policy.ensureCalls()).toEqual([]);
    expect(policy.gitActivity.peek(rootPath).effectiveMode).toBe("manual");
    service.dispose();
  });

  test("convergence never fires for an already-automatic root", async () => {
    const rootPath = realpathSync(mkdtempSync(path.join(tmpdir(), "reconcile-auto-")));
    tempDirs.push(rootPath);
    const { projects, workspaces, projectRegistry, workspaceRegistry } = createTestRegistries();
    seedProject(projects, rootPath);
    seedWorkspace(workspaces, "w1", "p1", rootPath);

    const clock = new TestClock();
    const policy = createTestGitActivity({ policy: "auto" });
    // Settle the verdict before the service ever sees the root. `isAutomatic`
    // only peeks, so this is the explicit pre-classification.
    expect(await policy.settle(rootPath)).toBe(true);
    const git = new TestCheckouts();
    const service = new WorkspaceReconciliationService({
      projectRegistry,
      workspaceRegistry,
      logger: createTestLogger(),
      workspaceGitService: git,
      gitActivity: policy.gitActivity,
      clock,
      rescanIntervalMs: 1_000,
      watchProjectRoot: inertRootWatch(),
    });
    await service.start();

    await clock.advanceBy(1_000);
    await clock.advanceBy(1_000);

    expect(policy.ensureCalls()).toEqual([]);
    expect(git.reads).toEqual([rootPath, rootPath]);
    service.dispose();
  });

  test("an aged-out verdict is skipped on that tick and reconciles on the next", async () => {
    const rootPath = realpathSync(mkdtempSync(path.join(tmpdir(), "reconcile-aged-")));
    tempDirs.push(rootPath);
    const { projects, workspaces, projectRegistry, workspaceRegistry } = createTestRegistries();
    seedProject(projects, rootPath, { kind: "non_git" });
    seedWorkspace(workspaces, "w1", "p1", rootPath, { kind: "directory" });

    const git = new TestCheckouts();
    git.set(rootPath, createCheckout(rootPath, { isGit: true, worktreeRoot: rootPath }));
    const clock = new TestClock();
    // The probe is held past the aged-out tick, so the skip cannot be hidden by
    // a verdict that lands mid-tick.
    let release!: () => void;
    let held: Promise<void> | null = null;
    const policy = createTestGitActivity({
      policy: "auto",
      cacheTtlMs: 60_000,
      classify: async () => {
        if (held) await held;
        return localVerdict();
      },
    });
    const service = new WorkspaceReconciliationService({
      projectRegistry,
      workspaceRegistry,
      logger: createTestLogger(),
      workspaceGitService: git,
      gitActivity: policy.gitActivity,
      clock,
      rescanIntervalMs: 5_000,
      watchProjectRoot: inertRootWatch(),
    });
    await service.start();

    await clock.advanceBy(5_000);
    await clock.advanceBy(5_000);
    expect(git.reads).toEqual([rootPath]);
    expect(projects.get("p1")?.kind).toBe("git");

    // Past the 60s verdict TTL the stored verdict stops granting permission, so
    // this tick reads `unknown` -- the same root, still skipped.
    held = new Promise<void>((accept) => {
      release = accept;
    });
    policy.advanceClock(60_000);
    await clock.advanceBy(5_000);

    expect(git.reads).toEqual([rootPath]);
    expect(policy.gitActivity.isAutomatic(rootPath)).toBe(false);
    expect(projects.get("p1")?.kind).toBe("git");

    // The skipped tick asked for a fresh verdict; once it lands, the next tick
    // reconciles again without any other trigger.
    release();
    held = null;
    await flushMicrotasks();
    await clock.advanceBy(5_000);

    expect(policy.gitActivity.isAutomatic(rootPath)).toBe(true);
    expect(git.reads).toEqual([rootPath, rootPath]);
    service.dispose();
  });

  test("a manual tick reads no Git metadata but still archives a missing directory", async () => {
    const rootPath = realpathSync(mkdtempSync(path.join(tmpdir(), "reconcile-manual-root-")));
    tempDirs.push(rootPath);
    const missingDirectory = "/tmp/reconcile-manual-missing-workspace";
    const { projects, workspaces, projectRegistry, workspaceRegistry } = createTestRegistries();
    seedProject(projects, rootPath);
    seedWorkspace(workspaces, "w1", "p1", rootPath);
    seedWorkspace(workspaces, "w2", "p1", missingDirectory);

    const git = new TestCheckouts();
    const clock = new TestClock();
    const policy = createTestGitActivity({ policy: "manual" });
    const service = new WorkspaceReconciliationService({
      projectRegistry,
      workspaceRegistry,
      logger: createTestLogger(),
      workspaceGitService: git,
      gitActivity: policy.gitActivity,
      clock,
      rescanIntervalMs: 1_000,
      watchProjectRoot: inertRootWatch(),
      statDirectory: async (targetPath) => {
        if (targetPath === missingDirectory) throw createErrno("ENOENT", "missing");
        return presentDirectory();
      },
    });
    await service.start();

    await clock.advanceBy(1_000);

    expect(git.reads).toEqual([]);
    expect(workspaces.get("w2")?.archivedAt).toEqual(expect.any(String));
    service.dispose();
  });

  test("a manual tick leaves project identity untouched", async () => {
    const rootPath = realpathSync(mkdtempSync(path.join(tmpdir(), "reconcile-manual-identity-")));
    tempDirs.push(rootPath);
    const { projects, workspaces, projectRegistry, workspaceRegistry } = createTestRegistries();
    const project = seedProject(projects, rootPath, {
      kind: "git",
      projectKey: "identity-key",
    });
    seedWorkspace(workspaces, "w1", "p1", rootPath, { kind: "local_checkout" });

    const git = new TestCheckouts();
    git.set(rootPath, createCheckout(rootPath, { remoteUrl: "git@github.com:acme/other.git" }));
    const clock = new TestClock();
    const policy = createTestGitActivity({ policy: "manual" });
    const service = new WorkspaceReconciliationService({
      projectRegistry,
      workspaceRegistry,
      logger: createTestLogger(),
      workspaceGitService: git,
      gitActivity: policy.gitActivity,
      clock,
      rescanIntervalMs: 1_000,
      watchProjectRoot: inertRootWatch(),
    });
    await service.start();

    await clock.advanceBy(1_000);

    expect(git.reads).toEqual([]);
    const after = projects.get("p1");
    expect(after?.kind).toBe(project.kind);
    expect(after?.projectKey).toBe(project.projectKey);
    expect(after?.displayName).toBe(project.displayName);
    service.dispose();
  });

  test("a manual tick leaves workspace placement untouched, including a worktree", async () => {
    const rootPath = realpathSync(mkdtempSync(path.join(tmpdir(), "reconcile-manual-placement-")));
    tempDirs.push(rootPath);
    const { projects, workspaces, projectRegistry, workspaceRegistry } = createTestRegistries();
    seedProject(projects, rootPath);
    const workspace = seedWorkspace(workspaces, "w1", "p1", rootPath, {
      kind: "worktree",
      worktreeRoot: rootPath,
      mainRepoRoot: "/tmp/main-repo",
      isPaseoOwnedWorktree: true,
    });

    const git = new TestCheckouts();
    // What Git would really say: a plain directory. A skipped read must not leak
    // this in any form -- that is what collapses the worktree placement.
    git.set(rootPath, createCheckout(rootPath));
    const clock = new TestClock();
    const policy = createTestGitActivity({ policy: "manual" });
    const service = new WorkspaceReconciliationService({
      projectRegistry,
      workspaceRegistry,
      logger: createTestLogger(),
      workspaceGitService: git,
      gitActivity: policy.gitActivity,
      clock,
      rescanIntervalMs: 1_000,
      watchProjectRoot: inertRootWatch(),
    });
    await service.start();

    await clock.advanceBy(1_000);

    expect(git.reads).toEqual([]);
    const after = workspaces.get("w1");
    expect(after?.kind).toBe(workspace.kind);
    expect(after?.worktreeRoot).toBe(workspace.worktreeRoot);
    expect(after?.mainRepoRoot).toBe(workspace.mainRepoRoot);
    expect(after?.isPaseoOwnedWorktree).toBe(workspace.isPaseoOwnedWorktree);
    service.dispose();
  });

  test("a mixed mount reads the admitted root and leaves the manual sibling alone", async () => {
    const rootPath = realpathSync(mkdtempSync(path.join(tmpdir(), "reconcile-mixed-root-")));
    const siblingPath = realpathSync(mkdtempSync(path.join(tmpdir(), "reconcile-mixed-sibling-")));
    tempDirs.push(rootPath, siblingPath);
    const { projects, workspaces, projectRegistry, workspaceRegistry } = createTestRegistries();
    seedProject(projects, rootPath);
    seedWorkspace(workspaces, "w1", "p1", rootPath, { kind: "local_checkout" });
    seedWorkspace(workspaces, "w2", "p1", siblingPath, {
      kind: "worktree",
      worktreeRoot: siblingPath,
      mainRepoRoot: "/tmp/main-repo",
      isPaseoOwnedWorktree: true,
    });

    const git = new TestCheckouts();
    git.set(rootPath, createCheckout(rootPath, { isGit: true, worktreeRoot: rootPath }));
    git.set(siblingPath, createCheckout(siblingPath));
    const clock = new TestClock();
    const policy = createTestGitActivity({
      policy: "auto",
      classify: async (cwd) =>
        cwd === path.resolve(siblingPath)
          ? localVerdict({ class: "network", reason: "cwd_on_network_mount" })
          : localVerdict(),
    });
    const service = new WorkspaceReconciliationService({
      projectRegistry,
      workspaceRegistry,
      logger: createTestLogger(),
      workspaceGitService: git,
      gitActivity: policy.gitActivity,
      clock,
      rescanIntervalMs: 5_000,
      watchProjectRoot: inertRootWatch(),
    });
    await service.start();

    // Settles both verdicts, then reconciles only the admitted root.
    await clock.advanceBy(5_000);
    await clock.advanceBy(5_000);

    expect(git.reads).toEqual([rootPath]);
    expect(policy.gitActivity.isAutomatic(rootPath)).toBe(true);
    expect(policy.gitActivity.isAutomatic(siblingPath)).toBe(false);
    const sibling = workspaces.get("w2");
    expect(sibling?.kind).toBe("worktree");
    expect(sibling?.worktreeRoot).toBe(siblingPath);
    expect(sibling?.mainRepoRoot).toBe("/tmp/main-repo");
    expect(sibling?.isPaseoOwnedWorktree).toBe(true);
    expect(workspaces.get("w1")?.kind).toBe("local_checkout");
    service.dispose();
  });

  test("an automatic policy still reads Git metadata and updates kind", async () => {
    const rootPath = realpathSync(mkdtempSync(path.join(tmpdir(), "reconcile-auto-kind-")));
    tempDirs.push(rootPath);
    const { projects, workspaces, projectRegistry, workspaceRegistry } = createTestRegistries();
    seedProject(projects, rootPath, { kind: "non_git" });
    seedWorkspace(workspaces, "w1", "p1", rootPath, { kind: "directory" });

    const git = new TestCheckouts();
    git.set(rootPath, createCheckout(rootPath, { isGit: true, worktreeRoot: rootPath }));
    const clock = new TestClock();
    const policy = createTestGitActivity({ policy: "enabled" });
    const service = new WorkspaceReconciliationService({
      projectRegistry,
      workspaceRegistry,
      logger: createTestLogger(),
      workspaceGitService: git,
      gitActivity: policy.gitActivity,
      clock,
      rescanIntervalMs: 1_000,
      watchProjectRoot: inertRootWatch(),
    });
    await service.start();

    await clock.advanceBy(1_000);

    expect(policy.ensureCalls()).toEqual([]);
    expect(git.reads).toEqual([rootPath]);
    expect(projects.get("p1")?.kind).toBe("git");
    expect(workspaces.get("w1")?.kind).toBe("local_checkout");
    service.dispose();
  });

  test("backfills persisted worktree ownership from the current checkout", async () => {
    const rootPath = realpathSync(mkdtempSync(path.join(tmpdir(), "reconcile-worktree-owner-")));
    tempDirs.push(rootPath);
    const { projects, workspaces, projectRegistry, workspaceRegistry } = createTestRegistries();
    const checkouts = new TestCheckouts();
    checkouts.set(
      rootPath,
      createCheckout(rootPath, {
        isGit: true,
        worktreeRoot: rootPath,
        isPaseoOwnedWorktree: true,
        mainRepoRoot: "/tmp/main-repo",
      }),
    );
    projects.set(
      "p1",
      createPersistedProjectRecord({
        projectId: "p1",
        rootPath,
        kind: "git",
        displayName: "worktree",
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    );
    workspaces.set(
      "w1",
      createPersistedWorkspaceRecord({
        workspaceId: "w1",
        projectId: "p1",
        cwd: rootPath,
        kind: "worktree",
        displayName: "worktree",
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    );
    const service = new WorkspaceReconciliationService({
      projectRegistry,
      workspaceRegistry,
      workspaceGitService: checkouts,
      logger: createTestLogger(),
    });

    const result = await service.reconcileGitMetadata();

    expect(result.changesApplied).toEqual([
      {
        kind: "project_updated",
        projectId: "p1",
        directory: rootPath,
        fields: { projectKey: canonicalLocalProjectKey(rootPath) },
      },
      {
        kind: "workspace_updated",
        workspaceId: "w1",
        directory: rootPath,
        fields: {
          worktreeRoot: rootPath,
          isPaseoOwnedWorktree: true,
          mainRepoRoot: "/tmp/main-repo",
        },
      },
    ]);
    expect(workspaces.get("w1")).toMatchObject({
      worktreeRoot: rootPath,
      isPaseoOwnedWorktree: true,
      mainRepoRoot: "/tmp/main-repo",
    });
  });
});
