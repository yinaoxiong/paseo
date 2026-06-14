# Phase 02: Direct Provider Core - Research

**Researched:** 2026-06-13
**Domain:** Paseo server direct provider integration for Cursor TypeScript SDK
**Confidence:** HIGH

## User Constraints (from CONTEXT.md)

### Locked Decisions

## Implementation Decisions

### Provider Boundary and Availability

- **D-01:** If `cursor-sdk` cannot find `CURSOR_API_KEY`, mark the provider unavailable in provider snapshots and expose a diagnostic. Do not create a Cursor SDK session just to discover the missing key.
- **D-02:** `isAvailable()` should stay lightweight: check SDK import/native readiness and key presence. Leave deeper auth/model/network failures to diagnostics, `listModels()`, or create/resume entry points.
- **D-03:** API key resolution should prefer `agents.providers.cursor-sdk.env.CURSOR_API_KEY`, then daemon process env `CURSOR_API_KEY`. Prefer passing the resolved key explicitly to the SDK; use a narrow temporary env wrapper only if the SDK requires `process.env`.
- **D-04:** Diagnostics should be structured and redacted: include error class/message, status/code, operation/endpoint, key source, sandbox/model context, and SDK/run ids where available. Never include key values, prefixes, suffixes, lengths, hashes, headers, or raw env.
- **D-05:** `createSession()` and `resumeSession()` must repeat critical preflight checks so stale provider snapshots do not hide launch/resume failures.
- **D-06:** Keep `cursor-sdk` completely isolated from the existing `cursor` ACP provider. Do not inherit ACP command settings, login state, or `agents.providers.cursor.*` config.
- **D-07:** If the SDK reports invalid key/auth failure such as HTTP 401, fail the current operation with a redacted diagnostic and let provider snapshots show error/unavailable until the user fixes config and refreshes. Do not auto-retry.

### Sandbox Handling

- **D-08:** When the current runtime cannot support Cursor SDK Sandbox, do not list Sandbox as a runtime-available mode. Provider diagnostics should explain unsupported sandboxing.
- **D-09:** Explicit or stale Sandbox requests must fail closed. Never silently downgrade Sandbox to YOLO.
- **D-10:** If a persisted session was created with Sandbox semantics and the current environment cannot support Sandbox, reject resume with a clear diagnostic.
- **D-11:** Sandbox capability probing must be side-effect-free. Use an SDK capability API if available, known failure cache, or environment diagnostics; do not create scratch SDK agents for metadata or mode probing.
- **D-12:** Mode metadata must use explicit safety labels. YOLO is dangerous and unattended (`isUnattended: true`); Sandbox is not unattended. Do not use a generic "Agent" label in v1.

### Persistence and Resume Contract

- **D-13:** Resume metadata validation is strict. Missing or inconsistent `nativeHandle`, `storePath`, `cwd`, `runtime`, `modeId`, or `sandboxEnabled` rejects resume.
- **D-14:** Use `AgentPersistenceHandle.nativeHandle` for the SDK `agentId`.
- **D-15:** Store only non-secret resume context in metadata: `runtime`, `cwd`, `storePath`, `model`, `modeId`, and `sandboxEnabled`.
- **D-16:** Production `JsonlLocalAgentStore` files should live under `$PASEO_HOME/providers/cursor-sdk/stores/{paseoSessionId}`. Resume should accept only paths inside this controlled provider/session-scoped root.
- **D-17:** Resume may accept explicit model and mode overrides, including mode changes, when the user asks for them.
- **D-18:** Override handling must still fail closed. If the SDK cannot resume with the requested model/mode, fail with a diagnostic; do not silently fall back to the persisted mode, YOLO, or any other available option.

### Stream and Timeline Mapping

- **D-19:** Use robust core mapping for Phase 2. Map observed SDK `status`, `assistant`, `tool_call`, `runId`, `requestId`, and terminal status surfaces; record unknown SDK events as redacted diagnostics without crashing or blocking the turn.
- **D-20:** Emit exactly one canonical `user_message` timeline row when `startTurn()` accepts the prompt. Use SDK echoes only for dedupe/correlation.
- **D-21:** Map terminal statuses directly: `finished` to `turn_completed`, `cancelled` to `turn_canceled`, and `error` or unknown terminal states to `turn_failed` with diagnostic metadata.
- **D-22:** Map SDK `tool_call` events conservatively. Reliably identified tool calls become standard `ToolCallDetail`; unknown tools remain generic/diagnostic instead of being guessed into read/edit/shell categories.

### the agent's Discretion

The planner may choose exact file names, helper boundaries, adapter class names, test fixture names, and diagnostic field names as long as they preserve the decisions above and the existing provider architecture.

### Deferred Ideas (OUT OF SCOPE)

## Deferred Ideas

- Cursor SDK cloud runtime remains deferred.
- SDK `local.autoReview` remains deferred and is not a v1 mode.
- Interactive Ask/human approval remains deferred until the SDK exposes a stable host approval response path.
- Provider manifest/UI/icon/model/thinking surfacing belongs to Phase 3.
- Full hardening docs and broader targeted tests belong to Phase 4, though Phase 2 plans should still add narrow tests for newly implemented provider-core behavior.

## Summary

