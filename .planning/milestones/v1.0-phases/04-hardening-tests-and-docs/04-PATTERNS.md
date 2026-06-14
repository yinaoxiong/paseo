# Phase 4: hardening-tests-and-docs - Pattern Map

**Mapped:** 2026-06-14
**Files analyzed:** 12
**Analogs found:** 12 / 12

## File Classification

| New/Modified File                                                               | Role          | Data Flow                              | Closest Analog                                                                    | Match Quality |
| ------------------------------------------------------------------------------- | ------------- | -------------------------------------- | --------------------------------------------------------------------------------- | ------------- |
| `packages/server/src/server/agent/providers/cursor-sdk-agent.test.ts`           | test          | request-response, streaming, transform | `packages/server/src/server/agent/providers/cursor-sdk-agent.test.ts`             | exact         |
| `packages/server/src/server/agent/providers/cursor-sdk/event-mapper.test.ts`    | test          | streaming, transform                   | `packages/server/src/server/agent/providers/cursor-sdk/event-mapper.test.ts`      | exact         |
| `packages/server/src/server/agent/providers/cursor-sdk/model-options.test.ts`   | test          | transform                              | `packages/server/src/server/agent/providers/cursor-sdk/model-options.test.ts`     | exact         |
| `packages/server/src/server/agent/providers/cursor-sdk/persistence.test.ts`     | test          | file-I/O, transform                    | `packages/server/src/server/agent/providers/cursor-sdk/persistence.test.ts`       | exact         |
| `packages/server/src/server/agent/provider-registry.test.ts`                    | test          | request-response, transform            | `packages/server/src/server/agent/provider-registry.test.ts`                      | exact         |
| `packages/app/src/provider-selection/resolve-agent-form.test.ts`                | test          | transform                              | `packages/app/src/provider-selection/resolve-agent-form.test.ts`                  | exact         |
| `packages/app/src/composer/agent-controls/utils.test.ts`                        | test          | transform                              | `packages/app/src/composer/agent-controls/utils.test.ts`                          | exact         |
| `packages/app/src/components/provider-icon-name.test.ts`                        | test          | transform                              | `packages/app/src/components/provider-icon-name.test.ts`                          | exact         |
| `docs/providers.md`                                                             | documentation | transform                              | `docs/providers.md`                                                               | exact         |
| `docs/custom-providers.md`                                                      | documentation | transform                              | `docs/custom-providers.md`                                                        | exact         |
| `docs/testing.md`                                                               | documentation | transform                              | `docs/testing.md`                                                                 | exact         |
| `.planning/phases/04-hardening-tests-and-docs/04-VERIFICATION.md` / `04-UAT.md` | documentation | batch, transform                       | `.planning/phases/03-manifest-and-ui-integration/03-VERIFICATION.md`, `03-UAT.md` | role-match    |

## Pattern Assignments

### `packages/server/src/server/agent/providers/cursor-sdk-agent.test.ts` (test, request-response/streaming)

**Analog:** `packages/server/src/server/agent/providers/cursor-sdk-agent.test.ts`

**Imports and fake-runtime pattern** (lines 1-23, 155-230):

```typescript
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type {
  AgentOptions,
  Run,
  RunOperation,
  RunResult,
  RunStatus,
  SDKAgent,
  SDKMessage,
} from "@cursor/sdk";

import { createTestLogger } from "../../../test-utils/test-logger.js";
import { CursorSdkAgentClient } from "./cursor-sdk-agent.js";
import { expandCursorSdkModels, type CursorSdkModelListItem } from "./cursor-sdk/model-options.js";
import { createCursorSdkPersistenceHandle } from "./cursor-sdk/persistence.js";
```

