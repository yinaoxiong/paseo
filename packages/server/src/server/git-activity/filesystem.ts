import path from "node:path";
import { withTimeout } from "../../utils/promise-timeout.js";
import {
  classifyMountClass,
  findMountEntryForPath,
  parseMountInfo,
  readMountInfo,
  type MountClass,
  type MountEntry,
} from "./mountinfo.js";

export const FILESYSTEM_CACHE_TTL_MS = 60_000;
export const MOUNT_TABLE_CACHE_TTL_MS = 30_000;
export const FILESYSTEM_CACHE_MAX_ENTRIES = 512;
export const MOUNT_READ_TIMEOUT_MS = 500;

export type WorkspaceFilesystemClass = "local" | "network" | "unknown";

export interface WorkspaceFilesystemVerdict {
  class: WorkspaceFilesystemClass;
  reason: string;
  /** Linux mount type hosting the path, when the mount table resolved it. */
  mountFsType: string | null;
  checkedAt: number;
}

export interface ClassifyFilesystemOptions {
  cwd: string;
  now?: () => number;
  mountInfoPath?: string;
  readMountTable?: () => Promise<string | null>;
  cacheTtlMs?: number;
  mountTableTtlMs?: number;
  isLinux?: boolean;
  logger?: { warn(fields: Record<string, unknown>, message: string): void };
}

interface MountTableSnapshot {
  content: string | null;
  loadedAt: number;
}

interface CacheEntry {
  promise: Promise<WorkspaceFilesystemVerdict>;
  createdAt: number;
}

interface ClassifierState {
  mountTable: MountTableSnapshot | null;
  cache: Map<string, CacheEntry>;
  entries: MountEntry[] | null;
  logger?: ClassifyFilesystemOptions["logger"];
}

function lexicalShortCircuit(cwd: string): WorkspaceFilesystemClass | null {
  const normalized = cwd.replace(/\\/g, "/");
  if (normalized.startsWith("//") || normalized.startsWith("\\\\")) {
    return "network";
  }
  return null;
}

/**
 * Only the lexical cwd is inspected here. The mount table alone decides: a known
 * network or unknown FUSE mount is refused, and a local mount is accepted as
 * local, so classification never reads the stalled workspace tree it is trying to
 * protect.
 *
 * That acceptance assumes the Git metadata a workspace reads lives on the same
 * mount as the workspace itself. A `.git` symlinked or `gitdir:`-linked onto a
 * different mount is not detected; see docs/file-observation.md.
 */
function classifyMount(mountFsType: string): WorkspaceFilesystemClass {
  return classifyMountClass(mountFsType);
}

async function loadMountTable(
  state: ClassifierState,
  options: ClassifyFilesystemOptions,
  now: number,
): Promise<MountEntry[]> {
  const snapshot = state.mountTable;
  const ttl = options.mountTableTtlMs ?? MOUNT_TABLE_CACHE_TTL_MS;
  if (snapshot && now - snapshot.loadedAt < ttl) {
    return state.entries ?? [];
  }

  // /proc is not the workspace, but a stalled read must still not hang the
  // caller: the verdict falls back to unknown.
  const read = options.readMountTable
    ? options.readMountTable()
    : readMountInfo(options.mountInfoPath);
  const content = await withTimeout(
    read,
    MOUNT_READ_TIMEOUT_MS,
    "Mount table read timed out",
  ).catch(() => null);
  state.mountTable = { content, loadedAt: now };
  state.entries = content ? parseMountInfo(content) : [];
  return state.entries;
}

function mountClassFor(
  state: ClassifierState,
  targetPath: string,
): {
  mountClass: MountClass;
  mountFsType: string | null;
} {
  const entry = findMountEntryForPath(state.entries ?? [], targetPath);
  if (!entry) {
    return { mountClass: "unknown", mountFsType: null };
  }
  return { mountClass: classifyMount(entry.fsType), mountFsType: entry.fsType };
}

