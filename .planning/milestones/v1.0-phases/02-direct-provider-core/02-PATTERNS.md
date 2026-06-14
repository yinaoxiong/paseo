# Phase 02: Direct Provider Core - Pattern Map

**Mapped:** 2026-06-13
**Files analyzed:** 12
**Analogs found:** 12 / 12

## File Classification

| New/Modified File                                                            | Role             | Data Flow                             | Closest Analog                                                                                                                                    | Match Quality |
| ---------------------------------------------------------------------------- | ---------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| `packages/server/src/server/agent/providers/cursor-sdk-agent.ts`             | provider/service | streaming, request-response, file-I/O | `packages/server/src/server/agent/providers/claude/agent.ts`                                                                                      | exact         |
| `packages/server/src/server/agent/providers/cursor-sdk/sdk-runtime.ts`       | utility/adapter  | request-response, streaming           | `packages/server/src/server/agent/providers/opencode-agent.ts`                                                                                    | role-match    |
| `packages/server/src/server/agent/providers/cursor-sdk/diagnostics.ts`       | utility          | transform                             | `packages/server/src/server/agent/providers/diagnostic-utils.ts`                                                                                  | exact         |
| `packages/server/src/server/agent/providers/cursor-sdk/event-mapper.ts`      | utility          | streaming, transform                  | `packages/server/src/server/agent/providers/opencode/tool-call-mapper.ts` and `packages/server/src/server/agent/providers/opencode-agent.ts`      | exact         |
| `packages/server/src/server/agent/providers/cursor-sdk/modes.ts`             | utility/config   | request-response                      | `packages/server/src/server/agent/providers/codex-app-server-agent.ts`                                                                            | role-match    |
| `packages/server/src/server/agent/providers/cursor-sdk/persistence.ts`       | utility          | file-I/O, transform                   | `packages/server/src/server/agent/providers/opencode-agent.ts` and `packages/server/src/server/agent/providers/claude/agent.ts`                   | role-match    |
| `packages/server/src/server/agent/provider-registry.ts`                      | registry/config  | request-response                      | `packages/server/src/server/agent/provider-registry.ts`                                                                                           | exact         |
| `packages/protocol/src/provider-manifest.ts`                                 | config           | request-response                      | `packages/protocol/src/provider-manifest.ts`                                                                                                      | exact         |
| `packages/server/package.json`                                               | config           | dependency                            | `packages/server/package.json`                                                                                                                    | exact         |
| `packages/server/src/server/agent/providers/cursor-sdk-agent.test.ts`        | test             | request-response, streaming, file-I/O | `packages/server/src/server/agent/providers/claude/agent.test.ts` and `packages/server/src/server/agent/providers/codex-app-server-agent.test.ts` | exact         |
| `packages/server/src/server/agent/providers/cursor-sdk/event-mapper.test.ts` | test             | streaming, transform                  | `packages/server/src/server/agent/providers/opencode/event-translator.test.ts`                                                                    | exact         |
| `packages/server/src/server/agent/provider-registry.test.ts`                 | test             | request-response                      | `packages/server/src/server/agent/provider-registry.test.ts`                                                                                      | exact         |

## Pattern Assignments

### `packages/server/src/server/agent/providers/cursor-sdk-agent.ts` (provider/service, streaming + request-response + file-I/O)

**Analog:** `packages/server/src/server/agent/providers/claude/agent.ts`

**Imports pattern** (lines 1-90):

```typescript
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { promises } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Logger } from "pino";
import {
  buildBinaryDiagnosticRows,
  formatDiagnosticStatus,
  formatProviderDiagnostic,
  formatProviderDiagnosticError,
  toDiagnosticErrorMessage,
} from "../diagnostic-utils.js";
import { appendOrReplaceGrowingAssistantMessage, runProviderTurn } from "../provider-runner.js";
import type {
  AgentCapabilityFlags,
  AgentClient,
  AgentCreateSessionOptions,
  AgentLaunchContext,
  AgentMode,
  AgentModelDefinition,
  AgentPersistenceHandle,
  AgentPromptInput,
  AgentRunOptions,
  AgentRunResult,
  AgentSession,
  AgentSessionConfig,
  AgentStreamEvent,
  ListModelsOptions,
  McpServerConfig,
} from "../../agent-sdk-types.js";
```

**Client lifecycle pattern** (lines 1341-1405):

