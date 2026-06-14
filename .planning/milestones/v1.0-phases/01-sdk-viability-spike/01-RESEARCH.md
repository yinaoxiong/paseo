# Phase 1 Research: SDK Viability Spike

**Research date:** 2026-06-13  
**Question:** What do I need to know to PLAN this phase well?  
**Phase goal:** Produce evidence that `@cursor/sdk` can support Paseo's local direct-provider lifecycle, or document why scope must change.

## Executive Summary

Phase 1 should be planned as an evidence-producing spike, not as the first slice of the production provider. The planner needs to validate three separate contracts:

1. **Dependency/import contract:** `@cursor/sdk` must install as a real `packages/server` dependency, resolve types under the server workspace, and not destabilize existing workspace builds.
2. **Runtime lifecycle contract:** a local SDK agent must work in a Paseo-compatible Node/server environment for create, send, stream, wait, cancel, and cross-process resume.
3. **Provider design contract:** SDK state, errors, modes, auth, and stream events must map cleanly enough onto `AgentClient` / `AgentSession` for Phase 2.

The most important planning constraint is that `@cursor/sdk` import success is not enough. Official SDK docs state that import is lazy: the local executor and native stack load on first local acquire. Phase 1 must perform at least one real local SDK run inside an isolated temporary git repository.

Recommended Phase 1 outcome target: **proceed if local JSONL-backed create/send/stream/wait/cancel/resume succeeds with documented error handling and mode implications; adjust scope if sandbox, JSONL store, or cancel/resume has runtime limitations; stop if install/import or basic local send cannot work in the server workspace.**

## Inputs Read

- `.planning/phases/01-sdk-viability-spike/01-CONTEXT.md`
- `.planning/REQUIREMENTS.md`
- `.planning/STATE.md`
- `.planning/ROADMAP.md`
- `.planning/PROJECT.md`
- `/root/.cursor/skills-cursor/sdk/SKILL.md`
- `docs/development.md`
- `docs/testing.md`
- `docs/providers.md`
- `docs/custom-providers.md`
- `packages/server/AGENTS.md`
- `packages/server/src/server/agent/agent-sdk-types.ts`
- `packages/server/src/server/agent/provider-registry.ts`
- `packages/server/src/server/agent/provider-launch-config.ts`
- `packages/server/src/server/agent/providers/cursor-acp-agent.ts`
- `packages/server/src/server/agent/providers/claude/agent.ts`
- `packages/server/src/server/agent/providers/provider-runner.ts`
- `packages/protocol/src/provider-manifest.ts`
- `packages/server/package.json`
- Cursor TypeScript SDK docs at `https://cursor.com/docs/sdk/typescript`

## Planning-Relevant Decisions Already Made

These are fixed inputs for planning:

- Phase 1 may use real `CURSOR_API_KEY` calls.
- Real SDK calls must use a temporary minimal git repository, not the Paseo checkout.
- The lifecycle probe must cover `Agent.create`, `agent.send`, `run.stream`, `run.wait`, `run.cancel`, and `Agent.resume`.
- Each core capability gets at most two correction attempts before the spike records failure evidence and provider impact.
- Add `@cursor/sdk` as a real dependency of `packages/server` during Phase 1, validate it in the devcontainer, and remove it if unsuitable.
- Start from the repo's devcontainer install posture with lifecycle scripts disabled where possible; if SDK runtime needs scripts/native downloads, record the risk and minimally verify.
- Prefer `JsonlLocalAgentStore` under `${PASEO_HOME}/providers/cursor-sdk/stores/{paseoSessionId}`.
- Resume proof must be cross-process and conversation-based.
- Store the SDK `agentId` in `AgentPersistenceHandle.nativeHandle`; include store path, runtime, model, and mode metadata.
- v1 local modes are Sandbox and YOLO only:
  - Sandbox: `local.sandboxOptions.enabled = true`
  - YOLO: `local.sandboxOptions.enabled = false`, with `local.autoReview` not enabled
- `local.autoReview` may be documented but is not a v1 mode.
- API key lookup should prefer `$PASEO_HOME/config.json` at `agents.providers.cursor-sdk.env.CURSOR_API_KEY`, then fall back to daemon process `CURSOR_API_KEY`.
- Cloud agents and new credential stores are out of scope.
- Logs/results may record key presence, never key values.

## Codebase Facts That Shape the Plan

