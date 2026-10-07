import { watch as watchPath } from "node:fs";
import { resolve } from "node:path";
import { stat } from "node:fs/promises";
import type { ProjectCheckoutLitePayload } from "@getpaseo/protocol/messages";
import pLimit from "p-limit";
import type pino from "pino";
import type {
  ProjectRegistry,
  WorkspaceRegistry,
  PersistedProjectRecord,
  PersistedWorkspaceRecord,
} from "./workspace-registry.js";
import type { WorkspaceGitService } from "./workspace-git-service.js";
import { areEquivalentPaths } from "../utils/path.js";
import { withTimeout } from "../utils/promise-timeout.js";
import {
  deriveProjectKind,
  reconcileWorkspacePlacement,
  type MutableWorkspacePlacement,
} from "./workspace-registry-model.js";
import { workspaceIdsForProjects } from "./workspace-directory.js";
import { deriveProjectKey } from "./project-key.js";
import type { GitActivityPolicyService } from "./git-activity/policy.js";

const DEFAULT_RESCAN_INTERVAL_MS = 5 * 60_000;
const DEFAULT_DEBOUNCE_MS = 100;
const DIRECTORY_STAT_CONCURRENCY = 2;
const DIRECTORY_STAT_TIMEOUT_MS = 5_000;

export type ProjectUpdate =
  | { kind: "upsert"; project: PersistedProjectRecord }
  | { kind: "remove"; projectId: string };

interface ProjectRootWatcher {
  close(): void;
}

export interface ProjectRootWatch {
  (
    rootPath: string,
    options: { recursive: false },
    onChange: (event: string, filename: string | Buffer | null) => void,
    onError: (error: Error) => void,
  ): ProjectRootWatcher;
}

export interface ReconciliationTimer {
  unref?(): void;
}

export interface ReconciliationClock {
  setTimeout(callback: () => void | Promise<void>, delayMs: number): ReconciliationTimer;
  clearTimeout(timer: ReconciliationTimer): void;
  setInterval(callback: () => void | Promise<void>, delayMs: number): ReconciliationTimer;
  clearInterval(timer: ReconciliationTimer): void;
}

const systemClock: ReconciliationClock = {
  setTimeout: (callback, delayMs) => setTimeout(() => void callback(), delayMs),
  clearTimeout: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
  setInterval: (callback, delayMs) => setInterval(() => void callback(), delayMs),
  clearInterval: (timer) => clearInterval(timer as ReturnType<typeof setInterval>),
};

const watchProjectRoot: ProjectRootWatch = (rootPath, options, onChange, onError) => {
  const watcher = watchPath(rootPath, options, onChange);
  watcher.on("error", onError);
  return watcher;
};

export type ReconciliationChange =
  | { kind: "workspace_archived"; workspaceId: string; directory: string; reason: string }
  | {
      kind: "project_updated";
      projectId: string;
      directory: string;
      fields: Partial<Pick<PersistedProjectRecord, "kind" | "projectKey">>;
    }
  | {
      kind: "workspace_updated";
      workspaceId: string;
      directory: string;
      fields: Partial<MutableWorkspacePlacement>;
    };

export interface ReconciliationResult {
  changesApplied: ReconciliationChange[];
  durationMs: number;
}

export interface DirectoryStat {
  isDirectory(): boolean;
}

export interface WorkspaceReconciliationServiceOptions {
  serverId?: string;
  projectRegistry: ProjectRegistry;
  workspaceRegistry: WorkspaceRegistry;
  logger: pino.Logger;
  onChanges?: (changes: ReconciliationChange[]) => void;
  workspaceGitService?: Pick<WorkspaceGitService, "getCheckout">;
  /** Host-global Git activity policy. Omitted means allow-all. */
  gitActivity?: ReconciliationGitActivity;
  onProjectUpdate?: (update: ProjectUpdate) => void;
  onWorkspaceArchived?: (workspaceId: string) => void | Promise<void>;
  onWorkspacesChanged?: (workspaceIds: string[]) => Promise<void>;
  watchProjectRoot?: ProjectRootWatch;
  clock?: ReconciliationClock;
  rescanIntervalMs?: number;
  debounceMs?: number;
  statDirectory?: (targetPath: string) => Promise<DirectoryStat>;
  directoryStatTimeoutMs?: number;
  directoryStatConcurrency?: number;
}

