import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startE2EWorker } from "../../support/helpers/e2e-worker";
import { seedWorkspace } from "../../support/helpers/seed-client";
import { buildHostAgentDetailRoute } from "../../../src/utils/host-routes";

async function main() {
  const output = process.env.PASEO_ANDROID_QA_STATE;
  if (!output) throw new Error("Set an isolated QA state directory");
  process.env.E2E_METRO_PORT = "61990"; // CORS origin only; release APK does not use Metro.
  const fixture = fileURLToPath(new URL("../../fixtures/catalog-codex.mjs", import.meta.url));
  const worker = await startE2EWorker(89, {
    daemonConfig: {
      version: 1,
      agents: {
        providers: {
          codex: { enabled: true, command: [process.execPath, fixture] },
          claude: { enabled: false },
          copilot: { enabled: false },
          opencode: { enabled: false },
          pi: { enabled: false },
          omp: { enabled: false },
          "cursor-sdk": { enabled: false },
        },
      },
    },
    environment: { PASEO_ANDROID_MATH_QA: "1" },
  });
  const workspaces: Awaited<ReturnType<typeof seedWorkspace>>[] = [];
  try {
    const routes: Record<string, string> = {};
    const workspaceIds: Record<string, string> = {};
    for (const kind of ["math", "plain"]) {
      const workspace = await seedWorkspace({
        repoPrefix: `android-${kind}-qa-`,
        title: `Android ${kind} QA`,
      });
      workspaces.push(workspace);
      workspaceIds[kind] = workspace.workspaceId;
      const agent = await workspace.client.createAgent({
        provider: "codex",
        cwd: workspace.repoPath,
        workspaceId: workspace.workspaceId,
        title: `Android ${kind} QA`,
        model: "gpt-6.1-sol",
        modeId: "full-access",
        initialPrompt: kind,
      });
      const finished = await workspace.client.waitForFinish(agent.id, 30000);
      if (finished.final?.lastError) throw new Error(finished.final.lastError);
      routes[kind] =
        `paseo-personal:/${buildHostAgentDetailRoute(process.env.E2E_SERVER_ID!, agent.id, workspace.workspaceId)}`;
    }
    await mkdir(output, { recursive: true });
    const ready = path.join(output, "fixture-ready.json");
    await writeFile(
      ready + ".tmp",
      JSON.stringify({
        port: Number(process.env.E2E_DAEMON_PORT),
        serverId: process.env.E2E_SERVER_ID,
        workspaceIds,
        routes,
        isolatedHome: process.env.E2E_PASEO_HOME,
      }) + "\n",
    );
    const { rename } = await import("node:fs/promises");
    await rename(ready + ".tmp", ready);
    if (process.env.PASEO_ANDROID_QA_VALIDATE_ONLY === "1") return;
    await new Promise<void>((resolve) => {
      process.once("SIGTERM", resolve);
      process.once("SIGINT", resolve);
    });
  } finally {
    for (const workspace of workspaces.toReversed()) await workspace.cleanup();
    await worker.close();
    await writeFile(
      path.join(output, "fixture-cleaned.json"),
      JSON.stringify({ isolatedDaemonClosed: true, projectsRemoved: true }) + "\n",
    );
  }
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