```typescript
export class ClaudeAgentClient implements AgentClient {
  readonly provider = "claude" as const;
  readonly capabilities = CLAUDE_CAPABILITIES;

  private readonly logger: Logger;
  private readonly runtimeSettings?: ProviderRuntimeSettings;

  constructor(options: ClaudeAgentClientOptions) {
    this.logger = options.logger.child({ module: "agent", provider: "claude" });
    this.runtimeSettings = options.runtimeSettings;
  }

  async createSession(
    config: AgentSessionConfig,
    launchContext?: AgentLaunchContext,
    options?: AgentCreateSessionOptions,
  ): Promise<AgentSession> {
    const claudeConfig = this.assertConfig(config);
    return new ClaudeAgentSession(claudeConfig, {
      runtimeSettings: this.runtimeSettings,
      agentId: launchContext?.agentId,
      launchEnv: launchContext?.env,
      persistSession: options?.persistSession,
      logger: this.logger,
    });
  }

  async resumeSession(
    handle: AgentPersistenceHandle,
    overrides?: Partial<AgentSessionConfig>,
    launchContext?: AgentLaunchContext,
  ): Promise<AgentSession> {
    const metadata = coerceSessionMetadata(handle.metadata);
    const merged: Partial<AgentSessionConfig> = { ...metadata, ...overrides };
    if (!merged.cwd) {
      throw new Error("Claude resume requires the original working directory in metadata");
    }
    const mergedConfig: AgentSessionConfig = {
      ...merged,
      provider: "claude",
      cwd: merged.cwd,
    };
    return new ClaudeAgentSession(this.assertConfig(mergedConfig), {
      runtimeSettings: this.runtimeSettings,
      handle,
      agentId: launchContext?.agentId,
      launchEnv: launchContext?.env,
      logger: this.logger,
    });
  }
}
```

**Session state pattern** (lines 1641-1729):

```typescript
class ClaudeAgentSession implements AgentSession {
  readonly provider = "claude" as const;
  readonly capabilities = CLAUDE_CAPABILITIES;

  private query: Query | null = null;
  private claudeSessionId: string | null;
  private persistence: AgentPersistenceHandle | null;
  private currentMode: PermissionMode;
  private readonly subscribers = new Set<(event: AgentStreamEvent) => void>();
  private activeForegroundTurnId: string | null = null;
  private closed = false;

  constructor(config: ClaudeAgentConfig, options: ClaudeAgentSessionOptions) {
    const handle = options.handle;
    if (handle) {
      if (!handle.sessionId) {
        throw new Error("Cannot resume: persistence handle has no sessionId");
      }
      this.claudeSessionId = handle.sessionId;
      this.persistence = handle;
    } else {
      this.claudeSessionId = null;
      this.persistence = null;
    }

    if (config.modeId && !VALID_CLAUDE_MODES.has(config.modeId)) {
      throw new Error(`Invalid mode '${config.modeId}' for Claude provider.`);
    }
  }
}
```

**Start-turn and canonical user-message pattern** (lines 1791-1868):

```typescript
async startTurn(prompt: AgentPromptInput, _options?: AgentRunOptions): Promise<{ turnId: string }> {
  if (this.closed) {
    throw new Error("Claude session is closed");
  }
  if (this.activeForegroundTurnId) {
    throw new Error("A foreground turn is already active");
  }

  const sdkMessage = this.toSdkUserMessage(prompt);
  const turnId = this.createTurnId("foreground");
  this.activeForegroundTurnId = turnId;

  this.notifySubscribers({ type: "turn_started", provider: "claude" });

  try {
    await this.ensureQuery();
    this.startQueryPump();
    this.input.push(sdkMessage);
    setTimeout(() => {
      if (this.activeForegroundTurnId === turnId) {
        this.emitSubmittedUserMessage(sdkMessage, turnId);
      }
    }, 0);
  } catch (error) {
    this.finishForegroundTurn(
      this.buildTurnFailedEvent(error instanceof Error ? error.message : "Claude stream failed"),
    );
  }

  return { turnId };
}
```

**Persistence pattern** (lines 2076-2089):

```typescript
describePersistence(): AgentPersistenceHandle | null {
  if (this.persistence) {
    return this.persistence;
  }
  if (!this.claudeSessionId) {
    return null;
  }
  this.persistence = {
    provider: "claude",
    sessionId: this.claudeSessionId,
    nativeHandle: this.claudeSessionId,
    metadata: { ...this.config },
  };
  return this.persistence;
}
```

**Error and terminal event pattern** (lines 2814-2828, 3576-3582):

```typescript
private buildTurnFailedEvent(errorMessage: string): Extract<AgentStreamEvent, { type: "turn_failed" }> {
  const normalized = errorMessage.trim() || "Claude run failed";
  const diagnostic = this.getRecentStderrDiagnostic();
  return {
    type: "turn_failed",
    provider: "claude",
    error: normalized,
    ...(diagnostic ? { diagnostic } : {}),
  };
}

events.push({ type: "turn_completed", provider: "claude", usage });
```

