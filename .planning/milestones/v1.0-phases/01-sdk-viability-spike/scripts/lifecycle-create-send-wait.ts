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

interface RuntimeEvidence {
  readonly cwd: string;
  readonly storePath: string;
  readonly productionStorePathPattern: string;
  readonly model: string;
  readonly modeId: ProbeMode;
  readonly sandboxEnabled: boolean;
  readonly autoReview?: boolean;
}

function parseMode(value: string | undefined): ProbeMode {
  if (value === "sandbox" || value === "yolo") {
    return value;
  }
  throw new Error("Expected --mode sandbox or --mode yolo");
}

function resultFileName(mode: ProbeMode): string {
  return `create-send-stream-wait-${mode}.json`;
}

function buildPrompt(mode: ProbeMode): string {
  return [
    "You are running inside a disposable Paseo Cursor SDK spike scratch repository.",
    `Mode under test: ${mode}.`,
    "Create or update a file named sdk-spike-result.txt in this repository only.",
    "Write exactly one short sentence that says Paseo Cursor SDK local lifecycle probe succeeded.",
    "Do not access the network. Do not read or write outside this scratch repository.",
    "After editing, reply with a one-sentence summary.",
  ].join("\n");
}

async function writeBlockedResult(options: {
  readonly mode: ProbeMode;
  readonly runtime: RuntimeEvidence;
  readonly secrets: readonly string[];
}): Promise<void> {
  const apiKey = readCursorApiKey();
  await writeRedactedJson(
    resolveResultPath(resultFileName(options.mode)),
    {
      experiment: "create-send-stream-wait",
      status: "blocked",
      recordedAt: new Date().toISOString(),
      environment: buildEnvironment(apiKey),
      runtime: options.runtime,
      sdk: {
        agentIdPrefix: null,
        streamEventTypeCounts: {},
        terminalStatus: "blocked_auth",
      },
      error: null,
      providerImpact: providerImpactForBlockedAuth(
        `${options.mode} create/send/stream/wait lifecycle`,
      ),
      attempts: 0,
    },
    options.secrets,
  );
}

async function runLiveProbe(options: {
  readonly mode: ProbeMode;
  readonly runtime: RuntimeEvidence;
  readonly apiKeyValue: string;
}): Promise<void> {
  const typeCounts: Record<string, number> = {};
  const store = new JsonlLocalAgentStore(options.runtime.storePath);
  let agent = null;

  try {
    agent = await Agent.create({
      apiKey: options.apiKeyValue,
      model: { id: options.runtime.model },
      name: `Paseo SDK spike ${options.mode}`,
      local: {
        cwd: options.runtime.cwd,
        store,
        settingSources: [],
        sandboxOptions: { enabled: options.runtime.sandboxEnabled },
      },
    });

    const run = await agent.send(buildPrompt(options.mode));
    for await (const event of run.stream()) {
      countStreamEvent(typeCounts, event);
    }
    const terminal: RunResult = await run.wait();
    const status = terminal.status === "finished" ? "passed" : "failed";

    await writeRedactedJson(
      resolveResultPath(resultFileName(options.mode)),
      {
        experiment: "create-send-stream-wait",
        status,
        recordedAt: new Date().toISOString(),
        environment: buildEnvironment(readCursorApiKey()),
        runtime: options.runtime,
        sdk: {
          agentIdPrefix: getAgentIdPrefix(agent.agentId),
          agentId: agent.agentId,
          runId: terminal.id,
          requestId: terminal.requestId,
          streamEventTypeCounts: typeCounts,
          terminalStatus: terminal.status,
          resultPreview: previewText(terminal.result),
          durationMs: terminal.durationMs,
          model: terminal.model,
        },
        error: null,
        providerImpact:
          status === "passed"
            ? "Local create/send/stream/wait can map onto Paseo direct-provider turn lifecycle."
            : providerImpactForFailure(`${options.mode} create/send/stream/wait lifecycle`),
        attempts: 1,
      },
      [options.apiKeyValue],
    );
  } catch (error) {
    await writeRedactedJson(
      resolveResultPath(resultFileName(options.mode)),
      {
        experiment: "create-send-stream-wait",
        status: "failed",
        recordedAt: new Date().toISOString(),
        environment: buildEnvironment(readCursorApiKey()),
        runtime: options.runtime,
        sdk: {
          agentIdPrefix: getAgentIdPrefix(agent?.agentId),
          agentId: agent?.agentId,
          streamEventTypeCounts: typeCounts,
          terminalStatus: "thrown",
        },
        error: serializeSdkError(error, [options.apiKeyValue]),
        providerImpact: providerImpactForFailure(
          `${options.mode} create/send/stream/wait lifecycle`,
        ),
        attempts: 1,
      },
      [options.apiKeyValue],
    );
  } finally {
    await disposeSdkAgent(agent);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const mode = parseMode(getStringFlag(args, "mode"));
  const model = getStringFlag(args, "model", defaultModel) ?? defaultModel;
  const apiKey = readCursorApiKey();
  const scratch = await createScratchGitRepo(`create-send-wait-${mode}`);
  assertNotPaseoCheckout(scratch.cwd);

  const sessionId = makeSessionId(`create-send-wait-${mode}`);
  const storePath = resolveStorePath(sessionId);
  await mkdir(storePath, { recursive: true });
  const runtime: RuntimeEvidence = {
    cwd: scratch.cwd,
    storePath,
    productionStorePathPattern: "${PASEO_HOME}/providers/cursor-sdk/stores/{paseoSessionId}",
    model,
    modeId: mode,
    sandboxEnabled: mode === "sandbox",
    ...(mode === "yolo" ? {} : { autoReview: false }),
  };

  if (!apiKey.value) {
    await writeBlockedResult({
      mode,
      runtime,
      secrets: [],
    });
    console.log(JSON.stringify({ status: "blocked", mode, reason: "missing CURSOR_API_KEY" }));
    return;
  }

  await runLiveProbe({ mode, runtime, apiKeyValue: apiKey.value });
  console.log(JSON.stringify({ status: "recorded", mode }));
}

main().catch(async (error: unknown) => {
  const args = parseArgs(process.argv.slice(2));
  const mode = parseMode(getStringFlag(args, "mode"));
  const apiKey = readCursorApiKey();
  await writeRedactedJson(
    resolveResultPath(resultFileName(mode)),
    {
      experiment: "create-send-stream-wait",
      status: "failed",
      recordedAt: new Date().toISOString(),
      environment: buildEnvironment(apiKey),
      error: serializeSdkError(error, apiKey.value ? [apiKey.value] : []),
      providerImpact: providerImpactForFailure(`${mode} create/send/stream/wait lifecycle`),
      attempts: 1,
    },
    apiKey.value ? [apiKey.value] : [],
  );
  throw error;
});
