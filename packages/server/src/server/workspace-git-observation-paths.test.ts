import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  createObservationPathRoot,
  createObservationRootAliasResolver,
  createRebasedRoot,
  isInsideRoot,
} from "./workspace-git-observation-paths.js";

const cleanupPaths: string[] = [];

afterEach(() => {
  while (cleanupPaths.length > 0) {
    rmSync(cleanupPaths.pop() as string, { recursive: true, force: true });
  }
});

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanupPaths.push(dir);
  return dir;
}

describe("observation path roots", () => {
  test("matches and contains candidates through pre-resolved aliases", () => {
    const root = createObservationPathRoot("/workspaces/repo", ["/mnt/data/repo"]);

    expect(root.matches("/workspaces/repo")).toBe(true);
    expect(root.matches("/mnt/data/repo")).toBe(true);
    expect(root.matches("/workspaces/repo/")).toBe(true);
    expect(root.matches("/workspaces/repo-other")).toBe(false);

    expect(root.contains(join("/mnt/data/repo", ".git", "packed-refs.new"))).toBe(true);
    expect(root.contains("/mnt/data/repo-extra")).toBe(false);
  });

  test("relativePath decides deleted and temporary paths without touching the filesystem", () => {
    const root = createObservationPathRoot("/workspaces/repo");

    expect(root.relativePath(join("/workspaces/repo", "packed-refs.new"))).toBe("packed-refs.new");
    expect(root.relativePath(join("/workspaces/repo", "refs", "heads", "gone"))).toBe(
      join("refs", "heads", "gone"),
    );
    expect(root.relativePath("/somewhere/else")).toBeNull();
  });

  test("rebases a derived path onto every alias of the root", () => {
    const root = createObservationPathRoot("/workspaces/repo", ["/mnt/data/repo"]);
    const gitDir = join("/workspaces/repo", ".git");

    expect(createRebasedRoot(gitDir, root).aliases).toEqual([
      join("/workspaces/repo", ".git"),
      join("/mnt/data/repo", ".git"),
    ]);
    expect(
      createRebasedRoot(join("/workspaces/repo", ".git"), root).contains(
        join("/mnt/data/repo", ".git", "HEAD"),
      ),
    ).toBe(true);
  });

  test("withAlias adds spellings without mutating the original root", () => {
    const root = createObservationPathRoot("/workspaces/repo");
    const widened = root.withAlias("/mnt/data/repo");

    expect(root.aliases).toEqual(["/workspaces/repo"]);
    expect(widened.matches("/mnt/data/repo")).toBe(true);
    expect(widened.withAlias("/mnt/data/repo")).toBe(widened);
  });

  test("rebase returns the path itself when the root does not contain it", () => {
    const root = createObservationPathRoot("/workspaces/repo", ["/mnt/data/repo"]);
    expect(root.rebase("/elsewhere/.git")).toEqual(["/elsewhere/.git"]);
  });
});

describe("isInsideRoot", () => {
  test("keeps segment boundaries significant", () => {
    expect(isInsideRoot("/opt/paseo", "/opt/paseo/node_modules")).toBe(true);
    expect(isInsideRoot("/opt/paseo", "/opt/paseo-other")).toBe(false);
  });
});

describe("observation root alias resolver", () => {
  test("resolves a real symlinked root and caches the resolution", async () => {
    const tempDir = makeTempDir("paseo-observation-alias-");
    const realRoot = join(tempDir, "real-root");
    const aliasRoot = join(tempDir, "alias-root");
    mkdirSync(realRoot, { recursive: true });
    symlinkSync(realRoot, aliasRoot, "dir");

    const resolveRealpath = vi.fn(async (root: string) => {
      const { realpath } = await import("node:fs/promises");
      return realpath(root);
    });
    const resolver = createObservationRootAliasResolver({ resolveRealpath });

    const first = await resolver(aliasRoot);
    const second = await resolver(aliasRoot);

    expect(first).toContain(realRoot);
    expect(first).toContain(aliasRoot);
    expect(second).toBe(first);
    expect(resolveRealpath).toHaveBeenCalledTimes(1);
  });

  test("returns the root alone when a stalled realpath never settles", async () => {
    const resolver = createObservationRootAliasResolver({
      timeoutMs: 20,
      resolveRealpath: () => new Promise<string>(() => {}),
    });

    await expect(resolver("/mnt/fuse/repo")).resolves.toEqual(["/mnt/fuse/repo"]);
  });

  test("returns the root alone when the path does not exist", async () => {
    const resolver = createObservationRootAliasResolver({
      resolveRealpath: async () => {
        const error = new Error("ENOENT") as Error & { code: string };
        error.code = "ENOENT";
        throw error;
      },
    });

    await expect(resolver("/tmp/paseo-missing-root")).resolves.toEqual(["/tmp/paseo-missing-root"]);
  });

  test("does not repeat work for concurrent requests on the same root", async () => {
    let release: ((value: string) => void) | null = null;
    const resolveRealpath = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          release = resolve;
        }),
    );
    const resolver = createObservationRootAliasResolver({ resolveRealpath });

    const first = resolver("/mnt/fuse/repo");
    const second = resolver("/mnt/fuse/repo");
    release?.("/mnt/real/repo");

    await expect(first).resolves.toEqual(["/mnt/fuse/repo", "/mnt/real/repo"]);
    await expect(second).resolves.toEqual(["/mnt/fuse/repo", "/mnt/real/repo"]);
    expect(resolveRealpath).toHaveBeenCalledTimes(1);
  });

  test("drops the root itself from aliases when it is already canonical", async () => {
    const tempDir = makeTempDir("paseo-observation-canonical-");
    writeFileSync(join(tempDir, "marker.txt"), "x\n");
    const resolver = createObservationRootAliasResolver();
    const root = createObservationPathRoot(tempDir, await resolver(tempDir));

    expect(root.aliases).toEqual([tempDir]);
  });
});