async function computeVerdict(
  state: ClassifierState,
  options: ClassifyFilesystemOptions,
  now: number,
): Promise<WorkspaceFilesystemVerdict> {
  const isLinux = options.isLinux ?? process.platform === "linux";
  if (!isLinux) {
    return {
      class: "unknown",
      reason: "platform_unsupported",
      mountFsType: null,
      checkedAt: now,
    };
  }

  const lexical = lexicalShortCircuit(options.cwd);
  if (lexical === "network") {
    return {
      class: "network",
      reason: "unc_path",
      mountFsType: null,
      checkedAt: now,
    };
  }

  const entries = await loadMountTable(state, options, now);
  if (entries.length === 0) {
    return {
      class: "unknown",
      reason: "mount_table_unavailable",
      mountFsType: null,
      checkedAt: now,
    };
  }

  const cwdMount = mountClassFor(state, options.cwd);
  if (cwdMount.mountClass !== "local") {
    return {
      class: cwdMount.mountClass === "network" ? "network" : "unknown",
      reason:
        cwdMount.mountClass === "network" ? "cwd_on_network_mount" : "cwd_on_unclassified_mount",
      mountFsType: cwdMount.mountFsType,
      checkedAt: now,
    };
  }

  return {
    class: "local",
    reason: "verified_local_mounts",
    mountFsType: cwdMount.mountFsType,
    checkedAt: now,
  };
}

function createClassifierState(logger?: ClassifyFilesystemOptions["logger"]): ClassifierState {
  return { mountTable: null, cache: new Map(), entries: null, logger };
}

/**
 * Service factory consumed by the Git activity policy (T004). One instance per
 * daemon: the mount table and per-cwd verdict cache are process-wide, and
 * `invalidate` is the entry point for mount-table and path-change events.
 */
export function createFilesystemClassifier(
  options: {
    logger?: ClassifyFilesystemOptions["logger"];
    cacheTtlMs?: number;
    mountTableTtlMs?: number;
    readMountTable?: () => Promise<string | null>;
    isLinux?: boolean;
    mountInfoPath?: string;
    now?: () => number;
  } = {},
) {
  const state = createClassifierState(options.logger);
  const shared: ClassifyFilesystemOptions = {
    cwd: "",
    ...(options.now ? { now: options.now } : {}),
    ...(options.mountInfoPath ? { mountInfoPath: options.mountInfoPath } : {}),
    ...(options.readMountTable ? { readMountTable: options.readMountTable } : {}),
    ...(options.cacheTtlMs === undefined ? {} : { cacheTtlMs: options.cacheTtlMs }),
    ...(options.mountTableTtlMs === undefined ? {} : { mountTableTtlMs: options.mountTableTtlMs }),
    ...(options.isLinux === undefined ? {} : { isLinux: options.isLinux }),
    ...(options.logger ? { logger: options.logger } : {}),
  };

  function invalidateMountTable(): void {
    state.mountTable = null;
    state.entries = null;
  }

  return {
    classify(cwd: string): Promise<WorkspaceFilesystemVerdict> {
      const now = shared.now ? shared.now() : Date.now();
      const key = path.resolve(cwd);
      const ttl = shared.cacheTtlMs ?? FILESYSTEM_CACHE_TTL_MS;
      const cached = state.cache.get(key);
      if (cached && now - cached.createdAt < ttl) {
        return cached.promise;
      }

      // The entry is published before any await, so concurrent callers for the
      // same uncached path share one classification instead of one each.
      const promise = computeVerdict(state, { ...shared, cwd: key }, now).catch(
        (error: unknown) => {
          state.logger?.warn(
            { cwd: key, error: error instanceof Error ? error.message : String(error) },
            "Filesystem classification failed",
          );
          return {
            class: "unknown" as const,
            reason: "classification_error",
            mountFsType: null,
            checkedAt: Date.now(),
          };
        },
      );

      state.cache.set(key, { promise, createdAt: now });
      if (state.cache.size > FILESYSTEM_CACHE_MAX_ENTRIES) {
        const oldest = state.cache.keys().next();
        if (!oldest.done) {
          state.cache.delete(oldest.value);
        }
      }
      return promise;
    },
    invalidate(cwd?: string): void {
      if (cwd === undefined) {
        state.cache.clear();
      } else {
        state.cache.delete(path.resolve(cwd));
      }
    },
    /** Mount topology changed: every cached verdict and the table itself are stale. */
    invalidateMountTable(): void {
      invalidateMountTable();
      state.cache.clear();
    },
    /**
     * Releases cached verdicts and the parsed mount table. Classification after
     * disposal starts from a fresh mount read.
     */
    dispose(): void {
      state.cache.clear();
      invalidateMountTable();
    },
  };
}

export type FilesystemClassifier = ReturnType<typeof createFilesystemClassifier>;