### Direct provider contract

The new provider should be planned against `AgentClient` and `AgentSession` in `agent-sdk-types.ts`. Required implementation shape for Phase 2:

- `AgentClient.createSession(config, launchContext, options)`
- `AgentClient.resumeSession(handle, overrides, launchContext)`
- `AgentClient.listModels(options)`
- `AgentClient.isAvailable()`
- Optional `listModes`, `listFeatures`, `resolveCreateConfig`, `isCreateConfigUnattended`
- `AgentSession.startTurn`, `subscribe`, `streamHistory`, `describePersistence`, `interrupt`, `close`, and `run`

`runProviderTurn` in `providers/provider-runner.ts` can be reused conceptually: a provider session can implement `startTurn`/`subscribe`, then `run()` can collect timeline events until `turn_completed`, `turn_failed`, or `turn_canceled`.

### Registry and manifest wiring

Built-ins are registered in two places:

- Server factory: `PROVIDER_CLIENT_FACTORIES` in `provider-registry.ts`
- UI/protocol metadata: `AGENT_PROVIDER_DEFINITIONS` in `provider-manifest.ts`

Provider ids are runtime strings, not a closed TypeScript union. A new built-in id `cursor-sdk` can be added without widening a static enum, but the manifest and registry must stay in sync.

Provider overrides already support `agents.providers.<providerId>.env`, so Phase 1 should plan to reuse existing runtime settings rather than invent secret storage.

### Existing Cursor ACP boundary

`cursor-acp-agent.ts` is an ACP-specific integration using `cursor-agent acp`. It already handles Cursor ACP model discovery fallback and parameterized model variants. The SDK provider should remain side-by-side and should not alter ACP behavior.

Important implication: Phase 1 should avoid copying ACP behavior assumptions into the SDK provider. ACP modes/models are discovered over protocol; SDK modes/safety are local runtime options.

### Claude as the closest direct SDK reference

`providers/claude/agent.ts` is the strongest reference for a direct SDK-style provider:

- It stores provider-native session id in `AgentPersistenceHandle.nativeHandle`.
- It stores enough original config in `metadata` to resume.
- It emits canonical submitted user timeline rows.
- It maps provider events into Paseo timeline, turn, permission, and runtime events.
- It treats cancellation as a first-class `turn_canceled` terminal event.
- It disposes provider resources in `close()`.

The Cursor SDK provider will likely be simpler than Claude for permissions, because the SDK does not expose a stable interactive approval response path for v1.

## SDK Facts That Shape the Plan

### Runtime and dependency facts

- `@cursor/sdk` is Node-first and public beta.
- Local runtime means the agent loop and filesystem access run locally; inference still goes through Cursor-hosted models.
- The SDK package has native/runtime dependencies:
  - `sqlite3` for the default local checkpoint store
  - a per-platform `@cursor/sdk--...` helper for sandboxing/ripgrep
- Importing the SDK does not eagerly load the local agent stack; first local agent creation/acquire loads more runtime code.
- Local mode requires `model`; use `Cursor.models.list()` or a known model such as `composer-2.5`, but the spike should record the actual model used.
- The SDK does not auto-discover credentials from local Cursor app login. It needs `CURSOR_API_KEY` or explicit `apiKey`.

Planning implication: validate both static import/typecheck and actual local agent creation. If `npm ci --ignore-scripts` installs but sandbox or sqlite/native helpers fail at runtime, that is a Phase 1 finding, not an implementation bug to paper over.

### Core lifecycle API facts

The TypeScript shape to validate:

- `Agent.create({ apiKey, model: { id }, local: { cwd, store, sandboxOptions } })`
- `agent.agentId` is populated immediately; local IDs are not `bc-`.
- `agent.send(prompt)` returns a `Run`.
- `run.stream()` yields `SDKMessage` events.
- `run.wait()` returns `{ status: "finished" | "error" | "cancelled", result?, requestId?, model?, durationMs? }`.
- `run.cancel()` cancels a running run; docs say `run.wait()` resolves with `status: "cancelled"`.
- `run.supports(operation)` and `run.unsupportedReason(operation)` must be checked before assuming detached/refetched run operations.
- `Agent.resume(agentId, options)` resumes by id. Local resume needs the same local store available.
- `Agent.getRun(runId, { runtime: "local", cwd })` exists, but Phase 1 only needs it if active-run reattachment becomes necessary.
- Always dispose agents: use `await agent[Symbol.asyncDispose]()` or `agent.close()`.

