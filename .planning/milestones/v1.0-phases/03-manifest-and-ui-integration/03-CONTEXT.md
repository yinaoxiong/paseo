# Phase 3: Manifest and UI Integration - Context

**Gathered:** 2026-06-13
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 3 surfaces the experimental `cursor-sdk` provider in Paseo's built-in provider metadata, app provider/model/mode controls, provider icon resolution, SDK model parameter metadata, and side-by-side UI behavior without changing the existing Cursor ACP integration.

This phase does not implement the provider lifecycle/core runtime, which Phase 2 completed. It also does not cover hardening/docs/final verification from Phase 4, Ask/Agent modes, a credential store, cloud agents, generic parameter UI for every provider, or interactive approval behavior that the Cursor SDK does not expose.

</domain>

<decisions>
## Implementation Decisions

### Provider Identity, Copy, and Icon

- **D-01:** Show `cursor-sdk` as an independent built-in provider, side by side with the existing Cursor ACP provider. Do not merge them and do not rename the existing Cursor provider.
- **D-02:** Use the user-visible label `Cursor SDK`.
- **D-03:** Reuse the Cursor brand icon for `cursor-sdk`; do not leave it on the generic `Bot` fallback.
- **D-04:** Keep the experimental status in the description only. Do not add a visible experimental badge in Phase 3.
- **D-05:** The provider description should prioritize the `CURSOR_API_KEY` requirement while preserving the experimental/direct/local SDK positioning.
- **D-06:** If the provider is unavailable because credentials or SDK metadata discovery are missing, keep it visible in diagnostics/settings surfaces but do not allow selecting it for new agent creation.

### Mode Visibility and Safety Semantics

- **D-07:** v1 exposes only `Sandbox` and `YOLO`; do not add a generic `Agent` or `Ask` mode.
- **D-08:** When the current runtime cannot support Cursor SDK Sandbox, creation and composer mode controls should show only `YOLO`.
- **D-09:** The Sandbox unsupported reason belongs in provider diagnostics/settings, not as a disabled mode in the picker.
- **D-10:** Keep mode labels exactly `Sandbox` and `YOLO`.
- **D-11:** If a future side-effect-free probe proves Sandbox support, default to `Sandbox`. In the current unsupported runtime, `YOLO` is the only visible/available mode and therefore the effective default.
- **D-12:** Dynamic provider snapshot modes should drive app controls; static manifest metadata may carry labels, descriptions, and visual treatment.

### Model Discovery and Empty/Error Behavior

- **D-13:** Model metadata for `cursor-sdk` comes from `Cursor.models.list`.
- **D-14:** Existing provider-config model metadata may enrich successful SDK discovery, but it must not mask SDK discovery failure or an empty SDK model list.
- **D-15:** A successful SDK discovery with zero models is an error for `cursor-sdk`; do not show the app's synthetic `Default` model row for this provider.
- **D-16:** If SDK model discovery errors, mark the provider unavailable for creation and use the existing selector error/retry/diagnostic path.
- **D-17:** Refresh should follow the existing provider snapshot contract: cold cwd/warm cache semantics, explicit refresh, and existing stale refetch behavior. Do not force-refresh every selector open.

### Model Parameters, Thinking, and Fast

- **D-18:** Treat SDK `ModelListItem.parameters` and `variants` as real send-time configuration metadata, not display-only metadata.
- **D-19:** Context length is represented as distinct selectable model options by combining base model plus context. Use labels like `GPT-5.5 - 1M`.
- **D-20:** For models with context values, show only explicit context variants; do not also show a bare base-model row.
- **D-21:** Do not mark or prefer an SDK default context variant. The user should see every model/context combination as a peer option.
- **D-22:** Sort combined model/context options by SDK model order, then SDK context value order.
- **D-23:** Internal model option ids must be stable and reversible back to SDK `ModelSelection` shape: `{ id: string, params?: [{ id: string, value: string }] }`.
- **D-24:** Map SDK `reasoning`, `effort`, and boolean `thinking` metadata into Paseo's existing thinking UI where a model exposes those parameters.
- **D-25:** Preserve SDK raw values per model when sending. Do not normalize values across providers.
- **D-26:** Boolean `thinking` options should display as `Thinking On` / `Thinking Off` while still sending SDK values `true` / `false`.
- **D-27:** Do not mark or prefer SDK default thinking/reasoning options. These are user selections only.
- **D-28:** Map SDK `fast` to the existing feature-toggle UI only when the selected SDK model exposes `fast`.
- **D-29:** The `fast` feature default is always off/false, even if SDK model metadata marks a fast variant as default.
- **D-30:** Model/context/reasoning/fast changes on a running agent should apply on the next turn through SDK per-send model params. Do not interrupt an in-flight turn and do not force a new session.
- **D-31:** If refreshed SDK metadata removes a selected model/context/reasoning/fast value, clear that invalid selection or preference. Do not fall back to an SDK default and do not keep stale metadata until send failure.