Apply to Cursor SDK:

- Use `provider = "cursor-sdk"`.
- Inject SDK runtime functions for tests.
- Repeat lightweight preflight in `isAvailable()`, `createSession()`, and `resumeSession()`.
- Emit one `turn_started`, one canonical accepted `user_message`, and terminal `turn_completed` / `turn_canceled` / `turn_failed`.
- Build persistence with `nativeHandle = agentId` and secret-free metadata only.

---

### `packages/server/src/server/agent/providers/cursor-sdk/sdk-runtime.ts` (utility/adapter, request-response + streaming)

**Analog:** `packages/server/src/server/agent/providers/opencode-agent.ts`

**Runtime adapter construction pattern** (lines 1239-1262):

```typescript
export class OpenCodeAgentClient implements AgentClient {
  readonly provider = "opencode" as const;
  readonly capabilities = OPENCODE_CAPABILITIES;

  private readonly runtime: OpenCodeRuntime;
  private readonly logger: Logger;
  private readonly runtimeSettings?: ProviderRuntimeSettings;

  constructor(
    logger: Logger,
    runtimeSettings?: ProviderRuntimeSettings,
    deps: OpenCodeAgentClientDeps = {},
  ) {
    this.logger = logger.child({ module: "agent", provider: "opencode" });
    this.runtimeSettings = runtimeSettings;
    this.runtime =
      deps.runtime ??
      new ProductionOpenCodeRuntime(
        OpenCodeServerManager.getInstance(this.logger, runtimeSettings),
      );
  }
}
```

**Create-session through runtime port pattern** (lines 1264-1311):

```typescript
async createSession(
  config: AgentSessionConfig,
  launchContext?: AgentLaunchContext,
  options?: AgentCreateSessionOptions,
): Promise<AgentSession> {
  const openCodeConfig = this.assertConfig(config);
  const acquisition = await this.runtime.acquireServer({
    force: false,
    env: launchContext?.env,
  });
  const client = this.runtime.createClient({
    baseUrl: acquisition.server.url,
    directory: openCodeConfig.cwd,
  });

  try {
    const response = await withTimeout(
      client.session.create({ directory: openCodeConfig.cwd }),
      10_000,
      "OpenCode session.create timed out after 10s",
    );
    if (response.error) {
      throw new Error(`Failed to create OpenCode session: ${JSON.stringify(response.error)}`);
    }
    return new OpenCodeAgentSession(...);
  } catch (error) {
    acquisition.release();
    throw error;
  }
}
```

Apply to Cursor SDK:

- Define a small `CursorSdkRuntime` interface around SDK import, `Agent.create`, `Agent.resume`, `Cursor.models.list`, `JsonlLocalAgentStore`, `Run.stream`, `Run.wait`, and `Run.cancel`.
- Provide `ProductionCursorSdkRuntime` as the default.
- Tests should pass an in-memory fake runtime rather than mocking own exports.

---

### `packages/server/src/server/agent/providers/cursor-sdk/diagnostics.ts` (utility, transform)

**Analog:** `packages/server/src/server/agent/providers/diagnostic-utils.ts`

**Diagnostic formatting pattern** (lines 9-39):

```typescript
export interface DiagnosticEntry {
  label: string;
  value: string;
}

export function formatProviderDiagnostic(providerName: string, entries: DiagnosticEntry[]): string {
  return [providerName, ...entries.map((entry) => `  ${entry.label}: ${entry.value}`)].join("\n");
}

export function formatDiagnosticStatus(
  available: boolean,
  error?: { source: string; cause: unknown },
): string {
  if (error) {
    return `Error (${error.source} failed: ${toDiagnosticErrorMessage(error.cause)})`;
  }
  return available ? "Available" : "Unavailable";
}
```

**Error serialization pattern** (lines 84-120):

```typescript
function formatErrorDiagnostic(error: Error): string {
  const sections: string[] = [];
  if (error.message && error.message.trim().length > 0) {
    sections.push(error.message.trim());
  }
  pushIfNonEmpty(sections, "exit code", readStringProperty(error, "code"));
  pushIfNonEmpty(sections, "signal", readStringProperty(error, "signal"));
  pushTruncatedIfNonEmpty(sections, "stderr", readStringProperty(error, "stderr"));
  pushTruncatedIfNonEmpty(sections, "stdout", readStringProperty(error, "stdout"));
  const cause = readUnknownProperty(error, "cause");
  if (cause !== undefined && cause !== null) {
    const causeMessage = toDiagnosticErrorMessage(cause);
    if (causeMessage && causeMessage !== "Unknown error") {
      sections.push(`caused by: ${causeMessage}`);
    }
  }
  return sections.length > 0 ? sections.join("\n") : "Unknown error";
}
```