```typescript
class FakeCursorSdkRuntime implements CursorSdkRuntime {
  readiness: CursorSdkRuntimeReadiness = { available: true };
  sandboxSupport: CursorSdkSandboxSupport = { supported: true };
  models: CursorSdkRuntimeModel[] = [];
  readonly calls = {
    checkReadiness: 0,
    checkSandboxSupport: 0,
    listModels: 0,
    createJsonlStore: 0,
    createAgent: 0,
    resumeAgent: 0,
  };

  async listModels(options?: { apiKey?: string }): Promise<CursorSdkRuntimeModel[]> {
    this.calls.listModels += 1;
    this.listModelsOptions.push(options);
    if (this.listModelsError) throw this.listModelsError;
    return this.models;
  }
}
```

**Secret handling pattern** (lines 333-388):

```typescript
const originalCursorApiKey = process.env.CURSOR_API_KEY;

beforeEach(() => {
  delete process.env.CURSOR_API_KEY;
});

afterEach(() => {
  if (originalCursorApiKey === undefined) delete process.env.CURSOR_API_KEY;
  else process.env.CURSOR_API_KEY = originalCursorApiKey;
});

test("key resolution prefers provider config over process env without exposing key material", async () => {
  process.env.CURSOR_API_KEY = "process-secret-key";
  const client = createClient(runtime, { env: { CURSOR_API_KEY: "provider-secret-key" } });
  await expect(client.isAvailable()).resolves.toBe(true);
  const { diagnostic } = await client.getDiagnostic();
  expect(diagnostic).toContain("API key source: provider-config");
  expect(diagnostic).not.toContain("provider-secret-key");
});
```

**Mode/MCP boundary pattern** (lines 364-368, 424-463, 607-728):

```typescript
expect(client.capabilities.supportsMcpServers).toBe(false);

await expect(client.listModes({ cwd: "/tmp/cursor-sdk", force: false })).resolves.toEqual([
  expect.objectContaining({ id: "sandbox", label: "Sandbox", isUnattended: false }),
  expect.objectContaining({ id: "yolo", label: "YOLO", isUnattended: true }),
]);
expect(runtime.calls.createAgent).toBe(0);
expect(runtime.calls.resumeAgent).toBe(0);
```

```typescript
expect(
  client.resolveCreateConfig({ provider: "cursor-sdk", requestedMode: undefined, availableModes }),
).toEqual({
  modeId: "sandbox",
  featureValues: undefined,
});

for (const requestedMode of ["agent", "ask"]) {
  expect(() =>
    client.resolveCreateConfig({ provider: "cursor-sdk", requestedMode, availableModes }),
  ).toThrow(/Invalid Cursor SDK mode/u);
}
```

**Streaming lifecycle pattern** (lines 1099-1195, 1357-1465):

```typescript
runtime.nextAgent.nextRun = new FakeRun({
  streamEvents: [
    /* user, assistant, thinking, tool_call */
  ],
});
runtime.nextAgent.nextRun.waitResult.resolve({
  id: "run-123",
  requestId: "request-123",
  status: "finished",
});
const session = await client.createSession(
  { provider: "cursor-sdk", cwd: "/workspace/project", modeId: "yolo" },
  { agentId: "paseo-agent-123" },
);
const { events, waitForTerminal } = collectSessionEvents(session);

await session.startTurn("hello", { messageId: "paseo-message-1" });
await waitForTerminal;

expect(timelineItems.filter((item) => item.type === "user_message")).toEqual([
  { type: "user_message", text: "hello", messageId: "paseo-message-1" },
]);
```

```typescript
expect(failed).toMatchObject({
  type: "turn_failed",
  provider: "cursor-sdk",
  error: "Cursor SDK run failed",
  diagnostic: expect.stringContaining("Status: error"),
});
expect(JSON.stringify(failed)).not.toContain("sk-live-secret-token");
```

### `packages/server/src/server/agent/providers/cursor-sdk/event-mapper.test.ts` (test, streaming/transform)

**Analog:** `packages/server/src/server/agent/providers/cursor-sdk/event-mapper.test.ts`

**Imports pattern** (lines 1-7):

```typescript
import { describe, expect, test } from "vitest";

import {
  mapCursorSdkStreamEvent,
  mapCursorSdkTerminalStatus,
  mapCursorSdkToolCall,
} from "./event-mapper.js";
```