### Stream event facts

`run.stream()` yields normalized `SDKMessage` events. Stable envelopes:

- `system`: init metadata, optional model/tools
- `user`: prompt echo
- `assistant`: assistant content blocks, including text and tool-use blocks
- `thinking`: reasoning text
- `tool_call`: stable envelope with `call_id`, `name`, `status`; `args` and `result` are explicitly unstable and should be treated as `unknown`
- `status`: mostly cloud lifecycle
- `task`: milestones/summaries
- `request`: awaiting user input or approval

Planning implication: Phase 1 should not over-design tool argument parsing. It only needs to capture which event types appear and whether their stable envelopes can map to Paseo timeline items. Full tool detail mapping belongs later.

### Store and resume facts

The SDK supports:

- Default `SqliteLocalAgentStore`
- `JsonlLocalAgentStore`
- Custom `LocalAgentStore`

`JsonlLocalAgentStore` writes:

- `agents.ndjson`
- `runs.ndjson`
- `run_events.ndjson`
- `checkpoints.ndjson`

The same store must be passed to `Agent.create`, `Agent.resume`, and local list/get APIs. `Cursor.configure({ local: { store } })` can set a process-wide default, but a provider implementation should prefer passing the store explicitly per session to avoid cross-session leakage in a daemon.

Planning implication: the spike should create a store per Paseo session path and prove process B can resume using only `agentId`, store path, cwd, model, and mode metadata.

### Safety and mode facts

Official docs say local agents default to unrestricted headless execution:

- `local.sandboxOptions.enabled` defaults to `false`.
- There is no human-in-the-loop approval flow in headless SDK runs.
- With sandbox enabled, writes are limited to workspace/allowed paths, shell runs inside a platform sandbox, and outbound network is denied by default.
- If sandboxing is unsupported, the SDK throws `ConfigurationError`.
- `local.autoReview` is best-effort and not a security boundary; blocked calls are denied rather than escalated to a human.

Planning implication: Sandbox and YOLO are the only honest v1 modes. Phase 1 should design prompts that verify mode configuration without risking destructive behavior. A good probe asks the agent to create/read a file inside the scratch repo, then attempts a harmless outside-workspace or network action only if the planner deems it necessary and safe.

### Error facts

All SDK errors extend `CursorSdkError`, re-exported as `CursorAgentError` for compatibility. Diagnostic fields include:

- `isRetryable`
- `code`
- `status`
- `requestId`
- `endpoint`
- `operation`
- `cause`
- sometimes `helpUrl`

Important classes to plan around:

- `AuthenticationError`: missing/invalid API key
- `RateLimitError`: transient or usage cap
- `ConfigurationError`: bad model, unsupported sandbox, bad config
- `NetworkError`: backend/network failure
- `UnsupportedRunOperationError`: operation not supported by this `Run` handle
- `UnknownAgentError`: unclassified backend/runtime error

Separate error categories for Phase 1 evidence:

- **Startup/config/auth failure:** thrown by `Cursor.models.list`, `Agent.create`, `Agent.resume`, or `agent.send` before a run executes.
- **In-run failure:** `run.wait()` returns `status: "error"` or stream emits terminal failure after run creation.
- **Cancellation path:** `run.wait()` returns `status: "cancelled"` after `run.cancel()`.

## Recommended Phase 1 Plan Shape

Phase 1 should stay at two plans, matching the roadmap:

### Plan 01-01: Run and document SDK local lifecycle experiments

Deliverables:

- Add `@cursor/sdk` to `packages/server` as a real dependency.
- Add phase-local spike scripts under `.planning/phases/01-sdk-viability-spike/`, likely:
  - `scripts/check-import.ts`
  - `scripts/lifecycle-create-send-wait.ts`
  - `scripts/lifecycle-cancel.ts`
  - `scripts/lifecycle-resume-create.ts`
  - `scripts/lifecycle-resume-followup.ts`
  - or one script with subcommands if simpler.
- Use a generated scratch git repo under the phase directory or `/tmp`, with logs/results copied back into the phase directory.
- Use a redacted JSON result format that records:
  - dependency version
  - Node/npm environment
  - key presence only
  - cwd/store path
  - mode/sandbox options
  - agent id prefix
  - run id/request id
  - stream event type counts
  - terminal status/result preview
  - error class/code/status/isRetryable/requestId/operation