Apply to Cursor SDK:

- Add SDK-specific redaction helpers that include class/message/status/code/operation/endpoint/key source/sandbox/model/run ids.
- Never include `CURSOR_API_KEY` value, prefix, suffix, length, hash, headers, or raw env.
- Use structured diagnostic objects internally and `formatProviderDiagnostic` for provider snapshot output.

---

### `packages/server/src/server/agent/providers/cursor-sdk/event-mapper.ts` (utility, streaming + transform)

**Analog:** `packages/server/src/server/agent/providers/opencode/tool-call-mapper.ts`

**Schema-first tool-call mapping pattern** (lines 1-68):

```typescript
import { z } from "zod";

import type { ToolCallTimelineItem } from "../../agent-sdk-types.js";
import { normalizeToolCallStatus } from "../tool-call-mapper-utils.js";
import { deriveOpencodeToolDetail } from "./tool-call-detail-parser.js";

const OpencodeRawToolCallSchema = z
  .object({
    toolName: z.string().min(1),
    callId: z.string().optional().nullable(),
    status: z.unknown().optional(),
    input: z.unknown().optional(),
    output: z.unknown().optional(),
    error: z.unknown().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export function mapOpencodeToolCall(params: OpencodeToolCallParams): ToolCallTimelineItem | null {
  const parsed = OpencodeRawToolCallSchema.safeParse(params);
  if (!parsed.success) {
    return null;
  }
  const raw = parsed.data;
  const callId =
    typeof raw.callId === "string" && raw.callId.trim().length > 0 ? raw.callId.trim() : null;
  if (callId === null) {
    return null;
  }
  const status = normalizeToolCallStatus(rawStatus, error, output);
  const detail = deriveOpencodeToolDetail(name, input, output, error);
  return {
    type: "tool_call",
    callId,
    name,
    status,
    detail,
    error: null,
    ...(raw.metadata ? { metadata: raw.metadata } : {}),
  };
}
```

**Terminal status mapping pattern** (opencode-agent.ts lines 2676-2706):

```typescript
if (error.name === "MessageAbortedError") {
  events.push({
    type: "turn_canceled",
    provider: "opencode",
    reason: "interrupted",
  });
} else {
  events.push({
    type: "turn_failed",
    provider: "opencode",
    error: toDiagnosticErrorMessage(error),
  });
}

if (status.type === "idle") {
  resetOpenCodeTurnTrackingState(state);
  events.push({ type: "turn_completed", provider: "opencode", usage: undefined });
}
```

Apply to Cursor SDK:

- Parse SDK `assistant`, `thinking`, `tool_call`, `status`, `requestId`, and `runId` events with permissive schemas.
- Map known tool calls to canonical `ToolCallTimelineItem`; unknown tools stay generic with redacted metadata.
- Map terminal statuses exactly: `finished` -> `turn_completed`, `cancelled` -> `turn_canceled`, `error` or unknown terminal -> `turn_failed`.
- Unknown non-terminal SDK events should become redacted diagnostics/logs, not crashes.

---

### `packages/server/src/server/agent/providers/cursor-sdk/modes.ts` (utility/config, request-response)

**Analog:** `packages/server/src/server/agent/providers/codex-app-server-agent.ts`

**Mode and safety preset pattern** (lines 192-258):

```typescript
const DEFAULT_CODEX_MODE_ID = "auto";

interface CodexModePreset {
  approvalPolicy: string;
  sandbox: string;
  networkAccess?: boolean;
  approvalsReviewer?: "auto_review";
}

const MODE_PRESETS: Record<string, CodexModePreset> = {
  "read-only": {
    approvalPolicy: "on-request",
    sandbox: "read-only",
  },
  auto: {
    approvalPolicy: "on-request",
    sandbox: "workspace-write",
  },
  "full-access": {
    approvalPolicy: "never",
    sandbox: "danger-full-access",
    networkAccess: true,
  },
};
```

**Runtime parameter application pattern** (lines 3388-3409):

```typescript
const preset = MODE_PRESETS[this.currentMode] ?? MODE_PRESETS[DEFAULT_CODEX_MODE_ID];
const approvalPolicy = this.config.approvalPolicy ?? preset.approvalPolicy;
const sandboxPolicyType = this.config.sandboxMode ?? preset.sandbox;

const params: Record<string, unknown> = {
  threadId: this.currentThreadId,
  input,
  approvalPolicy,
  sandboxPolicy: toSandboxPolicy(
    sandboxPolicyType,
    typeof this.config.networkAccess === "boolean"
      ? this.config.networkAccess
      : preset.networkAccess,
  ),
};
```

