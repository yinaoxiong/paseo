import { describe, expect, test } from "vitest";
import {
  classifyMountClass,
  findMountEntryForPath,
  parseMountInfo,
  unescapeMountField,
} from "./mountinfo.js";

// Captured shape of /proc/self/mountinfo on this host: the dop-fuse and
// juicefs entries, plus the nested bind mounts for the Paseo checkout.
const HOST_FIXTURE = [
  "3046 2294 253:1 / / ro,nosuid,nodev,noatime master:1 - ext4 /dev/vda1 rw",
  "3102 3046 253:16 / /data ro,nosuid,nodev,noatime master:61 - ext4 /dev/vdb rw",
  "3205 3049 0:396 / /mnt/jfs_gy ro,nosuid,nodev,relatime master:640 - fuse.juicefs JuiceFS:aoxiongyinsjfs rw,user_id=0,group_id=0,default_permissions,allow_other,max_read=131072",
  "3206 3049 0:238 / /mnt/private_yax_qy4 ro,nosuid,nodev,relatime master:292 - fuse.dop-fuse dop-fuse rw,user_id=0,group_id=0,default_permissions,allow_other",
  "3222 3206 0:238 /projects/paseo /mnt/private_yax_qy4/projects/paseo rw,nosuid,nodev,relatime master:292 - fuse.dop-fuse dop-fuse rw,user_id=0,group_id=0,default_permissions,allow_other",
  "3223 3222 0:238 /projects/paseo/.git /mnt/private_yax_qy4/projects/paseo/.git ro,nosuid,nodev,relatime master:292 - fuse.dop-fuse dop-fuse rw,user_id=0,group_id=0,default_permissions,allow_other",
  "3099 3046 0:5 / /proc ro,nosuid,nodev,noexec,relatime master:24 - proc proc rw",
].join("\n");

describe("mountinfo parsing", () => {
  test("decodes octal escapes in mount points and optional fields", () => {
    expect(unescapeMountField("/mnt/my\\040share")).toBe("/mnt/my share");
    expect(unescapeMountField("/mnt/a\\011b")).toBe("/mnt/a\tb");
    expect(unescapeMountField("/mnt/back\\134slash")).toBe("/mnt/back\\slash");
  });

  test("parses optional fields of varying count by locating the separator", () => {
    const entries = parseMountInfo(HOST_FIXTURE);
    expect(entries).toHaveLength(7);

    const juicefs = entries.find((entry) => entry.mountPoint === "/mnt/jfs_gy");
    expect(juicefs).toEqual({
      mountId: 3205,
      parentId: 3049,
      mountPoint: "/mnt/jfs_gy",
      fsType: "fuse.juicefs",
      source: "JuiceFS:aoxiongyinsjfs",
    });

    // A bind mount with a different root field still reports its own mount point.
    const gitBind = entries.find(
      (entry) => entry.mountPoint === "/mnt/private_yax_qy4/projects/paseo/.git",
    );
    expect(gitBind?.fsType).toBe("fuse.dop-fuse");
    expect(gitBind?.parentId).toBe(3222);
  });

  test("reads escaped mount points created by real mount names", () => {
    const entries = parseMountInfo(
      "77 22 0:44 / /mnt/my\\040fuse\\040share rw - fuse.dop-fuse dop-fuse rw",
    );
    expect(entries[0]?.mountPoint).toBe("/mnt/my fuse share");
    expect(entries[0]?.fsType).toBe("fuse.dop-fuse");
  });

  test("skips malformed lines without throwing", () => {
    const entries = parseMountInfo(
      [
        "garbage",
        "1 2 3:4 / /",
        "not-a-number 2 3:4 / /mnt/bad rw - ext4 /dev/x rw",
        "99 1 0:1 / /mnt/ok rw - ext4 /dev/y rw",
      ].join("\n"),
    );
    expect(entries.map((entry) => entry.mountPoint)).toEqual(["/mnt/ok"]);
  });

  test("accepts lines that carry no optional fields", () => {
    const entries = parseMountInfo("1 2 3:4 / /mnt/min rw - ext4 /dev/x rw");
    expect(entries).toEqual([
      {
        mountId: 1,
        parentId: 2,
        mountPoint: "/mnt/min",
        fsType: "ext4",
        source: "/dev/x",
      },
    ]);
  });

  test("matches the longest mount point on path segments, not string prefixes", () => {
    const entries = parseMountInfo(
      [
        "20 1 0:20 / /mnt rw - ext4 /dev/a rw",
        "21 20 0:21 / /mnt/foobar rw - fuse.dop-fuse dop-fuse rw",
      ].join("\n"),
    );

    expect(findMountEntryForPath(entries, "/mnt/foo")?.mountPoint).toBe("/mnt");
    expect(findMountEntryForPath(entries, "/mnt/foobar")?.mountPoint).toBe("/mnt/foobar");
    expect(findMountEntryForPath(entries, "/mnt/foobarbaz")?.mountPoint).toBe("/mnt");
    expect(findMountEntryForPath(entries, "/mntfoo")).toBeNull();
  });

  test("resolves the deepest mount for nested bind mounts", () => {
    const entries = parseMountInfo(HOST_FIXTURE);
    expect(
      findMountEntryForPath(entries, "/mnt/private_yax_qy4/projects/paseo/.git/objects")
        ?.mountPoint,
    ).toBe("/mnt/private_yax_qy4/projects/paseo/.git");
    expect(
      findMountEntryForPath(entries, "/mnt/private_yax_qy4/projects/paseo/src")?.mountPoint,
    ).toBe("/mnt/private_yax_qy4/projects/paseo");
    expect(findMountEntryForPath(entries, "/mnt/private_yax_qy4/other")?.mountPoint).toBe(
      "/mnt/private_yax_qy4",
    );
  });

  test("classifies this host's observed mount types", () => {
    expect(classifyMountClass("fuse.dop-fuse")).toBe("network");
    expect(classifyMountClass("fuse.juicefs")).toBe("network");
    expect(classifyMountClass("nfs4")).toBe("network");
    expect(classifyMountClass("cifs")).toBe("network");
    expect(classifyMountClass("ext4")).toBe("local");
    expect(classifyMountClass("overlay")).toBe("local");
    expect(classifyMountClass("tmpfs")).toBe("local");
  });

  test("treats unrecognized and unknown FUSE filesystems as non-local", () => {
    expect(classifyMountClass("fuse.mystery")).toBe("unknown");
    expect(classifyMountClass("fuse")).toBe("unknown");
    expect(classifyMountClass("autofs")).toBe("unknown");
  });
});