Phase 2 should implement `cursor-sdk` as a direct `AgentClient` / `AgentSession` in `packages/server`, registered side-by-side with the existing `cursor` ACP provider and using the existing provider registry/runtime-settings flow. [VERIFIED: docs/providers.md, packages/server/src/server/agent/agent-sdk-types.ts, packages/server/src/server/agent/provider-registry.ts] The Cursor SDK API surface needed for this phase is present in `@cursor/sdk@1.0.18`: `Agent.create`, `Agent.resume`, `SDKAgent.send`, `Run.stream`, `Run.wait`, `Run.cancel`, `Run.supports`, `Cursor.models.list`, `JsonlLocalAgentStore`, `local.sandboxOptions`, and SDK error classes. [CITED: https://cursor.com/docs/sdk/typescript] [VERIFIED: npm registry + package d.ts]

Phase 1 is the strongest runtime evidence for planning: YOLO local lifecycle, cancellation, and JSONL-backed cross-process resume passed with a provider-config key, while Sandbox failed in this Linux devcontainer with unsupported-sandbox `ConfigurationError`. [VERIFIED: .planning/phases/01-sdk-viability-spike/01-SPIKE-RESULTS.md] Therefore the implementation must support both Paseo mode concepts but list Sandbox only when a side-effect-free capability check says it is supported, and must reject explicit/stale Sandbox requests when unsupported. [VERIFIED: .planning/phases/02-direct-provider-core/02-CONTEXT.md]

**Primary recommendation:** Build a narrow `CursorSdkAgentClient` plus `CursorSdkAgentSession` around explicit API-key resolution, provider-scoped JSONL store paths, strict resume validation, SDK run cancellation, and conservative stream mapping; do not add UI polish, cloud agents, Ask mode, auto-review mode, or ACP fallback in this phase. [VERIFIED: .planning/phases/02-direct-provider-core/02-CONTEXT.md]

## Phase Requirements

| ID      | Description                                                                                                               | Research Support                                                                                                                                                                                                                                               |
| ------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PROV-01 | Paseo has an experimental direct provider with id `cursor-sdk`.                                                           | Registry and manifest use runtime string provider ids; add a built-in factory entry without changing `cursor` ACP. [VERIFIED: packages/server/src/server/agent/provider-registry.ts, packages/protocol/src/provider-manifest.ts]                               |
| PROV-02 | The provider implements `AgentClient` and `AgentSession` without depending on ACP process transport.                      | Direct provider contract is in `agent-sdk-types.ts`; Claude/Codex/OpenCode are direct analogs. [VERIFIED: packages/server/src/server/agent/agent-sdk-types.ts, docs/providers.md]                                                                              |
| PROV-03 | The provider emits canonical user timeline items and maps SDK assistant/tool/reasoning events.                            | Provider docs require exactly one canonical `user_message`; SDK message types include `assistant`, `tool_call`, `thinking`, `status`, and `request`. [VERIFIED: docs/providers.md] [VERIFIED: npm registry + package d.ts]                                     |
| PROV-04 | The provider persists a resume handle that can recreate a Cursor SDK agent after daemon restart.                          | Use SDK `agentId` in `nativeHandle` plus `runtime`, `cwd`, `storePath`, `model`, `modeId`, `sandboxEnabled` metadata. [VERIFIED: .planning/phases/01-sdk-viability-spike/01-SPIKE-RESULTS.md]                                                                  |
| PROV-05 | The provider supports interruption/cancellation using the SDK run lifecycle where available.                              | `Run.supports("cancel")`, `Run.cancel()`, and `Run.wait().status === "cancelled"` are available and YOLO cancellation was live-proven. [CITED: https://cursor.com/docs/sdk/typescript] [VERIFIED: .planning/phases/01-sdk-viability-spike/01-SPIKE-RESULTS.md] |
| MODE-01 | The provider exposes a Sandbox mode that runs Cursor SDK local agents with sandboxing enabled.                            | SDK local options include `sandboxOptions: { enabled: boolean }`; current devcontainer does not support enabled sandbox. [CITED: https://cursor.com/docs/sdk/typescript] [VERIFIED: .planning/phases/01-sdk-viability-spike/01-SPIKE-RESULTS.md]               |
| MODE-02 | The provider exposes a YOLO mode that runs Cursor SDK local agents without sandboxing and is marked unattended/dangerous. | YOLO maps to `sandboxOptions.enabled = false` and must be `isUnattended: true`. [VERIFIED: .planning/phases/02-direct-provider-core/02-CONTEXT.md]                                                                                                             |

## Project Constraints (from AGENTS.md)

- Check `docs/` before online sources; docs are the source of truth for repo conventions. [VERIFIED: AGENTS.md]
- Do not restart the main Paseo daemon on port `6767` without permission. [VERIFIED: AGENTS.md]
- Run dependency install/update, formatting, linting, typechecking, tests, build verification, and dependency-backed hooks inside the devcontainer. [VERIFIED: AGENTS.md]
- Do not run broad/full local test suites; run targeted changed test files with `npx vitest run <file> --bail=1`, and never run `npm run test` for an entire workspace unless explicitly asked. [VERIFIED: AGENTS.md]
- Always run typecheck and lint after changes inside the devcontainer; use npm scripts for lint/format, not direct `npx eslint`, `npx oxfmt`, `npx oxlint`, or package-local binaries. [VERIFIED: AGENTS.md]
- Run `npm run format` before committing inside the devcontainer; use `npm run format:files -- <paths>` for targeted formatting. [VERIFIED: AGENTS.md]
- Protocol schema changes must be backward-compatible; new fields are optional/defaulted and new feature availability is capability-gated. [VERIFIED: AGENTS.md]
- New RPCs, if any, use dotted `.request` / `.response` names, but Phase 2 should not need new RPCs for provider-core plumbing. [VERIFIED: AGENTS.md] [ASSUMED]
- Do not add auth checks to tests; provider adapters own authentication. [VERIFIED: AGENTS.md, docs/testing.md]
- Provider code must preserve cross-platform/server boundaries; no app/UI platform work is expected in Phase 2. [VERIFIED: AGENTS.md] [VERIFIED: .planning/ROADMAP.md]

## Architectural Responsibility Map

| Capability                          | Primary Tier  | Secondary Tier     | Rationale                                                                                                                                                                                                                                                                               |
| ----------------------------------- | ------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider registration and snapshots | API / Backend | Protocol metadata  | Provider factories, availability, models, and modes are built in `packages/server`; static mode visuals live in protocol metadata when needed. [VERIFIED: packages/server/src/server/agent/provider-registry.ts, packages/protocol/src/provider-manifest.ts]                            |
| Cursor SDK lifecycle                | API / Backend | Local filesystem   | `AgentClient.createSession` / `resumeSession` and `AgentSession.startTurn` own SDK calls and local store wiring. [VERIFIED: packages/server/src/server/agent/agent-sdk-types.ts]                                                                                                        |
| Resume persistence                  | API / Backend | Database / Storage | Paseo stores `AgentPersistenceHandle` in agent records under `$PASEO_HOME/agents`, while SDK JSONL store files live under `$PASEO_HOME/providers/cursor-sdk/stores/{paseoSessionId}`. [VERIFIED: docs/data-model.md] [VERIFIED: .planning/phases/02-direct-provider-core/02-CONTEXT.md] |
| Cancellation                        | API / Backend | Cursor SDK runtime | `AgentSession.interrupt()` should hold the active SDK `Run`, check cancel support, call `run.cancel()`, and map terminal status. [CITED: https://cursor.com/docs/sdk/typescript]                                                                                                        |
| Mode safety                         | API / Backend | Protocol metadata  | Server/provider mode list decides runtime availability; metadata flags such as `isUnattended` communicate YOLO danger to clients. [VERIFIED: packages/protocol/src/provider-manifest.ts, packages/server/src/server/agent/agent-sdk-types.ts]                                           |
| Stream event mapping                | API / Backend | WebSocket timeline | Provider emits `AgentStreamEvent`; `AgentManager` persists and broadcasts timeline/state. [VERIFIED: docs/architecture.md, packages/server/src/server/agent/agent-sdk-types.ts]                                                                                                         |
| Credential resolution and redaction | API / Backend | Local config       | Provider runtime settings/env supply keys; diagnostics must redact and never persist key material. [VERIFIED: docs/custom-providers.md, .planning/phases/02-direct-provider-core/02-CONTEXT.md]                                                                                         |

## Standard Stack

### Core

| Library                              | Version                        | Purpose                                                                                               | Why Standard                                                                                                                                                                                                 |
| ------------------------------------ | ------------------------------ | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@cursor/sdk`                        | `1.0.18`, published 2026-06-05 | Cursor local agent SDK: create/resume/send/stream/wait/cancel, JSONL store, model API, error classes. | Official Cursor TypeScript SDK and already present in `@getpaseo/server` dependency graph. [CITED: https://cursor.com/docs/sdk/typescript] [VERIFIED: npm registry]                                          |
| Paseo `AgentClient` / `AgentSession` | local source                   | Provider contract and normalized stream/timeline interface.                                           | Existing direct providers use this contract; adding ACP transport would violate Phase 2 scope. [VERIFIED: packages/server/src/server/agent/agent-sdk-types.ts, docs/providers.md]                            |
| Paseo provider registry              | local source                   | Built-in provider factory, runtime-settings overlay, model/mode wrapping, custom provider isolation.  | It is the established way to add built-in providers and preserve custom-provider behavior. [VERIFIED: packages/server/src/server/agent/provider-registry.ts]                                                 |
| `JsonlLocalAgentStore`               | from `@cursor/sdk@1.0.18`      | Portable file-backed local SDK store.                                                                 | Phase 1 proved JSONL-backed YOLO resume across processes and Phase 2 locked this store path. [VERIFIED: .planning/phases/01-sdk-viability-spike/01-SPIKE-RESULTS.md] [VERIFIED: npm registry + package d.ts] |

### Supporting

| Library                                         | Version                         | Purpose                                                                  | When to Use                                                                                                                                                                              |
| ----------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node `fs/promises`, `path`, `crypto.randomUUID` | Node `v22.22.3` in devcontainer | Directory creation, store path containment validation, turn/session ids. | Use built-in APIs for provider store directories and deterministic path checks. [VERIFIED: environment probe]                                                                            |
| `zod`                                           | existing repo dependency        | Runtime validation for resume metadata helper schemas.                   | Use if implementing strict `AgentPersistenceHandle.metadata` parsing; repo already validates persistence/config at runtime. [VERIFIED: docs/data-model.md, packages/server/package.json] |
| `pino` logger                                   | existing repo dependency        | Structured provider diagnostics/logs.                                    | Use child logger with provider context as direct providers do. [VERIFIED: packages/server/src/server/agent/providers/claude/agent.ts]                                                    |
| Vitest                                          | `4.1.6`                         | Focused unit tests for provider behavior.                                | Existing repo test runner; use only targeted files per project rules. [VERIFIED: packages/server/package.json, docs/testing.md]                                                          |

### Alternatives Considered

| Instead of               | Could Use                                    | Tradeoff                                                                                                                                                                                                 |
| ------------------------ | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `JsonlLocalAgentStore`   | SDK default `SqliteLocalAgentStore`          | SQLite is SDK default, but Phase 1 selected JSONL for provider/session-scoped portable stores and already proved resume with it. [VERIFIED: .planning/phases/01-sdk-viability-spike/01-SPIKE-RESULTS.md] |
| Explicit `apiKey` option | Mutating global `process.env.CURSOR_API_KEY` | Explicit option avoids daemon-global secret mutation; use a narrow temporary env wrapper only if a specific SDK call lacks `apiKey`. [VERIFIED: .planning/phases/02-direct-provider-core/02-CONTEXT.md]  |
| Direct provider          | ACP provider subclass                        | Cursor SDK is not ACP transport, and existing `cursor` ACP provider must remain isolated. [VERIFIED: docs/providers.md, .planning/phases/02-direct-provider-core/02-CONTEXT.md]                          |

**Installation:**

```bash
# Already present after Phase 1 in packages/server/package.json.
devcontainer exec --workspace-folder /mnt/private_yax_qy4/projects/paseo npm install
devcontainer exec --workspace-folder /mnt/private_yax_qy4/projects/paseo npm rebuild sqlite3
```

**Version verification:** `devcontainer exec --workspace-folder /mnt/private_yax_qy4/projects/paseo npm ls @cursor/sdk --workspace=@getpaseo/server --depth=0 --json` reports `@cursor/sdk@1.0.18`, and `npm view @cursor/sdk version` reports `1.0.18`. [VERIFIED: npm registry] The package depends on `sqlite3`, and Phase 1 import passed only after rebuilding native `sqlite3` bindings in the devcontainer. [VERIFIED: npm registry] [VERIFIED: .planning/phases/01-sdk-viability-spike/01-SPIKE-RESULTS.md]

## Package Legitimacy Audit

> The installed `gsd-tools` shim in this checkout does not expose `package-legitimacy`; running `gsd-tools query package-legitimacy check --ecosystem npm @cursor/sdk sqlite3` returned `Unknown command: package-legitimacy`. [VERIFIED: tool output] Because the required seam verdict is unavailable, planner should treat external package approval as manual-verify despite npm and official-doc evidence. [VERIFIED: tool output] [ASSUMED]

| Package       | Registry | Age                                               | Downloads     | Source Repo                        | Verdict                                          | Disposition                                                                                                                                                                  |
| ------------- | -------- | ------------------------------------------------- | ------------- | ---------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@cursor/sdk` | npm      | created 2026-04-26; latest `1.0.18` on 2026-06-05 | not collected | `github.com/cursor/cursor`         | `UNVERIFIED` because legitimacy seam unavailable | Already installed; planner should add `checkpoint:human-verify` before changing dependency version. [CITED: https://cursor.com/docs/sdk/typescript] [VERIFIED: npm registry] |
| `sqlite3`     | npm      | created 2011-02-24; latest `6.0.1` on 2026-03-12  | not collected | `github.com/TryGhost/node-sqlite3` | `UNVERIFIED` because legitimacy seam unavailable | Transitive dependency of `@cursor/sdk`; do not add direct dependency unless implementation proves it is needed. [VERIFIED: npm registry]                                     |

**Packages removed due to [SLOP] verdict:** none; no seam verdict was available. [VERIFIED: tool output]
**Packages flagged as suspicious [SUS]:** none by seam; `@cursor/sdk` remains human-verify-gated only because the seam was unavailable. [VERIFIED: tool output]

## Architecture Patterns

### System Architecture Diagram

```text
Provider snapshot refresh / create agent request
        |
        v
Provider registry resolves built-in `cursor-sdk`
        |
        v
CursorSdkAgentClient
  |-- lightweight availability: SDK import/native readiness + resolved key presence
  |-- listModels: Cursor.models.list({ apiKey }) without scratch sessions
  |-- listModes: Sandbox only if side-effect-free support says available; YOLO always when SDK/key ready
  |-- createSession/resumeSession repeat preflight
        |
        v
CursorSdkAgentSession
  |-- create/resume SDK Agent with JsonlLocalAgentStore under controlled PASEO_HOME root
  |-- startTurn emits turn_started and exactly one canonical user_message
  |-- SDK agent.send -> Run.stream + Run.wait
  |-- interrupt -> run.supports("cancel") -> run.cancel()
        |
        v
SDK stream mapper
  |-- assistant -> assistant_message timeline
  |-- thinking -> reasoning timeline
  |-- tool_call -> known ToolCallDetail or generic unknown
  |-- status/request -> diagnostic/correlation metadata
  |-- terminal finished/cancelled/error -> turn_completed/turn_canceled/turn_failed
        |
        v
AgentManager persists AgentStreamEvent timeline and AgentPersistenceHandle
```

### Recommended Project Structure

```text
packages/server/src/server/agent/providers/
├── cursor-sdk-agent.ts              # AgentClient + AgentSession implementation
├── cursor-sdk/
│   ├── diagnostics.ts               # SDK error serialization/redaction helpers
│   ├── event-mapper.ts              # SDKMessage -> AgentStreamEvent / timeline mapping
│   ├── modes.ts                     # Sandbox/YOLO definitions and fail-closed validation
│   ├── persistence.ts               # handle metadata schema and store path containment
│   └── sdk-runtime.ts               # small injectable wrapper around @cursor/sdk for tests
└── cursor-acp-agent.ts              # existing ACP provider, unchanged
```

This structure is recommended because Phase 2 touches provider lifecycle, persistence, modes, diagnostics, and event mapping; separating those helpers gives targeted unit seams without broad module mocks. [VERIFIED: docs/testing.md] [ASSUMED]

### Pattern 1: Direct Provider Client

**What:** Implement `AgentClient` on a provider-specific class with `provider = "cursor-sdk"`, `capabilities`, `createSession`, `resumeSession`, `listModels`, `listModes`, `isAvailable`, and `getDiagnostic`. [VERIFIED: packages/server/src/server/agent/agent-sdk-types.ts]

**When to use:** Use this for SDK-native providers that do not speak ACP. [VERIFIED: docs/providers.md]

**Example:**

```typescript
// Source: packages/server/src/server/agent/agent-sdk-types.ts and @cursor/sdk d.ts
const CURSOR_SDK_CAPABILITIES: AgentCapabilityFlags = {
  supportsStreaming: true,
  supportsSessionPersistence: true,
  supportsDynamicModes: true,
  supportsMcpServers: true,
  supportsReasoningStream: true,
  supportsToolInvocations: true,
};

export class CursorSdkAgentClient implements AgentClient {
  readonly provider = "cursor-sdk" as const;
  readonly capabilities = CURSOR_SDK_CAPABILITIES;

  async createSession(config: AgentSessionConfig, launchContext?: AgentLaunchContext) {
    const preflight = await this.preflight({ operation: "createSession", modeId: config.modeId });
    return CursorSdkAgentSession.create({ config, launchContext, preflight });
  }
}
```

### Pattern 2: Strict Resume Metadata

**What:** Parse `AgentPersistenceHandle` through a schema/helper before calling `Agent.resume`, reject missing/inconsistent fields, and validate `storePath` under `$PASEO_HOME/providers/cursor-sdk/stores`. [VERIFIED: .planning/phases/02-direct-provider-core/02-CONTEXT.md]

**When to use:** Every `resumeSession` call, including daemon restart and explicit resume with overrides. [VERIFIED: packages/server/src/server/agent/agent-sdk-types.ts]

**Example:**

```typescript
// Source: docs/data-model.md and Phase 2 CONTEXT.md
type CursorSdkResumeMetadata = {
  runtime: "local";
  cwd: string;
  storePath: string;
  model?: string | null;
  modeId: "sandbox" | "yolo";
  sandboxEnabled: boolean;
};

function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
```

### Pattern 3: Canonical User Message Before SDK Echoes

**What:** Emit one `timeline` event with `{ type: "user_message" }` when `startTurn` accepts a prompt, then dedupe or ignore any SDK `user` echo for the same turn. [VERIFIED: docs/providers.md] [VERIFIED: .planning/phases/02-direct-provider-core/02-CONTEXT.md]

**When to use:** `CursorSdkAgentSession.startTurn` before or immediately after calling `agent.send`, once preflight has succeeded and the foreground turn is accepted. [VERIFIED: docs/providers.md]

**Example:**

```typescript
// Source: docs/providers.md canonical user-message rule
this.notifySubscribers({ type: "turn_started", provider: "cursor-sdk", turnId });
this.notifySubscribers({
  type: "timeline",
  provider: "cursor-sdk",
  turnId,
  item: { type: "user_message", text: renderPromptForTimeline(prompt), messageId },
});
```

### Anti-Patterns to Avoid

- **Scratch SDK sessions for metadata:** Provider snapshots must use `isAvailable`, `listModels`, and `listModes`; scratch sessions can leave empty native history. [VERIFIED: docs/providers.md]
- **Silent Sandbox downgrade:** Sandbox unsupported or stale Sandbox resume must fail closed, never become YOLO. [VERIFIED: .planning/phases/02-direct-provider-core/02-CONTEXT.md]
- **Global secret mutation:** Do not write `process.env.CURSOR_API_KEY` globally in a long-running daemon. [VERIFIED: .planning/phases/02-direct-provider-core/02-CONTEXT.md]
- **Secret-bearing persistence:** Do not write API keys, prefixes, suffixes, hashes, headers, raw env, SDK stores, or raw transcripts into `AgentPersistenceHandle.metadata` or Markdown/log diagnostics. [VERIFIED: .planning/phases/02-direct-provider-core/02-CONTEXT.md, .planning/phases/01-sdk-viability-spike/01-SPIKE-RESULTS.md]
- **Guessing tool categories:** Unknown SDK `tool_call` names should stay generic/diagnostic instead of being coerced into shell/read/edit. [VERIFIED: .planning/phases/02-direct-provider-core/02-CONTEXT.md]

## Don't Hand-Roll

| Problem                      | Don't Build                          | Use Instead                                                              | Why                                                                                                                                                                                                                          |
| ---------------------------- | ------------------------------------ | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cursor local agent lifecycle | Custom child process / ACP transport | `@cursor/sdk` `Agent.create`, `Agent.resume`, `SDKAgent.send`            | SDK exposes native local lifecycle and Phase 1 proved the YOLO path. [CITED: https://cursor.com/docs/sdk/typescript] [VERIFIED: .planning/phases/01-sdk-viability-spike/01-SPIKE-RESULTS.md]                                 |
| Local session storage        | Ad hoc JSON transcript files         | `JsonlLocalAgentStore`                                                   | SDK store owns agents, runs, run events, and checkpoints; JSONL store writes the expected SDK layout. [VERIFIED: npm registry + package d.ts]                                                                                |
| Cancellation                 | Local boolean-only cancel            | SDK `Run.supports("cancel")`, `Run.cancel()`, `Run.wait()`               | SDK exposes operation support and terminal `cancelled` status. [CITED: https://cursor.com/docs/sdk/typescript]                                                                                                               |
| Model discovery              | Hard-coded model list                | `Cursor.models.list({ apiKey })`                                         | SDK docs and invalid-model error both direct callers to model list for valid selections. [CITED: https://cursor.com/docs/sdk/typescript] [VERIFIED: .planning/phases/01-sdk-viability-spike/results/auth-config-errors.json] |
| Provider snapshots           | Forced session creation              | Existing `ProviderSnapshotManager` + provider `listModels` / `listModes` | Snapshot manager calls availability before model/mode fetch and caches warm entries. [VERIFIED: packages/server/src/server/agent/provider-snapshot-manager.ts]                                                               |
| Runtime config/env overlay   | New credential store                 | Existing `agents.providers.<providerId>.env` runtime settings            | Project locked v1 to provider env config and process env fallback. [VERIFIED: docs/custom-providers.md, .planning/PROJECT.md]                                                                                                |

**Key insight:** The hard problems are state ownership and safety semantics, not SDK invocation; use Cursor's SDK for lifecycle/storage and Paseo's provider contract for state/timeline, with strict validation at the boundary. [VERIFIED: docs/providers.md] [CITED: https://cursor.com/docs/sdk/typescript]

## Common Pitfalls

### Pitfall 1: Treating Provider Snapshot Availability as Authorization Truth

**What goes wrong:** A warm provider snapshot says ready, but the key was removed or invalidated before `createSession` or `resumeSession`. [VERIFIED: docs/providers.md] [VERIFIED: .planning/phases/02-direct-provider-core/02-CONTEXT.md]
**Why it happens:** Snapshot entries are cached until explicit refresh, by design. [VERIFIED: docs/providers.md]
**How to avoid:** Repeat SDK import/key/mode/store preflight in create/resume, then surface redacted diagnostics on failure. [VERIFIED: .planning/phases/02-direct-provider-core/02-CONTEXT.md]
**Warning signs:** `createSession` assumes `isAvailable()` already ran; tests only cover snapshot ready path. [ASSUMED]

### Pitfall 2: Path Traversal Through Persisted `storePath`

**What goes wrong:** A tampered persisted handle points `storePath` outside `$PASEO_HOME/providers/cursor-sdk/stores`. [VERIFIED: .planning/phases/02-direct-provider-core/02-CONTEXT.md]
**Why it happens:** `AgentPersistenceHandle.metadata` is data loaded from disk and must not be trusted without validation. [VERIFIED: docs/data-model.md]
**How to avoid:** Resolve/normalize the controlled root and candidate path; accept only paths inside the controlled root, then rebuild `JsonlLocalAgentStore` from that path. [VERIFIED: .planning/phases/02-direct-provider-core/02-CONTEXT.md] [ASSUMED]
**Warning signs:** Code uses `startsWith(root)` string checks without `path.relative` / `path.resolve`. [ASSUMED]

### Pitfall 3: Duplicated User Timeline Rows

**What goes wrong:** Paseo emits a local user row and later maps an SDK `user` echo to another row. [VERIFIED: docs/providers.md]
**Why it happens:** SDK stream includes `user` messages, while Paseo requires provider-owned canonical user rows. [VERIFIED: docs/providers.md] [VERIFIED: npm registry + package d.ts]
**How to avoid:** Emit one row at accepted prompt time and use SDK user events only for correlation/dedupe. [VERIFIED: .planning/phases/02-direct-provider-core/02-CONTEXT.md]
**Warning signs:** Event mapper maps every SDK `user` event directly into timeline rows. [ASSUMED]

### Pitfall 4: Overclaiming Sandbox Support

**What goes wrong:** Sandbox appears as selectable in this devcontainer, but `Agent.create` fails because SDK local sandboxing is unsupported. [VERIFIED: .planning/phases/01-sdk-viability-spike/01-SPIKE-RESULTS.md]
**Why it happens:** SDK exposes `sandboxOptions.enabled`, but runtime support is environment-dependent. [CITED: https://cursor.com/docs/sdk/typescript] [VERIFIED: .planning/phases/01-sdk-viability-spike/01-SPIKE-RESULTS.md]
**How to avoid:** Use side-effect-free support checks or known unsupported cache; fail explicit Sandbox creates/resumes with diagnostics. [VERIFIED: .planning/phases/02-direct-provider-core/02-CONTEXT.md]
**Warning signs:** `listModes()` always returns both Sandbox and YOLO without checking runtime support. [ASSUMED]

### Pitfall 5: Treating `local.autoReview` as Ask Mode

**What goes wrong:** UI or provider metadata suggests human-in-the-loop approval exists for Cursor SDK. [VERIFIED: .planning/phases/02-direct-provider-core/02-CONTEXT.md]
**Why it happens:** SDK local options include `autoReview`, but Phase 2/3 explicitly defer it and it is not a security boundary. [CITED: https://cursor.com/docs/sdk/typescript] [VERIFIED: .planning/phases/02-direct-provider-core/02-CONTEXT.md]
**How to avoid:** Expose only Sandbox/YOLO in v1 core; defer Ask/autoReview. [VERIFIED: .planning/REQUIREMENTS.md]
**Warning signs:** A mode named `agent`, `ask`, `auto`, or `auto-review` appears in Phase 2 provider output. [VERIFIED: .planning/phases/02-direct-provider-core/02-CONTEXT.md]

## Code Examples

### Cursor SDK Local Create

```typescript
// Source: @cursor/sdk@1.0.18 package d.ts and Phase 1 scripts
const store = new JsonlLocalAgentStore(storePath);
const agent = await Agent.create({
  apiKey,
  model: { id: modelId },
  local: {
    cwd,
    store,
    sandboxOptions: { enabled: sandboxEnabled },
  },
});
```

### Cursor SDK Resume

```typescript
// Source: @cursor/sdk@1.0.18 package d.ts and Phase 1 scripts
const store = new JsonlLocalAgentStore(metadata.storePath);
const agent = await Agent.resume(handle.nativeHandle, {
  apiKey,
  model: metadata.model ? { id: metadata.model } : undefined,
  local: {
    cwd: metadata.cwd,
    store,
    sandboxOptions: { enabled: metadata.sandboxEnabled },
  },
});
```

### Cancellation Guard

```typescript
// Source: @cursor/sdk@1.0.18 run.d.ts
if (!activeRun.supports("cancel")) {
  const reason = activeRun.unsupportedReason("cancel") ?? "cancel unsupported";
  this.emitDiagnostic({ operation: "cancel", reason });
  return;
}
await activeRun.cancel();
const terminal = await activeRun.wait();
```

### SDK Message Mapping Skeleton

```typescript
// Source: @cursor/sdk@1.0.18 messages.d.ts and Paseo AgentStreamEvent
function mapSdkMessage(message: SDKMessage): AgentStreamEvent[] {
  if (message.type === "assistant") {
    return message.message.content
      .filter((block) => block.type === "text")
      .map((block) => ({
        type: "timeline",
        provider: "cursor-sdk",
        item: { type: "assistant_message", text: block.text },
      }));
  }
  if (message.type === "thinking") {
    return [
      { type: "timeline", provider: "cursor-sdk", item: { type: "reasoning", text: message.text } },
    ];
  }
  if (message.type === "tool_call") {
    return [mapCursorSdkToolCall(message)];
  }
  return [];
}
```

## State of the Art

| Old Approach                                          | Current Approach                                       | When Changed                 | Impact                                                                                                                                                       |
| ----------------------------------------------------- | ------------------------------------------------------ | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Existing Cursor integration via `cursor` ACP provider | Side-by-side experimental `cursor-sdk` direct provider | Current milestone, Phase 2   | Do not replace ACP or inherit its command/login config. [VERIFIED: .planning/PROJECT.md, .planning/phases/02-direct-provider-core/02-CONTEXT.md]             |
| Generic "Agent" mode label                            | Explicit Sandbox and YOLO labels                       | Current milestone decisions  | Users must see whether sandboxing is enabled; YOLO is dangerous/unattended. [VERIFIED: .planning/REQUIREMENTS.md]                                            |
| Scratch sessions for metadata                         | Top-level provider metadata APIs                       | Existing provider docs       | Avoid empty native sessions in history/import surfaces. [VERIFIED: docs/providers.md]                                                                        |
| SDK default local store                               | Provider/session-scoped JSONL store                    | Phase 1 spike recommendation | Use `$PASEO_HOME/providers/cursor-sdk/stores/{paseoSessionId}` for resume isolation. [VERIFIED: .planning/phases/01-sdk-viability-spike/01-SPIKE-RESULTS.md] |

**Deprecated/outdated:**

- Treating Phase 1 missing-key blocked evidence as current truth is outdated; credentialed follow-up proved YOLO lifecycle/cancel/resume. [VERIFIED: .planning/phases/01-sdk-viability-spike/01-SPIKE-RESULTS.md]
- Assuming Sandbox works because the SDK has `sandboxOptions.enabled` is invalid in this devcontainer. [VERIFIED: .planning/phases/01-sdk-viability-spike/01-SPIKE-RESULTS.md]

## Assumptions Log

| #   | Claim                                                                                                                                                         | Section                       | Risk if Wrong                                                                                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------- |
| A1  | Phase 2 should not need new WebSocket RPCs.                                                                                                                   | Project Constraints           | If new client/server interaction is needed, planner must add protocol compatibility tasks.                  |
| A2  | Splitting implementation into `cursor-sdk/diagnostics.ts`, `event-mapper.ts`, `modes.ts`, `persistence.ts`, and `sdk-runtime.ts` is the best local structure. | Recommended Project Structure | Planner may choose fewer files, but must preserve test seams.                                               |
| A3  | Store path containment can use `path.resolve` plus `path.relative` checks.                                                                                    | Common Pitfalls               | Symlink-sensitive containment may require `fs.realpath` if attacker-controlled symlinks are in scope.       |
| A4  | Tests should focus on unit-level injectable SDK runtime fakes, with live SDK tests deferred or marked `.real.e2e.test.ts`.                                    | Validation Architecture       | If Phase 2 requires live verification, planner must add credential-aware real e2e tasks without auth skips. |

## Open Questions (RESOLVED)

1. **How should Sandbox support be detected without creating a scratch agent?**
   - What we know: current devcontainer reports unsupported sandboxing during `Agent.create`; Phase 2 forbids scratch sessions for probing. [VERIFIED: .planning/phases/01-sdk-viability-spike/01-SPIKE-RESULTS.md] [VERIFIED: .planning/phases/02-direct-provider-core/02-CONTEXT.md]
   - What's unclear: no official side-effect-free sandbox capability API was found in package d.ts. [VERIFIED: npm registry + package d.ts]
   - Resolution: implement an injectable side-effect-free capability helper in `CursorSdkRuntime` / `modes.ts`. Production should return an explicit support status when a safe SDK/platform signal exists; otherwise it returns `unsupported` with a diagnostic. Tests must prove `listModes()` does not call `Agent.create`, `Agent.resume`, or `agent.send`. Explicit Sandbox create/resume requests still fail closed when the helper reports unsupported. [RESOLVED: plans 02-01 and 02-02]

2. **Should Phase 2 add minimal protocol manifest metadata or defer all manifest changes to Phase 3?**
   - What we know: roadmap puts manifest/UI integration in Phase 3, but provider registry needs a built-in definition for snapshots. [VERIFIED: .planning/ROADMAP.md] [VERIFIED: packages/server/src/server/agent/provider-registry.ts]
   - What's unclear: whether a non-UI minimal `provider-manifest.ts` entry is considered Phase 2 core or Phase 3 metadata polish. [ASSUMED]
   - Resolution: Phase 2 may add the smallest `provider-manifest.ts` definition required for built-in provider snapshots and truthful Sandbox/YOLO safety metadata. Phase 3 still owns icon wiring, provider-selection polish, model/thinking surfaces, and side-by-side UI verification. [RESOLVED: plan 02-01]

## Environment Availability

| Dependency                              | Required By                            | Available | Version                                            | Fallback                                                                                                                       |
| --------------------------------------- | -------------------------------------- | --------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Devcontainer CLI                        | Required repo verification environment | yes       | `0.87.0`                                           | None; project requires dependency-backed checks inside devcontainer. [VERIFIED: environment probe, AGENTS.md]                  |
| Docker                                  | Devcontainer runtime                   | yes       | `26.1.3`                                           | None. [VERIFIED: environment probe]                                                                                            |
| Node.js in devcontainer                 | Server build/runtime                   | yes       | `v22.22.3`                                         | None. [VERIFIED: environment probe]                                                                                            |
| npm in devcontainer                     | Workspace dependency/scripts           | yes       | `10.9.8`                                           | None. [VERIFIED: environment probe]                                                                                            |
| `@cursor/sdk` import in devcontainer    | Cursor SDK provider                    | yes       | `1.0.18`                                           | None for Phase 2; provider unavailable if import/native readiness fails. [VERIFIED: environment probe]                         |
| `CURSOR_API_KEY`                        | Live Cursor SDK auth                   | yes       | source: provider-config, value not read or printed | Provider unavailable/diagnostic if missing. [VERIFIED: environment probe]                                                      |
| Sandbox support in current devcontainer | Sandbox mode                           | no        | SDK `ConfigurationError` in Phase 1                | Fail closed; do not list Sandbox as runtime-available. [VERIFIED: .planning/phases/01-sdk-viability-spike/01-SPIKE-RESULTS.md] |
| Knowledge graph                         | Semantic codebase graph                | no        | graphify disabled                                  | Continue with file/docs research. [VERIFIED: `gsd-tools graphify status`]                                                      |

**Missing dependencies with no fallback:**

- Sandbox runtime support is missing for current devcontainer; explicit Sandbox create/resume must fail closed. [VERIFIED: .planning/phases/01-sdk-viability-spike/01-SPIKE-RESULTS.md]

**Missing dependencies with fallback:**

- GSD `research-plan`, `classify-confidence`, and `package-legitimacy` query commands are unavailable in this installed shim; fallback was official docs, npm registry, package d.ts, and repo-local evidence. [VERIFIED: tool output]

## Validation Architecture

### Test Framework

| Property           | Value                                                                                                                                                                                              |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework          | Vitest `4.1.6`. [VERIFIED: packages/server/package.json]                                                                                                                                           |
| Config file        | `packages/server/vitest.config.ts` and root `vitest.config.ts`. [VERIFIED: file scan]                                                                                                              |
| Quick run command  | `devcontainer exec --workspace-folder /mnt/private_yax_qy4/projects/paseo npx vitest run packages/server/src/server/agent/providers/cursor-sdk-agent.test.ts --bail=1` [VERIFIED: docs/testing.md] |
| Full suite command | Do not run locally; use targeted files plus `npm run typecheck` and `npm run lint` inside devcontainer. [VERIFIED: AGENTS.md, docs/testing.md]                                                     |

### Phase Requirements -> Test Map

| Req ID  | Behavior                                                                                          | Test Type | Automated Command                                                                                                                                                      | File Exists?                                                                   |
| ------- | ------------------------------------------------------------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| PROV-01 | Registry contains `cursor-sdk` and leaves `cursor` ACP factory intact.                            | unit      | `devcontainer exec --workspace-folder /mnt/private_yax_qy4/projects/paseo npx vitest run packages/server/src/server/agent/provider-registry.test.ts --bail=1`          | existing file. [VERIFIED: file scan]                                           |
| PROV-02 | `CursorSdkAgentClient` implements direct provider contract without ACP.                           | unit      | `devcontainer exec --workspace-folder /mnt/private_yax_qy4/projects/paseo npx vitest run packages/server/src/server/agent/providers/cursor-sdk-agent.test.ts --bail=1` | Wave 0 gap. [VERIFIED: file scan]                                              |
| PROV-03 | User prompt emits one canonical `user_message`; SDK assistant/thinking/tool/status map correctly. | unit      | same cursor-sdk test file                                                                                                                                              | Wave 0 gap. [VERIFIED: docs/providers.md]                                      |
| PROV-04 | `describePersistence` and `resumeSession` validate handle metadata and controlled store path.     | unit      | same cursor-sdk test file                                                                                                                                              | Wave 0 gap. [VERIFIED: .planning/phases/02-direct-provider-core/02-CONTEXT.md] |
| PROV-05 | `interrupt` checks `run.supports("cancel")`, calls cancel when supported, and maps `cancelled`.   | unit      | same cursor-sdk test file                                                                                                                                              | Wave 0 gap. [VERIFIED: npm registry + package d.ts]                            |
| MODE-01 | Sandbox appears only when side-effect-free support is true and fails closed otherwise.            | unit      | same cursor-sdk test file                                                                                                                                              | Wave 0 gap. [VERIFIED: .planning/phases/02-direct-provider-core/02-CONTEXT.md] |
| MODE-02 | YOLO maps to sandbox disabled and is unattended/dangerous.                                        | unit      | same cursor-sdk test file plus manifest/registry test if minimal manifest added                                                                                        | Wave 0 gap. [VERIFIED: .planning/REQUIREMENTS.md]                              |

### Sampling Rate

- **Per task commit:** run the changed provider test file only. [VERIFIED: docs/testing.md]
- **Per wave merge:** run targeted provider test, touched registry/manifest tests, `npm run typecheck`, and `npm run lint` inside devcontainer. [VERIFIED: AGENTS.md]
- **Phase gate:** targeted tests plus typecheck/lint green; full local suite is forbidden unless explicitly requested. [VERIFIED: AGENTS.md]

### Wave 0 Gaps

- [ ] `packages/server/src/server/agent/providers/cursor-sdk-agent.test.ts` — covers PROV-02 through PROV-05 and MODE-01/MODE-02 with an injectable SDK runtime fake. [ASSUMED]
- [ ] `packages/server/src/server/agent/providers/cursor-sdk/persistence.test.ts` — covers strict metadata and path containment if persistence helper is split out. [ASSUMED]
- [ ] `packages/server/src/server/agent/providers/cursor-sdk/event-mapper.test.ts` — covers SDK message mapping if mapper is split out. [ASSUMED]
- [ ] Update `packages/server/src/server/agent/provider-registry.test.ts` for PROV-01. [VERIFIED: file scan]

## Security Domain

### Applicable ASVS Categories

| ASVS Category                 | Applies | Standard Control                                                                                                                                                                                                  |
| ----------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V2 Authentication             | yes     | Provider owns Cursor API-key auth; resolve from provider config/env and fail unavailable/diagnostic when absent or invalid. [VERIFIED: docs/providers.md, .planning/phases/02-direct-provider-core/02-CONTEXT.md] |
| V3 Session Management         | yes     | Store only non-secret `AgentPersistenceHandle` data; validate `nativeHandle`, `sessionId`, and metadata on resume. [VERIFIED: docs/data-model.md, .planning/phases/02-direct-provider-core/02-CONTEXT.md]         |
| V4 Access Control             | yes     | Fail-closed mode checks for Sandbox/YOLO and do not silently lower safety. [VERIFIED: .planning/phases/02-direct-provider-core/02-CONTEXT.md]                                                                     |
| V5 Input Validation           | yes     | Runtime-validate persisted metadata, cwd/store paths, mode/model overrides, and SDK event shapes before mapping. [VERIFIED: docs/data-model.md] [ASSUMED]                                                         |
| V6 Cryptography               | no      | Phase 2 does not add encryption; existing config file privacy and relay cryptography are outside this provider core. [VERIFIED: docs/data-model.md, SECURITY.md]                                                  |
| V7 Error Handling and Logging | yes     | Redact API keys and raw env; include class/status/code/operation/request/run ids only. [VERIFIED: .planning/phases/02-direct-provider-core/02-CONTEXT.md]                                                         |
| V12 File and Resources        | yes     | Constrain JSONL store paths under `$PASEO_HOME/providers/cursor-sdk/stores/{paseoSessionId}` and reject traversal/tampered handles. [VERIFIED: .planning/phases/02-direct-provider-core/02-CONTEXT.md]            |

### Known Threat Patterns for Cursor SDK Provider

| Pattern                                                             | STRIDE                             | Standard Mitigation                                                                                                                                                                  |
| ------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| API key disclosure through diagnostics, logs, metadata, or Markdown | Information Disclosure             | Redact before serialization; do not include key values, prefixes, suffixes, lengths, hashes, headers, or raw env. [VERIFIED: .planning/phases/02-direct-provider-core/02-CONTEXT.md] |
| Tampered persisted `storePath` escapes provider root                | Tampering / Elevation of Privilege | Strict metadata schema plus controlled-root path containment check before `JsonlLocalAgentStore`. [VERIFIED: .planning/phases/02-direct-provider-core/02-CONTEXT.md] [ASSUMED]       |
| Unsafe mode downgrade from Sandbox to YOLO                          | Elevation of Privilege             | Reject unsupported/stale Sandbox requests and require explicit YOLO selection for unsandboxed execution. [VERIFIED: .planning/phases/02-direct-provider-core/02-CONTEXT.md]          |
| Duplicate or spoofed timeline messages                              | Tampering / Repudiation            | Provider emits canonical user row and treats SDK echoes as correlation only. [VERIFIED: docs/providers.md]                                                                           |
| Unknown SDK event crashes turn processing                           | Denial of Service                  | Record redacted diagnostics for unknown events and continue/terminate according to terminal status. [VERIFIED: .planning/phases/02-direct-provider-core/02-CONTEXT.md]               |
| Auto-retry duplicates local runs                                    | Tampering / Repudiation            | Do not auto-retry auth/model/network/create/resume failures in v1; surface diagnostic. [VERIFIED: .planning/phases/01-sdk-viability-spike/01-SPIKE-RESULTS.md]                       |

## Sources

### Primary (HIGH confidence)

- `.planning/phases/02-direct-provider-core/02-CONTEXT.md` — locked decisions D-01 through D-22 and scope fences. [VERIFIED: file read]
- `.planning/phases/01-sdk-viability-spike/01-SPIKE-RESULTS.md` — authoritative runtime evidence for import, YOLO lifecycle/cancel/resume, Sandbox unsupported, and error taxonomy. [VERIFIED: file read]
- `docs/providers.md` — direct provider contract, provider snapshot behavior, canonical user-message rule, metadata lookup guidance. [VERIFIED: file read]
- `docs/architecture.md`, `docs/agent-lifecycle.md`, `docs/data-model.md`, `docs/custom-providers.md`, `docs/testing.md` — lifecycle, persistence, config/env, and test constraints. [VERIFIED: file read]
- `packages/server/src/server/agent/agent-sdk-types.ts`, `provider-registry.ts`, `provider-launch-config.ts`, `provider-snapshot-manager.ts`, and provider analogs. [VERIFIED: file read]
- `@cursor/sdk@1.0.18` package d.ts files from `npm pack` — exact TypeScript API signatures. [VERIFIED: npm registry]

### Secondary (MEDIUM confidence)

- `https://cursor.com/docs/sdk/typescript` — official Cursor TypeScript SDK docs, including SDK options and error tables. [CITED: https://cursor.com/docs/sdk/typescript]
- npm registry metadata for `@cursor/sdk` and `sqlite3` versions, publish dates, dependencies, repository URLs, and scripts. [VERIFIED: npm registry]

### Tertiary (LOW confidence)

- Assumptions in the Assumptions Log about file split, no new RPCs, and path-containment implementation details. [ASSUMED]

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — official Cursor docs, npm registry, package d.ts, and Phase 1 runtime evidence align. [CITED: https://cursor.com/docs/sdk/typescript] [VERIFIED: npm registry] [VERIFIED: .planning/phases/01-sdk-viability-spike/01-SPIKE-RESULTS.md]
- Architecture: HIGH — repo docs and existing direct providers define clear implementation seams. [VERIFIED: docs/providers.md] [VERIFIED: packages/server/src/server/agent/agent-sdk-types.ts]
- Pitfalls: HIGH for locked safety/auth/persistence pitfalls, MEDIUM for exact helper/file factoring. [VERIFIED: .planning/phases/02-direct-provider-core/02-CONTEXT.md] [ASSUMED]

**Research date:** 2026-06-13
**Valid until:** 2026-06-20 for Cursor SDK API details because the SDK is public beta and recently published; repo-local architecture remains valid until changed. [VERIFIED: npm registry] [ASSUMED]
