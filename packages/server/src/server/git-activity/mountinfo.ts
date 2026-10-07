import { readFile } from "node:fs/promises";

export const LINUX_MOUNT_INFO_PATH = "/proc/self/mountinfo";

export interface MountEntry {
  mountId: number;
  parentId: number;
  mountPoint: string;
  fsType: string;
  source: string;
}

/**
 * `unknown` is a verdict, not a failure: an unrecognized filesystem must be
 * treated as non-local by callers rather than retried or assumed fast.
 */
export type MountClass = "local" | "network" | "unknown";

const NETWORK_FS_TYPES = new Set([
  "9p",
  "afs",
  "ceph",
  "cifs",
  "davfs",
  "dop-fuse",
  "fuse.ceph-fuse",
  "fuse.dop-fuse",
  "fuse.glusterfs",
  "fuse.juicefs",
  "fuse.moosefs",
  "fuse.rclone",
  "fuse.s3fs",
  "fuse.sshfs",
  "gfs2",
  "glusterfs",
  "juicefs",
  "lustre",
  "ncpfs",
  "nfs",
  "nfs4",
  "ocfs2",
  "smb3",
  "smbfs",
  "sshfs",
]);

const LOCAL_FS_TYPES = new Set([
  "aufs",
  "bcachefs",
  "btrfs",
  "exfat",
  "ext2",
  "ext3",
  "ext4",
  "f2fs",
  "hpfs",
  "iso9660",
  "jfs",
  "minix",
  "msdos",
  "nilfs2",
  "ntfs",
  "ntfs3",
  "overlay",
  "ramfs",
  "reiserfs",
  "squashfs",
  "tmpfs",
  "udf",
  "vfat",
  "xfs",
  "zfs",
]);

const OCTAL_ESCAPE_PATTERN = /\\([0-7]{3})/g;

export function unescapeMountField(value: string): string {
  return value.replace(OCTAL_ESCAPE_PATTERN, (_match, octal: string) =>
    String.fromCharCode(Number.parseInt(octal, 8)),
  );
}

/**
 * Parses `/proc/self/mountinfo`. Optional fields (shared:, master:,
 * propagate_from:) vary in count, so the `-` separator is found by scan rather
 * than by fixed index.
 */
export function parseMountInfo(content: string): MountEntry[] {
  const entries: MountEntry[] = [];

  for (const line of content.split("\n")) {
    if (line.trim().length === 0) {
      continue;
    }
    const fields = line.split(" ");
    const separatorIndex = fields.indexOf("-");
    if (separatorIndex < 5 || separatorIndex + 2 >= fields.length) {
      continue;
    }
    const mountId = Number(fields[0]);
    const parentId = Number(fields[1]);
    if (!Number.isInteger(mountId) || !Number.isInteger(parentId)) {
      continue;
    }
    entries.push({
      mountId,
      parentId,
      mountPoint: unescapeMountField(fields[4]),
      fsType: unescapeMountField(fields[separatorIndex + 1]),
      source: unescapeMountField(fields[separatorIndex + 2]),
    });
  }

  return entries;
}

export function classifyMountClass(fsType: string): MountClass {
  const normalized = fsType.toLowerCase();
  if (NETWORK_FS_TYPES.has(normalized)) {
    return "network";
  }
  if (LOCAL_FS_TYPES.has(normalized)) {
    return "local";
  }
  return "unknown";
}

function splitPathSegments(value: string): string[] {
  return value.split("/").filter((segment) => segment.length > 0);
}

/**
 * Longest mount point that matches on whole path segments. String prefix
 * matching would treat `/mnt/foo` as the mount for `/mnt/foobar`.
 */
export function findMountEntryForPath(
  entries: readonly MountEntry[],
  targetPath: string,
): MountEntry | null {
  const targetSegments = splitPathSegments(targetPath);
  let best: MountEntry | null = null;
  let bestLength = -1;

  for (const entry of entries) {
    const mountSegments = splitPathSegments(entry.mountPoint);
    if (mountSegments.length > targetSegments.length || mountSegments.length <= bestLength) {
      continue;
    }
    const matches = mountSegments.every((segment, index) => segment === targetSegments[index]);
    if (!matches) {
      continue;
    }
    best = entry;
    bestLength = mountSegments.length;
  }

  return best;
}

export async function readMountInfo(
  mountInfoPath: string = LINUX_MOUNT_INFO_PATH,
): Promise<string | null> {
  try {
    return await readFile(mountInfoPath, "utf8");
  } catch {
    return null;
  }
}
