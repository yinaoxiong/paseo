import { chmod, mkdtemp, mkdir, rm } from "node:fs/promises";
import { exec, execFile, fork, spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createFilesystemClassifier } from "./filesystem.js";

// The deleted path probe ran in a forked child. Nothing in classification may
// spawn one any more, and a mock is the only way this file can catch a
// regression: `filesystem.ts` itself has no `child_process` import to inspect.
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    fork: vi.fn(actual.fork),
    spawn: vi.fn(actual.spawn),
    exec: vi.fn(actual.exec),
    execFile: vi.fn(actual.execFile),
  };
});

const LOCAL_MOUNT_TABLE = [
  "3046 2294 253:1 / / ro,nosuid,nodev,noatime master:1 - ext4 /dev/vda1 rw",
  "3205 3049 0:396 / /tmp rw,nosuid,nodev,relatime master:640 - ext4 /dev/vdb rw",
  "3300 3049 0:400 / /data rw,nosuid,nodev,relatime master:641 - ext4 /dev/vdc rw",
].join("\n");

const HOST_MOUNT_TABLE = [
  "3046 2294 253:1 / / ro,nosuid,nodev,noatime master:1 - ext4 /dev/vda1 rw",
  "3206 3049 0:238 / /mnt/private_yax_qy4 ro,nosuid,nodev,relatime master:292 - fuse.dop-fuse dop-fuse rw,user_id=0,group_id=0,default_permissions,allow_other",
  "3205 3049 0:396 / /mnt/jfs_gy ro,nosuid,nodev,relatime master:640 - fuse.juicefs JuiceFS:aoxiongyinsjfs rw",
  "3222 3206 0:238 /projects/paseo /mnt/private_yax_qy4/projects/paseo rw - fuse.dop-fuse dop-fuse rw",
  "3301 3049 0:401 / /workspaces rw - ext4 /dev/vdd rw",
].join("\n");

/** A local workspace whose `.git` sits on a network mount. */
const SPLIT_GIT_MOUNT_TABLE = [
  "3046 2294 253:1 / / ro - ext4 /dev/vda1 rw",
  "3301 3049 0:401 / /workspaces rw - ext4 /dev/vdd rw",
  "3302 3301 0:238 / /workspaces/repo/.git rw - fuse.juicefs JuiceFS:aoxiongyinsjfs rw",
].join("\n");

const UNKNOWN_FUSE_MOUNT_TABLE = [
  "3046 2294 253:1 / / ro - ext4 /dev/vda1 rw",
  "3400 3049 0:500 / /mnt/mystery-box rw - fuse.mystery-box mystery rw",
].join("\n");