/**
 * A Git read is either a real checkout or a policy refusal. The refusal is its
 * own variant rather than an `isGit: false` payload: `readCheckout` already
 * returns that payload when no Git service is injected, so a synthetic one
 * would be indistinguishable from it and would still rewrite `kind` to
 * `non_git` and collapse a worktree's placement.
 */
export type CheckoutRead =
  | { kind: "checkout"; checkout: ProjectCheckoutLitePayload }
  | { kind: "skipped"; cwd: string };

interface ProjectReconciliationInput {
  project: PersistedProjectRecord;
  siblings: PersistedWorkspaceRecord[];
  currentGit: ProjectCheckoutLitePayload;
  readCheckout: (cwd: string) => Promise<CheckoutRead>;
  changes: ReconciliationChange[];
}

interface CachedCheckoutRead {
  cwd: string;
  checkout: Promise<CheckoutRead>;
}

/**
 * The reconciliation slice of the host-global policy owner.
 *
 * Reconciliation takes the service itself rather than a boolean predicate: it
 * also has to call `ensureClassification`, which is what lets an unclassified
 * root converge instead of staying skipped forever. `peek` is what separates
 * that case from a host decision -- `isAutomatic` is false for both.
 */
export type ReconciliationGitActivity = Pick<
  GitActivityPolicyService,
  "isAutomatic" | "ensureClassification" | "peek"
>;

type DirectoryState = "directory" | "missing" | "unreadable";

export class WorkspaceReconciliationService {
  private readonly serverId: string | undefined;
  private readonly projectRegistry: ProjectRegistry;
  private readonly workspaceRegistry: WorkspaceRegistry;
  private readonly logger: pino.Logger;
  private readonly onChanges: ((changes: ReconciliationChange[]) => void) | null;
  private readonly workspaceGitService: Pick<WorkspaceGitService, "getCheckout"> | null;
  private readonly gitActivity: ReconciliationGitActivity | null;
  private readonly onProjectUpdate: ((update: ProjectUpdate) => void) | null;
  private readonly onWorkspaceArchived: ((workspaceId: string) => void | Promise<void>) | null;
  private readonly onWorkspacesChanged: ((workspaceIds: string[]) => Promise<void>) | null;
  private readonly watchProjectRoot: ProjectRootWatch;
  private readonly clock: ReconciliationClock;
  private readonly rescanIntervalMs: number;
  private readonly debounceMs: number;
  private readonly statDirectory: (targetPath: string) => Promise<DirectoryStat>;
  private readonly directoryStatTimeoutMs: number;
  private readonly directoryInspectLimit: ReturnType<typeof pLimit>;
  private readonly watchers: Array<{ rootPath: string; watcher: ProjectRootWatcher }> = [];
  private unsubscribeRegistry: (() => void) | null = null;
  private rescanTimer: ReconciliationTimer | null = null;
  private debounceTimer: ReconciliationTimer | null = null;
  private disposed = false;
  private started = false;
  private reconciling = false;
  private reconcileQueuedMode: "metadata" | "full" | null = null;
  /** At most one classification attempt per root, keyed by resolved root path. */
  private readonly classificationRequests = new Map<string, Promise<void>>();