Apply to Cursor SDK:

- Define explicit mode ids, likely `sandbox` and `yolo`.
- YOLO metadata: dangerous label, `isUnattended: true`, SDK `sandboxOptions.enabled = false`.
- Sandbox metadata: safe/moderate label, `isUnattended` omitted/false, SDK `sandboxOptions.enabled = true`.
- `listModes()` should omit Sandbox when side-effect-free support says unavailable.
- Explicit or stale Sandbox requests must throw; never downgrade to YOLO.

---

### `packages/server/src/server/agent/providers/cursor-sdk/persistence.ts` (utility, file-I/O + transform)

**Analog:** `packages/server/src/server/agent/providers/opencode-agent.ts`

**Resume metadata validation pattern** (lines 1314-1328):

```typescript
async resumeSession(
  handle: AgentPersistenceHandle,
  overrides?: Partial<AgentSessionConfig>,
  launchContext?: AgentLaunchContext,
): Promise<AgentSession> {
  const metadata = (handle.metadata ?? {}) as Partial<AgentSessionConfig>;
  const cwd = overrides?.cwd ?? metadata.cwd;
  if (!cwd) {
    throw new Error("OpenCode resume requires the original working directory");
  }

  const config: AgentSessionConfig = {
    ...metadata,
    ...overrides,
    provider: "opencode",
```

**Persistence handle pattern** (lines 3575-3585):

```typescript
describePersistence(): AgentPersistenceHandle | null {
  return {
    provider: "opencode",
    sessionId: this.sessionId,
    nativeHandle: this.sessionId,
    metadata: {
      cwd: this.config.cwd,
      ...(this.config.modeId ? { modeId: this.config.modeId } : {}),
      ...(this.config.model ? { model: this.config.model } : {}),
    },
  };
}
```

Apply to Cursor SDK:

- Use a Zod schema for metadata: `runtime`, `cwd`, `storePath`, `model`, `modeId`, `sandboxEnabled`.
- Require `handle.nativeHandle` as Cursor SDK `agentId`.
- Store JSONL files under `$PASEO_HOME/providers/cursor-sdk/stores/{paseoSessionId}`.
- Validate `storePath` containment with `path.resolve` + `path.relative`; reject outside paths.
- No secrets in metadata.

---

### `packages/server/src/server/agent/provider-registry.ts` (registry/config, request-response)

**Analog:** same file

**Built-in factory pattern** (lines 30-37, 107-129):

```typescript
import { ClaudeAgentClient } from "./providers/claude/agent.js";
import { CodexAppServerAgentClient } from "./providers/codex-app-server-agent.js";
import { CursorACPAgentClient } from "./providers/cursor-acp-agent.js";
import { OpenCodeAgentClient } from "./providers/opencode-agent.js";

const PROVIDER_CLIENT_FACTORIES: Record<string, ProviderClientFactory> = {
  claude: (logger, runtimeSettings) =>
    new ClaudeAgentClient({
      logger,
      runtimeSettings,
    }),
  codex: (logger, runtimeSettings, options) =>
    new CodexAppServerAgentClient(logger, runtimeSettings, {
      workspaceGitService: options?.workspaceGitService,
      customProvider: options?.customProvider,
    }),
  cursor: (logger, runtimeSettings) =>
    new CursorACPAgentClient({
      logger,
      command: getCursorACPCommand(runtimeSettings),
      env: runtimeSettings?.env,
    }),
  opencode: (logger, runtimeSettings) => new OpenCodeAgentClient(logger, runtimeSettings),
};
```

**Runtime settings merge pattern** (lines 177-215):

```typescript
function toRuntimeSettings(override?: ProviderOverride): ProviderRuntimeSettings | undefined {
  if (!override?.command && !override?.env && !override?.disallowedTools) {
    return undefined;
  }

  return {
    command: override.command ? { mode: "replace", argv: override.command } : undefined,
    env: override.env,
    disallowedTools: override.disallowedTools,
  };
}

function mergeRuntimeSettings(
  base: ProviderRuntimeSettings | undefined,
  override: ProviderRuntimeSettings | undefined,
): ProviderRuntimeSettings | undefined {
  return {
    command: override?.command ?? base?.command,
    env: base?.env || override?.env ? { ...base?.env, ...override?.env } : undefined,
    disallowedTools: [...(base?.disallowedTools ?? []), ...(override?.disallowedTools ?? [])],
  };
}
```

Apply to Cursor SDK:

