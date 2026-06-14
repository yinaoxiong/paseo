import path from "node:path";
import { readFile } from "node:fs/promises";

import { Agent, JsonlLocalAgentStore, type RunResult } from "@cursor/sdk";

import {
  buildEnvironment,
  countStreamEvent,
  disposeSdkAgent,
  getAgentIdPrefix,
  getStringFlag,
  parseArgs,
  previewText,
  providerImpactForBlockedAuth,
  providerImpactForFailure,
  readCursorApiKey,
  readJsonFile,
  resolveResultPath,
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
  readonly modeId: "sandbox" | "yolo";
  readonly sandboxEnabled: boolean;
  readonly continuityToken?: string;
}

interface ResumeCreateResult {
  readonly status?: string;
  readonly handle?: ResumeHandle | null;
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

function createResultFileName(mode: ProbeMode): string {
  return mode === "sandbox" ? "resume-create.json" : `resume-create-${mode}.json`;
}

function followupResultFileName(mode: ProbeMode): string {
  return mode === "sandbox" ? "resume-followup.json" : `resume-followup-${mode}.json`;
}

function buildPrompt(): string {
  return [
    "This is process B of the Paseo Cursor SDK resume probe.",
    "Reply with the continuity token you were told to remember in the previous process.",
    "If no prior process context is available, say that you do not know the token.",
    "Do not access the network. Do not read or write outside the scratch repository.",
  ].join("\n");
}

async function readExpectedContinuityToken(handle: ResumeHandle): Promise<string | null> {
  const filePath = path.join(handle.cwd, "resume-process-a.txt");
  try {
    const content = await readFile(filePath, "utf8");
    const match = content.match(/paseo-resume-token-[A-Za-z0-9_-]+/);
    return match?.[0] ?? null;
  } catch {
    return null;
  }
}

async function writeBlockedResult(reason: string, mode: ProbeMode): Promise<void> {
  const apiKey = readCursorApiKey();
  await writeRedactedJson(resolveResultPath(followupResultFileName(mode)), {
    experiment: "resume-followup",
    status: "blocked",
    recordedAt: new Date().toISOString(),
    environment: buildEnvironment(apiKey),
    resumeSuccess: false,
    continuityAssertion: {
      status: "blocked",
      reason,
    },
    sdk: {
      agentIdPrefix: null,
      streamEventTypeCounts: {},
      terminalStatus: "blocked_auth",
    },
    error: null,
    providerImpact:
      reason === "missing CURSOR_API_KEY"
        ? providerImpactForBlockedAuth("Cross-process Agent.resume follow-up")
        : "Cross-process Agent.resume follow-up could not be live-verified because resume-create did not produce a live SDK agent handle.",
    attempts: 0,
  });
}

async function runLiveProbe(handle: ResumeHandle, apiKeyValue: string): Promise<void> {
  const store = new JsonlLocalAgentStore(handle.storePath);
  const typeCounts: Record<string, number> = {};
  let agent = null;
  let resumeSuccess = false;
  const expectedToken = await readExpectedContinuityToken(handle);
  const secrets = expectedToken ? [apiKeyValue, expectedToken] : [apiKeyValue];

  try {
    agent = await Agent.resume(handle.agentId, {
      apiKey: apiKeyValue,
      model: { id: handle.model },
      local: {
        cwd: handle.cwd,
        store,
        settingSources: [],
        sandboxOptions: { enabled: handle.sandboxEnabled },
      },
    });
    resumeSuccess = true;
    const run = await agent.send(buildPrompt());
    for await (const event of run.stream()) {
      countStreamEvent(typeCounts, event);
    }
    const terminal: RunResult = await run.wait();
    const resultPreview = previewText(terminal.result, 800);
    const tokenMentioned = Boolean(expectedToken && resultPreview?.includes(expectedToken));
    const status = terminal.status === "finished" && tokenMentioned ? "passed" : "failed";

    await writeRedactedJson(
      resolveResultPath(followupResultFileName(handle.modeId)),
      {
        experiment: "resume-followup",
        status,
        recordedAt: new Date().toISOString(),
        environment: buildEnvironment(readCursorApiKey()),
        handle: {
          agentId: handle.agentId,
          cwd: handle.cwd,
          storePath: handle.storePath,
          runtime: handle.runtime,
          model: handle.model,
          modeId: handle.modeId,
          sandboxEnabled: handle.sandboxEnabled,
        },
        resumeSuccess,
        continuityAssertion: {
          status: tokenMentioned ? "passed" : "failed",
          tokenMentioned,
          expectedTokenPreview: expectedToken,
        },
        sdk: {
          agentIdPrefix: getAgentIdPrefix(agent.agentId),
          agentId: agent.agentId,
          runId: terminal.id,
          requestId: terminal.requestId,
          streamEventTypeCounts: typeCounts,
          terminalStatus: terminal.status,
          resultPreview,
          durationMs: terminal.durationMs,
        },
        error: null,
        providerImpact:
          status === "passed"
            ? "Agent.resume can restore the JSONL-backed local conversation across processes."
            : providerImpactForFailure("Cross-process Agent.resume follow-up"),
        attempts: 1,
      },
      secrets,
    );
  } catch (error) {
    await writeRedactedJson(
      resolveResultPath(followupResultFileName(handle.modeId)),
      {
        experiment: "resume-followup",
        status: "failed",
        recordedAt: new Date().toISOString(),
        environment: buildEnvironment(readCursorApiKey()),
        handle: {
          agentId: handle.agentId,
          cwd: handle.cwd,
          storePath: handle.storePath,
          runtime: handle.runtime,
          model: handle.model,
          modeId: handle.modeId,
          sandboxEnabled: handle.sandboxEnabled,
        },
        resumeSuccess,
        continuityAssertion: {
          status: "failed",
          tokenMentioned: false,
        },
        sdk: {
          agentIdPrefix: getAgentIdPrefix(agent?.agentId),
          agentId: agent?.agentId,
          streamEventTypeCounts: typeCounts,
          terminalStatus: "thrown",
        },
        error: serializeSdkError(error, secrets),
        providerImpact: providerImpactForFailure("Cross-process Agent.resume follow-up"),
        attempts: 1,
      },
      secrets,
    );
  } finally {
    await disposeSdkAgent(agent);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const mode = parseMode(getStringFlag(args, "mode"));
  const apiKey = readCursorApiKey();
  const createResult = await readJsonFile<ResumeCreateResult>(
    resolveResultPath(createResultFileName(mode)),
  );
  const handle = createResult?.handle ?? null;
  if (!handle) {
    await writeBlockedResult("resume-create did not produce a live SDK agent handle", mode);
    console.log(JSON.stringify({ status: "blocked", reason: "missing live resume handle" }));
    return;
  }
  if (!apiKey.value) {
    await writeBlockedResult("missing CURSOR_API_KEY", mode);
    console.log(JSON.stringify({ status: "blocked", reason: "missing CURSOR_API_KEY" }));
    return;
  }

  await runLiveProbe(handle, apiKey.value);
  console.log(JSON.stringify({ status: "recorded" }));
}

main().catch(async (error: unknown) => {
  const apiKey = readCursorApiKey();
  const args = parseArgs(process.argv.slice(2));
  const mode = parseMode(getStringFlag(args, "mode"));
  await writeRedactedJson(
    resolveResultPath(followupResultFileName(mode)),
    {
      experiment: "resume-followup",
      status: "failed",
      recordedAt: new Date().toISOString(),
      environment: buildEnvironment(apiKey),
      error: serializeSdkError(error, apiKey.value ? [apiKey.value] : []),
      providerImpact: providerImpactForFailure("Cross-process Agent.resume follow-up"),
      attempts: 1,
    },
    apiKey.value ? [apiKey.value] : [],
  );
  throw error;
});