  constructor(options: WorkspaceReconciliationServiceOptions) {
    this.serverId = options.serverId;
    this.projectRegistry = options.projectRegistry;
    this.workspaceRegistry = options.workspaceRegistry;
    this.logger = options.logger.child({ module: "workspace-reconciliation" });
    this.onChanges = options.onChanges ?? null;
    this.workspaceGitService = options.workspaceGitService ?? null;
    this.gitActivity = options.gitActivity ?? null;
    this.onProjectUpdate = options.onProjectUpdate ?? null;
    this.onWorkspaceArchived = options.onWorkspaceArchived ?? null;
    this.onWorkspacesChanged = options.onWorkspacesChanged ?? null;
    this.watchProjectRoot = options.watchProjectRoot ?? watchProjectRoot;
    this.clock = options.clock ?? systemClock;
    this.rescanIntervalMs = options.rescanIntervalMs ?? DEFAULT_RESCAN_INTERVAL_MS;
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.statDirectory = options.statDirectory ?? ((targetPath) => stat(targetPath));
    this.directoryStatTimeoutMs = options.directoryStatTimeoutMs ?? DIRECTORY_STAT_TIMEOUT_MS;
    this.directoryInspectLimit = pLimit(
      options.directoryStatConcurrency ?? DIRECTORY_STAT_CONCURRENCY,
    );
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.unsubscribeRegistry =
      this.projectRegistry.subscribeToMutations?.(async (mutation) => {
        try {
          // Project creation does not resolve until its root watch is installed,
          // closing the git-init race for newly added empty projects.
          await this.syncProjectRootWatches();
          if (this.disposed) return;
          if (mutation.kind === "upsert" && mutation.project && !mutation.project.archivedAt) {
            this.onProjectUpdate?.({ kind: "upsert", project: mutation.project });
          } else {
            this.onProjectUpdate?.({ kind: "remove", projectId: mutation.projectId });
          }
        } catch (error) {
          this.logger.warn({ err: error }, "Project reconciliation mutation handling failed");
        }
      }) ?? null;
    await this.syncProjectRootWatches();
    this.rescanTimer = this.clock.setInterval(
      () => this.reconcileObservedGitMetadata("full"),
      this.rescanIntervalMs,
    );
    this.rescanTimer.unref?.();
  }

  dispose(): void {
    this.disposed = true;
    this.classificationRequests.clear();
    this.unsubscribeRegistry?.();
    this.unsubscribeRegistry = null;
    if (this.rescanTimer) this.clock.clearInterval(this.rescanTimer);
    if (this.debounceTimer) this.clock.clearTimeout(this.debounceTimer);
    for (const { watcher } of this.watchers) watcher.close();
    this.watchers.length = 0;
  }

  /** Reconciles mutable Git facts only; never archives missing records. */
  async reconcileGitMetadata(): Promise<ReconciliationResult> {
    const start = Date.now();
    const changes: ReconciliationChange[] = [];
    const [projects, workspaces] = await Promise.all([
      this.projectRegistry.list(),
      this.workspaceRegistry.list(),
    ]);
    const activeWorkspaces = workspaces.filter((workspace) => !workspace.archivedAt);
    const activeProjects = projects.filter((project) => !project.archivedAt);
    const directoryStates = await this.inspectDirectories([
      ...activeWorkspaces.map((workspace) => workspace.cwd),
      ...activeProjects.map((project) => project.rootPath),
    ]);
    const workspacesByProject = new Map<string, PersistedWorkspaceRecord[]>();
    for (const workspace of activeWorkspaces) {
      if (directoryStateFor(directoryStates, workspace.cwd) !== "directory") continue;
      const siblings = workspacesByProject.get(workspace.projectId) ?? [];
      siblings.push(workspace);
      workspacesByProject.set(workspace.projectId, siblings);
    }
    await this.reconcileGitMetadataForProjects(
      activeProjects.filter(
        (project) => directoryStateFor(directoryStates, project.rootPath) === "directory",
      ),
      workspacesByProject,
      changes,
    );
    if (changes.length > 0) this.onChanges?.(changes);
    return { changesApplied: changes, durationMs: Date.now() - start };
  }

