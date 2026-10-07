import { resolve } from "node:path";
import { LRUCache } from "lru-cache";
import type { Logger } from "pino";

import { archiveIfSafe, type AutoArchiveArchiveOptions } from "./archive-if-safe.js";
import type {
  WorkspaceGitRuntimeSnapshot,
  WorkspaceGitSubscription,
} from "../workspace-git-service.js";
import type { GitActivityPolicyService } from "../git-activity/policy.js";

export interface AutoArchiveOnMergeOptions extends AutoArchiveArchiveOptions {
  logger: Logger;
  /**
   * Host-global Git activity admission. Auto-archive consumes automatic Git/PR
   * observation, so a workspace that is not admitted is never auto-archived:
   * acting on a cached snapshot the policy stopped refreshing would archive from
   * stale state. Explicit archive still runs its own safety checks.
   */
  gitActivity?: GitActivityPolicyService;
}

export interface AutoArchiveOnMergeDependencies {
  archiveIfSafe: typeof archiveIfSafe;
  resolvePath: typeof resolve;
}

const OPEN_PULL_REQUEST_LATCH_MAX = 1_024;

const defaultDependencies: AutoArchiveOnMergeDependencies = {
  archiveIfSafe,
  resolvePath: resolve,
};

export function setupAutoArchiveOnMerge(
  options: AutoArchiveOnMergeOptions,
  deps: AutoArchiveOnMergeDependencies = defaultDependencies,
): WorkspaceGitSubscription {
  const log = options.logger.child({ module: "auto-archive-on-merge" });
  const inFlightCwds = new Set<string>();
  const openPullRequestUrlsByCwd = new LRUCache<string, string>({
    max: OPEN_PULL_REQUEST_LATCH_MAX,
  });

  return options.workspaceGitService.onSnapshotUpdated((snapshot) => {
    const snapshotCwd = deps.resolvePath(snapshot.cwd);
    if (options.daemonConfigStore.get().autoArchiveAfterMerge !== true) {
      openPullRequestUrlsByCwd.delete(snapshotCwd);
      return;
    }
    // Never archive from a snapshot the policy is no longer keeping fresh. Drop
    // the latch so a later re-enable cannot fire on this stale pair either.
    if (options.gitActivity && !options.gitActivity.isAutomatic(snapshotCwd)) {
      openPullRequestUrlsByCwd.delete(snapshotCwd);
      return;
    }

    const pullRequest = snapshot.forge.pullRequest;
    if (!pullRequest?.isMerged) {
      if (pullRequest?.state.toLowerCase() === "open") {
        openPullRequestUrlsByCwd.set(snapshotCwd, pullRequest.url);
      } else {
        openPullRequestUrlsByCwd.delete(snapshotCwd);
      }
      return;
    }
    if (openPullRequestUrlsByCwd.get(snapshotCwd) !== pullRequest.url) {
      openPullRequestUrlsByCwd.delete(snapshotCwd);
      return;
    }
    if (inFlightCwds.has(snapshotCwd)) {
      return;
    }
    inFlightCwds.add(snapshotCwd);

    void (async () => {
      let freshSnapshot: WorkspaceGitRuntimeSnapshot | null;
      try {
        freshSnapshot = await options.workspaceGitService.getSnapshot(snapshot.cwd, {
          reason: "auto-archive-on-merge",
        });
      } catch (error) {
        log.warn(
          { err: error, cwd: snapshot.cwd },
          "Failed to read snapshot for auto-archive; skipping",
        );
        return;
      }
      const freshPullRequest = freshSnapshot?.forge.pullRequest;
      if (
        !freshPullRequest?.isMerged ||
        freshPullRequest.url !== pullRequest.url ||
        openPullRequestUrlsByCwd.get(snapshotCwd) !== pullRequest.url
      ) {
        if (openPullRequestUrlsByCwd.get(snapshotCwd) === pullRequest.url) {
          openPullRequestUrlsByCwd.delete(snapshotCwd);
        }
        return;
      }

      const attachedWorkspaces = (await options.listActiveWorkspaces()).filter(
        (workspace) => deps.resolvePath(workspace.cwd) === snapshotCwd,
      );
      for (const workspace of attachedWorkspaces) {
        await deps.archiveIfSafe({
          workspaceId: workspace.workspaceId,
          snapshot: freshSnapshot,
          options,
          log,
        });
      }
    })()
      .catch((error) => {
        log.warn({ err: error, cwd: snapshot.cwd }, "Failed to auto-archive attached workspaces");
      })
      .finally(() => {
        inFlightCwds.delete(snapshotCwd);
      });
  });
}