### the agent's Discretion

Implementation details are left to the planner/executor as long as the above behavior holds. In particular, the exact data structure for reversible combined model ids, the precise diagnostic wording, and the local test boundaries can follow existing Paseo patterns.

</decisions>

<canonical_refs>

## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project Planning

- `.planning/PROJECT.md` - Project goal, non-goals, credential location, and accepted side-by-side provider decision.
- `.planning/REQUIREMENTS.md` - Requirements mapped to Phase 3: `MODE-03`, `FEAT-01`, `FEAT-02`, `FEAT-03`, `UI-01`, `UI-02`, `UI-03`.
- `.planning/ROADMAP.md` - Phase 3 goal, success criteria, and plan split.
- `.planning/STATE.md` - Current milestone state and prior phase decisions.
- `.planning/phases/01-sdk-viability-spike/01-CONTEXT.md` - SDK viability context and local runtime assumptions.
- `.planning/phases/01-sdk-viability-spike/01-SPIKE-RESULTS.md` - Empirical SDK local runtime behavior and risks.
- `.planning/phases/02-direct-provider-core/02-CONTEXT.md` - Phase 2 decisions around provider lifecycle, modes, persistence, and stream mapping.
- `.planning/phases/02-direct-provider-core/02-RESEARCH.md` - Research backing the direct provider core implementation.

### Repository Docs

- `docs/providers.md` - End-to-end provider integration flow and provider metadata expectations.
- `docs/custom-providers.md` - Custom provider and profile behavior that must not be confused with built-in `cursor-sdk`.
- `docs/design.md` - App design tokens and icon/style conventions.
- `docs/architecture.md` - Package boundaries, provider lifecycle, WebSocket protocol, and data flow.

### Provider and SDK Contracts

- `packages/protocol/src/provider-manifest.ts` - Built-in provider metadata, default modes, model/features schema.
- `packages/protocol/src/provider-icon-names.ts` - Built-in provider icon-name allowlist; currently omits `cursor-sdk`.
- `packages/protocol/src/agent-types.ts` - Agent model, thinking, mode, and feature types used across server/app.
- `packages/server/src/server/agent/agent-sdk-types.ts` - Server-side SDK provider types and runtime option contracts.
- `packages/server/src/server/agent/provider-registry.ts` - Provider registration, built-in/config merge behavior, and provider availability semantics.
- `packages/server/src/server/agent/provider-snapshot-manager.ts` - Snapshot warmup, model/mode discovery, and error/status propagation.
- `packages/server/src/server/agent/providers/cursor-sdk-agent.ts` - Cursor SDK agent client, availability, mode, model, and feature exposure points.
- `packages/server/src/server/agent/providers/cursor-sdk/modes.ts` - Sandbox/YOLO mode list and unsupported Sandbox behavior.
- `packages/server/src/server/agent/providers/cursor-sdk/sdk-runtime.ts` - Cursor SDK import boundary, model discovery, runtime session creation, and send/resume hooks.

### App UI Integration