**Timeline mapping pattern** (lines 10-38, 41-64):

```typescript
expect(mapCursorSdkStreamEvent({ type: "assistant", id: "msg-assistant-1", content: [...] }, { turnId: "turn-1" })).toEqual({
  events: [{
    type: "timeline",
    provider: "cursor-sdk",
    turnId: "turn-1",
    item: { type: "assistant_message", text: "Hello from Cursor.\nMore detail.", messageId: "msg-assistant-1" },
  }],
});
```

**Redaction pattern** (lines 67-143, 185-227, 230-247):

```typescript
const unknown = mapCursorSdkToolCall({
  type: "tool_call",
  name: "mysteryTool",
  input: { token: "sk-live-secret-token", nested: { command: "rm -rf /" } },
  output: { headers: { authorization: "Bearer sk-live-secret-token" } },
});
expect(unknown).toMatchObject({ detail: { type: "unknown" }, error: null });
expect(JSON.stringify(unknown)).not.toContain("sk-live-secret-token");
expect(JSON.stringify(unknown)).not.toContain("authorization");
```

```typescript
expect(
  mapCursorSdkTerminalStatus({ status: "paused", runId: "run-5" }, { turnId: "turn-1" }),
).toMatchObject({
  type: "turn_failed",
  provider: "cursor-sdk",
  error: "Cursor SDK run ended with unsupported status: paused",
  diagnostic: expect.stringContaining("Status: paused"),
});
```

### `packages/server/src/server/agent/providers/cursor-sdk/model-options.test.ts` (test, transform)

**Analog:** `packages/server/src/server/agent/providers/cursor-sdk/model-options.test.ts`

**Fixture pattern** (lines 1-11, 18-82):

```typescript
import {
  buildCursorSdkFeatures,
  buildCursorSdkSendModelSelection,
  decodeCursorSdkModelOptionId,
  expandCursorSdkModels,
  type CursorSdkModelListItem,
} from "./model-options.js";

const SDK_MODELS = [
  {
    id: "gpt-5.5",
    displayName: "GPT-5.5",
    parameters: [
      {
        id: "context",
        values: [
          { value: "272k", displayName: "272K" },
          { value: "1m", displayName: "1M" },
        ],
      },
      {
        id: "reasoning",
        values: [
          { value: "none", displayName: "None" },
          { value: "low", displayName: "Low" },
        ],
      },
      {
        id: "fast",
        values: [
          { value: "false", displayName: "Off" },
          { value: "true", displayName: "On" },
        ],
      },
    ],
  },
] satisfies CursorSdkModelListItem[];
```

**Model/feature transform pattern** (lines 85-96, 110-164, 167-195):

```typescript
const rows = expandCursorSdkModels(SDK_MODELS);
expect(rows.map((row) => row.label)).toEqual([
  "Auto",
  "GPT-5.5 - 272K",
  "GPT-5.5 - 1M",
  "Opus 4.8",
]);
expect(rows.every((row) => row.provider === "cursor-sdk")).toBe(true);
```

```typescript
expect(buildCursorSdkFeatures({ modelId: gpt?.id ?? null, models: SDK_MODELS })).toEqual([
  expect.objectContaining({ id: "fast_mode", label: "Fast", value: false }),
]);
expect(
  buildCursorSdkSendModelSelection({
    modelId: gpt?.id ?? null,
    thinkingOptionId: reasoningLow?.id ?? null,
    featureValues: { fast_mode: true },
    models: SDK_MODELS,
  }),
).toEqual({
  id: "gpt-5.5",
  params: [
    { id: "context", value: "272k" },
    { id: "reasoning", value: "low" },
    { id: "fast", value: "true" },
  ],
});
```

### `packages/server/src/server/agent/providers/cursor-sdk/persistence.test.ts` (test, file-I/O/transform)

**Analog:** `packages/server/src/server/agent/providers/cursor-sdk/persistence.test.ts`

**Temp filesystem pattern** (lines 1-24):

