import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createDaemonTestContext, type DaemonTestContext } from "../test-utils/index.js";
import type { SessionOutboundMessage } from "../messages.js";
import type { PersistedProjectRecord } from "../workspace-registry.js";

type CheckoutStatusResponsePayload = Extract<
  SessionOutboundMessage,
  { type: "checkout_status_response" }
>["payload"];

let ctx: DaemonTestContext;
let checkoutStatusEvents: ReturnType<DaemonTestContext["client"]["observeEvents"]>;
const tempDirs: string[] = [];

function tmpCwd(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), `daemon-e2e-${prefix}-`));
  tempDirs.push(dir);
  return dir;
}

function initGitRepo(cwd: string): void {
  execSync("git init -b main", { cwd, stdio: "pipe" });
  execSync("git config user.email 'test@test.com'", { cwd, stdio: "pipe" });
  execSync("git config user.name 'Test'", { cwd, stdio: "pipe" });
  writeFileSync(path.join(cwd, "README.md"), "# repo\n");
  execSync("git add README.md", { cwd, stdio: "pipe" });
  execSync("git -c commit.gpgsign=false commit -m 'Initial commit'", { cwd, stdio: "pipe" });
}

async function waitForCheckoutStatusUpdate(
  predicate: (
    payload: Extract<SessionOutboundMessage, { type: "checkout_status_update" }>["payload"],
  ) => boolean,
  timeoutMs = 15_000,
): Promise<Extract<SessionOutboundMessage, { type: "checkout_status_update" }>["payload"]> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error("Timed out waiting for checkout_status_update"));
    }, timeoutMs);

    const unsubscribe = ctx.client.on("checkout_status_update", (message) => {
      if (message.type !== "checkout_status_update") {
        return;
      }
      if (!predicate(message.payload)) {
        return;
      }
      clearTimeout(timeout);
      unsubscribe();
      resolve(message.payload);
    });
  });
}

/**
 * End-to-end proof for the host-global Git activity policy. A real daemon, a real
 * websocket client and a real temporary git repository: manual mode must produce
 * no automatic Git, and an explicit refresh must still deliver state.
 */
