# Phase 2: Direct Provider Core - Context

**Gathered:** 2026-06-13
**Status:** Ready for planning

<domain>

## Phase Boundary

Phase 2 adds the experimental `cursor-sdk` direct provider core for local Cursor SDK agents. It owns the server-side provider/session implementation, provider availability checks, local SDK lifecycle, secret-free persistence/resume, cancellation, Sandbox/YOLO mode handling, and stream-to-Paseo timeline mapping.

This phase does not replace the existing Cursor ACP provider, add UI/manifest polish, add Cursor cloud agents, add Ask/Agent modes, build a secret store, or implement model/thinking controls beyond what the provider core needs to avoid misleading metadata.

</domain>

<decisions>

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

</decisions>

<canonical_refs>

## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project Planning

- `.planning/PROJECT.md` — project scope, key decisions, active constraints, and Cursor SDK credential location.
- `.planning/REQUIREMENTS.md` — Phase 2 requirements `PROV-01` through `PROV-05`, `MODE-01`, and `MODE-02`.
- `.planning/ROADMAP.md` — Phase 2 goal, success criteria, and planned plan split.
- `.planning/STATE.md` — current project position and accumulated decisions.
- `.planning/phases/01-sdk-viability-spike/01-CONTEXT.md` — locked Phase 1 decisions that feed Phase 2.
- `.planning/phases/01-sdk-viability-spike/01-SPIKE-RESULTS.md` — authoritative evidence: YOLO lifecycle/cancel/resume passed; Sandbox unsupported in this devcontainer; persistence/error/mode handoff.

### Provider Architecture and Repo Docs

- `docs/providers.md` — direct provider contract, provider snapshot behavior, canonical user-message timeline rule, and metadata lookup guidance.
- `docs/architecture.md` — agent provider data flow, WebSocket timeline model, and provider lifecycle placement.
- `docs/agent-lifecycle.md` — agent state, archive, and persistence lifecycle expectations.
- `docs/data-model.md` — `AgentPersistenceHandle`, agent record persistence, optional schema conventions, and `$PASEO_HOME` layout.
- `docs/custom-providers.md` — `agents.providers.<providerId>.env` provider config convention.
- `docs/testing.md` — targeted test rules and live provider test placement.

### Code Contracts and Analogs

- `packages/server/src/server/agent/agent-sdk-types.ts` — `AgentClient`, `AgentSession`, `AgentPersistenceHandle`, `AgentMode`, `AgentCapabilityFlags`, and `AgentStreamEvent` contracts.
- `packages/server/src/server/agent/provider-registry.ts` — built-in provider factory registration, runtime settings, model/mode wrapping, and custom provider isolation.
- `packages/server/src/server/agent/provider-launch-config.ts` — provider env overlay and config migration helpers.
- `packages/protocol/src/provider-manifest.ts` — provider mode visuals, `isUnattended`, and built-in provider definitions.
- `packages/server/src/server/agent/providers/claude/agent.ts` — closest direct SDK-backed provider analog for lifecycle, persistence, event mapping, diagnostics, and cleanup.
- `packages/server/src/server/agent/providers/codex-app-server-agent.ts` — sandbox/full-access safety semantics, thread persistence, cancellation, and native-handle behavior.
- `packages/server/src/server/agent/providers/opencode-agent.ts` — event translation, mode listing, and conservative tool/reasoning mapping analogs.

### Cursor SDK

- `https://cursor.com/docs/sdk/typescript` — official TypeScript SDK reference for local agents, `Agent.create`, `Agent.resume`, `Run`, `JsonlLocalAgentStore`, sandbox options, cancellation, and model APIs.

</canonical_refs>

<code_context>

## Existing Code Insights

### Reusable Assets

- `AgentClient` / `AgentSession` in `packages/server/src/server/agent/agent-sdk-types.ts`: `cursor-sdk` should implement the direct provider path, not ACP transport.
- `AgentPersistenceHandle`: use `nativeHandle` for Cursor SDK `agentId`; keep metadata secret-free and resume-focused.
- Provider runtime settings in `packages/server/src/server/agent/provider-launch-config.ts`: reuse provider env overlay semantics for `CURSOR_API_KEY` instead of inventing a credential store.
- Claude provider: closest SDK-backed lifecycle, stream, persistence, diagnostic, and cleanup analog.
- Codex and OpenCode providers: useful references for safety mode semantics, cancellation, event translation, and conservative tool mapping.

### Established Patterns

- Providers own their auth boundary and expose availability/diagnostics; tests should not add external auth gates.
- Provider snapshots should avoid creating empty native sessions for metadata. Use top-level provider APIs or side-effect-free checks.
- Every provider adapter owns exactly one canonical user-message timeline row for an accepted foreground prompt.
- Persistence handles are provider-owned and must be sufficient to resume after daemon restart without storing secrets.
- Mode safety is expressed through explicit labels, color/icon metadata, and `isUnattended`.

### Integration Points

- Add the `cursor-sdk` factory in `packages/server/src/server/agent/provider-registry.ts` without changing existing `cursor` ACP behavior.
- Add provider implementation under `packages/server/src/server/agent/providers/` using a direct `AgentClient`/`AgentSession` shape.
- Use `$PASEO_HOME/providers/cursor-sdk/stores/{paseoSessionId}` for Cursor SDK JSONL stores.
- Map SDK stream output into `AgentStreamEvent` values consumed by `AgentManager`.
- Keep UI/provider manifest polish and model/thinking feature surfacing for Phase 3 unless Phase 2 needs minimal metadata to satisfy provider core behavior.

</code_context>

<specifics>

## Specific Ideas

- Use fail-closed semantics for every safety-sensitive path: Sandbox unsupported, resume sandbox mismatch, and model/mode override failure.
- Use SDK `requestId` and `runId` as diagnostic/correlation metadata where available.
- Treat Phase 1's `01-SPIKE-RESULTS.md` as authoritative when it conflicts with older summary wording: YOLO was live-proven with a configured key; Sandbox remained unsupported in this devcontainer.

</specifics>

<deferred>

## Deferred Ideas

- Cursor SDK cloud runtime remains deferred.
- SDK `local.autoReview` remains deferred and is not a v1 mode.
- Interactive Ask/human approval remains deferred until the SDK exposes a stable host approval response path.
- Provider manifest/UI/icon/model/thinking surfacing belongs to Phase 3.
- Full hardening docs and broader targeted tests belong to Phase 4, though Phase 2 plans should still add narrow tests for newly implemented provider-core behavior.

</deferred>

---

_Phase: 2-Direct Provider Core_
_Context gathered: 2026-06-13_