```typescript
import { mkdtemp, mkdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(tmpdir(), "paseo-cursor-sdk-persistence-"));
  paseoHome = path.join(tempRoot, "paseo-home");
});
```

**Strict metadata pattern** (lines 26-63):

```typescript
const handle = createCursorSdkPersistenceHandle({
  sessionId: "agent-123",
  sdkAgentId: "sdk-agent-abc",
  cwd: path.join(tempRoot, "workspace"),
  storePath,
  model: "composer-2.5",
  modeId: "yolo",
  sandboxEnabled: false,
});

expect(handle).toEqual({
  provider: "cursor-sdk",
  sessionId: "agent-123",
  nativeHandle: "sdk-agent-abc",
  metadata: {
    runtime: "local",
    cwd: path.join(tempRoot, "workspace"),
    storePath,
    model: "composer-2.5",
    modeId: "yolo",
    sandboxEnabled: false,
  },
});
```

**Path safety and secret rejection pattern** (lines 93-119, 151-190, 193-216):

```typescript
await expect(parseCursorSdkPersistenceHandle(handle, { paseoHome })).rejects.toThrow(
  /outside the controlled Cursor SDK store root/u,
);

await symlink(outsideStoreRoot, storeRoot, "dir");
await expect(parseCursorSdkPersistenceHandle(handle, { paseoHome })).rejects.toThrow(
  /store root must not contain symlinked ancestors/u,
);

await expect(parseCursorSdkPersistenceHandle(handle, { paseoHome })).rejects.not.toThrow(
  /sk-live-super-secret|Bearer|\{"runtime"/u,
);
```

### `packages/server/src/server/agent/provider-registry.test.ts` (test, request-response/transform)

**Analog:** `packages/server/src/server/agent/provider-registry.test.ts`

**Module-mock registry pattern** (lines 1-52):

```typescript
import { beforeEach, describe, expect, test, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  constructorArgs: { cursor: [], cursorSdk: [], genericAcp: [] },
  isCommandAvailable: vi.fn(async (_command: string) => false),
  runtimeModels: new Map<string, AgentModelDefinition[]>(),
  reset() {
    /* clear constructor args, mocks, runtimeModels */
  },
}));

vi.mock("../../utils/executable.js", () => ({
  isCommandAvailable: mockState.isCommandAvailable,
}));
```

**Provider model merge pattern** (lines 1108-1155, 1212-1245):

```typescript
mockState.runtimeModels.set("claude", [
  { provider: "claude", id: "runtime-model", label: "Runtime Model" },
  { provider: "claude", id: "shared-model", label: "Runtime Label" },
]);
const registry = buildProviderRegistry(logger, {
  providerOverrides: { claude: { models: [{ id: "shared-model", label: "Profile Label" }] } },
});
const models = await registry.claude.fetchModels({ cwd: "/tmp/registry-models", force: false });
expect(models).toEqual([{ provider: "claude", id: "shared-model", label: "Profile Label" }]);
```

### App-side test files (test, transform)

**Analogs:** `packages/app/src/provider-selection/resolve-agent-form.test.ts`, `packages/app/src/composer/agent-controls/utils.test.ts`, `packages/app/src/components/provider-icon-name.test.ts`

**Provider fixture pattern** (`resolve-agent-form.test.ts` lines 61-111):

```typescript
const TEST_CURSOR_DEFINITION: AgentProviderDefinition = {
  id: "cursor",
  label: "Cursor",
  description: "Cursor ACP test provider",
  defaultModeId: "agent",
  modes: [{ id: "agent", label: "Agent", icon: "ShieldAlert", colorTier: "moderate" }],
};

const TEST_CURSOR_SDK_DEFINITION: AgentProviderDefinition = {
  id: "cursor-sdk",
  label: "Cursor SDK",
  description: "Cursor SDK test provider",
  defaultModeId: "yolo",
  modes: [{ id: "yolo", label: "YOLO", icon: "ShieldOff", colorTier: "dangerous" }],
};
```

**Explicit Cursor SDK selection pattern** (`resolve-agent-form.test.ts` lines 222-237):

