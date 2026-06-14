import { mkdir } from "node:fs/promises";

import { Agent, JsonlLocalAgentStore, type RunResult } from "@cursor/sdk";

import {
  assertNotPaseoCheckout,
  buildEnvironment,
  countStreamEvent,
  createScratchGitRepo,
  defaultModel,
  disposeSdkAgent,
  getAgentIdPrefix,
  getStringFlag,
  makeSessionId,
  parseArgs,
  previewText,
  providerImpactForBlockedAuth,
  providerImpactForFailure,
  readCursorApiKey,
  resolveResultPath,
  resolveStorePath,
  serializeSdkError,
  writeRedactedJson,
} from "./cursor-sdk-spike-utils.js";

type ProbeMode = "sandbox" | "yolo";

interface ResumeHandle {
  readonly agentId: string;
  readonly cwd: string;
  readonly storePath: string;
  readonly runtime: "local";
  readonly model: string;
  readonly modeId: ProbeMode;
  readonly sandboxEnabled: boolean;
  readonly continuityToken: string;
}

interface ResumeRuntime {
  readonly cwd: string;
  readonly storePath: string;
  readonly model: string;
  readonly modeId: ProbeMode;
  readonly sandboxEnabled: boolean;
  readonly continuityToken: string;
}

function parseMode(value: string | undefined): ProbeMode {
  if (value === undefined || value === "sandbox") {
    return "sandbox";
  }
  if (value === "yolo") {
    return value;
  }
  throw new Error("Expected --mode sandbox or --mode yolo");
}

function resultFileName(mode: ProbeMode): string {
  return mode === "sandbox" ? "resume-create.json" : `resume-create-${mode}.json`;
}

function buildPrompt(continuityToken: string): string {
  return [
    "You are running inside a disposable Paseo Cursor SDK resume probe repository.",
    `Remember this continuity token for the next process: ${continuityToken}.`,
    "Create a file named resume-process-a.txt containing the continuity token.",
    "Reply with a short sentence that includes the continuity token.",
    "Do not access the network. Do not read or write outside this scratch repository.",
  ].join("\n");
}

async function writeBlockedResult(runtime: ResumeRuntime): Promise<void> {
  const apiKey = readCursorApiKey();
  await writeRedactedJson(resolveResultPath(resultFileName(runtime.modeId)), {
    experiment: "resume-create",
    status: "blocked",
    recordedAt: new Date().toISOString(),
    environment: buildEnvironment(apiKey),
    runtime,
    sdk: {
      agentIdPrefix: null,
      streamEventTypeCounts: {},
      terminalStatus: "blocked_auth",
    },
    handle: null,
    intendedHandle: {
      cwd: runtime.cwd,
      storePath: runtime.storePath,
      runtime: "local",
      model: runtime.model,
      modeId: runtime.modeId,
      sandboxEnabled: runtime.sandboxEnabled,
    },
    error: null,
    providerImpact: providerImpactForBlockedAuth("Cross-process resume create"),
    attempts: 0,
  });
}

async function runLiveProbe(runtime: ResumeRuntime, apiKeyValue: string): Promise<void> {
  const store = new JsonlLocalAgentStore(runtime.storePath);
  const typeCounts: Record<string, number> = {};
  let agent = null;

  try {
    agent = await Agent.create({
      apiKey: apiKeyValue,
      model: { id: runtime.model },
      name: "Paseo SDK spike resume create",
      local: {
        cwd: runtime.cwd,
        store,
        settingSources: [],
        sandboxOptions: { enabled: runtime.sandboxEnabled },
      },
    });
    const run = await agent.send(buildPrompt(runtime.continuityToken));
    for await (const event of run.stream()) {
      countStreamEvent(typeCounts, event);
    }
    const terminal: RunResult = await run.wait();
    const handle: ResumeHandle = {
      agentId: agent.agentId,
      cwd: runtime.cwd,
      storePath: runtime.storePath,
      runtime: "local",
      model: runtime.model,
      modeId: runtime.modeId,
      sandboxEnabled: runtime.sandboxEnabled,
      continuityToken: runtime.continuityToken,
    };
    const status = terminal.status === "finished" ? "passed" : "failed";

    await writeRedactedJson(
      resolveResultPath(resultFileName(runtime.modeId)),
      {
        experiment: "resume-create",
        status,
        recordedAt: new Date().toISOString(),
        environment: buildEnvironment(readCursorApiKey()),
        runtime,
        sdk: {
          agentIdPrefix: getAgentIdPrefix(agent.agentId),
          agentId: agent.agentId,
          runId: terminal.id,
          requestId: terminal.requestId,
          streamEventTypeCounts: typeCounts,
          terminalStatus: terminal.status,
          resultPreview: previewText(terminal.result),
          durationMs: terminal.durationMs,
        },
        handle,
        error: null,
        providerImpact:
          status === "passed"
            ? "Process A produced a local SDK resume handle for Process B."
            : providerImpactForFailure("Cross-process resume create"),
        attempts: 1,
      },
      [apiKeyValue, runtime.continuityToken],
    );
  } catch (error) {
    await writeRedactedJson(
      resolveResultPath(resultFileName(runtime.modeId)),
      {
        experiment: "resume-create",
        status: "failed",
        recordedAt: new Date().toISOString(),
        environment: buildEnvironment(readCursorApiKey()),
        runtime,
        sdk: {
          agentIdPrefix: getAgentIdPrefix(agent?.agentId),
          agentId: agent?.agentId,
          streamEventTypeCounts: typeCounts,
          terminalStatus: "thrown",
        },
        handle: null,
        error: serializeSdkError(error, [apiKeyValue]),
        providerImpact: providerImpactForFailure("Cross-process resume create"),
        attempts: 1,
      },
      [apiKeyValue, runtime.continuityToken],
    );
  } finally {
    await disposeSdkAgent(agent);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const model = getStringFlag(args, "model", defaultModel) ?? defaultModel;
  const mode = parseMode(getStringFlag(args, "mode"));
  const apiKey = readCursorApiKey();
  const scratch = await createScratchGitRepo(`resume-create-${mode}`);
  assertNotPaseoCheckout(scratch.cwd);
  const storePath = resolveStorePath(makeSessionId(`resume-${mode}`));
  await mkdir(storePath, { recursive: true });
  const runtime: ResumeRuntime = {
    cwd: scratch.cwd,
    storePath,
    model,
    modeId: mode,
    sandboxEnabled: mode === "sandbox",
    continuityToken: `paseo-resume-${makeSessionId("token")}`,
  };

  if (!apiKey.value) {
    await writeBlockedResult(runtime);
    console.log(JSON.stringify({ status: "blocked", reason: "missing CURSOR_API_KEY" }));
    return;
  }

  await runLiveProbe(runtime, apiKey.value);
  console.log(JSON.stringify({ status: "recorded" }));
}

main().catch(async (error: unknown) => {
  const apiKey = readCursorApiKey();
  const args = parseArgs(process.argv.slice(2));
  const mode = parseMode(getStringFlag(args, "mode"));
  await writeRedactedJson(
    resolveResultPath(resultFileName(mode)),
    {
      experiment: "resume-create",
      status: "failed",
      recordedAt: new Date().toISOString(),
      environment: buildEnvironment(apiKey),
      error: serializeSdkError(error, apiKey.value ? [apiKey.value] : []),
      providerImpact: providerImpactForFailure("Cross-process resume create"),
      attempts: 1,
    },
    apiKey.value ? [apiKey.value] : [],
  );
  throw error;
});
