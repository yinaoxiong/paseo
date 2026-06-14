import { mkdir } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";

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
  providerImpactForBlockedAuth,
  providerImpactForFailure,
  readCursorApiKey,
  resolveResultPath,
  resolveStorePath,
  serializeSdkError,
  writeRedactedJson,
} from "./cursor-sdk-spike-utils.js";

type ProbeMode = "sandbox" | "yolo";

interface CancelRuntime {
  readonly cwd: string;
  readonly storePath: string;
  readonly model: string;
  readonly modeId: ProbeMode;
  readonly sandboxEnabled: boolean;
}

type CancelStatus = "passed" | "failed" | "inconclusive";

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
  return mode === "sandbox" ? "cancel.json" : `cancel-${mode}.json`;
}

function buildPrompt(): string {
  return [
    "You are running inside a disposable Paseo Cursor SDK cancellation probe repository.",
    "Create a file named cancel-probe-started.txt containing the word started.",
    "Then wait briefly or perform a harmless multi-step explanation so cancellation can be issued.",
    "Do not access the network. Do not read or write outside this scratch repository.",
  ].join("\n");
}

async function writeBlockedResult(runtime: CancelRuntime): Promise<void> {
  const apiKey = readCursorApiKey();
  await writeRedactedJson(resolveResultPath(resultFileName(runtime.modeId)), {
    experiment: "cancel",
    status: "blocked",
    recordedAt: new Date().toISOString(),
    environment: buildEnvironment(apiKey),
    runtime,
    sdk: {
      agentIdPrefix: null,
      streamEventTypeCounts: {},
      terminalStatus: "blocked_auth",
    },
    supportsCancel: null,
    unsupportedReason: null,
    cancelIssued: false,
    error: null,
    providerImpact: providerImpactForBlockedAuth("Cancellation"),
    attempts: 0,
  });
}

function classifyCancelStatus(
  terminalStatus: RunResult["status"],
  supportsCancel: boolean | null,
  cancelIssued: boolean,
): CancelStatus {
  if (supportsCancel && cancelIssued && terminalStatus === "cancelled") {
    return "passed";
  }
  if (supportsCancel && cancelIssued && terminalStatus === "finished") {
    return "inconclusive";
  }
  return "failed";
}

function providerImpactForCancelStatus(status: CancelStatus): string {
  if (status === "passed") {
    return "Cancellation behavior can be mapped to Paseo interrupt semantics, with terminal status recorded.";
  }
  if (status === "inconclusive") {
    return "Cancellation was requested, but the run finished before a cancelled terminal status proved interrupt semantics.";
  }
  return providerImpactForFailure("Cancellation");
}

async function runLiveProbe(runtime: CancelRuntime, apiKeyValue: string): Promise<void> {
  const store = new JsonlLocalAgentStore(runtime.storePath);
  const typeCounts: Record<string, number> = {};
  let agent = null;
  let cancelIssued = false;
  let supportsCancel: boolean | null = null;
  let unsupportedReason: string | undefined;

  try {
    agent = await Agent.create({
      apiKey: apiKeyValue,
      model: { id: runtime.model },
      name: "Paseo SDK spike cancel",
      local: {
        cwd: runtime.cwd,
        store,
        settingSources: [],
        sandboxOptions: { enabled: runtime.sandboxEnabled },
      },
    });
    const run = await agent.send(buildPrompt());
    supportsCancel = run.supports("cancel");
    unsupportedReason = run.unsupportedReason("cancel");
    const streamPromise = (async () => {
      for await (const event of run.stream()) {
        countStreamEvent(typeCounts, event);
      }
    })();

    await sleep(1500);
    if (supportsCancel) {
      cancelIssued = true;
      await run.cancel();
    }

    const terminal: RunResult = await run.wait();
    await streamPromise.catch(() => undefined);
    const status = classifyCancelStatus(terminal.status, supportsCancel, cancelIssued);

    await writeRedactedJson(
      resolveResultPath(resultFileName(runtime.modeId)),
      {
        experiment: "cancel",
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
          durationMs: terminal.durationMs,
        },
        supportsCancel,
        unsupportedReason,
        cancelIssued,
        error: null,
        providerImpact: providerImpactForCancelStatus(status),
        attempts: 1,
      },
      [apiKeyValue],
    );
  } catch (error) {
    await writeRedactedJson(
      resolveResultPath(resultFileName(runtime.modeId)),
      {
        experiment: "cancel",
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
        supportsCancel,
        unsupportedReason,
        cancelIssued,
        error: serializeSdkError(error, [apiKeyValue]),
        providerImpact: providerImpactForFailure("Cancellation"),
        attempts: 1,
      },
      [apiKeyValue],
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
  const scratch = await createScratchGitRepo(`cancel-${mode}`);
  assertNotPaseoCheckout(scratch.cwd);
  const storePath = resolveStorePath(makeSessionId(`cancel-${mode}`));
  await mkdir(storePath, { recursive: true });
  const runtime: CancelRuntime = {
    cwd: scratch.cwd,
    storePath,
    model,
    modeId: mode,
    sandboxEnabled: mode === "sandbox",
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
      experiment: "cancel",
      status: "failed",
      recordedAt: new Date().toISOString(),
      environment: buildEnvironment(apiKey),
      error: serializeSdkError(error, apiKey.value ? [apiKey.value] : []),
      providerImpact: providerImpactForFailure("Cancellation"),
      attempts: 1,
    },
    apiKey.value ? [apiKey.value] : [],
  );
  throw error;
});