```typescript
expect(
  resolveThinkingOptionId({
    availableModels: CURSOR_SDK_MODELS,
    modelId: "sdk:gpt-5.5:context=1m",
    requestedThinkingOptionId: "",
  }),
).toBe("");
expect(
  resolveThinkingOptionId({
    availableModels: CURSOR_SDK_MODELS,
    modelId: "sdk:gpt-5.5:context=1m",
    requestedThinkingOptionId: "invalid",
  }),
).toBe("");
```

**Composer control utility pattern** (`utils.test.ts` lines 20-42, 86-89, 205-220):

```typescript
expect(getFeatureHighlightColor("fast_mode")).toBe("yellow");
expect(getFeatureHighlightColor("plan_mode")).toBe("blue");
expect(getFeatureHighlightColor("other")).toBe("default");

expect(formatThinkingOptionLabel({ id: "true", label: "Thinking On" })).toBe("Thinking On");
expect(formatThinkingOptionLabel({ id: "false", label: "Thinking Off" })).toBe("Thinking Off");
```

**Icon alias pattern** (`provider-icon-name.test.ts` lines 10-29):

```typescript
it("aliases Cursor SDK to the Cursor catalog icon", () => {
  expect(resolveProviderIconName("cursor-sdk")).toEqual({ kind: "catalog", id: "cursor" });
});
```

### Documentation files (documentation, transform)

**Analogs:** `docs/providers.md`, `docs/custom-providers.md`, `docs/testing.md`, `docs/development.md`

**Provider docs closeout pattern** (`docs/providers.md` lines 31-43):

```markdown
Cursor ACP is launched as `cursor-agent acp` by default. Cursor Agent 2026.06.12 accepts both `cursor-agent acp --force` and `cursor-agent acp --yolo`...

Cursor ACP has bundled code for a non-standard `cursor/ask_question` extension method... A real Cursor Agent 2026.06.12 ACP smoke did not expose AskQuestion...

Draft metadata lookups should avoid creating provider sessions when the upstream provider has top-level APIs for that metadata.
```

Apply this style to Cursor SDK docs: dated, evidence-backed limitation notes; distinguish ACP from SDK; do not promise Ask/MCP behavior that is not implemented.

**Custom provider config pattern** (`docs/custom-providers.md` lines 36-63, 441-458, 592-609):

```markdown
Use `extends` to create a new provider entry that inherits from a built-in provider (claude, codex, copilot, cursor, cursor-sdk, opencode, pi, omp).

By default, Paseo injects its internal MCP server into ACP providers...
Disable injected MCP for those providers with `params.supportsMcpServers: false`.

| `env` | `Record<string, string>` | No | Environment variables to set for the agent process |
| `params` | `Record<string, unknown>` | No | Provider-specific options such as `supportsMcpServers: false` |
```

**Testing docs pattern** (`docs/testing.md` lines 87-117, 120-129):

```markdown
Live provider smoke tests belong in `*.real.e2e.test.ts`, not `*.test.ts`, even when guarded by environment variables. Default unit suites must use deterministic provider adapters/fakes so missing credits, auth outages, and upstream model drift do not block normal CI.

Server: `packages/server/src/test-utils/vitest-setup.ts` loads `.env.test`, sets `PASEO_SUPERVISED=0`, and disables Git/SSH prompts.
```

**Verification environment pattern** (`docs/development.md` lines 8-20):

````markdown
Run all dependency-related commands inside the devcontainer defined by `.devcontainer/devcontainer.json`.

```bash
npm run format:files -- docs/development.md
npm run lint
npm run typecheck
```
````

### Phase verification/UAT docs (documentation, batch/transform)

**Analogs:** `.planning/phases/03-manifest-and-ui-integration/03-VERIFICATION.md`, `.planning/phases/03-manifest-and-ui-integration/03-UAT.md`

**Verification report structure** (`03-VERIFICATION.md` lines 1-17, 26-38, 83-108, 118-140):