  async runOnce(): Promise<ReconciliationResult> {
    const start = Date.now();
    const changes: ReconciliationChange[] = [];

    const allProjects = await this.projectRegistry.list();
    const allWorkspaces = await this.workspaceRegistry.list();

    const activeProjects = allProjects.filter((p) => !p.archivedAt);
    const activeWorkspaces = allWorkspaces.filter((w) => !w.archivedAt);
    const workspaceDirectoryStatesByPath = await this.inspectDirectories(
      activeWorkspaces.map((workspace) => workspace.cwd),
    );
    const workspaceDirectoryStates = activeWorkspaces.map((workspace) => ({
      workspace,
      state: directoryStateFor(workspaceDirectoryStatesByPath, workspace.cwd),
    }));
    // Project roots are read after the workspace directories, so a volume that
    // goes away mid-pass leaves its project unreachable rather than its workspaces
    // alone. The skew can only withhold an archive, never produce one.
    const projectDirectoryStates = await this.inspectDirectories(
      activeProjects.map((project) => project.rootPath),
      workspaceDirectoryStatesByPath,
    );
    const reachableProjectIds = new Set(
      activeProjects
        .filter(
          (project) => directoryStateFor(projectDirectoryStates, project.rootPath) === "directory",
        )
        .map((project) => project.projectId),
    );

    const workspacesByProject = new Map<string, PersistedWorkspaceRecord[]>();
    for (const { workspace, state } of workspaceDirectoryStates) {
      if (state !== "directory") continue;
      const list = workspacesByProject.get(workspace.projectId) ?? [];
      list.push(workspace);
      workspacesByProject.set(workspace.projectId, list);
    }

    // 1. Archive workspaces whose directories no longer exist, but only when the
    //    project they belong to is still reachable. A missing project root means the
    //    whole location is unavailable - an unmounted volume, an offline share, a disk
    //    that has not appeared yet - and absence there proves nothing about the
    //    workspace. Projects already persist through that; their workspaces do too.
    const missingWorkspaces = workspaceDirectoryStates
      .filter(
        ({ workspace, state }) =>
          state === "missing" && reachableProjectIds.has(workspace.projectId),
      )
      .map(({ workspace }) => workspace);
    await Promise.all(
      missingWorkspaces.map(async (workspace) => {
        const timestamp = new Date().toISOString();
        await this.workspaceRegistry.archive(workspace.workspaceId, timestamp);
        await this.onWorkspaceArchived?.(workspace.workspaceId);
        changes.push({
          kind: "workspace_archived",
          workspaceId: workspace.workspaceId,
          directory: workspace.cwd,
          reason: "directory_missing",
        });

        // Update the in-memory list for the project orphan check below
        const siblings = workspacesByProject.get(workspace.projectId);
        if (siblings) {
          const updated = siblings.filter((w) => w.workspaceId !== workspace.workspaceId);
          workspacesByProject.set(workspace.projectId, updated);
        }
      }),
    );

    // 2. Reconcile mutable git metadata without changing identity or membership.
    //    Projects persist until explicitly removed, even when they currently have
    //    zero active workspaces, so they still reconcile their own metadata.
    await this.reconcileGitMetadataForProjects(
      activeProjects.filter((project) => reachableProjectIds.has(project.projectId)),
      workspacesByProject,
      changes,
    );

    if (changes.length > 0 && this.onChanges) {
      this.onChanges(changes);
    }

    const result = { changesApplied: changes, durationMs: Date.now() - start };
    if (changes.length > 0) {
      this.logger.info(
        { changeCount: changes.length, durationMs: result.durationMs, changes },
        "Workspace reconciliation applied changes",
      );
    }
    return result;
  }

  /** Runs the boot-time convergence path and publishes every affected workspace. */
  async reconcileNow(): Promise<void> {
    await this.reconcileObservedGitMetadata("full");
  }