describe("daemon E2E git activity policy", () => {
  beforeEach(async () => {
    ctx = await createDaemonTestContext();
    checkoutStatusEvents = ctx.client.observeEvents(["checkout_status_update"]);
    await checkoutStatusEvents.ready;
  });

  afterEach(async () => {
    await checkoutStatusEvents.release();
    await ctx.cleanup();
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  test("the daemon advertises the gitActivityPolicy capability", async () => {
    // Asserted on the wire rather than through a client helper: the capability
    // is a server contract, and the daemon advertises it whether or not any
    // client exposes a convenience accessor for it.
    expect(ctx.client.getLastServerInfoMessage()?.features?.gitActivityPolicy).toBe(true);
    expect(ctx.client.getLastServerInfoMessage()?.features?.gitManualRefresh).toBe(true);
  });

  test("manual mode creates zero automatic git and explicit refresh publishes state", async () => {
    const cwd = tmpCwd("manual");
    initGitRepo(cwd);

    // Host-global: only manual.
    const patched = await ctx.client.patchDaemonConfig({ git: { policy: "manual" } });
    expect(patched.config.git?.policy).toBe("manual");

    // Open the project: the user's own action, but its background follow-up is
    // automatic Git and must not run.
    await ctx.client.openProject({ cwd }).catch(() => undefined);

    // A status request carries no explicit intent. Manual mode must refuse it
    // instead of reading Git, and must not present that as a non-Git fact.
    const status = (await ctx.client.getCheckoutStatus(cwd)) as CheckoutStatusResponsePayload;
    expect(status.error?.code).toBe("NOT_ALLOWED");
    expect(status.refreshState).toBe("paused");
    expect(status.lastRefreshedAt).toBeNull();

    // No live observation behind it: wait, then assert nothing arrived.
    let automaticUpdate: unknown = null;
    const unsubscribe = ctx.client.on("checkout_status_update", (message) => {
      if (message.type === "checkout_status_update" && message.payload.cwd === cwd) {
        automaticUpdate = message.payload;
      }
    });
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    unsubscribe();
    expect(automaticUpdate).toBeNull();

    // Explicit refresh: runs Git, returns the snapshot, and publishes the status
    // itself because manual mode has no observer to do it.
    const updatePromise = waitForCheckoutStatusUpdate((payload) => payload.cwd === cwd);
    const refresh = await ctx.client.checkoutRefresh(cwd);
    expect(refresh.success).toBe(true);
    expect(refresh.status).toBeTruthy();
    expect(refresh.status?.isGit).toBe(true);
    expect(refresh.status?.currentBranch).toBe("main");

    const update = await updatePromise;
    expect(update.isGit).toBe(true);
    expect(update.lastRefreshedAt).toBeTruthy();
  }, 60_000);

  test("auto mode classifies a local workspace and admits it", async () => {
    const cwd = tmpCwd("auto-local");
    initGitRepo(cwd);

    // Host-global default: decide per workspace.
    const patched = await ctx.client.patchDaemonConfig({ git: { policy: "auto" } });
    expect(patched.config.git?.policy).toBe("auto");

    const created = await ctx.client.createWorkspace({
      source: { kind: "directory", path: cwd },
    });
    expect(created.error).toBeNull();
    const workspaceId = created.workspace!.id;

    // The fetch itself never blocks on classification. The explicit event
    // subscription may already have completed the background classification,
    // so either the pending or settled projection is valid here.
    const initial = await ctx.client.fetchWorkspaces({ includeGitData: true });
    const initialEntry = initial.entries.find((entry) => entry.id === workspaceId);
    expect(initialEntry?.gitActivity?.configuredPolicy).toBe("auto");
    expect(["unknown", "automatic"]).toContain(initialEntry?.gitActivity?.effectiveMode);

    // The classification then converges on its own, and the daemon broadcasts
    // the new projection rather than leaving it "undetermined" forever.
    const deadline = Date.now() + 15_000;
    let settled: NonNullable<typeof initialEntry>["gitActivity"] = null;
    while (Date.now() < deadline) {
      const next = await ctx.client.fetchWorkspaces({ includeGitData: true });
      const entry = next.entries.find((candidate) => candidate.id === workspaceId);
      if (entry?.gitActivity?.effectiveMode === "automatic") {
        settled = entry.gitActivity;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    expect(settled).not.toBeNull();
    expect(settled?.effectiveMode).toBe("automatic");
    expect(settled?.reason).toBe("storage_local");
    expect(settled?.lastCheckedAt).toBeTruthy();
  }, 60_000);

  test("a manual-mode status request serves cached state marked paused after a refresh", async () => {
    const cwd = tmpCwd("cached");
    initGitRepo(cwd);

    await ctx.client.patchDaemonConfig({ git: { policy: "manual" } });

    // Refuse before anything is cached...
    const before = (await ctx.client.getCheckoutStatus(cwd)) as CheckoutStatusResponsePayload;
    expect(before.error?.code).toBe("NOT_ALLOWED");

    // ...refresh, then the same request serves the cached snapshot as paused.
    await ctx.client.checkoutRefresh(cwd);
    const after = (await ctx.client.getCheckoutStatus(cwd)) as CheckoutStatusResponsePayload;
    expect(after.error).toBeNull();
    expect(after.isGit).toBe(true);
    expect(after.refreshState).toBe("paused");
  }, 60_000);

  test("a diff subscription in manual mode performs no git read at all", async () => {
    const cwd = tmpCwd("legacy");
    initGitRepo(cwd);
    writeFileSync(path.join(cwd, "README.md"), "# repo\nchanged\n");

    await ctx.client.patchDaemonConfig({ git: { policy: "manual" } });

    // Diff observations still use subscribe_checkout_diff_request on the wire.
    // It carries no explicit user intent, so manual mode gives it ZERO Git
    // reads and a parseable paused payload — not a computed diff.
    const observation = ctx.client.observeCheckoutDiff(cwd, { mode: "uncommitted" });
    const initial = await observation.ready;
    expect(initial.error?.code).toBe("NOT_ALLOWED");
    expect(initial.files).toEqual([]);

    // Repeated reconnect-style subscribes cannot accumulate Git work.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const repeated = ctx.client.observeCheckoutDiff(cwd, { mode: "uncommitted" });
      const again = await repeated.ready;
      expect(again.error?.code).toBe("NOT_ALLOWED");
      await repeated.release();
    }

    let updates = 0;
    const unsubscribe = observation.subscribe({
      snapshot: () => {},
      update: () => {
        updates += 1;
      },
    });
    writeFileSync(path.join(cwd, "README.md"), "# repo\nchanged again\n");
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    unsubscribe();
    await observation.release();
    // No watcher, so no automatic diff update from the working-tree change.
    expect(updates).toBe(0);

    // The explicit read RPC can read the current diff without arming a watcher.
    const first = await ctx.client.getCheckoutDiff(cwd, { mode: "uncommitted" });
    expect(first.error).toBeNull();
    expect(first.files.map((file) => file.path)).toEqual(["README.md"]);
    writeFileSync(path.join(cwd, "another.txt"), "new explicit read\n");
    const second = await ctx.client.getCheckoutDiff(cwd, { mode: "uncommitted" });
    expect(second.error).toBeNull();
    expect(second.files.map((file) => file.path)).toEqual(["README.md", "another.txt"]);
  }, 60_000);

  test("repeated legacy PR status requests in manual mode are refused", async () => {
    const cwd = tmpCwd("pr-manual");
    initGitRepo(cwd);

    await ctx.client.patchDaemonConfig({ git: { policy: "manual" } });

    // A PR status request carries no explicit user intent: clients re-issue it
    // on mount, focus and reconnect. Manual mode must refuse it without
    // reaching Git or the forge at all.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const prStatus = (await ctx.client.checkoutPrStatus(cwd)) as {
        error?: { code?: string } | null;
        status?: unknown;
      };
      expect(prStatus.error?.code).toBe("NOT_ALLOWED");
      expect(prStatus.status ?? null).toBeNull();
    }

    // An explicit refresh is still the working path for real Git state.
    const refresh = await ctx.client.checkoutRefresh(cwd);
    expect(refresh.success).toBe(true);
    expect(refresh.status?.isGit).toBe(true);
  }, 60_000);

  test("a manual-policy reconciliation rescan performs no Git read", async () => {
    // The harness cannot shorten the 5-minute rescan interval, so this drives the
    // same gate through the `.git` root watcher: both entry points run
    // `reconcileObservedGitMetadata` and reach the one gated `readCheckout`, so a
    // skipped read here is the same skipped read the timer would perform. Waiting
    // out a real 300-second timer is not an option inside a test.
    const cwd = realpathSync(tmpCwd("reconcile-manual"));

    // Added while the directory is not a repo, so reconciliation has a project it
    // would reclassify to `git` the moment it is allowed to read Git.
    const added = await ctx.client.addProject(cwd);
    expect(added.error).toBeNull();
    const project = added.project!;
    expect(project.projectKind).toBe("non_git");

    const patched = await ctx.client.patchDaemonConfig({ git: { policy: "manual" } });
    expect(patched.config.git?.policy).toBe("manual");

    // Creating `.git` is what arms the root watcher, so a reconciliation cycle
    // definitely runs from here.
    initGitRepo(cwd);

    const observedKinds: string[] = [];
    const unsubscribe = ctx.client.on("project.update", (message) => {
      if (message.type !== "project.update" || message.payload.kind !== "upsert") return;
      if (message.payload.project.projectId !== project.projectId) return;
      observedKinds.push(message.payload.project.projectKind);
    });
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    unsubscribe();

    // A skipped read is not a non-Git read. The tree is genuinely Git now, so
    // `non_git` can only mean no Git command ran: had the service been given no
    // policy service at all, this same cycle would have reclassified it.
    const persisted = JSON.parse(
      await readFile(path.join(ctx.daemon.paseoHome, "projects", "projects.json"), "utf8"),
    ) as PersistedProjectRecord[];
    expect(persisted.find((entry) => entry.projectId === project.projectId)?.kind).toBe("non_git");
    expect(observedKinds).toEqual([]);

    // Control, so the assertion above cannot pass for the wrong reason: admitting
    // the root makes the identical cycle read Git and flip the project. Each
    // iteration re-arms the watcher, because a root already classified as
    // automatic would otherwise wait for the 5-minute timer.
    await ctx.client.patchDaemonConfig({ git: { policy: "auto" } });
    let settled: string | null = null;
    for (let attempt = 0; attempt < 20 && settled !== "git"; attempt += 1) {
      rmSync(path.join(cwd, ".git"), { recursive: true, force: true });
      initGitRepo(cwd);
      await new Promise((resolve) => setTimeout(resolve, 400));
      const next = await ctx.client.fetchWorkspaces({ filter: { projectId: project.projectId } });
      settled =
        next.emptyProjects.find((entry) => entry.projectId === project.projectId)?.projectKind ??
        null;
    }
    expect(settled).toBe("git");
  }, 60_000);
});