```markdown
---
phase: 03-manifest-and-ui-integration
verified: 2026-06-13T17:34:31Z
status: human_needed
score: "5/5 roadmap must-haves verified; 28/28 plan truths mapped"
human_verification:
  - test: "..."
    expected: "..."
    why_human: "..."
---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
```

**UAT evidence structure** (`03-UAT.md` lines 9-16, 18-29, 52-71, 73-84):

```markdown
## Current Test

number: 3
name: Side-by-Side Runtime Check
expected: Cursor SDK changes apply on the next turn without session restart; Cursor ACP behavior and defaults are unchanged.
awaiting: none

## Tests

### 1. Provider Selector Visual/UX Check

result: passed
evidence:

- 2026-06-14 automated browser check against temporary dev daemon...

## Summary

total: 3
passed: 3
issues: 0
pending: 0
```

## Shared Patterns

### Deterministic Provider Tests

**Source:** `docs/testing.md` lines 87-117; `cursor-sdk-agent.test.ts` lines 155-230
**Apply to:** all Phase 4 `*.test.ts` files

```typescript
// Use injected runtime fakes and exact assertions. Do not call live Cursor APIs in default unit suites.
const runtime = new FakeCursorSdkRuntime();
runtime.models = SDK_MODELS;
const client = createClient(runtime, { env: { CURSOR_API_KEY: "provider-secret-key" } });
expect(runtime.calls.createAgent).toBe(0);
```

### Secret Redaction

**Source:** `cursor-sdk-agent.test.ts` lines 371-388; `event-mapper.test.ts` lines 113-143; `persistence.test.ts` lines 193-216
**Apply to:** provider tests, event mapping tests, persistence tests, docs that mention credentials

```typescript
expect(JSON.stringify(mapped)).not.toContain("sk-live-secret-token");
expect(JSON.stringify(mapped)).not.toContain("CURSOR_API_KEY");
expect(diagnostic).not.toContain("provider-secret-key");
```

### Cursor SDK v1 Boundaries

**Source:** `cursor-sdk-agent.test.ts` lines 364-368, 424-463, 702-728; `docs/providers.md` lines 31-43
**Apply to:** docs and tests covering mode support, MCP support, Ask/User limitations

```typescript
expect(client.capabilities.supportsMcpServers).toBe(false);
for (const requestedMode of ["agent", "ask"]) {
  expect(() =>
    client.resolveCreateConfig({ provider: "cursor-sdk", requestedMode, availableModes }),
  ).toThrow(/Invalid Cursor SDK mode/u);
}
```

### Explicit Model/Thinking/Fast Semantics

**Source:** `model-options.test.ts` lines 145-195; `resolve-agent-form.test.ts` lines 222-237; `utils.test.ts` lines 86-89
**Apply to:** model option tests and app control tests

```typescript
expect(buildCursorSdkFeatures({ modelId: gpt?.id ?? null, models: SDK_MODELS })).toEqual([
  expect.objectContaining({ id: "fast_mode", label: "Fast", value: false }),
]);
expect(
  resolveThinkingOptionId({
    availableModels: CURSOR_SDK_MODELS,
    modelId,
    requestedThinkingOptionId: "",
  }),
).toBe("");
```

### Docs Style

**Source:** `docs/providers.md` lines 31-43; `docs/custom-providers.md` lines 36-63; `03-UAT.md` lines 60-71
**Apply to:** provider docs, custom provider docs, final closeout summary

```markdown
- State exact current behavior.
- Include dated evidence where behavior depends on live Cursor SDK/Agent behavior.
- Keep Cursor ACP and Cursor SDK behavior separate.
- Mark future Ask/MCP/cloud work as deferred, not hidden fallback behavior.
```

## No Analog Found

None. Every implied Phase 4 file has an existing exact or role-match analog.

## Metadata

**Analog search scope:** `packages/server/src/server/agent/**`, `packages/app/src/**`, `docs/`, `.planning/phases/03-manifest-and-ui-integration/`
**Files scanned:** 12 primary analogs plus `rg --files` provider/test inventory
**Pattern extraction date:** 2026-06-14
