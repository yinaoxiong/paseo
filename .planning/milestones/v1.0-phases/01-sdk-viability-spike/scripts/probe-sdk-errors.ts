import { Agent, Cursor, JsonlLocalAgentStore } from "@cursor/sdk";

import {
  assertNotPaseoCheckout,
  buildEnvironment,
  createScratchGitRepo,
  disposeSdkAgent,
  makeSessionId,
  providerImpactForBlockedAuth,
  providerImpactForFailure,
  readCursorApiKey,
  resolveResultPath,
  resolveStorePath,
  serializeSdkError,
  writeRedactedJson,
} from "./cursor-sdk-spike-utils.js";

interface ErrorProbeResult {
  readonly operation: string;
  readonly status: "passed" | "failed" | "blocked";
  readonly expectedFailure: boolean;
  readonly error: ReturnType<typeof serializeSdkError> | null;
  readonly providerImpact: string;
}

async function captureExpectedError(
  operation: string,
  action: () => Promise<unknown>,
): Promise<ErrorProbeResult> {
  try {
    await action();
    return {
      operation,
      status: "failed",
      expectedFailure: true,
      error: null,
      providerImpact: providerImpactForFailure(operation),
    };
  } catch (error) {
    return {
      operation,
      status: "passed",
      expectedFailure: true,
      error: serializeSdkError(error),
      providerImpact:
        "Provider can expose this SDK startup/config/auth failure as an availability or turn diagnostic.",
    };
  }
}

async function probeInvalidModel(apiKeyValue: string | undefined): Promise<ErrorProbeResult> {
  if (!apiKeyValue) {
    return {
      operation: "Agent.create invalid model",
      status: "blocked",
      expectedFailure: true,
      error: null,
      providerImpact: providerImpactForBlockedAuth("Invalid-model startup/config error probing"),
    };
  }

  const scratch = await createScratchGitRepo("invalid-model");
  assertNotPaseoCheckout(scratch.cwd);
  const storePath = resolveStorePath(makeSessionId("invalid-model"));
  const store = new JsonlLocalAgentStore(storePath);
  let agent = null;

  try {
    agent = await Agent.create({
      apiKey: apiKeyValue,
      model: { id: "paseo-invalid-model-for-sdk-spike" },
      local: {
        cwd: scratch.cwd,
        store,
        settingSources: [],
        sandboxOptions: { enabled: true },
      },
    });
    return {
      operation: "Agent.create invalid model",
      status: "failed",
      expectedFailure: true,
      error: null,
      providerImpact: providerImpactForFailure("Invalid-model startup/config error probing"),
    };
  } catch (error) {
    return {
      operation: "Agent.create invalid model",
      status: "passed",
      expectedFailure: true,
      error: serializeSdkError(error, [apiKeyValue]),
      providerImpact:
        "Provider can map invalid model/config failures before a run exists without creating a production session.",
    };
  } finally {
    await disposeSdkAgent(agent);
  }
}

async function main(): Promise<void> {
  const apiKey = readCursorApiKey();
  const invalidKey = "invalid-cursor-sdk-spike-key";
  const probes: ErrorProbeResult[] = [];

  probes.push(
    await captureExpectedError("Cursor.me missing key", async () => Cursor.me({ apiKey: "" })),
  );
  probes.push(
    await captureExpectedError("Cursor.me invalid key", async () =>
      Cursor.me({ apiKey: invalidKey }),
    ),
  );
  probes.push(await probeInvalidModel(apiKey.value));

  const status = probes.every((probe) => probe.status === "passed" || probe.status === "blocked")
    ? "passed"
    : "failed";

  await writeRedactedJson(
    resolveResultPath("auth-config-errors.json"),
    {
      experiment: "auth-config-errors",
      status,
      recordedAt: new Date().toISOString(),
      environment: buildEnvironment(apiKey),
      probes,
      notes: [
        "Missing and invalid key probes are startup/auth failures before a run exists.",
        apiKey.hasCursorApiKey
          ? "Invalid-model probe attempted with real key from configured source."
          : "Invalid-model probe blocked because no CURSOR_API_KEY was available.",
      ],
    },
    apiKey.value ? [apiKey.value, invalidKey] : [invalidKey],
  );

  console.log(JSON.stringify({ status, probes: probes.map((probe) => probe.status) }, null, 2));
}

main().catch(async (error: unknown) => {
  const apiKey = readCursorApiKey();
  await writeRedactedJson(
    resolveResultPath("auth-config-errors.json"),
    {
      experiment: "auth-config-errors",
      status: "failed",
      recordedAt: new Date().toISOString(),
      environment: buildEnvironment(apiKey),
      error: serializeSdkError(error, apiKey.value ? [apiKey.value] : []),
      providerImpact: providerImpactForFailure("SDK auth/config error probing"),
    },
    apiKey.value ? [apiKey.value] : [],
  );
  throw error;
});