  private async reconcileGitMetadataForProjects(
    projectsToReconcile: PersistedProjectRecord[],
    workspacesByProject: Map<string, PersistedWorkspaceRecord[]>,
    changes: ReconciliationChange[],
  ): Promise<void> {
    const checkoutReads: CachedCheckoutRead[] = [];
    const readCheckout = (cwd: string): Promise<CheckoutRead> => {
      const existing = checkoutReads.find((read) => areEquivalentPaths(read.cwd, cwd));
      if (existing) return existing.checkout;
      const checkout = this.readCheckout(cwd);
      checkoutReads.push({ cwd, checkout });
      return checkout;
    };
    const roots: Array<{ rootPath: string; projects: PersistedProjectRecord[] }> = [];
    for (const project of projectsToReconcile) {
      const root = roots.find((candidate) =>
        areEquivalentPaths(candidate.rootPath, project.rootPath),
      );
      if (root) root.projects.push(project);
      else roots.push({ rootPath: project.rootPath, projects: [project] });
    }
    await Promise.all(
      roots.map(async ({ rootPath, projects }) => {
        try {
          const rootGit = await readCheckout(rootPath);
          if (rootGit.kind === "skipped") return;
          await Promise.all(
            projects.map((project) =>
              this.reconcileProject({
                project,
                siblings: workspacesByProject.get(project.projectId) ?? [],
                currentGit: rootGit.checkout,
                readCheckout,
                changes,
              }),
            ),
          );
        } catch (error) {
          this.logger.warn(
            { err: error, rootPath },
            "Skipped workspace reconciliation after Git read failed",
          );
        }
      }),
    );
  }

  private async reconcileProject(input: ProjectReconciliationInput): Promise<void> {
    const { project, siblings, currentGit, readCheckout, changes } = input;
    const workspaceCheckouts = await Promise.all(
      siblings.map(async (workspace) => ({
        workspace,
        read: await readCheckout(workspace.cwd),
      })),
    );
    const projectUpdates: Partial<Pick<PersistedProjectRecord, "kind" | "projectKey">> = {};
    const mappedKind = deriveProjectKind(currentGit);
    const projectKey = deriveProjectKey({
      rootPath: project.rootPath,
      remoteUrl: currentGit.remoteUrl,
      worktreeRoot: currentGit.worktreeRoot,
      mainRepoRoot: currentGit.mainRepoRoot,
      serverId: this.serverId,
    });

    if (project.kind !== mappedKind) {
      projectUpdates.kind = mappedKind;
    }
    if (project.projectKey !== projectKey) {
      projectUpdates.projectKey = projectKey;
    }

    if (Object.keys(projectUpdates).length > 0) {
      const timestamp = new Date().toISOString();
      await this.projectRegistry.upsert({
        ...project,
        ...projectUpdates,
        updatedAt: timestamp,
      });
      changes.push({
        kind: "project_updated",
        projectId: project.projectId,
        directory: project.rootPath,
        fields: projectUpdates,
      });
    }

    await Promise.all(
      workspaceCheckouts.map(async ({ workspace, read }) => {
        // A sibling refused by policy keeps its persisted placement: guessing
        // from a skipped read is what collapses a worktree into a directory.
        if (read.kind === "skipped") return;
        const timestamp = new Date().toISOString();
        const update = reconcileWorkspacePlacement({
          workspace,
          checkout: read.checkout,
          updatedAt: timestamp,
        });
        if (!update) return;

        const updated = await this.workspaceRegistry.update(workspace.workspaceId, (current) => ({
          ...current,
          ...update.fields,
          updatedAt: timestamp,
        }));
        if (!updated) return;
        changes.push({
          kind: "workspace_updated",
          workspaceId: workspace.workspaceId,
          directory: workspace.cwd,
          fields: update.fields,
        });
      }),
    );
  }