describe("filesystem classification", () => {
  test("classifies this host's dop-fuse mount as network from the mount table", async () => {
    const classifier = createFilesystemClassifier({
      isLinux: true,
      readMountTable: async () => HOST_MOUNT_TABLE,
    });

    const verdict = await classifier.classify("/mnt/private_yax_qy4/projects/paseo");

    expect(verdict.class).toBe("network");
    expect(verdict.reason).toBe("cwd_on_network_mount");
    expect(verdict.mountFsType).toBe("fuse.dop-fuse");
  });

  test("classifies juicefs mount points as network", async () => {
    const classifier = createFilesystemClassifier({
      isLinux: true,
      readMountTable: async () => HOST_MOUNT_TABLE,
    });

    const verdict = await classifier.classify("/mnt/jfs_gy/some/workspace");
    expect(verdict.class).toBe("network");
    expect(verdict.mountFsType).toBe("fuse.juicefs");
  });

  test("unknown FUSE stays unknown", async () => {
    const classifier = createFilesystemClassifier({
      isLinux: true,
      readMountTable: async () => UNKNOWN_FUSE_MOUNT_TABLE,
    });

    const verdict = await classifier.classify("/mnt/mystery-box/repo");
    expect(verdict.class).toBe("unknown");
    expect(verdict.reason).toBe("cwd_on_unclassified_mount");
    expect(verdict.mountFsType).toBe("fuse.mystery-box");
  });

  test("returns unknown on unsupported platforms instead of guessing local", async () => {
    const classifier = createFilesystemClassifier({
      isLinux: false,
      readMountTable: async () => LOCAL_MOUNT_TABLE,
    });

    const verdict = await classifier.classify("/tmp/repo");
    expect(verdict.class).toBe("unknown");
    expect(verdict.reason).toBe("platform_unsupported");
  });

  test("returns unknown when the mount table cannot be read", async () => {
    const classifier = createFilesystemClassifier({
      isLinux: true,
      readMountTable: async () => null,
    });

    const verdict = await classifier.classify("/tmp/repo");
    expect(verdict.class).toBe("unknown");
    expect(verdict.reason).toBe("mount_table_unavailable");
  });

  test("a local mount is verified local from the mount table alone", async () => {
    const classifier = createFilesystemClassifier({
      isLinux: true,
      readMountTable: async () => LOCAL_MOUNT_TABLE,
    });

    const verdict = await classifier.classify("/tmp/repo");

    expect(verdict.class).toBe("local");
    expect(verdict.reason).toBe("verified_local_mounts");
    expect(verdict.mountFsType).toBe("ext4");
    expect(verdict.checkedAt).toBeGreaterThan(0);
  });

  test("the longest matching mount point decides a nested path", async () => {
    const classifier = createFilesystemClassifier({
      isLinux: true,
      readMountTable: async () => HOST_MOUNT_TABLE,
    });

    // `/workspaces` is a local mount nested under the ext4 root.
    const nested = await classifier.classify("/workspaces/repo");
    expect(nested.class).toBe("local");
    expect(nested.reason).toBe("verified_local_mounts");

    // `/mnt/jfs_gy/repo` is under a network mount, not under `/`.
    const nestedNetwork = await classifier.classify("/mnt/jfs_gy/repo/deeper");
    expect(nestedNetwork.class).toBe("network");
    expect(nestedNetwork.mountFsType).toBe("fuse.juicefs");
  });

  test("git metadata on another mount is not consulted", async () => {
    const classifier = createFilesystemClassifier({
      isLinux: true,
      readMountTable: async () => SPLIT_GIT_MOUNT_TABLE,
    });

    // Accepted limitation: classification reads only the workspace's own mount.
    // A `.git` symlinked or `gitdir:`-linked onto network storage is not
    // detected, so this workspace is local even though its metadata is not.
    const verdict = await classifier.classify("/workspaces/repo");

    expect(verdict.class).toBe("local");
    expect(verdict.reason).toBe("verified_local_mounts");
    expect(verdict.mountFsType).toBe("ext4");
  });

  test("a throwing mount reader degrades to unknown", async () => {
    const classifier = createFilesystemClassifier({
      isLinux: true,
      readMountTable: async () => {
        throw new Error("mount read exploded");
      },
    });

    const verdict = await classifier.classify("/tmp/repo");
    expect(verdict.class).toBe("unknown");
    expect(verdict.reason).toBe("mount_table_unavailable");
  });

  test("a stalled mount reader hits its own deadline and degrades to unknown", async () => {
    const classifier = createFilesystemClassifier({
      isLinux: true,
      readMountTable: () => new Promise<string | null>(() => {}),
    });

    const started = Date.now();
    const verdict = await classifier.classify("/tmp/repo");
    expect(verdict.class).toBe("unknown");
    expect(verdict.reason).toBe("mount_table_unavailable");
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  test("classification errors degrade to unknown and never to local", async () => {
    const warnings: string[] = [];
    const classifier = createFilesystemClassifier({
      isLinux: true,
      // Throws before the read is wrapped in its deadline, so the failure
      // reaches `classify`'s catch instead of the mount-table fallback.
      readMountTable: () => {
        throw new Error("mount table access denied");
      },
      logger: {
        warn: (fields) => {
          warnings.push(String(fields.error));
        },
      },
    });

    const verdict = await classifier.classify("/tmp/repo");
    expect(verdict.class).toBe("unknown");
    expect(verdict.reason).toBe("classification_error");
    expect(warnings).toEqual(["mount table access denied"]);
  });

  test("caches verdicts per resolved cwd and merges concurrent requests", async () => {
    let now = 1_000;
    let mountReads = 0;
    const classifier = createFilesystemClassifier({
      isLinux: true,
      now: () => now,
      mountTableTtlMs: 0,
      readMountTable: async () => {
        mountReads += 1;
        return LOCAL_MOUNT_TABLE;
      },
    });

    const [first, second] = await Promise.all([
      classifier.classify("/tmp/repo"),
      classifier.classify("/tmp/repo/"),
    ]);
    expect(first.class).toBe("local");
    expect(second.class).toBe("local");
    expect(mountReads).toBe(1);

    now += 120_000;
    await classifier.classify("/tmp/repo");
    expect(mountReads).toBe(2);
  });

  test("invalidate and invalidateMountTable force fresh classification", async () => {
    let mountReads = 0;
    const classifier = createFilesystemClassifier({
      isLinux: true,
      mountTableTtlMs: 0,
      readMountTable: async () => {
        mountReads += 1;
        return LOCAL_MOUNT_TABLE;
      },
    });

    await classifier.classify("/tmp/repo");
    classifier.invalidate("/tmp/repo");
    await classifier.classify("/tmp/repo");
    expect(mountReads).toBe(2);

    await classifier.classify("/tmp/other");
    classifier.invalidateMountTable();
    await classifier.classify("/tmp/other");
    expect(mountReads).toBe(4);
  });

  test("dispose clears cached verdicts and the mount table", async () => {
    let mountReads = 0;
    const classifier = createFilesystemClassifier({
      isLinux: true,
      readMountTable: async () => {
        mountReads += 1;
        return LOCAL_MOUNT_TABLE;
      },
    });

    await classifier.classify("/tmp/repo");
    classifier.dispose();
    await classifier.classify("/tmp/repo");

    expect(mountReads).toBe(2);
  });

  test("classification spawns no child process across many paths", async () => {
    const classifier = createFilesystemClassifier({
      isLinux: true,
      cacheTtlMs: 0,
      readMountTable: async () => LOCAL_MOUNT_TABLE,
    });

    const cwds = Array.from({ length: 40 }, (_unused, index) => `/data/workspace-${index}`);
    const verdicts = await Promise.all(cwds.map((cwd) => classifier.classify(cwd)));

    expect(verdicts.every((verdict) => verdict.class === "local")).toBe(true);
    expect(vi.mocked(fork)).not.toHaveBeenCalled();
    expect(vi.mocked(spawn)).not.toHaveBeenCalled();
    expect(vi.mocked(exec)).not.toHaveBeenCalled();
    expect(vi.mocked(execFile)).not.toHaveBeenCalled();
  });
});

describe("filesystem classification never reads the workspace tree", () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "paseo-fs-classify-"));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  /** Declares the temp root local, whatever the host's real topology is. */
  function tempRootTable(extraLines: string[] = []): string {
    return [`3046 2294 253:1 / / ro - ext4 /dev/vda1 rw`, ...extraLines].join("\n");
  }

  function classifierFor(table: string) {
    return createFilesystemClassifier({
      isLinux: true,
      readMountTable: async () => table,
    });
  }

  test("an unreadable workspace directory still yields a verdict", async () => {
    const workspace = path.join(tempRoot, "unreadable");
    await mkdir(workspace, { recursive: true });
    await chmod(workspace, 0o000);

    const table = [
      "3046 2294 253:1 / / ro - ext4 /dev/vda1 rw",
      `3401 3049 0:501 / ${tempRoot} rw - ext4 /dev/vde rw`,
    ].join("\n");
    const verdict = await classifierFor(table).classify(workspace);
    await chmod(workspace, 0o700);

    expect(verdict.class).toBe("local");
    expect(verdict.reason).toBe("verified_local_mounts");
  });

  test("a workspace path that does not exist still yields a verdict", async () => {
    const missing = path.join(tempRoot, "never-created");
    const table = [
      "3046 2294 253:1 / / ro - ext4 /dev/vda1 rw",
      `3401 3049 0:501 / ${tempRoot} rw - ext4 /dev/vde rw`,
    ].join("\n");

    const verdict = await classifierFor(table).classify(missing);

    expect(verdict.class).toBe("local");
    expect(verdict.checkedAt).toBeGreaterThan(0);
  });

  test("a plain directory is classified by storage, not by whether it is a repo", async () => {
    const plain = path.join(tempRoot, "plain-dir");
    await mkdir(plain, { recursive: true });

    const verdict = await classifierFor(tempRootTable()).classify(plain);

    // `/` is ext4 here, and a non-repo directory is neither special nor refused.
    expect(verdict.class).toBe("local");
    expect(verdict.mountFsType).toBe("ext4");
  });

  test("a mount table that changes is re-read after the mount TTL", async () => {
    let clock = 0;
    let reads = 0;
    let table = LOCAL_MOUNT_TABLE;
    const classifier = createFilesystemClassifier({
      isLinux: true,
      now: () => clock,
      mountTableTtlMs: 1_000,
      cacheTtlMs: 0,
      readMountTable: async () => {
        reads += 1;
        return table;
      },
    });

    const cwd = "/workspaces/repo";
    const first = await classifier.classify(cwd);
    expect(first.class).toBe("local");
    expect(reads).toBe(1);

    // The mount table changes underneath us: the same path is now on FUSE.
    table = HOST_MOUNT_TABLE.replace("/mnt/private_yax_qy4/projects/paseo", "/workspaces/repo");
    // Inside the mount TTL the cached table is still served, so nothing is read.
    await classifier.classify(cwd);
    expect(reads).toBe(1);

    // Past the TTL the table is re-read and the new topology is seen.
    clock += 1_500;
    const after = await classifier.classify(cwd);
    expect(reads).toBe(2);
    expect(after.class).toBe("network");
  });
});
