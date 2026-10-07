import { randomUUID } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { withTimeout } from "../utils/promise-timeout.js";
import type { FileChange } from "./file-observer/index.js";

export const WATCHER_LIVENESS_CANARY_TIMEOUT_MS = 10_000;
// The canary file lives inside the watched workspace, so its create and delete
// are the same class of I/O as the event paths this guards. The JS wait for
// each is bounded so a mount that never answers cannot hold observation setup
// open. The bound is on waiting, not on the I/O: Node cannot cancel an
// in-flight fs/promises operation, so a stalled create may still land later and
// is cleaned up by the late-write path below.
const WATCHER_LIVENESS_CANARY_IO_TIMEOUT_MS = 2_000;

export interface WatcherLivenessCanary {
  readonly path: string;
  filterEvents(events: FileChange[]): FileChange[];
  verify(signal?: AbortSignal): Promise<void>;
}

export function createWatcherLivenessCanary(
  watchRoot: string,
  options: { timeoutMs?: number } = {},
): WatcherLivenessCanary {
  const canaryPath = join(watchRoot, `.paseo-watcher-canary-${randomUUID()}`);
  const timeoutMs = options.timeoutMs ?? WATCHER_LIVENESS_CANARY_TIMEOUT_MS;
  let reportCanary!: () => void;
  const reported = new Promise<void>((resolve) => {
    reportCanary = resolve;
  });

  let writeOutcome: "pending" | "created" | "failed" = "pending";

  /**
   * Creates the canary file, recording whether it actually landed.
   *
   * The original error is rethrown: `verify` must fail on a create that was
   * refused rather than fall through to waiting on the watcher event, which
   * would only end at the event timeout (or never, if a stray event arrives).
   */
  const trackCanaryWrite = async (): Promise<void> => {
    try {
      await writeFile(canaryPath, "paseo watcher liveness canary\n", { flag: "wx" });
      writeOutcome = "created";
    } catch (error) {
      writeOutcome = "failed";
      throw error;
    }
  };

  const removeCanaryFile = (): Promise<void> =>
    withTimeout(
      rm(canaryPath, { force: true }),
      WATCHER_LIVENESS_CANARY_IO_TIMEOUT_MS,
      `Timed out removing the watcher liveness canary for ${watchRoot}`,
    ).catch(() => undefined);

  return {
    path: canaryPath,
    filterEvents(events) {
      const filtered = events.filter((event) => event.path !== canaryPath);
      if (filtered.length !== events.length) {
        reportCanary();
      }
      return filtered;
    },
    async verify(signal) {
      // An already-aborted verification must not touch the workspace at all.
      if (signal?.aborted) {
        throw signal.reason;
      }

      let timeout: NodeJS.Timeout | null = null;
      let removeAbortListener = () => {};
      const writePromise = trackCanaryWrite();
      // The late-cleanup path observes this promise on its own schedule, so sink
      // a refused create now: otherwise it is an unhandled rejection.
      void writePromise.catch(() => undefined);
      try {
        await withTimeout(
          writePromise,
          WATCHER_LIVENESS_CANARY_IO_TIMEOUT_MS,
          `Timed out writing the watcher liveness canary for ${watchRoot}`,
        );
        const timeoutPromise = new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => {
            reject(
              new Error(
                `Watcher for ${watchRoot} did not report its liveness canary within ${timeoutMs}ms`,
              ),
            );
          }, timeoutMs);
        });
        const abortPromise = new Promise<never>((_resolve, reject) => {
          if (!signal) return;
          const rejectForAbort = () => reject(signal.reason);
          if (signal.aborted) {
            rejectForAbort();
            return;
          }
          signal.addEventListener("abort", rejectForAbort, { once: true });
          removeAbortListener = () => signal.removeEventListener("abort", rejectForAbort);
        });
        await Promise.race([reported, timeoutPromise, abortPromise]);
      } finally {
        if (timeout) clearTimeout(timeout);
        removeAbortListener();
        // Best effort: an unreachable mount leaves the file behind, which is
        // harmless (it is not a ref, lock, or worktree path) and never blocks.
        if (writeOutcome === "pending") {
          // We stopped waiting on a create that is still in flight. That write
          // may still land, so clean up its late result instead of leaking it.
          void writePromise
            .then(() => {
              if (writeOutcome === "created") return removeCanaryFile();
              return undefined;
            })
            .catch(() => undefined);
        } else if (writeOutcome === "created") {
          void removeCanaryFile();
        }
      }
    },
  };
}