- Add `import { CursorSdkAgentClient } from "./providers/cursor-sdk-agent.js";`
- Add `"cursor-sdk": (logger, runtimeSettings) => new CursorSdkAgentClient({ logger, runtimeSettings })`.
- Do not alter the existing `cursor` ACP factory.

---

### `packages/protocol/src/provider-manifest.ts` (config, request-response)

**Analog:** same file

**Mode visuals and unattended pattern** (lines 15-19, 94-100):

```typescript
export type AgentProviderModeDefinition = Omit<AgentMode, "icon" | "colorTier"> &
  AgentModeVisuals & {
    isUnattended?: boolean;
  };

{
  id: "full-access",
  label: "Full Access",
  description: "Edit files, run commands, and access the network without additional prompts.",
  icon: "ShieldAlert",
  colorTier: "dangerous",
  isUnattended: true,
}
```

**Provider definition pattern** (lines 178-189):

```typescript
{
  id: "codex",
  label: "Codex",
  description: "OpenAI's Codex workspace agent with sandbox controls and optional network access",
  defaultModeId: "auto",
  modes: CODEX_MODES,
  voice: {
    enabled: true,
    defaultModeId: "auto",
    defaultModel: "gpt-5.4-mini",
  },
}
```

Apply to Cursor SDK:

- Add a minimal built-in provider definition only if Phase 2 needs provider snapshots to expose `cursor-sdk`.
- Keep provider manifest polish/icon work minimal because Phase 3 owns UI polish.
- If added, set YOLO `isUnattended: true`; do not label it generically as “Agent”.

---

### `packages/server/package.json` (config, dependency)

**Analog:** same file

Pattern notes:

- Research says `@cursor/sdk@1.0.18` is already present in `@getpaseo/server`.
- Planner should verify the dependency before implementation and avoid adding `sqlite3` directly unless code imports it.
- No source excerpt needed unless the package file actually changes.

---

### `packages/server/src/server/agent/providers/cursor-sdk-agent.test.ts` (test, request-response + streaming + file-I/O)

**Analog:** `packages/server/src/server/agent/providers/claude/agent.test.ts`

**Injected provider dependency test pattern** (lines 448-472):

```typescript
const client = new ClaudeAgentClient({
  logger,
  queryFactory,
  resolveBinary: async () => "/test/claude/bin",
});
const session = await client.createSession({
  provider: "claude",
  cwd: process.cwd(),
});

await expect(
  (session as unknown as { ensureQuery(): Promise<unknown> }).ensureQuery(),
).resolves.toBeDefined();

expect(queryFactory.mock.calls[0]?.[0].options.settingSources).toEqual([
  "user",
  "project",
  "local",
]);
```

**Persistence option test pattern** (lines 963-999):

```typescript
const nonPersistedClient = new ClaudeAgentClient({
  logger,
  queryFactory: nonPersistedQueryFactory,
  resolveBinary: async () => "/test/claude/bin",
});
const nonPersistedSession = await nonPersistedClient.createSession(
  { provider: "claude", cwd: process.cwd() },
  undefined,
  { persistSession: false },
);
await nonPersistedSession.run("turn");
expect(nonPersistedQueryFactory.mock.calls[0]?.[0].options.persistSession).toBe(false);
```

**Streaming assertions pattern:** `packages/server/src/server/agent/providers/codex-app-server-agent.test.ts` lines 2243-2292:

```typescript
expect(events).toContainEqual({
  type: "usage_updated",
  provider: "codex",
  turnId: "test-turn",
  usage: {
    inputTokens: 30000,
    cachedInputTokens: 5000,
    outputTokens: 15000,
    contextWindowMaxTokens: 200000,
    contextWindowUsedTokens: 50000,
  },
});
expect(events.at(-1)).toEqual({
  type: "turn_completed",
  provider: "codex",
  turnId: "test-turn",
  usage: expect.any(Object),
});
```

Apply to Cursor SDK tests:

- Use fake `CursorSdkRuntime`, temp directories for store roots, and explicit fake API keys.
- Cover missing key availability/diagnostic, runtime-settings key precedence over process env, strict resume metadata, path containment rejection, Sandbox fail-closed, YOLO mode metadata, cancellation, and terminal status mapping.
- Do not add auth gates or conditional skips.

---

### `packages/server/src/server/agent/providers/cursor-sdk/event-mapper.test.ts` (test, streaming + transform)

**Analog:** `packages/server/src/server/agent/providers/opencode/event-translator.test.ts`

**Tool-call mapping test pattern** (lines 664-725):

