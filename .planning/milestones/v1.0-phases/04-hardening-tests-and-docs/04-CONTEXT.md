# Phase 4: Hardening, Tests, and Docs - Context

**Gathered:** 2026-06-14
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 4 closes the Cursor SDK provider milestone. It proves the already-built integration with targeted tests, updates user-facing and provider documentation, records remaining SDK beta limitations, and runs final verification. It does not add new Cursor ACP behavior, Cursor SDK MCP injection, Ask/User tools, credential storage, cloud agents, or new UI surfaces.

</domain>

<decisions>
## Implementation Decisions

### Closeout Scope

- **D-01:** Use a lean closeout: targeted tests, provider docs, planning-state updates, and final type/lint verification only.
- **D-02:** Do not implement Cursor ACP `cursor/ask_question` bridging in Phase 4. The exploration is documented, but real Cursor ACP did not expose AskQuestion in the model-visible tool list or emit the extension.
- **D-03:** Do not add MCP injection to Cursor SDK in Phase 4. The current `@cursor/sdk` integration exposes no `mcpServers`/custom-tool configuration path, and `cursor-sdk` intentionally remains `supportsMcpServers: false`.
- **D-04:** Keep Cursor SDK side-by-side with Cursor ACP. Phase 4 hardening must verify isolation instead of merging or replacing providers.

### Test Boundary

- **D-05:** Prefer deterministic unit and integration tests around provider registration, mode metadata, model/feature mapping, event mapping, persistence, and resume handles.
- **D-06:** Live Cursor SDK/API behavior should remain documented as UAT or real-smoke evidence, not a default CI gate. Normal targeted tests must not depend on external Cursor API availability, credits, model drift, or a live `CURSOR_API_KEY`.
- **D-07:** Do not run the full test suite locally. Use focused Vitest files touched by the phase plus required `npm run typecheck`, `npm run lint`, and formatting commands inside the devcontainer.

### Documentation Boundary

- **D-08:** Provider docs must explain Cursor SDK auth through `CURSOR_API_KEY`, local runtime focus, Sandbox vs YOLO semantics, and why Agent/Ask modes are omitted in v1.
- **D-09:** Docs must state Cursor SDK cannot currently receive Paseo MCP injection through this provider; Cursor ACP can receive injected MCP when daemon injection is enabled and the provider supports MCP.
- **D-10:** Final summary must call out SDK beta risk, Linux Sandbox unavailability in the current devcontainer, external auth/model discovery dependency, and v2 follow-ups for cloud runtime, custom tools/MCP, and interactive approval.

### the agent's Discretion

The planner can choose the exact test-file split and doc locations, but should keep edits narrow and reuse existing test suites. It should not create new broad E2E suites unless a specific gap cannot be covered deterministically.

</decisions>

<canonical_refs>

## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Milestone Scope

- `.planning/ROADMAP.md` - Phase 4 goal, success criteria, and planned split.
- `.planning/REQUIREMENTS.md` - Pending Phase 4 requirements: `MODE-04`, `QUAL-01`, `QUAL-02`, `QUAL-03`.
- `.planning/PROJECT.md` - Cursor SDK milestone boundary, out-of-scope items, and credential location rule.
- `.planning/STATE.md` - Current accumulated decisions and remaining blockers.

### Prior Phase Evidence

- `.planning/phases/01-sdk-viability-spike/01-SPIKE-RESULTS.md` - Live SDK lifecycle, auth, resume, and Sandbox findings.
- `.planning/phases/02-direct-provider-core/02-CONTEXT.md` - Provider lifecycle, persistence, cancellation, and event mapping decisions.
- `.planning/phases/03-manifest-and-ui-integration/03-CONTEXT.md` - Provider metadata, model/thinking/fast, and side-by-side Cursor decisions.
- `.planning/phases/03-manifest-and-ui-integration/03-VERIFICATION.md` - Phase 3 verification evidence and integration points.
- `.planning/phases/03-manifest-and-ui-integration/03-UAT.md` - Live UI and Cursor SDK metadata validation evidence.

### Project Docs