  private async syncProjectRootWatches(): Promise<void> {
    if (this.disposed) return;
    const projects = await this.projectRegistry.list();
    if (this.disposed) return;
    const activeProjects = projects.filter((project) => !project.archivedAt);

    for (let index = this.watchers.length - 1; index >= 0; index -= 1) {
      const target = this.watchers[index]!;
      const stillActive = activeProjects.some((project) =>
        areEquivalentPaths(project.rootPath, target.rootPath),
      );
      if (stillActive) continue;
      target.watcher.close();
      this.watchers.splice(index, 1);
    }

    for (const project of activeProjects) {
      const alreadyWatching = this.watchers.some((target) =>
        areEquivalentPaths(target.rootPath, project.rootPath),
      );
      if (alreadyWatching) continue;
      try {
        let watcher: ProjectRootWatcher;
        watcher = this.watchProjectRoot(
          project.rootPath,
          { recursive: false },
          (_event, filename) => {
            if (filename === null || filename.toString() === ".git") {
              this.scheduleObservedReconciliation();
            }
          },
          (error) => {
            watcher.close();
            const index = this.watchers.findIndex((target) => target.watcher === watcher);
            if (index >= 0) this.watchers.splice(index, 1);
            this.logger.warn(
              { err: error, rootPath: project.rootPath },
              "Project root watch failed",
            );
          },
        );
        this.watchers.push({ rootPath: project.rootPath, watcher });
      } catch (error) {
        // The periodic reconciliation is the convergence path for roots that
        // are temporarily missing or unwatchable.
        this.logger.debug(
          { err: error, rootPath: project.rootPath },
          "Project root is not watchable yet",
        );
      }
    }
  }

  private scheduleObservedReconciliation(): void {
    if (this.disposed || this.debounceTimer) return;
    this.debounceTimer = this.clock.setTimeout(() => {
      this.debounceTimer = null;
      return this.reconcileObservedGitMetadata();
    }, this.debounceMs);
  }

  private async reconcileObservedGitMetadata(
    mode: "metadata" | "full" = "metadata",
  ): Promise<void> {
    if (this.disposed) return;
    if (this.reconciling) {
      if (mode === "full" || this.reconcileQueuedMode === null) {
        this.reconcileQueuedMode = mode;
      }
      return;
    }
    this.reconciling = true;
    try {
      await this.syncProjectRootWatches();
      const result = mode === "full" ? await this.runOnce() : await this.reconcileGitMetadata();
      const workspaceIds = new Set<string>();
      const projectIds = new Set<string>();
      for (const change of result.changesApplied) {
        if (change.kind === "workspace_updated" || change.kind === "workspace_archived") {
          workspaceIds.add(change.workspaceId);
        }
        if (change.kind === "project_updated") projectIds.add(change.projectId);
      }
      if (projectIds.size > 0) {
        const workspaces = await this.workspaceRegistry.list();
        for (const workspaceId of workspaceIdsForProjects(workspaces, projectIds)) {
          workspaceIds.add(workspaceId);
        }
      }
      if (!this.disposed && workspaceIds.size > 0) {
        await this.onWorkspacesChanged?.(Array.from(workspaceIds));
      }
    } catch (error) {
      if (!this.disposed) {
        this.logger.warn({ err: error }, "Workspace reconciliation failed");
      }
    } finally {
      this.reconciling = false;
      if (this.reconcileQueuedMode) {
        const queuedMode = this.reconcileQueuedMode;
        this.reconcileQueuedMode = null;
        void this.reconcileObservedGitMetadata(queuedMode);
      }
    }
  }