```typescript
const events = [
  {
    id: "part-grep",
    tool: "grep",
    callID: "call-grep",
    state: { status: "completed", input: { pattern: "sendCorrelatedSessionRequest" } },
  },
].flatMap((part) =>
  translateOpenCodeEvent(
    {
      type: "message.part.updated",
      properties: {
        part: {
          ...part,
          sessionID: "session-1",
          messageID: "message-1",
          type: "tool",
        },
      },
    },
    state,
  ),
);

expect(events).toEqual([
  {
    type: "timeline",
    provider: "opencode",
    item: {
      type: "tool_call",
      callId: "call-grep",
      name: "grep",
      status: "completed",
    },
  },
]);
```

**Terminal tests pattern** (lines 1132-1156, 1283-1328):

```typescript
expect(
  translateOpenCodeEvent(
    { type: "session.status", properties: { status: { type: "idle" } } },
    state,
  ),
).toEqual([{ type: "turn_completed", provider: "opencode", usage: undefined }]);

expect(events).toEqual([{ type: "turn_canceled", provider: "opencode", reason: "interrupted" }]);

expect(events).toEqual([
  {
    type: "turn_failed",
    provider: "opencode",
    error: '{"name":"UnknownError","data":{"message":"something broke"}}',
  },
]);
```

Apply to Cursor SDK tests:

- Assert `finished`, `cancelled`, and `error` mappings exactly.
- Assert unknown event emits a redacted diagnostic/log path and returns no crashing event.
- Assert SDK prompt echoes do not create duplicate `user_message` rows.

---

### `packages/server/src/server/agent/provider-registry.test.ts` (test, request-response)

**Analog:** same file

**Mock constructor capture pattern** (lines 6-45):

```typescript
const mockState = vi.hoisted(() => {
  interface ConstructorEntry {
    runtimeSettings?: unknown;
    providerParams?: unknown;
  }

  return {
    constructorArgs: {
      claude: [] as ConstructorEntry[],
      codex: [] as ConstructorEntry[],
      cursor: [] as Array<{ command: string[]; env?: Record<string, string> }>,
    },
    reset() {
      this.constructorArgs.claude = [];
      this.constructorArgs.codex = [];
      this.constructorArgs.cursor = [];
    },
  };
});
```

**Registry assertion pattern** (lines 472-487):

```typescript
test("new provider extending claude appears in registry", () => {
  const registry = buildProviderRegistry(logger, {
    providerOverrides: {
      zai: {
        extends: "claude",
        label: "ZAI",
        description: "Claude with ZAI defaults",
      },
    },
  });

  expect(registry.zai).toBeDefined();
  expect(registry.zai.createClient(logger).provider).toBe("zai");
});
```

Apply to Cursor SDK:

- Add a mocked `./providers/cursor-sdk-agent.js` module.
- Capture constructor `runtimeSettings`.
- Assert built-in `cursor-sdk` exists, creates a `cursor-sdk` client, and receives `agents.providers.cursor-sdk.env` without affecting `cursor`.

---

## Shared Patterns

### Direct Provider Contract

**Source:** `packages/server/src/server/agent/agent-sdk-types.ts` lines 595-677
**Apply to:** `cursor-sdk-agent.ts`, tests

```typescript
export interface AgentSession {
  readonly provider: AgentProvider;
  readonly id: string | null;
  readonly capabilities: AgentCapabilityFlags;
  startTurn(prompt: AgentPromptInput, options?: AgentRunOptions): Promise<{ turnId: string }>;
  subscribe(callback: (event: AgentStreamEvent) => void): () => void;
  describePersistence(): AgentPersistenceHandle | null;
  interrupt(): Promise<void>;
  close(): Promise<void>;
}

export interface AgentClient {
  readonly provider: AgentProvider;
  readonly capabilities: AgentCapabilityFlags;
  createSession(
    config: AgentSessionConfig,
    launchContext?: AgentLaunchContext,
  ): Promise<AgentSession>;
  resumeSession(
    handle: AgentPersistenceHandle,
    overrides?: Partial<AgentSessionConfig>,
  ): Promise<AgentSession>;
  listModels(options: ListModelsOptions): Promise<AgentModelDefinition[]>;
  listModes?(options: ListModesOptions): Promise<AgentMode[]>;
  isAvailable(): Promise<boolean>;
  getDiagnostic?(): Promise<{ diagnostic: string }>;
}
```

### Timeline Event Shape

**Source:** `packages/server/src/server/agent/agent-sdk-types.ts` lines 363-397
**Apply to:** `cursor-sdk-agent.ts`, `event-mapper.ts`