- `docs/providers.md` - Provider integration guidance and current Cursor ACP exploration notes.
- `docs/custom-providers.md` - Custom provider behavior, ACP MCP injection notes, and model/profile docs that must stay accurate.
- `docs/testing.md` - Test scope conventions and live provider smoke-test placement.
- `docs/development.md` - Devcontainer, build, and verification workflow.

</canonical_refs>

<code_context>

## Existing Code Insights

### Reusable Assets

- `packages/server/src/server/agent/providers/cursor-sdk-agent.test.ts` - Main deterministic suite for Cursor SDK client/session behavior, mode defaults, next-turn send params, diagnostics, and lifecycle.
- `packages/server/src/server/agent/providers/cursor-sdk/event-mapper.test.ts` - Focused stream/event mapping coverage.
- `packages/server/src/server/agent/providers/cursor-sdk/model-options.test.ts` - Model/context/thinking/fast encoding and decoding coverage.
- `packages/server/src/server/agent/providers/cursor-sdk/persistence.test.ts` - Resume-handle and store-path coverage.
- `packages/server/src/server/agent/provider-registry.test.ts` and `packages/protocol/src/provider-manifest.ts` - Built-in provider registration and manifest metadata.
- `packages/app/src/provider-selection/resolve-agent-form.test.ts`, `packages/app/src/composer/agent-controls/utils.test.ts`, and `packages/app/src/components/provider-icon-name.test.ts` - Existing app-side Cursor SDK selector and icon behavior coverage.

### Established Patterns

- Cursor SDK provider tests use injected runtime fakes rather than live API calls for default suites.
- Cursor SDK runtime settings read provider-config `CURSOR_API_KEY` first and process env second; tests and docs must not print or persist key values.
- Provider snapshots should avoid scratch Cursor SDK sessions for metadata; model/feature discovery uses the SDK model listing boundary.
- Cursor SDK mode support fails closed: Sandbox is visible only when a verified runtime reports support; otherwise YOLO is the effective available mode.
- Cursor SDK explicit-selection semantics must not fall back to SDK defaults for context/thinking/fast.

### Integration Points

- `packages/server/src/server/agent/providers/cursor-sdk-agent.ts` - Direct provider lifecycle, modes, features, send params, diagnostics, and runtime boundary.
- `packages/server/src/server/agent/providers/cursor-sdk/sdk-runtime.ts` - Import boundary for `@cursor/sdk`, model listing, `Agent.create`, and `Agent.resume`.
- `packages/server/src/server/agent/providers/cursor-sdk/modes.ts` - Sandbox/YOLO mode definitions and unsupported Sandbox behavior.
- `packages/server/src/server/agent/providers/cursor-sdk/model-options.ts` - SDK model parameter expansion and next-send selection.
- `packages/server/src/server/agent/providers/cursor-sdk/persistence.ts` - Non-secret persistence handle metadata.
- `packages/app/src/provider-selection/resolve-agent-form.ts` and `packages/app/src/composer/agent-controls/utils.ts` - App selection semantics that must preserve Cursor SDK explicitness.

</code_context>

<specifics>
## Specific Ideas

Use the lean closeout selected by the user: close remaining quality and documentation requirements without expanding scope into Cursor ACP AskQuestion, Cursor SDK MCP injection, or live-device packaging work.

</specifics>

<deferred>
## Deferred Ideas

- Cursor ACP native AskQuestion bridge - revisit only if Cursor ACP actually exposes the AskQuestion tool to the model or emits `cursor/ask_question`.
- Paseo MCP `ask_user` tool for Cursor ACP - viable future path, but outside Cursor SDK v1 closeout.
- Cursor SDK MCP/custom tool injection - revisit if `@cursor/sdk` exposes a stable tool or MCP configuration API.
- Cursor SDK cloud runtime - v2 follow-up after local provider lifecycle is stable.
- Interactive approval / Ask mode for Cursor SDK - revisit if Cursor SDK exposes a stable host approval response API.

</deferred>

---

_Phase: 4-Hardening, Tests, and Docs_
_Context gathered: 2026-06-14_
