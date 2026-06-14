# Phase 1: SDK Viability Spike - Context

**Gathered:** 2026-06-13
**Status:** Ready for planning

<domain>

## Phase Boundary

Phase 1 proves whether the TypeScript `@cursor/sdk` can support Paseo's local direct-provider lifecycle before implementation begins. It must validate install/import, local `Agent.create`, `agent.send`, streaming, `run.wait`, cancellation, cross-process `Agent.resume`, SDK error surfaces, mode option mapping, and provider design implications.

This phase does not implement the production provider. It produces evidence, scripts/results, and a provider design recommendation for Phase 2.

</domain>

<decisions>

## Implementation Decisions

### Real SDK Call Boundary

- **D-01:** Phase 1 may use `CURSOR_API_KEY` to run real Cursor SDK local agent calls.
- **D-02:** Real SDK calls must run in a temporary minimal git repository, not against the current Paseo checkout.
- **D-03:** The real lifecycle probe must cover `Agent.create`, `agent.send`, `run.stream`, `run.wait`, `run.cancel`, and `Agent.resume`.
- **D-04:** Each core capability gets at most two correction attempts. If it still fails, stop digging and record the error, environment, reproduction command, and provider impact.
- **D-05:** Spike scripts, logs, and conclusions belong under `.planning/phases/01-sdk-viability-spike/` so later GSD agents can read the evidence.

### Dependency Shape

- **D-06:** Phase 1 should add `@cursor/sdk` as a real dependency of `packages/server`, installed and verified through the devcontainer.
- **D-07:** The dependency change is part of the Phase 1 spike work. It should be validated together with the spike scripts/results, typecheck, and lint.
- **D-08:** Start with the repo's devcontainer install posture (`npm ci --ignore-scripts`). If SDK runtime behavior fails because required native binaries or postinstall steps are missing, record that as a Phase 1 risk and minimally verify whether lifecycle scripts are required.
- **D-09:** If Phase 1 proves `@cursor/sdk` is not suitable for the provider goal, remove the dependency and keep the spike conclusion.

### Persistence and Resume Probe

- **D-10:** Prefer a `PASEO_HOME` scoped `JsonlLocalAgentStore` for Phase 1. It is inspectable, copyable, and easier to include in spike evidence than the SDK's default SQLite store.
- **D-11:** Resume success requires cross-process context continuity: process A creates/sends/waits and saves `agentId`; process B uses the same store to `Agent.resume(agentId)` and sends a follow-up that demonstrates access to the previous conversation.
- **D-12:** The Cursor SDK provider's `AgentPersistenceHandle` should store the SDK `agentId` in `nativeHandle`.
- **D-13:** The persistence handle metadata should include at least store path, runtime, model, and mode information needed to resume correctly.
- **D-14:** The store path convention should be `${PASEO_HOME}/providers/cursor-sdk/stores/{paseoSessionId}` to keep data provider-scoped and session-scoped.

### Safety and Auth Boundary

- **D-15:** Phase 1 must explicitly probe both v1 mode mappings:
  - Sandbox: `local.sandboxOptions.enabled = true`
  - YOLO: `local.sandboxOptions.enabled = false` and `local.autoReview` not enabled
- **D-16:** `local.autoReview` is not a v1 mode. Phase 1 may document it, but it should not be treated as Ask or as part of the first provider mode set.
- **D-17:** Cursor SDK API key resolution should reuse existing Paseo provider configuration:
  - First read `$PASEO_HOME/config.json` at `agents.providers.cursor-sdk.env.CURSOR_API_KEY`
  - Then fall back to the daemon process environment variable `CURSOR_API_KEY`
- **D-18:** Do not add a new Paseo secret store or UI-managed API key flow in this phase.
- **D-19:** Phase 1 and v1 provider scope are local-runtime only. Do not run Cursor SDK cloud agents.
- **D-20:** Logs, context files, and spike results may record whether a key was present, but must never record the API key value.

### the agent's Discretion

The planner may choose exact script names, fixture prompts, and result file names inside `.planning/phases/01-sdk-viability-spike/` as long as they preserve the decisions above.

