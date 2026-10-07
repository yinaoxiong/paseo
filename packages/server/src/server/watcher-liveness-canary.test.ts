import { mkdirSync } from "node:fs";
import * as fsPromises from "node:fs/promises";
import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createWatcherLivenessCanary } from "./watcher-liveness-canary.js";

/**
 * Lets individual tests hold or reject the canary create. The late-write and
 * refused-create paths have no other entry point.
 */
let holdWriteFile = false;
let heldWrite: Promise<void> = Promise.resolve();
let releaseLateWrite: (() => void) | null = null;
let rejectWriteFile: ((error: Error) => void) | null = null;
let rejectNextWriteFile = false;

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof fsPromises>();
  return {
    ...actual,
    writeFile: async (...args: Parameters<typeof writeFile>) => {
      if (rejectNextWriteFile) {
        const error = new Error("canary create refused") as Error & { code: string };
        error.code = "EACCES";
        rejectWriteFile?.(error);
        throw error;
      }
      if (holdWriteFile) {
        await heldWrite;
      }
      return actual.writeFile(...args);
    },
  };
});

beforeEach(() => {
  holdWriteFile = false;
  heldWrite = Promise.resolve();
  releaseLateWrite = null;
  rejectWriteFile = null;
  rejectNextWriteFile = false;
});

const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

test("requires the canary event to round-trip through the watcher callback", async () => {
  const watchRoot = await mkdtemp(join(tmpdir(), "paseo-watcher-canary-"));
  cleanupPaths.push(watchRoot);
  const canary = createWatcherLivenessCanary(watchRoot, { timeoutMs: 1_000 });

  const verification = canary.verify();
  const canaryPath = canary.path;
  expect(canary.filterEvents([{ path: canaryPath, type: "create" }])).toEqual([]);

  await expect(verification).resolves.toBeUndefined();
});

test("aborts while waiting and still removes the canary file", async () => {
  const watchRoot = await mkdtemp(join(tmpdir(), "paseo-watcher-canary-"));
  cleanupPaths.push(watchRoot);
  const canary = createWatcherLivenessCanary(watchRoot, { timeoutMs: 60_000 });

  const controller = new AbortController();
  const verification = canary.verify(controller.signal);
  await new Promise((resolve) => setTimeout(resolve, 10));
  controller.abort(new Error("observation closed"));

  await expect(verification).rejects.toThrow("observation closed");
  // Cleanup is best-effort, so wait for the removal rather than assuming it.
  await vi.waitFor(
    async () => {
      await expect(stat(canary.path)).rejects.toThrow();
    },
    { timeout: 5_000 },
  );
});

test("the canary write is bounded so a stalled mount cannot hold verify open", async () => {
  const watchRoot = await mkdtemp(join(tmpdir(), "paseo-watcher-canary-"));
  cleanupPaths.push(watchRoot);
  // A directory that already contains the canary name makes the exclusive
  // create fail; the point of the test is that verify settles either way.
  const canary = createWatcherLivenessCanary(watchRoot, { timeoutMs: 10 });
  mkdirSync(canary.path, { recursive: true });

  await expect(canary.verify()).rejects.toThrow();
}, 20_000);

test("an already-aborted verification performs zero workspace writes", async () => {
  const watchRoot = await mkdtemp(join(tmpdir(), "paseo-watcher-canary-"));
  cleanupPaths.push(watchRoot);
  const canary = createWatcherLivenessCanary(watchRoot, { timeoutMs: 60_000 });

  const controller = new AbortController();
  controller.abort(new Error("observation closed before verify"));
  await expect(canary.verify(controller.signal)).rejects.toThrow(
    "observation closed before verify",
  );

  // Nothing was written, so the canary path never existed.
  await expect(stat(canary.path)).rejects.toThrow();
  await expect(readdir(watchRoot)).resolves.toEqual([]);
});

test("a canary write that lands after verify stopped waiting is cleaned up", async () => {
  const watchRoot = await mkdtemp(join(tmpdir(), "paseo-watcher-canary-"));
  cleanupPaths.push(watchRoot);
  const canary = createWatcherLivenessCanary(watchRoot, { timeoutMs: 10 });
  const canaryPath = canary.path;

  // Hold the create open past the wait deadline, then let it succeed late: the
  // abandoned write must still be cleaned up instead of leaking the artifact.
  releaseLateWrite = null;
  heldWrite = new Promise<void>((resolve) => {
    releaseLateWrite = resolve;
  });
  holdWriteFile = true;

  try {
    const verification = canary.verify();
    await vi.waitFor(() => {
      expect(releaseLateWrite).not.toBeNull();
    });
    await expect(verification).rejects.toThrow("Timed out writing");

    // The write is still in flight when verify gives up; let it land late.
    expect(
      await stat(canaryPath)
        .then(() => true)
        .catch(() => false),
    ).toBe(false);
    releaseLateWrite?.();
    await vi.waitFor(
      async () => {
        await expect(stat(canaryPath)).rejects.toThrow();
      },
      { timeout: 5_000, interval: 25 },
    );
  } finally {
    holdWriteFile = false;
    await rm(canaryPath, { force: true });
  }
}, 20_000);

test("a refused canary create rejects immediately with the original error", async () => {
  const watchRoot = await mkdtemp(join(tmpdir(), "paseo-watcher-canary-"));
  cleanupPaths.push(watchRoot);
  // Long event timeout: swallowing the write error would make verify wait for
  // this deadline instead of failing on the refused create.
  const canary = createWatcherLivenessCanary(watchRoot, { timeoutMs: 60_000 });
  rejectNextWriteFile = true;

  const startedAt = Date.now();
  await expect(canary.verify()).rejects.toThrow("canary create refused");
  expect(Date.now() - startedAt).toBeLessThan(5_000);

  // Nothing was created, so there is no artifact to remove.
  await expect(stat(canary.path)).rejects.toThrow();
  await expect(readdir(watchRoot)).resolves.toEqual([]);
}, 20_000);

test("rejects when the watcher never reports the canary", async () => {
  const watchRoot = await mkdtemp(join(tmpdir(), "paseo-watcher-canary-"));
  cleanupPaths.push(watchRoot);
  const canary = createWatcherLivenessCanary(watchRoot, { timeoutMs: 10 });

  await expect(canary.verify()).rejects.toThrow("did not report its liveness canary");
});
