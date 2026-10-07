import { writeFile } from "node:fs/promises";
import { z } from "zod";
import path from "node:path";
import { expect, test } from "../support/fixtures";
import { seedWorkspace } from "../support/helpers/seed-client";
import { gotoWorkspace } from "../support/helpers/launcher";
import { openChangesTreePanel } from "../support/helpers/workspace-tabs";
import { daemonWsRoutePattern } from "../support/helpers/daemon-port";
import { connectNewWorkspaceDaemonClient } from "../support/helpers/new-workspace";

test.use({ e2eDaemonConfig: { daemon: { git: { policy: "manual" } } } });

test("manual Git refresh works from a cold workspace, stays manual, and can retry", async ({
  page,
  e2eWorker,
}, info) => {
  info.setTimeout(180_000);
  await page.setViewportSize({ width: 1400, height: 900 });
  const workspace = await seedWorkspace({
    repoPrefix: "git-manual-refresh-",
    title: "Manual Git refresh",
  });
  let failNextRefresh = false;
  let holdRefresh = true;
  let releaseRefresh: (() => void) | undefined;
  let diffReads = 0;
  const envelopeSchema = z.object({
    message: z
      .object({ type: z.string(), cwd: z.string().optional(), requestId: z.string().optional() })
      .optional(),
  });
  // Keep normal requests on the real daemon. Intercept one failure to exercise
  // error/retry UI deterministically, and hold the first request to prove pending UI.
  await page.routeWebSocket(daemonWsRoutePattern(), (browser) => {
    const server = browser.connectToServer();
    browser.onMessage((raw) => {
      const parsed = typeof raw === "string" ? envelopeSchema.safeParse(JSON.parse(raw)) : null;
      const message = parsed?.success ? parsed.data.message : undefined;
      if (message?.type === "checkout.diff.get.request") diffReads += 1;
      if (message?.type === "checkout.refresh.request") {
        if (failNextRefresh) {
          failNextRefresh = false;
          browser.send(
            JSON.stringify({
              type: "session",
              message: {
                type: "checkout.refresh.response",
                payload: {
                  cwd: message.cwd,
                  requestId: message.requestId,
                  success: false,
                  error: { code: "UNKNOWN", message: "Injected Git read failure" },
                },
              },
            }),
          );
          return;
        }
        if (holdRefresh) {
          releaseRefresh = () => server.send(raw);
          return;
        }
      }
      server.send(raw);
    });
    server.onMessage((raw) => browser.send(raw));
  });
  try {
    await writeFile(
      path.join(workspace.repoPath, "README.md"),
      "# Temp Repo\nfirst manual change\n",
    );
    // Provisioning can warm Git state. Restart only the owned test daemon so
    // this exercises a persisted workspace with an empty Git cache.
    await e2eWorker.restart();
    await gotoWorkspace(page, workspace.workspaceId);
    await openChangesTreePanel(page);
    const panel = page.getByTestId("changes-tree-panel").filter({ visible: true });
    const refresh = panel.getByTestId("changes-refresh");
    await expect(panel).toContainText("Refresh to read Git state.");
    await expect(panel.getByTestId("changes-header")).toHaveCount(0);
    await expect(refresh).toBeVisible();
    expect(diffReads).toBe(0);
    await page.screenshot({ path: info.outputPath("manual-paused.png") });
    await refresh.click();
    await expect(refresh).toBeDisabled();
    await expect(refresh).toHaveAccessibleName("Refreshing");
    holdRefresh = false;
    if (!releaseRefresh) throw new Error("Refresh request did not reach the daemon connection");
    releaseRefresh();
    const readme = panel.getByTestId("diff-tree-file-0-toggle");
    await expect(readme).toBeVisible();
    await expect(panel).not.toContainText("Automatic Git updates are paused");
    expect(diffReads).toBe(1);

    await readme.click();
    await expect(page.getByTestId("git-diff-canvas").filter({ visible: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath("manual-diff-content.png") });
    await writeFile(path.join(workspace.repoPath, "second-change.txt"), "only after refresh\n");
    // Reconnect/remount is an automatic read trigger, not permission to run Git.
    await page.reload({ waitUntil: "domcontentloaded" });
    await openChangesTreePanel(page);
    await expect(panel).toContainText("Refresh to read this diff");
    await expect(panel.getByText("second-change.txt", { exact: true })).toHaveCount(0);
    expect(diffReads).toBe(1);
    await refresh.click();
    await expect(panel.getByText("second-change.txt", { exact: true })).toBeVisible();
    expect(diffReads).toBe(2);
    await page.screenshot({ path: info.outputPath("manual-refreshed.png") });

    failNextRefresh = true;
    await refresh.click();
    await expect(panel.getByTestId("changes-refresh-error")).toHaveText(
      "Injected Git read failure",
    );
    await expect(refresh).toBeEnabled();
    await page.screenshot({ path: info.outputPath("manual-refresh-failed.png") });
    await refresh.click();
    await expect(panel.getByTestId("changes-refresh-error")).toHaveCount(0);
    await expect(panel.getByText("second-change.txt", { exact: true })).toBeVisible();
    await expect.poll(() => diffReads).toBe(3);
  } catch (error) {
    await page.screenshot({ path: info.outputPath("before-cleanup.png") });
    await info.attach("before-cleanup", {
      body: await page.locator("body").innerText(),
      contentType: "text/plain",
    });
    throw error;
  } finally {
    await workspace.cleanup();
  }
});

test.describe("automatic Git", () => {
  test("keeps updating Changes without a manual refresh", async ({ page }) => {
    const configClient = await connectNewWorkspaceDaemonClient({ ownProjects: false });
    await configClient.patchDaemonConfig({ git: { policy: "enabled" } });
    const workspace = await seedWorkspace({ repoPrefix: "git-automatic-refresh-" });
    try {
      await page.setViewportSize({ width: 1400, height: 900 });
      await writeFile(
        path.join(workspace.repoPath, "README.md"),
        "# Temp Repo\nautomatic change\n",
      );
      await gotoWorkspace(page, workspace.workspaceId);
      await openChangesTreePanel(page);
      const panel = page.getByTestId("changes-tree-panel").filter({ visible: true });
      await expect(panel.getByText("README.md", { exact: true })).toBeVisible();
      await writeFile(path.join(workspace.repoPath, "automatic.txt"), "watcher update\n");
      await expect(panel.getByText("automatic.txt", { exact: true })).toBeVisible();
    } finally {
      await workspace.cleanup();
      await configClient.patchDaemonConfig({ git: { policy: "manual" } });
      await configClient.close();
    }
  });
});

test("a cold local subscription converges and survives an unrelated settings change", async ({
  page,
  e2eWorker,
}) => {
  const workspace = await seedWorkspace({ repoPrefix: "git-auto-cold-" });
  let configClient: Awaited<ReturnType<typeof connectNewWorkspaceDaemonClient>> | undefined;
  try {
    configClient = await connectNewWorkspaceDaemonClient({ ownProjects: false });
    await configClient.patchDaemonConfig({ git: { policy: "auto" } });
    await configClient.close();
    configClient = undefined;
    await e2eWorker.restart();
    await page.setViewportSize({ width: 1400, height: 900 });
    await gotoWorkspace(page, workspace.workspaceId);
    await openChangesTreePanel(page);
    const panel = page.getByTestId("changes-tree-panel").filter({ visible: true });
    await writeFile(path.join(workspace.repoPath, "auto-cold.txt"), "local automatic update\n");
    await expect(panel.getByText("auto-cold.txt", { exact: true })).toBeVisible();
    configClient = await connectNewWorkspaceDaemonClient({ ownProjects: false });
    await configClient.patchDaemonConfig({ mcp: { injectIntoAgents: true } });
    await writeFile(
      path.join(workspace.repoPath, "after-settings.txt"),
      "watcher survives settings\n",
    );
    await expect(panel.getByText("after-settings.txt", { exact: true })).toBeVisible();
  } finally {
    if (configClient) {
      await configClient.patchDaemonConfig({ git: { policy: "manual" } });
      await configClient.close();
    }
    await workspace.cleanup();
  }
});

test("an older private host gets an update message instead of an unsupported diff request", async ({
  page,
}) => {
  const workspace = await seedWorkspace({ repoPrefix: "git-refresh-old-host-" });
  let gitReads = 0;
  const serverInfoEnvelope = z
    .object({
      message: z
        .object({
          type: z.literal("status"),
          payload: z
            .object({
              status: z.literal("server_info"),
              features: z.record(z.string(), z.unknown()),
            })
            .passthrough(),
        })
        .passthrough(),
    })
    .passthrough();
  await page.routeWebSocket(daemonWsRoutePattern(), (browser) => {
    const server = browser.connectToServer();
    browser.onMessage((raw) => {
      if (typeof raw === "string" && /"checkout\.(?:refresh|diff\.get)\.request"/.test(raw))
        gitReads += 1;
      server.send(raw);
    });
    server.onMessage((raw) => {
      const parsed = typeof raw === "string" ? serverInfoEnvelope.safeParse(JSON.parse(raw)) : null;
      if (parsed?.success) {
        delete parsed.data.message.payload.features.gitManualRefresh;
        browser.send(JSON.stringify(parsed.data));
      } else {
        browser.send(raw);
      }
    });
  });
  try {
    await page.setViewportSize({ width: 1400, height: 900 });
    await gotoWorkspace(page, workspace.workspaceId);
    await openChangesTreePanel(page);
    const panel = page.getByTestId("changes-tree-panel").filter({ visible: true });
    await panel.getByTestId("changes-refresh").click();
    await expect(panel.getByTestId("changes-refresh-error")).toHaveText(
      "Update the host to refresh Git changes in manual mode.",
    );
    expect(gitReads).toBe(0);
  } finally {
    await workspace.cleanup();
  }
});