</decisions>

<canonical_refs>

## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project Planning

- `.planning/PROJECT.md` — project scope, out-of-scope items, and milestone-level decisions.
- `.planning/REQUIREMENTS.md` — Phase 1 requirements `SDK-01`, `SDK-02`, and `SDK-03`.
- `.planning/ROADMAP.md` — Phase 1 goal, success criteria, and planned split.
- `.planning/STATE.md` — current project position and accumulated decisions.

### Provider Architecture

- `packages/server/src/server/agent/agent-sdk-types.ts` — `AgentClient`, `AgentSession`, stream events, models, features, and persistence handle contracts.
- `packages/server/src/server/agent/provider-registry.ts` — built-in provider registration, runtime settings, model/mode fetch flow, and factory wiring.
- `packages/server/src/server/agent/providers/cursor-acp-agent.ts` — existing Cursor ACP behavior, model discovery fallback, and provider isolation boundary.
- `packages/server/src/server/agent/providers/claude/agent.ts` — direct SDK provider reference for lifecycle, persistence, stream mapping, features, and permission handling patterns.
- `packages/protocol/src/provider-manifest.ts` — built-in provider metadata, mode visuals, `isUnattended`, and UI-facing mode definitions.
- `packages/server/package.json` — server workspace dependency boundary where `@cursor/sdk` should be added.

### Config and Credentials

- `docs/custom-providers.md` — `$PASEO_HOME/config.json` provider env convention under `agents.providers.<providerId>.env`.
- `packages/server/src/server/agent/provider-launch-config.ts` — provider runtime env merging and existing provider env handling.

### Cursor SDK

- `https://cursor.com/docs/sdk/typescript` — Cursor SDK TypeScript reference for local runtime, auth, headless default behavior, `Run`, `Agent.resume`, `JsonlLocalAgentStore`, `sandboxOptions`, and `autoReview`.

</canonical_refs>

<code_context>

## Existing Code Insights

### Reusable Assets

- `AgentClient` / `AgentSession` contracts in `agent-sdk-types.ts`: Cursor SDK provider should implement the direct provider path, not ACP transport.
- `AgentPersistenceHandle`: use `nativeHandle` for SDK `agentId`, and metadata for store path/runtime/model/mode.
- Provider runtime env config: existing `agents.providers.<providerId>.env` can supply `CURSOR_API_KEY` without a new key store.
- Direct SDK provider reference: Claude provider shows how Paseo maps SDK messages, provider lifecycle, features, model discovery, and permission-related events.

### Established Patterns

- Built-in providers are registered through `PROVIDER_CLIENT_FACTORIES` and enriched through protocol provider manifest metadata.
- Provider snapshots should avoid creating empty native sessions when top-level metadata APIs exist.
- Mode visuals use `colorTier`, icon names, and `isUnattended` to communicate safety level.
- The repo now requires dependency install/update, validation, and dependency-backed commit hooks to run in the devcontainer.

### Integration Points

- Add `cursor-sdk` as a new built-in provider id, separate from existing `cursor` ACP support.
- Add `@cursor/sdk` to `packages/server` if Phase 1 proceeds as planned.
- Probe scripts/results should live under `.planning/phases/01-sdk-viability-spike/`.
- Future implementation should wire provider metadata through `packages/protocol/src/provider-manifest.ts` and provider factory wiring through `provider-registry.ts`.

</code_context>

<specifics>

## Specific Ideas

Use a temporary minimal git repository for real SDK calls. The scratch workspace should be disposable and should not point SDK `cwd` at the current Paseo checkout.

The resume proof should be conversation-based, not just API-based: a follow-up after `Agent.resume(agentId)` should demonstrate continuity from the first run.

</specifics>

<deferred>

## Deferred Ideas

- Cursor SDK cloud runtime remains deferred until local provider lifecycle is proven.
- `local.autoReview` can be revisited as a possible future third mode, but it is not part of v1.
- A dedicated encrypted secret store or UI-managed Cursor API key flow is out of scope for Phase 1.

</deferred>

---

_Phase: 1-SDK Viability Spike_
_Context gathered: 2026-06-13_