  /**
   * Reads Git metadata for one path unless the host policy withholds it.
   *
   * A withheld read is a `skipped` sentinel, never a synthetic `isGit: false`
   * payload: that payload is already what the no-Git-service path returns, and
   * feeding it onward would rewrite `kind` to `non_git` and collapse a
   * worktree's placement.
   */
  private async readCheckout(cwd: string): Promise<CheckoutRead> {
    if (this.gitActivity && !this.gitActivity.isAutomatic(cwd)) {
      // "Not automatic" covers two very different states: a host decision, and a
      // root that simply is not classified yet. Under `auto` the second is the
      // normal case on first sight, and no other caller would ask for the real
      // answer, so a bare skip would be permanent.
      this.requestClassificationWhenUndecided(cwd);
      return { kind: "skipped", cwd };
    }
    if (!this.workspaceGitService) {
      return {
        kind: "checkout",
        checkout: {
          cwd,
          isGit: false as const,
          currentBranch: null,
          remoteUrl: null,
          worktreeRoot: null,
          isPaseoOwnedWorktree: false as const,
          mainRepoRoot: null,
        },
      };
    }
    const checkout = await this.workspaceGitService.getCheckout(cwd);
    return { kind: "checkout", checkout };
  }

  /**
   * Asks the policy service to settle a root whose effective mode is not yet
   * decided. Bounded to one in-flight request per path, and never awaited here:
   * classification reads the mount table rather than the workspace tree, but it
   * is still asynchronous work, so awaiting it would put another caller's timing
   * on the reconciliation path.
   */
  private requestClassificationWhenUndecided(cwd: string): void {
    const gitActivity = this.gitActivity;
    if (!gitActivity) return;
    const key = resolve(cwd);
    if (this.classificationRequests.has(key)) return;
    // `manual` is a decision; only an undetermined verdict can still change.
    const state = gitActivity.peek(key);
    if (state.effectiveMode !== "unknown") return;
    const pending = gitActivity
      .ensureClassification(key)
      .then(() => undefined)
      .catch((error: unknown) => {
        this.logger.warn(
          { err: error, cwd: key },
          "Filesystem classification failed; workspace stays manual",
        );
      })
      .finally(() => {
        if (this.classificationRequests.get(key) === pending) {
          this.classificationRequests.delete(key);
        }
      });
    this.classificationRequests.set(key, pending);
  }

  private async inspectDirectories(
    paths: string[],
    states: Map<string, DirectoryState> = new Map(),
  ): Promise<Map<string, DirectoryState>> {
    const uniquePaths = uniqueDirectoryPaths(paths).filter(
      (targetPath) =>
        !Array.from(states.keys()).some((existing) => areEquivalentPaths(existing, targetPath)),
    );
    await Promise.all(
      uniquePaths.map((targetPath) =>
        this.directoryInspectLimit(async () => {
          states.set(targetPath, await this.inspectDirectory(targetPath));
        }),
      ),
    );
    return states;
  }

  private async inspectDirectory(targetPath: string): Promise<DirectoryState> {
    try {
      const stats = await withTimeout(
        this.statDirectory(targetPath),
        this.directoryStatTimeoutMs,
        `Directory inspection timed out: ${targetPath}`,
      );
      return stats.isDirectory() ? "directory" : "missing";
    } catch (error) {
      if (isMissingPathError(error)) return "missing";
      this.logger.warn(
        { err: error, targetPath },
        "Skipped workspace reconciliation after directory inspection failed",
      );
      return "unreadable";
    }
  }
}

function uniqueDirectoryPaths(paths: string[]): string[] {
  const unique: string[] = [];
  for (const targetPath of paths) {
    if (unique.some((existing) => areEquivalentPaths(existing, targetPath))) continue;
    unique.push(targetPath);
  }
  return unique;
}

function directoryStateFor(
  states: Map<string, DirectoryState>,
  targetPath: string,
): DirectoryState {
  for (const [path, state] of states) {
    if (areEquivalentPaths(path, targetPath)) return state;
  }
  return "unreadable";
}

function isMissingPathError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  return error.code === "ENOENT" || error.code === "ENOTDIR";
}