- Validate:
  - import/typecheck path from server workspace
  - real create/send/stream/wait
  - run cancellation and terminal cancelled status
  - process A create/send/wait/write handle, process B resume/send/wait with conversation continuity
  - Sandbox and YOLO option mapping

### Plan 01-02: Design provider state, persistence, error mapping, and mode mapping

Deliverables:

- A phase-local conclusion doc, likely `01-SPIKE-RESULTS.md`, or an appended section in research/results, with explicit recommendation: proceed / adjust / stop.
- Provider implementation guidance for Phase 2:
  - `AgentPersistenceHandle` shape
  - `CursorSdkAgentClient` / `CursorSdkAgentSession` responsibilities
  - mode mapping
  - event mapping strategy
  - error mapping strategy
  - `isAvailable()` behavior
  - model discovery behavior
  - disposal/cancel/resume behavior
- List any SDK beta limitations and how Phase 2 should gate or defer them.

## Experiment Matrix

| Experiment                             | Requirement    | Success evidence                                                                                                         | Failure impact                                                            |
| -------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| Install dependency in server workspace | SDK-01         | `packages/server/package.json` and lockfile include `@cursor/sdk`; server type import compiles                           | Stop or adjust if install/type resolution breaks workspace                |
| Static import                          | SDK-01         | `import { Agent, Cursor, JsonlLocalAgentStore } from "@cursor/sdk"` works in server TS runtime                           | Stop if package cannot be imported                                        |
| First local acquire                    | SDK-01, SDK-02 | `Agent.create` succeeds with local cwd/store/model                                                                       | Adjust if native helper/postinstall/devcontainer issue appears            |
| Auth/model probe                       | SDK-03         | Missing/bad key and/or model errors are captured as startup/config/auth failures                                         | Provider needs clear unavailable/diagnostic UX                            |
| Create/send/stream/wait                | SDK-02         | stream events observed; wait status is `finished`; final text/result captured                                            | Stop if basic local run cannot execute                                    |
| Cancellation                           | SDK-02         | `run.supports("cancel")` true or unsupported reason recorded; `run.cancel()` leads to `cancelled` or documented behavior | Provider may not support interruption or needs constrained implementation |
| Cross-process resume                   | SDK-02         | process B resumes `agentId` with same JSONL store and proves previous context continuity                                 | Provider persistence design must change if resume needs more data         |
| Sandbox mode                           | SDK-02         | `sandboxOptions.enabled=true` run succeeds or errors with documented `ConfigurationError`                                | Mode may need gating/diagnostic                                           |
| YOLO mode                              | SDK-02         | `sandboxOptions.enabled=false` run succeeds and is documented as unrestricted                                            | Required for v1 dangerous mode                                            |
| Error taxonomy                         | SDK-03         | Startup vs in-run errors captured separately with SDK fields                                                             | Phase 2 can map to `turn_failed` and diagnostics                          |

## Provider Design Implications for Phase 2

### Proposed persistence handle

Use:

```json
{
  "provider": "cursor-sdk",
  "sessionId": "<paseo-session-id>",
  "nativeHandle": "<sdk-agent-id>",
  "metadata": {
    "runtime": "local",
    "cwd": "<workspace cwd>",
    "storePath": "<PASEO_HOME>/providers/cursor-sdk/stores/<paseo-session-id>",
    "model": "<model id>",
    "modeId": "sandbox | yolo",
    "sandboxEnabled": true
  }
}
```

Do not store API key values in persistence.

### Proposed mode ids

Recommended internal ids:

- `sandbox`: label "Sandbox"; `colorTier: "safe"` or `"moderate"`; `isUnattended` false unless product wants "no prompts" reflected separately.
- `yolo`: label "YOLO"; `colorTier: "dangerous"`; `isUnattended: true`.

Do not use SDK `mode: "agent" | "plan"` as Paseo safety modes. SDK conversation mode controls planning/implementation behavior, while Paseo v1 mode requirement is about sandbox safety.

### Proposed capabilities

Initial capability assumptions to validate:

- `supportsStreaming: true`
- `supportsSessionPersistence: true`
- `supportsDynamicModes: true` if `setMode` can switch local options only before next run or by recreating session; otherwise false or limited
- `supportsMcpServers: false` for v1 unless Phase 1 explicitly proves inline MCP mapping is safe enough
- `supportsReasoningStream: true` if `thinking` events appear
- `supportsToolInvocations: true` if `tool_call` events appear

### Proposed error mapping

- SDK throw before run exists: return/emit provider availability diagnostic or `turn_failed` during `startTurn`.
- `run.wait().status === "error"`: emit `turn_failed` with SDK run id/request id in diagnostic metadata.
- `run.wait().status === "cancelled"`: emit `turn_canceled`.
- `CursorSdkError.isRetryable`: include in diagnostic text/log metadata, not as an automatic retry in v1.
- `UnsupportedRunOperationError`: guard with `run.supports()` and record unsupported reason.

## Validation Rules for the Planner

- Do not restart the main daemon on port `6767`.
- Do not run the full test suite.
- Dependency install, typecheck, lint, format, build verification, and tests must run inside the devcontainer.
- If server/package changes occur, run:
  - `npm run format:files -- <changed files>`
  - `npm run typecheck`
  - `npm run lint`
- For targeted tests, run only the changed test file, e.g. `npx vitest run <file> --bail=1`.
- If cross-package type errors appear, build the owning stack first, especially `npm run build:server`, before patching types.
- Do not add auth gates or conditional skips to tests. Live SDK probes can be scripts, not default unit tests.

## Open Questions the Plan Must Resolve

- What exact `@cursor/sdk` version is installed by npm at execution time, and does it include the expected exported names?
- Does `npm install --workspace=@getpaseo/server --ignore-scripts @cursor/sdk` produce a runtime-capable install, or does sandbox/native execution require lifecycle scripts?
- Does `JsonlLocalAgentStore` avoid `sqlite3` runtime use for the spike path, or does importing/installing still require sqlite artifacts?
- Does local sandboxing work in the devcontainer's Linux environment, including the bundled helper/bubblewrap path?
- Does `run.cancel()` reliably terminate a long-running local run in this environment, and what stream/wait sequence occurs?
- Does `Agent.resume()` require `local.store` to be passed directly, or is `Cursor.configure()` sufficient across process boundaries?
- What SDK message types appear during a minimal coding run, and are assistant/tool/thinking events enough for Phase 2 event mapping?
- Can `Cursor.models.list()` be used for provider model discovery without creating empty local SDK sessions?

## Risk Register

| Risk                             | Why it matters                                                     | Plan mitigation                                                             |
| -------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| SDK beta API drift               | Phase 2 could be planned against stale method/type names           | Capture installed version and compile spike scripts against real dependency |
| Native helper/postinstall issues | Import may pass while local runtime or sandbox fails               | Include first local acquire and sandbox probe                               |
| Devcontainer mismatch            | Project rules require dependency validation inside devcontainer    | Run dependency and verification commands only there                         |
| Auth unavailable                 | Real lifecycle cannot run without `CURSOR_API_KEY`                 | Record blocked state with key presence only and exact command needed        |
| Headless unrestricted default    | Mislabeling mode could create unsafe product behavior              | Keep Sandbox/YOLO explicit; no generic Agent mode                           |
| Resume needs more metadata       | Provider persistence could be under-specified                      | Store agent id, store path, cwd, runtime, model, mode                       |
| Tool payload instability         | Overfitting event mapper to internal args/results would be brittle | Treat tool args/results as unknown in Phase 1/2 plan                        |
| Local artifacts unsupported      | UI might assume downloadable artifacts                             | Defer artifact feature for SDK provider                                     |

## Recommendation for Planning

Plan Phase 1 as a bounded, real-runtime spike with phase-local artifacts. The first plan should prove or falsify SDK viability through scripts and redacted logs. The second plan should translate evidence into Phase 2 implementation guidance.

Do not begin production provider implementation until the spike answers:

- Can `@cursor/sdk` be a stable server dependency in this workspace?
- Can a JSONL-backed local agent be created, streamed, waited, cancelled, and resumed across processes?
- Are Sandbox and YOLO SDK options valid and honest enough for Paseo's mode model?
- Can SDK errors be mapped into Paseo diagnostics without hiding startup/config/auth failures?

If any of those answers is no, Phase 1 should conclude with **adjust scope** or **stop**, not with a partially implemented provider.

## RESEARCH COMPLETE