- `packages/app/src/components/provider-icons.ts` - Provider icon mapping and fallback behavior.
- `packages/app/src/components/provider-icon-name.ts` - Provider icon-name resolution used by the app.
- `packages/app/src/hooks/use-agent-form-state.ts` - Agent creation form state and selected provider/model/mode handling.
- `packages/app/src/hooks/use-providers-snapshot.ts` - Provider snapshot query and refresh behavior.
- `packages/app/src/provider-selection/provider-selection.ts` - Provider selection eligibility and status handling.
- `packages/app/src/provider-selection/resolve-agent-form.ts` - Agent form resolution from provider snapshots.
- `packages/app/src/components/combined-model-selector.tsx` - Existing model and thinking selector behavior, including synthetic `Default` row logic.
- `packages/app/src/hooks/use-draft-agent-features.ts` - Draft feature values and feature toggle plumbing.
- `packages/app/src/composer/agent-controls/mode-control.tsx` - Composer mode control rendering.
- `packages/app/src/composer/agent-controls/index.tsx` - Composer controls composition for mode/model/features.

### External SDK Reference

- `https://cursor.com/docs/sdk/typescript` - Official TypeScript SDK reference. Local `@cursor/sdk@1.0.18` declaration files confirmed `ModelListItem.parameters`, `ModelListItem.variants`, `ModelSelection.params`, `AgentOptions.model`, and `SendOptions.model`.

</canonical_refs>

<code_context>

## Existing Code Insights

### Reusable Assets

- `AgentProviderDefinition` / `AgentProviderModeDefinition` - Built-in provider metadata and visual mode definitions can represent Cursor SDK label/copy/mode visuals.
- `ProviderSnapshotEntry` - Existing transport for dynamic provider `models`, `modes`, `features`, and error status.
- `AgentModelDefinition.thinkingOptions` / `defaultThinkingOptionId` - Existing app path for thinking-style controls, but Phase 3 should avoid default selection for Cursor SDK thinking/reasoning values.
- `AgentFeature` / `featureValues` - Existing mechanism suitable for the SDK `fast` boolean toggle.
- `ProviderSnapshotManager` - Existing model/mode snapshot warmup and refresh behavior; should remain the discovery boundary.
- `CursorSdkRuntime` - SDK import and model discovery boundary where Cursor SDK metadata shape should be preserved.
- App provider icon resolver - Existing place to route `cursor-sdk` to the Cursor icon instead of generic fallback.
- `CombinedModelSelector`, `mode-control`, and draft feature hooks - Existing app surfaces for model/context, thinking, mode, and fast controls.

### Established Patterns

- Provider snapshots avoid creating scratch sessions for metadata. Phase 3 should use `Cursor.models.list`, not empty SDK sessions.
- The app consumes provider snapshot entries for selectable provider models and modes.
- Mode visuals can be enriched from static manifest metadata while availability comes from dynamic snapshot modes.
- Existing synthetic `Default` model-row behavior is acceptable for some providers but must not apply to `cursor-sdk` when SDK discovery succeeds with an empty list.
- Provider statuses already support visible-but-unavailable diagnostics; creation selection should remain ready-only.
- Existing Cursor ACP catalog/provider behavior must remain unchanged.

### Integration Points

- Protocol manifest: update `cursor-sdk` label/copy/default mode metadata as needed without breaking protocol parsing.
- Icon metadata: add `cursor-sdk` to provider icon-name resolution so it maps to the Cursor icon.
- Server runtime: widen Cursor SDK model metadata typing to include SDK `parameters` and `variants`.
- Server model mapping: convert SDK models plus context variants into Paseo `AgentModelDefinition` values with reversible ids.
- Server send path: decode selected combined model ids and feature/thinking values into SDK `model.params`.
- Provider registry/snapshot error semantics: treat missing/empty Cursor SDK model discovery as unavailable for creation.
- App selectors: suppress the synthetic `Default` row for `cursor-sdk` empty SDK model lists and render dynamic context/thinking/fast controls.

</code_context>

<specifics>
## Specific Ideas

### Cursor SDK Metadata Probe

A devcontainer probe called `Cursor.models.list({ apiKey })` using the local provider-config key from `.dev/paseo-home/config.json` at `agents.providers.cursor-sdk.env.CURSOR_API_KEY`. The key value was not printed or recorded. The probe initially failed because the `sqlite3` native binding was missing; `npm rebuild sqlite3` inside the devcontainer fixed the local dependency state.

The probe returned 30 models. SDK model objects include keys such as `id`, `displayName`, `description`, `aliases`, `parameters`, and `variants`.

Observed SDK TypeScript contracts:

- `ModelSelection`: `{ id: string; params?: ModelParameterValue[] }`
- `ModelParameterValue`: `{ id: string; value: string }`
- `ModelListItem`: `{ id, displayName, description?, aliases?, parameters?, variants? }`
- `AgentOptions.model?: ModelSelection`
- `SendOptions.model?: ModelSelection`

Observed model parameter metadata:

| Model            | Context values | Default context | Reasoning/thinking values                                  | Default reasoning/thinking | Fast values | Phase 3 fast default |
| ---------------- | -------------- | --------------- | ---------------------------------------------------------- | -------------------------- | ----------- | -------------------- |
| Auto             | none           | none            | none                                                       | none                       | none        | false                |
| Composer 2.5     | none           | none            | none                                                       | none                       | false, true | false                |
| Fable 5          | 300K, 1M       | 1M              | effort low, medium, high, xhigh, max; thinking false, true | high                       | none        | false                |
| Opus 4.8         | 300K, 1M       | 1M              | effort low, medium, high, xhigh, max; thinking false, true | high                       | false, true | false                |
| GPT-5.5          | 272K, 1M       | 1M              | none, low, medium, high, extra-high                        | medium                     | false, true | false                |
| Sonnet 4.6       | 200K, 1M       | 1M              | effort low, medium, high, max; thinking false, true        | medium                     | none        | false                |
| Composer 2       | none           | none            | none                                                       | none                       | false, true | false                |
| Codex 5.3        | none           | none            | low, medium, high, extra-high                              | high                       | false, true | false                |
| Opus 4.7         | 300K, 1M       | 1M              | effort low, medium, high, xhigh, max; thinking false, true | xhigh                      | false, true | false                |
| Grok Build 0.1   | 200K, 1M       | 1M              | none                                                       | none                       | none        | false                |
| GPT-5.4          | 272K, 1M       | 1M              | none, low, medium, high, extra-high                        | medium                     | false, true | false                |
| Opus 4.6         | 200K, 1M       | 1M              | effort low, medium, high, max; thinking false, true        | high                       | false, true | false                |
| Opus 4.5         | none           | none            | thinking false, true                                       | true                       | none        | false                |
| GPT-5.2          | none           | none            | low, medium, high, extra-high                              | high                       | false, true | false                |
| Gemini 3.1 Pro   | none           | none            | none                                                       | none                       | none        | false                |
| GPT-5.4 Mini     | none           | none            | none, low, medium, high, xhigh                             | medium                     | none        | false                |
| GPT-5.4 Nano     | none           | none            | none, low, medium, high, xhigh                             | medium                     | none        | false                |
| Haiku 4.5        | none           | none            | thinking false, true                                       | true                       | none        | false                |
| Grok 4.3         | 200K, 1M       | 1M              | none                                                       | none                       | none        | false                |
| Sonnet 4.5       | 200K           | 200K            | thinking false, true                                       | true                       | none        | false                |
| Codex 5.2        | none           | none            | low, medium, high, extra-high                              | high                       | false, true | false                |
| Codex 5.1 Max    | none           | none            | low, medium, high, extra-high                              | high                       | false, true | false                |
| GPT-5.1          | none           | none            | low, medium, high                                          | medium                     | none        | false                |
| Gemini 3 Flash   | none           | none            | none                                                       | none                       | none        | false                |
| Gemini 3.5 Flash | none           | none            | none                                                       | none                       | none        | false                |
| Codex 5.1 Mini   | none           | none            | low, medium, high                                          | medium                     | none        | false                |
| Sonnet 4         | 200K           | 200K            | thinking false, true                                       | false                      | none        | false                |
| GPT-5 Mini       | none           | none            | none                                                       | none                       | none        | false                |
| Gemini 2.5 Flash | none           | none            | none                                                       | none                       | none        | false                |
| Kimi K2.5        | none           | none            | none                                                       | none                       | none        | false                |

Important interpretation: SDK default context and default reasoning/thinking metadata are useful for understanding the SDK, but Phase 3 should not auto-select those defaults for context or thinking/reasoning. The `fast` feature is explicitly always off by default in Paseo.

</specifics>

<deferred>
## Deferred Ideas

None - discussion stayed within Phase 3 scope.

</deferred>

---

_Phase: 3-Manifest and UI Integration_
_Context gathered: 2026-06-13_