```typescript
export type AgentTimelineItem =
  | { type: "user_message"; text: string; messageId?: string }
  | { type: "assistant_message"; text: string; messageId?: string }
  | { type: "reasoning"; text: string }
  | ToolCallTimelineItem
  | { type: "error"; message: string };

export type AgentStreamEvent =
  | { type: "turn_started"; provider: AgentProvider; turnId?: string }
  | { type: "turn_completed"; provider: AgentProvider; usage?: AgentUsage; turnId?: string }
  | {
      type: "turn_failed";
      provider: AgentProvider;
      error: string;
      code?: string;
      diagnostic?: string;
      turnId?: string;
    }
  | { type: "turn_canceled"; provider: AgentProvider; reason: string; turnId?: string }
  | { type: "timeline"; item: AgentTimelineItem; provider: AgentProvider; turnId?: string };
```

### Provider Env Overlay

**Source:** `packages/server/src/server/agent/provider-launch-config.ts` lines 221-245
**Apply to:** API key resolution and SDK env wrapper

```typescript
function collectProviderEnvOverlays(
  runtimeSettings: ProviderRuntimeSettings | undefined,
  overlays: Array<ProcessEnvRecord | undefined>,
): ProcessEnvRecord[] {
  return [runtimeSettings?.env, ...overlays].filter(
    (overlay): overlay is ProcessEnvRecord => !!overlay,
  );
}

export function createProviderEnv(options: ProviderEnvOptions = {}): NodeJS.ProcessEnv {
  const spec = createProviderEnvSpec(options);
  return createExternalProcessEnv(spec.baseEnv ?? process.env, spec.envOverlay);
}
```

For `CURSOR_API_KEY`, prefer `runtimeSettings?.env?.CURSOR_API_KEY`, then daemon `process.env.CURSOR_API_KEY`. Pass the key explicitly to SDK calls if supported; if not, use a narrow temporary env wrapper and restore the prior env.

### Availability and Diagnostics

**Source:** `packages/server/src/server/agent/providers/claude/agent.ts` lines 1447-1462
**Apply to:** `CursorSdkAgentClient.isAvailable`, `getDiagnostic`

```typescript
async isAvailable(): Promise<boolean> {
  const launch = await resolveProviderLaunch({
    commandConfig: this.runtimeSettings?.command,
    defaultBinary: "claude",
  });
  const availability = await checkProviderLaunchAvailable(launch);
  return availability.available;
}

async getDiagnostic(): Promise<{ diagnostic: string }> {
  try {
    const launch = await resolveProviderLaunch({
      commandConfig: this.runtimeSettings?.command,
      defaultBinary: "claude",
    });
    const availability = await checkProviderLaunchAvailable(launch);
```

For Cursor SDK, replace binary check with SDK import/native readiness + key presence. Do not create a scratch SDK agent for availability, models, or mode probing.

### Cancellation

**Source:** `packages/server/src/server/agent/providers/opencode-agent.ts` lines 2897-2921 and `packages/server/src/server/agent/providers/codex-app-server-agent.ts` lines 3908-3922
**Apply to:** `CursorSdkAgentSession.interrupt`

```typescript
async interrupt(): Promise<void> {
  const turnId = this.activeForegroundTurnId;
  const turnAbortController = this.abortController;
  turnAbortController?.abort();
  const abortPromise = this.beginSessionAbort(turnId, "interrupt");
  await withTimeout(abortPromise, 2_000, "OpenCode session.abort").catch((error) => {
    this.logger.warn({ err: error, sessionId: this.sessionId, turnId }, "OpenCode session.abort exceeded the cancel cap");
  });
  if (turnId) {
    this.finishForegroundTurn(
      { type: "turn_canceled", provider: "opencode", reason: "interrupted" },
      turnId,
    );
  }
}
```

For Cursor SDK, hold the active SDK `Run`, check `run.supports("cancel")` when available, call `run.cancel()`, and map `Run.wait().status === "cancelled"` to `turn_canceled`.

### Tests

**Source:** `docs/testing.md` and colocated provider tests
**Apply to:** all new `*.test.ts`

- Collocate tests with implementation.
- Use fakes through injected adapters; avoid `vi.mock` of own modules for new code.
- Use temp directories for file persistence.
- Run only targeted files: `npx vitest run <file> --bail=1`.

## No Analog Found

No files are without a usable codebase analog. Cursor SDK itself is new, but the adapter shape, provider lifecycle, diagnostics, event mapping, mode safety, persistence, registry, and tests all have close local analogs.

## Metadata

**Analog search scope:** `packages/server/src/server/agent`, `packages/server/src/server/agent/providers`, `packages/protocol/src`
**Files scanned:** provider docs, provider registry/config, direct providers, diagnostic utils, provider manifest, targeted tests
**Pattern extraction date:** 2026-06-13
