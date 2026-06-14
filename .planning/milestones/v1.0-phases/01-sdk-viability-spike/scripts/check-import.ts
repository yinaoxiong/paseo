import { Agent, Cursor, JsonlLocalAgentStore } from "@cursor/sdk";

import {
  buildEnvironment,
  readCursorApiKey,
  readJsonFile,
  resolveResultPath,
  serializeSdkError,
  writeRedactedJson,
} from "./cursor-sdk-spike-utils.js";

interface ImportResult {
  readonly experiment?: string;
  readonly status?: string;
  readonly recordedAt?: string;
  readonly packageVersion?: string;
  readonly installCommand?: string;
  readonly ignoreScripts?: boolean;
  readonly node?: string;
  readonly npm?: string;
  readonly hasCursorApiKey?: boolean;
  readonly dependencyTree?: unknown;
  readonly exportedNames?: unknown;
  readonly notes?: readonly string[];
}

async function main(): Promise<void> {
  const apiKey = readCursorApiKey();
  const environment = buildEnvironment(apiKey);
  const resultPath = resolveResultPath("import.json");
  const previous = (await readJsonFile<ImportResult>(resultPath)) ?? {};
  const exportedNames = {
    Agent: typeof Agent.create === "function",
    Cursor: typeof Cursor.models?.list === "function",
    JsonlLocalAgentStore: typeof JsonlLocalAgentStore === "function",
  };

  await writeRedactedJson(
    resultPath,
    {
      ...previous,
      experiment: "dependency-import",
      status:
        exportedNames.Agent && exportedNames.Cursor && exportedNames.JsonlLocalAgentStore
          ? "passed"
          : "failed",
      recordedAt: new Date().toISOString(),
      packageVersion: previous.packageVersion ?? environment.packageVersion,
      installCommand:
        previous.installCommand ??
        "npm install --workspace=@getpaseo/server --ignore-scripts @cursor/sdk",
      ignoreScripts: previous.ignoreScripts ?? true,
      node: environment.node,
      npm: environment.npm,
      hasCursorApiKey: apiKey.hasCursorApiKey,
      cursorApiKeySource: apiKey.source,
      exportedNames,
      staticImport: {
        module: "@cursor/sdk",
        imported: ["Agent", "Cursor", "JsonlLocalAgentStore"],
      },
    },
    apiKey.value ? [apiKey.value] : [],
  );

  console.log(JSON.stringify({ status: "passed", exportedNames }, null, 2));
}

main().catch(async (error: unknown) => {
  const apiKey = readCursorApiKey();
  await writeRedactedJson(
    resolveResultPath("import.json"),
    {
      experiment: "dependency-import",
      status: "failed",
      recordedAt: new Date().toISOString(),
      environment: buildEnvironment(apiKey),
      error: serializeSdkError(error, apiKey.value ? [apiKey.value] : []),
    },
    apiKey.value ? [apiKey.value] : [],
  );
  throw error;
});
