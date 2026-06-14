# Phase 03: Manifest and UI Integration - Research

**Researched:** 2026-06-13  
**Domain:** Paseo provider manifest, provider snapshots, Cursor SDK model metadata, Expo composer controls  
**Confidence:** HIGH

<user_constraints>

## User Constraints (from CONTEXT.md)

Source: `.planning/phases/03-manifest-and-ui-integration/03-CONTEXT.md` [VERIFIED: codebase grep]

### Locked Decisions

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

### Deferred Ideas (OUT OF SCOPE)

## Deferred Ideas

None - discussion stayed within Phase 3 scope.
</user_constraints>

## Summary

Phase 03 should be planned as a protocol/server/app integration phase, not as a new provider runtime build. Phase 02 already registered the direct `cursor-sdk` runtime, exposes Sandbox/YOLO mode plumbing, calls `Cursor.models.list`, and wires basic availability diagnostics; Phase 03 needs to surface that provider through manifest copy, icon resolution, snapshot-derived mode/model metadata, composer controls, and side-by-side UI behavior with existing Cursor ACP unchanged. [VERIFIED: `.planning/STATE.md`; VERIFIED: `packages/server/src/server/agent/providers/cursor-sdk-agent.ts`; VERIFIED: `packages/server/src/server/agent/provider-registry.ts`]

The high-risk work is model metadata, not provider registration. The current Cursor SDK model mapping drops SDK `parameters` and `variants`, send-time options only pass `{ model: { id } }`, and app form resolution auto-selects default or first thinking options, which conflicts with the Phase 03 decision that SDK context and thinking values are peer user selections with no preferred default. [VERIFIED: `packages/server/src/server/agent/providers/cursor-sdk-agent.ts`; VERIFIED: `packages/app/src/provider-selection/resolve-agent-form.ts`; VERIFIED: `.planning/phases/03-manifest-and-ui-integration/03-CONTEXT.md`]

**Primary recommendation:** implement Phase 03 through three narrow plans: manifest/icon/mode metadata, Cursor SDK model-parameter snapshot and send-option mapping, then side-by-side app verification for `cursor` ACP and `cursor-sdk`. [VERIFIED: `.planning/ROADMAP.md`; VERIFIED: codebase grep]

## Architectural Responsibility Map

| Capability                                                          | Primary Tier | Secondary Tier | Rationale                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------- | ------------ | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Built-in provider label, description, mode labels, and mode visuals | Protocol     | App            | Provider definitions and static mode visuals live in `packages/protocol/src/provider-manifest.ts`; the app consumes those definitions for picker and composer labels. [VERIFIED: `packages/protocol/src/provider-manifest.ts`; VERIFIED: `packages/app/src/utils/provider-definitions.ts`]                                                                                                 |
| Cursor brand icon for `cursor-sdk`                                  | App          | Protocol       | Protocol icon-name allowlists influence recognized ids, but the app resolver decides whether a provider renders a built-in component, catalog SVG, or Bot fallback. [VERIFIED: `packages/protocol/src/provider-icon-names.ts`; VERIFIED: `packages/app/src/components/provider-icon-name.ts`; VERIFIED: `packages/app/src/components/provider-icons.ts`]                                   |
| Runtime mode availability                                           | Server       | Protocol/App   | `CursorSdkAgentClient.listModes` and `listCursorSdkModes` determine whether Sandbox appears; static manifest metadata should only enrich visuals. [VERIFIED: `packages/server/src/server/agent/providers/cursor-sdk-agent.ts`; VERIFIED: `packages/server/src/server/agent/providers/cursor-sdk/modes.ts`; VERIFIED: `docs/providers.md`]                                                  |
| Model/context/thinking/fast discovery                               | Server       | External SDK   | Cursor SDK metadata should enter through `Cursor.models.list` and provider snapshots, then be consumed by existing app controls. [CITED: https://cursor.com/docs/sdk/typescript; VERIFIED: `docs/providers.md`; VERIFIED: `packages/server/src/server/agent/provider-snapshot-manager.ts`]                                                                                                 |
| Creation eligibility and unavailable diagnostics                    | Server       | App            | Snapshot entries carry ready/error/loading status; the app already keeps loading/error providers visible while only ready providers are selectable for creation. [VERIFIED: `packages/server/src/server/agent/provider-snapshot-manager.ts`; VERIFIED: `packages/app/src/provider-selection/resolve-agent-form.ts`; VERIFIED: `packages/app/src/provider-selection/provider-selection.ts`] |
| Running-agent next-turn parameter changes                           | Server       | App            | App controls send model/thinking/feature mutations; the session must store them and build SDK `SendOptions.model` on the next user turn. [VERIFIED: `packages/server/src/server/agent/agent-manager.ts`; VERIFIED: `packages/server/src/server/agent/providers/cursor-sdk-agent.ts`]                                                                                                       |
| Side-by-side Cursor ACP preservation                                | Server/App   | Protocol       | `cursor` ACP and `cursor-sdk` have separate provider ids and factories; planner must avoid shared edits that collapse their icon/config/model behavior. [VERIFIED: `packages/server/src/server/agent/provider-registry.ts`; VERIFIED: `docs/custom-providers.md`]                                                                                                                          |

<phase_requirements>

## Phase Requirements

| ID      | Description                                                                                                       | Research Support                                                                                                                                                                                                                                                                                                                                                                    |
| ------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MODE-03 | Cursor SDK v1 should expose only Sandbox/YOLO and hide unsupported Sandbox from creation controls.                | `CURSOR_SDK_MODES` already contains only Sandbox/YOLO, and `listCursorSdkModes` returns YOLO only when Sandbox support is false; app controls consume snapshot modes when present. [VERIFIED: `packages/protocol/src/provider-manifest.ts`; VERIFIED: `packages/server/src/server/agent/providers/cursor-sdk/modes.ts`; VERIFIED: `packages/app/src/hooks/use-agent-form-state.ts`] |
| FEAT-01 | Model metadata should come from `Cursor.models.list`.                                                             | Runtime `listModels` already calls `Cursor.models.list({ apiKey })`, but Phase 03 must preserve SDK parameter and variant metadata instead of dropping it. [CITED: https://cursor.com/docs/sdk/typescript; VERIFIED: `packages/server/src/server/agent/providers/cursor-sdk/sdk-runtime.ts`; VERIFIED: `packages/server/src/server/agent/providers/cursor-sdk-agent.ts`]            |
| FEAT-02 | SDK parameters, context variants, thinking, and fast should reach app controls and send-time SDK options.         | Existing Paseo types have `thinkingOptions` and `AgentFeature`; session send options currently pass only model id, so Phase 03 must add reversible model option decoding and param assembly. [VERIFIED: `packages/protocol/src/agent-types.ts`; VERIFIED: `packages/server/src/server/agent/providers/cursor-sdk-agent.ts`]                                                         |
| FEAT-03 | Metadata discovery should avoid scratch sessions.                                                                 | `AgentManager.listDraftFeatures` uses `client.listFeatures` when available and otherwise creates a scratch session; Cursor SDK should implement `listFeatures` to keep discovery side-effect-free. [VERIFIED: `packages/server/src/server/agent/agent-manager.ts`; VERIFIED: `docs/providers.md`]                                                                                   |
| UI-01   | Built-in provider metadata should show clear experimental Cursor SDK copy.                                        | `cursor-sdk` already has a manifest entry, but its description should be updated to prioritize `CURSOR_API_KEY` and direct/local experimental positioning. [VERIFIED: `packages/protocol/src/provider-manifest.ts`; VERIFIED: `.planning/phases/03-manifest-and-ui-integration/03-CONTEXT.md`]                                                                                      |
| UI-02   | Provider selection, composer controls, icon/name/mode/model/thinking surfaces should render Cursor SDK correctly. | Existing app surfaces are `provider-icon-name`, `combined-model-selector`, `resolve-agent-form`, draft feature hooks, and composer agent controls; Phase 03 should extend those paths rather than build new UI. [VERIFIED: codebase grep]                                                                                                                                           |
| UI-03   | Existing Cursor ACP behavior must remain unchanged.                                                               | Cursor ACP remains `cursor`, uses ACP catalog behavior, and is registered separately from `cursor-sdk`; tests should assert both providers appear independently. [VERIFIED: `packages/server/src/server/agent/provider-registry.ts`; VERIFIED: `docs/custom-providers.md`]                                                                                                          |

</phase_requirements>

## Project Constraints (from AGENTS.md)

- `docs/` is the repository source of truth for system and process knowledge; research used local docs before external docs. [VERIFIED: `AGENTS.md`]
- Dependency-backed commands, formatting, linting, typechecking, tests, and builds must run inside the devcontainer for this checkout. [VERIFIED: `AGENTS.md`; VERIFIED: `.devcontainer/devcontainer.json`]
- Do not run broad local test suites; run only targeted files with `npx vitest run <file> --bail=1`, and use CI for full-suite confidence. [VERIFIED: `AGENTS.md`; VERIFIED: `docs/testing.md`]
- Always run `npm run format`, `npm run typecheck`, and `npm run lint` after implementation changes, inside the devcontainer. [VERIFIED: `AGENTS.md`]
- Use npm scripts for linting and formatting; do not call `oxlint`, `oxfmt`, or `eslint` directly. [VERIFIED: `AGENTS.md`]
- Build workspace declaration stacks before diagnosing cross-package type errors, especially `npm run build:client` for protocol/client changes and `npm run build:server` for server/CLI changes. [VERIFIED: `AGENTS.md`; VERIFIED: `docs/development.md`]
- Protocol changes must remain backward-compatible: new fields optional, removed fields still accepted, no optional-to-required flips, no type narrowing, and new RPCs use dotted namespaces with direction suffixes. [VERIFIED: `AGENTS.md`; VERIFIED: `docs/rpc-namespacing.md`]
- New feature behavior may require a new daemon capability, but Phase 03 should not add scattered fallback paths that simulate missing server capabilities. [VERIFIED: `AGENTS.md`]
- Do not restart the main Paseo daemon on port 6767 without permission. [VERIFIED: `AGENTS.md`]
- The Cursor API key may exist in local dev provider config, but research and tests must not record or print the secret value. [VERIFIED: `.planning/PROJECT.md`; VERIFIED: `AGENTS.md`]

## Standard Stack

### Core

| Library              | Version                                                       | Purpose                                                                                 | Why Standard                                                                                                                                                                                                                                   |
| -------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@cursor/sdk`        | `^1.0.18` declared; npm latest `1.0.18`, published 2026-06-05 | Cursor local SDK runtime, `Cursor.models.list`, and SDK send-time `model` options       | Existing Phase 02 server dependency; official Cursor TypeScript SDK docs identify this package. [VERIFIED: `packages/server/package.json`; VERIFIED: npm registry; CITED: https://cursor.com/docs/sdk/typescript]                              |
| `@getpaseo/protocol` | `0.1.96`                                                      | Shared provider manifest, provider icon-name allowlists, agent model/mode/feature types | Existing workspace contract used by server and app; protocol compatibility rules apply. [VERIFIED: `packages/protocol/package.json`; VERIFIED: `packages/protocol/src/provider-manifest.ts`; VERIFIED: `packages/protocol/src/agent-types.ts`] |
| `@getpaseo/server`   | `0.1.96`                                                      | Provider registry, provider snapshots, Cursor SDK session runtime                       | Server owns provider lifecycle and discovery boundaries. [VERIFIED: `packages/server/package.json`; VERIFIED: `docs/architecture.md`]                                                                                                          |
| `packages/app`       | `0.1.96`                                                      | Expo app provider selection, composer controls, icon rendering                          | Existing selectors and composer controls already cover provider/model/mode/thinking/feature UI. [VERIFIED: `packages/app/package.json`; VERIFIED: codebase grep]                                                                               |
| `vitest`             | `^4.1.6`                                                      | Focused unit tests for server, protocol, and app helpers                                | Existing test framework and repo testing docs require targeted file runs. [VERIFIED: `package.json`; VERIFIED: `docs/testing.md`]                                                                                                              |

### Supporting

| Library                   | Version                       | Purpose                                         | When to Use                                                                                                                                                      |
| ------------------------- | ----------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `zod`                     | Existing workspace dependency | Schema validation for protocol/server data      | Use existing protocol schemas and optional metadata fields rather than ad hoc unchecked wire shapes. [VERIFIED: `packages/protocol/src/agent-types.ts`; ASSUMED] |
| React Query via app hooks | Existing app dependency       | Provider snapshot fetching and refresh behavior | Keep `useProvidersSnapshot` stale/cold/warm behavior; do not force refresh on selector open. [VERIFIED: `packages/app/src/hooks/use-providers-snapshot.ts`]      |
| Existing UI primitives    | Existing app code             | Buttons, selectors, dropdowns, mode controls    | Use existing controls instead of custom provider/modal widgets. [VERIFIED: `docs/design.md`; VERIFIED: codebase grep]                                            |

### Alternatives Considered

| Instead of                                        | Could Use                               | Tradeoff                                                                                                                                                                                                            |
| ------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Cursor.models.list`                              | Static hard-coded model list            | Static lists would quickly drift and violate the locked SDK-source decision. [CITED: https://cursor.com/docs/sdk/typescript; VERIFIED: `.planning/phases/03-manifest-and-ui-integration/03-CONTEXT.md`]             |
| Provider snapshot `listModels`/`listFeatures`     | Scratch SDK sessions for draft metadata | Scratch sessions can create empty/native session side effects and are explicitly discouraged by Paseo provider docs. [VERIFIED: `docs/providers.md`; VERIFIED: `packages/server/src/server/agent/agent-manager.ts`] |
| Existing combined selector and composer controls  | New Cursor-specific UI surface          | New UI would duplicate existing provider/model/thinking/feature behavior and increase side-by-side regression risk. [VERIFIED: codebase grep; VERIFIED: `docs/design.md`]                                           |
| Metadata-packed reversible ids plus helper decode | String splitting by delimiter           | SDK ids and values are external strings; structured encoding avoids delimiter collisions and keeps send-time decode testable. [ASSUMED]                                                                             |

**Installation:**

```bash
# No new packages should be installed for Phase 03.
# @cursor/sdk is already declared by packages/server.
```

**Version verification:**

```bash
npm view @cursor/sdk version time dist-tags repository scripts.postinstall --json
node -p 'require("./packages/server/package.json").dependencies["@cursor/sdk"]'
node -p 'require("./packages/protocol/package.json").version'
node -p 'require("./packages/server/package.json").version'
node -p 'require("./packages/app/package.json").version'
```

## Package Legitimacy Audit

> Phase 03 should not install new packages. This audit records the existing Cursor SDK dependency because the phase depends on it. [VERIFIED: `packages/server/package.json`]

| Package       | Registry | Age                                   | Downloads                                            | Source Repo                | Verdict      | Disposition                                                                                                                                                                                                |
| ------------- | -------- | ------------------------------------- | ---------------------------------------------------- | -------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@cursor/sdk` | npm      | Created 2026-04-26; latest 2026-06-05 | 283,374 weekly downloads reported by legitimacy seam | `github.com/cursor/cursor` | SUS: too-new | Already present; approved for use in current lockfile, but planner should add a human checkpoint before any version change. [VERIFIED: npm registry; VERIFIED: `gsd-tools query package-legitimacy check`] |

**Packages removed due to [SLOP] verdict:** none. [VERIFIED: `gsd-tools query package-legitimacy check`]  
**Packages flagged as suspicious [SUS]:** `@cursor/sdk` if Phase 03 changes its installed version. [VERIFIED: `gsd-tools query package-legitimacy check`]

## Architecture Patterns

### System Architecture Diagram

```text
App provider/model/composer UI
  -> useProvidersSnapshot(provider,cwd)
  -> WebSocket provider snapshot request
  -> Server ProviderSnapshotManager
       -> ProviderRegistry entry: cursor-sdk
       -> CursorSdkAgentClient.isAvailable()
       -> CursorSdkAgentClient.listModes()
            -> CursorSdkRuntime.checkSandboxSupport()
            -> listCursorSdkModes(): YOLO only now, Sandbox+YOLO when support is proven
       -> CursorSdkAgentClient.listModels()
            -> Cursor.models.list({ apiKey })
            -> expand SDK models into stable Paseo model options
       -> snapshot entry: label, description, ready/error, models, modes
  -> App combined selector + mode/thinking/feature controls
       -> only ready providers selectable for creation
       -> unavailable providers visible with retry/diagnostic affordances

Running agent controls
  -> agent.setModel / setThinkingOption / setFeature
  -> CursorSdkAgentSession stores selected model option and param values
  -> next user turn
  -> buildSendOptions()
       -> decode model option id
       -> add context/reasoning/thinking/fast params
       -> Cursor SDK send/resume with SendOptions.model
```

### Recommended Project Structure

```text
packages/protocol/src/
├── provider-manifest.ts          # cursor-sdk label/copy/static mode visuals
├── provider-icon-names.ts        # icon-name recognition, if protocol needs alias metadata
└── agent-types.ts                # only optional metadata additions if unavoidable

packages/server/src/server/agent/
├── provider-registry.ts          # cursor-sdk built-in entry and model merge semantics
├── provider-snapshot-manager.ts  # preserve cold/warm/error behavior
└── providers/cursor-sdk/
    ├── sdk-runtime.ts            # widen SDK model metadata shape from Cursor.models.list
    ├── modes.ts                  # YOLO-only when Sandbox unsupported
    └── model-options.ts          # recommended helper for expand/decode/send params

packages/app/src/
├── components/provider-icon-name.ts       # map cursor-sdk to Cursor brand icon
├── components/provider-icons.ts           # keep icon resolver from falling back to Bot
├── provider-selection/resolve-agent-form.ts
├── provider-selection/provider-selection.ts
├── hooks/use-agent-form-state.ts
├── hooks/use-draft-agent-features.ts
└── composer/agent-controls/              # existing mode/model/thinking/feature controls
```

### Pattern 1: Dynamic Modes Own Availability

**What:** Keep `Sandbox` and `YOLO` in static manifest for labels and visuals, but let `CursorSdkAgentClient.listModes` decide which modes appear in provider snapshots. [VERIFIED: `packages/protocol/src/provider-manifest.ts`; VERIFIED: `packages/server/src/server/agent/providers/cursor-sdk/modes.ts`; VERIFIED: `docs/providers.md`]

**When to use:** Always for `cursor-sdk`, because current production Sandbox support is intentionally unsupported until a side-effect-free probe exists. [VERIFIED: `packages/server/src/server/agent/providers/cursor-sdk/sdk-runtime.ts`; VERIFIED: `.planning/STATE.md`]

**Example:**

```typescript
// Source: packages/server/src/server/agent/providers/cursor-sdk/modes.ts
// Planner should preserve this shape and test both supported and unsupported branches.
export function listCursorSdkModes(sandboxSupport: CursorSdkSandboxSupport): AgentMode[] {
  if (!sandboxSupport.supported) {
    return [CURSOR_SDK_YOLO_MODE];
  }
  return [CURSOR_SDK_SANDBOX_MODE, CURSOR_SDK_YOLO_MODE];
}
```

### Pattern 2: Expand SDK Models Into Reversible Paseo Options

**What:** Add a server helper that converts each SDK `ModelListItem` into one or more `AgentModelDefinition` rows. Models with context values should emit one row per context value and no bare base row; models without context values emit one base row. [VERIFIED: `.planning/phases/03-manifest-and-ui-integration/03-CONTEXT.md`; CITED: https://cursor.com/docs/sdk/typescript]

**When to use:** Use during `CursorSdkAgentClient.listModels`, before provider snapshots reach the app. [VERIFIED: `packages/server/src/server/agent/providers/cursor-sdk-agent.ts`; VERIFIED: `packages/server/src/server/agent/provider-snapshot-manager.ts`]

**Example:**

```typescript
// Source: recommended Phase 03 helper, based on SDK ModelSelection.
type CursorSdkModelSelection = {
  id: string;
  params?: Array<{ id: string; value: string }>;
};

export function encodeCursorSdkModelOptionId(selection: CursorSdkModelSelection): string {
  return `cursor-sdk:${Buffer.from(JSON.stringify(selection)).toString("base64url")}`;
}

export function decodeCursorSdkModelOptionId(optionId: string): CursorSdkModelSelection {
  if (!optionId.startsWith("cursor-sdk:")) {
    return { id: optionId };
  }
  return JSON.parse(
    Buffer.from(optionId.slice("cursor-sdk:".length), "base64url").toString("utf8"),
  );
}
```

**Planner note:** validate decoded ids against the latest discovered SDK metadata before send or before accepting a persisted preference, so stale or tampered param values are cleared instead of sent. [VERIFIED: `.planning/phases/03-manifest-and-ui-integration/03-CONTEXT.md`; ASSUMED]

### Pattern 3: Existing Thinking and Feature Surfaces, No Implicit SDK Defaults

**What:** Map SDK `reasoning`, `effort`, and boolean `thinking` metadata to `AgentModelDefinition.thinkingOptions`; map SDK `fast` to existing `AgentFeature` toggle only for selected models that expose fast. [VERIFIED: `.planning/phases/03-manifest-and-ui-integration/03-CONTEXT.md`; VERIFIED: `packages/protocol/src/agent-types.ts`]

**When to use:** Thinking options belong on model definitions; fast belongs in `CursorSdkAgentClient.listFeatures(config)` so `AgentManager.listDraftFeatures` does not create a scratch session. [VERIFIED: `packages/server/src/server/agent/agent-manager.ts`; VERIFIED: `packages/app/src/hooks/use-draft-agent-features.ts`]

**Critical detail:** existing app form utilities choose `defaultThinkingOptionId` or the first thinking option when no requested value exists; Phase 03 must add a `cursor-sdk` guard or metadata flag so SDK thinking/reasoning remains unset until the user selects it. [VERIFIED: `packages/app/src/provider-selection/resolve-agent-form.ts`; VERIFIED: `packages/app/src/composer/agent-controls/utils.ts`; VERIFIED: `.planning/phases/03-manifest-and-ui-integration/03-CONTEXT.md`]

### Pattern 4: Running Agent Changes Apply On Next Turn

**What:** `setModel`, `setThinkingOption`, and `setFeature` should update session state and runtime info; `buildSendOptions` should assemble SDK `ModelSelection` with params on the next send. [VERIFIED: `packages/server/src/server/agent/agent-manager.ts`; VERIFIED: `packages/server/src/server/agent/providers/cursor-sdk-agent.ts`]

**When to use:** Always for running `cursor-sdk` agents; do not interrupt an in-flight turn and do not create a new session for model/context/reasoning/fast changes. [VERIFIED: `.planning/phases/03-manifest-and-ui-integration/03-CONTEXT.md`]

### Anti-Patterns to Avoid

- **Adding `Agent` or `Ask` modes:** Phase 03 explicitly limits v1 to Sandbox and YOLO. [VERIFIED: `.planning/phases/03-manifest-and-ui-integration/03-CONTEXT.md`]
- **Letting static manifest modes override snapshot modes:** This would show unsupported Sandbox when the runtime only supports YOLO. [VERIFIED: `docs/providers.md`; VERIFIED: `packages/server/src/server/agent/providers/cursor-sdk/modes.ts`]
- **Provider-config models replacing failed SDK discovery:** Current registry merge behavior can replace runtime models when profile models are non-additive; `cursor-sdk` needs SDK success first, with provider-config data only as enrichment. [VERIFIED: `packages/server/src/server/agent/provider-registry.ts`; VERIFIED: `.planning/phases/03-manifest-and-ui-integration/03-CONTEXT.md`]
- **Showing synthetic `Default` for empty SDK models:** Existing app selection code builds a synthetic default row for empty model arrays; `cursor-sdk` empty discovery must become an unavailable/error provider state instead. [VERIFIED: `packages/app/src/provider-selection/provider-selection.ts`; VERIFIED: `.planning/phases/03-manifest-and-ui-integration/03-CONTEXT.md`]
- **Adding `cursor-sdk` to a builtin icon allowlist without an icon component:** The app builtin icon map does not currently include a Cursor component, so this can produce a missing icon instead of the catalog Cursor SVG. [VERIFIED: `packages/protocol/src/provider-icon-names.ts`; VERIFIED: `packages/app/src/components/provider-icons.ts`; VERIFIED: `packages/app/src/components/provider-icon-name.ts`]
- **Changing Cursor ACP behavior while fixing Cursor SDK:** Existing `cursor` is an ACP provider and must remain separate from `cursor-sdk`. [VERIFIED: `packages/server/src/server/agent/provider-registry.ts`; VERIFIED: `docs/custom-providers.md`]

## Don't Hand-Roll

| Problem                      | Don't Build                                       | Use Instead                                                                            | Why                                                                                                                                                                                                                                                                  |
| ---------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cursor SDK model discovery   | Static model catalog or config-only model list    | `Cursor.models.list({ apiKey })` through `CursorSdkRuntime.listModels`                 | Official SDK exposes model ids and params; Phase 03 requires SDK metadata as source of truth. [CITED: https://cursor.com/docs/sdk/typescript; VERIFIED: `.planning/phases/03-manifest-and-ui-integration/03-CONTEXT.md`]                                             |
| Snapshot caching and refresh | Custom selector-open refresh loop                 | Existing `ProviderSnapshotManager` and `useProvidersSnapshot` cold/warm/stale behavior | Repo docs define explicit refresh and warn against unnecessary provider process churn. [VERIFIED: `docs/providers.md`; VERIFIED: `packages/app/src/hooks/use-providers-snapshot.ts`]                                                                                 |
| Model/context selector UI    | New Cursor-only selector                          | Existing `CombinedModelSelector` rows and provider selection helpers                   | Existing UI already handles provider grouping, errors, retry, and settings affordances. [VERIFIED: `packages/app/src/components/combined-model-selector.tsx`]                                                                                                        |
| Thinking UI                  | New reasoning dropdown                            | Existing `thinkingOptions` path with no implicit SDK defaults                          | Existing app controls render thinking options, but need provider-specific no-auto-pick behavior. [VERIFIED: `packages/protocol/src/agent-types.ts`; VERIFIED: `packages/app/src/provider-selection/resolve-agent-form.ts`]                                           |
| Fast toggle                  | Cursor-specific custom switch                     | Existing `AgentFeature` toggle and `featureValues`                                     | Existing draft feature hooks prune invalid values and drive composer feature controls. [VERIFIED: `packages/protocol/src/agent-types.ts`; VERIFIED: `packages/app/src/hooks/use-draft-agent-features.ts`; VERIFIED: `packages/app/src/hooks/feature-preferences.ts`] |
| Icon rendering               | New SVG/import path if catalog already has Cursor | Existing provider icon resolver with a `cursor-sdk` to Cursor catalog alias            | Existing Cursor ACP already uses the Cursor catalog identity. [VERIFIED: `packages/app/src/components/provider-icon-name.ts`; VERIFIED: `packages/app/src/components/provider-icons.ts`]                                                                             |

**Key insight:** Phase 03 should adapt Cursor SDK metadata into existing Paseo provider snapshot contracts; custom UI or custom lifecycle paths would duplicate behavior that the app already centralizes. [VERIFIED: `docs/providers.md`; VERIFIED: codebase grep]

## Common Pitfalls

### Pitfall 1: Icon Allowlist Without App Icon Mapping

**What goes wrong:** `cursor-sdk` is recognized as a provider name but resolves to no rendered icon or still falls back to Bot. [VERIFIED: `packages/protocol/src/provider-icon-names.ts`; VERIFIED: `packages/app/src/components/provider-icons.ts`]

**Why it happens:** Protocol builtin icon names and app icon component maps are separate; existing Cursor icon behavior comes from catalog resolution for `cursor`. [VERIFIED: `packages/app/src/components/provider-icon-name.ts`]

**How to avoid:** Add a tested `cursor-sdk` alias that resolves to the existing Cursor catalog icon, or add a real built-in Cursor icon component and tests. Prefer the alias because D-03 says reuse the Cursor brand icon. [VERIFIED: `.planning/phases/03-manifest-and-ui-integration/03-CONTEXT.md`; ASSUMED]

**Warning signs:** `provider-icon-name.test.ts` fails or visual rows show the generic Bot icon. [VERIFIED: `packages/app/src/components/provider-icon-name.test.ts`]

### Pitfall 2: Empty SDK Model List Becomes `Default`

**What goes wrong:** A ready `cursor-sdk` snapshot with `models: []` causes the app to show the synthetic `Default` model row. [VERIFIED: `packages/app/src/provider-selection/provider-selection.ts`]

**Why it happens:** `buildModelSelection` creates a `Default` row for any empty model array. [VERIFIED: `packages/app/src/provider-selection/provider-selection.ts`]

**How to avoid:** Server-side: treat successful zero SDK models as provider error/unavailable. App-side: add a focused regression test so `cursor-sdk` cannot display the synthetic row if an empty array slips through. [VERIFIED: `.planning/phases/03-manifest-and-ui-integration/03-CONTEXT.md`; ASSUMED]

**Warning signs:** Combined selector shows `Default` under Cursor SDK, or creation is possible with an empty model id. [VERIFIED: `packages/app/src/components/combined-model-selector.tsx`; VERIFIED: `packages/app/src/provider-selection/provider-selection.ts`]

### Pitfall 3: Provider-Config Models Mask SDK Failure

**What goes wrong:** Configured model metadata makes `cursor-sdk` look ready after `Cursor.models.list` fails or returns zero models. [VERIFIED: `packages/server/src/server/agent/provider-registry.ts`; VERIFIED: `.planning/phases/03-manifest-and-ui-integration/03-CONTEXT.md`]

**Why it happens:** Generic registry model merging can replace runtime models with profile models when profile models are non-additive. [VERIFIED: `packages/server/src/server/agent/provider-registry.ts`]

**How to avoid:** Add a `cursor-sdk`-specific discovery rule: SDK discovery must succeed and return at least one model before config metadata is used as enrichment. [VERIFIED: `.planning/phases/03-manifest-and-ui-integration/03-CONTEXT.md`; ASSUMED]

**Warning signs:** Tests can make `Cursor.models.list` throw while configured models still produce a ready snapshot. [ASSUMED]

### Pitfall 4: Thinking Defaults Are Auto-Selected

**What goes wrong:** Selecting a model with SDK reasoning/thinking metadata immediately sets the first or default thinking option, causing Paseo to send a param the user did not choose. [VERIFIED: `packages/app/src/provider-selection/resolve-agent-form.ts`; VERIFIED: `packages/app/src/composer/agent-controls/utils.ts`]

**Why it happens:** Existing form utilities are built for providers where a default thinking option is acceptable. [VERIFIED: `packages/app/src/provider-selection/resolve-agent-form.ts`]

**How to avoid:** Do not set `defaultThinkingOptionId` for Cursor SDK models, and add provider-aware no-implicit-thinking logic so blank remains blank until user selection. [VERIFIED: `.planning/phases/03-manifest-and-ui-integration/03-CONTEXT.md`; ASSUMED]

**Warning signs:** Form reducer tests show `thinkingOptionId` populated after choosing a Cursor SDK model with no prior user selection. [VERIFIED: `packages/app/src/provider-selection/resolve-agent-form.test.ts`]

### Pitfall 5: Draft Feature Discovery Creates Scratch Sessions

**What goes wrong:** Opening controls or switching draft model creates an SDK session just to discover `fast`. [VERIFIED: `packages/server/src/server/agent/agent-manager.ts`]

**Why it happens:** `AgentManager.listDraftFeatures` falls back to scratch session creation when a provider client lacks `listFeatures`. [VERIFIED: `packages/server/src/server/agent/agent-manager.ts`]

**How to avoid:** Implement `CursorSdkAgentClient.listFeatures(config)` and compute `fast` from the selected decoded model metadata. [VERIFIED: `docs/providers.md`; ASSUMED]

**Warning signs:** Cursor SDK tests need to instantiate a session just to list draft features. [ASSUMED]

### Pitfall 6: Send-Time Params Are Lost

**What goes wrong:** UI selections for context, reasoning, thinking, or fast display correctly but are not sent to Cursor SDK. [VERIFIED: `packages/server/src/server/agent/providers/cursor-sdk-agent.ts`]

**Why it happens:** Current `buildSendOptions` only returns `{ model: { id: this.model } }`. [VERIFIED: `packages/server/src/server/agent/providers/cursor-sdk-agent.ts`]

**How to avoid:** Store selected model option id, thinking option id, and feature values in the session, then build SDK `ModelSelection.params` on each send. [VERIFIED: `packages/server/src/server/agent/agent-manager.ts`; ASSUMED]

**Warning signs:** A unit test selecting `GPT-5.5 - 1M` observes a send option without a context param. [ASSUMED]

## Code Examples

Verified patterns from official and local sources:

### Side-Effect-Free Draft Features

```typescript
// Source: packages/server/src/server/agent/agent-manager.ts
// Existing manager behavior to target: implement client.listFeatures to avoid fallback sessions.
if (typeof client.listFeatures === "function") {
  return await client.listFeatures(draftConfig);
}
```

### Cursor SDK Send Option Assembly

```typescript
// Source: recommended Phase 03 helper using SDK ModelSelection shape from Cursor docs.
function buildCursorSdkSendModel(
  modelOptionId: string | null,
  thinkingOptionId: string | null,
  featureValues: Record<string, unknown>,
): CursorSdkModelSelection | undefined {
  if (!modelOptionId) {
    return undefined;
  }
  const selection = decodeCursorSdkModelOptionId(modelOptionId);
  const params = [...(selection.params ?? [])];
  if (thinkingOptionId) {
    params.push(decodeCursorSdkThinkingOption(thinkingOptionId));
  }
  if (featureValues.fast_mode === true) {
    params.push({ id: "fast", value: "true" });
  }
  return params.length ? { id: selection.id, params } : { id: selection.id };
}
```

### Cursor SDK Icon Alias

```typescript
// Source: recommended Phase 03 app resolver change.
export function resolveProviderIconName(providerId: string): ProviderIconName {
  if (providerId === "cursor-sdk") {
    return { kind: "catalog", id: "cursor" };
  }
  // existing builtin/catalog/Bot resolution remains unchanged
}
```

## State of the Art

| Old Approach                              | Current Approach                                                             | When Changed                                                                     | Impact                                                                                                                                                                                                   |
| ----------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Static manifest modes drive UI            | Provider snapshot modes drive availability; static manifest enriches visuals | Documented in provider snapshot conventions and reinforced by Phase 03 decisions | Planner should place Sandbox visibility in server snapshot logic, not static app filtering. [VERIFIED: `docs/providers.md`; VERIFIED: `.planning/phases/03-manifest-and-ui-integration/03-CONTEXT.md`]   |
| Scratch session metadata probing          | Provider client `listModels`/`listModes`/`listFeatures` APIs                 | Existing provider docs and `AgentManager.listDraftFeatures` branch               | Cursor SDK should never create sessions just to discover draft controls. [VERIFIED: `docs/providers.md`; VERIFIED: `packages/server/src/server/agent/agent-manager.ts`]                                  |
| Cursor ACP as the only Cursor provider    | Side-by-side `cursor` ACP and `cursor-sdk` direct SDK provider               | Milestone decisions and Phase 02 registration                                    | Tests must assert both providers remain distinct. [VERIFIED: `.planning/STATE.md`; VERIFIED: `packages/server/src/server/agent/provider-registry.ts`]                                                    |
| Model id only for Cursor SDK send options | SDK `ModelSelection` with optional `params`                                  | Phase 03 scope                                                                   | Context, thinking, and fast selections must be encoded and sent on next turn. [CITED: https://cursor.com/docs/sdk/typescript; VERIFIED: `.planning/phases/03-manifest-and-ui-integration/03-CONTEXT.md`] |

**Deprecated/outdated:**

- Generic `Agent`/`Ask` mode labels for Cursor SDK are out of scope for v1 and must not be planned. [VERIFIED: `.planning/phases/03-manifest-and-ui-integration/03-CONTEXT.md`]
- A synthetic `Default` model row for `cursor-sdk` is invalid when SDK discovery returns zero models. [VERIFIED: `.planning/phases/03-manifest-and-ui-integration/03-CONTEXT.md`; VERIFIED: `packages/app/src/provider-selection/provider-selection.ts`]

## Assumptions Log

| #   | Claim                                                                                                                                              | Section                                 | Risk if Wrong                                                                                                                      |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Structured base64url JSON is an acceptable reversible Cursor SDK model option id format.                                                           | Architecture Patterns                   | If unacceptable, planner can choose another stable/reversible helper, but must keep encode/decode centralized and tested.          |
| A2  | Reusing the existing app `fast_mode` feature id is acceptable for SDK `fast`.                                                                      | Architecture Patterns / Don't Hand-Roll | If provider-specific semantics require a new id, the app feature color/icon mapping and persisted feature cleanup need adjustment. |
| A3  | Cursor SDK no-implicit-thinking can be implemented via provider-aware app resolver logic or open metadata without adding required protocol fields. | Architecture Patterns                   | If a new protocol field is chosen, it must be optional and backward-compatible.                                                    |

## Open Questions (RESOLVED)

1. **RESOLVED: Should provider-config model entries for `cursor-sdk` be forced additive-only?**  
   What we know: Phase 03 decisions allow config metadata to enrich successful SDK discovery but not mask SDK failure or empty SDK lists. [VERIFIED: `.planning/phases/03-manifest-and-ui-integration/03-CONTEXT.md`]  
   Decision: Use the provider-specific path selected in `03-02-PLAN.md`: `CursorSdkAgentClient.listModels` calls SDK discovery first, throws a redacted unavailable/error on failure or zero models, and only then allows existing provider-config metadata to enrich the successful SDK-derived rows. This keeps `cursor-sdk` failure/empty discovery from being masked by config entries while avoiding a broad registry-level policy change. [RESOLVED: `03-02-PLAN.md` Task 2]

2. **RESOLVED: Where should no-implicit-thinking live?**  
   What we know: App form utilities currently pick a default or first thinking option. [VERIFIED: `packages/app/src/provider-selection/resolve-agent-form.ts`; VERIFIED: `packages/app/src/composer/agent-controls/utils.ts`]  
   Decision: Use the provider-aware app resolver path selected in `03-03-PLAN.md`: existing helper logic checks `model.provider === "cursor-sdk"` or equivalent open metadata, preserves unset Cursor SDK thinking, and avoids falling back to `defaultThinkingOptionId` or the first option. This avoids adding a required protocol field and keeps any protocol metadata optional/backward-compatible if implementation needs it. [RESOLVED: `03-03-PLAN.md` Task 2]

## Environment Availability

| Dependency                | Required By                                      | Available                            | Version                                           | Fallback                                                                                                                                               |
| ------------------------- | ------------------------------------------------ | ------------------------------------ | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Devcontainer CLI          | Required implementation verification environment | yes                                  | `0.87.0`                                          | None for dependency-backed verification. [VERIFIED: shell command]                                                                                     |
| Docker                    | Devcontainer execution                           | yes                                  | `26.1.3`                                          | None for dependency-backed verification. [VERIFIED: shell command]                                                                                     |
| Node.js host              | Local inspection only                            | yes                                  | `v24.15.0`                                        | Use devcontainer Node 22 for repo verification. [VERIFIED: shell command; VERIFIED: `.devcontainer/devcontainer.json`]                                 |
| npm host                  | Registry/package inspection only                 | yes                                  | `11.12.1`                                         | Use devcontainer npm for implementation checks. [VERIFIED: shell command; VERIFIED: `AGENTS.md`]                                                       |
| `@cursor/sdk` host module | Optional live SDK probing                        | no                                   | Declared `^1.0.18`; host `require.resolve` failed | Use devcontainer dependency volumes; do not diagnose SDK from host `node_modules`. [VERIFIED: shell command; VERIFIED: `packages/server/package.json`] |
| Cursor API key            | Optional live model probe                        | local provider config may contain it | Secret value not recorded                         | Fall back to `CURSOR_API_KEY` env or skip live SDK probes in unit tests. [VERIFIED: `.planning/PROJECT.md`; VERIFIED: shell command]                   |

**Missing dependencies with no fallback:** none for planning; implementation verification must use the devcontainer. [VERIFIED: `AGENTS.md`; VERIFIED: shell command]

**Missing dependencies with fallback:**

- Host `@cursor/sdk` module resolution is unavailable; run dependency-backed implementation and tests inside the devcontainer. [VERIFIED: shell command; VERIFIED: `AGENTS.md`]

## Validation Architecture

### Test Framework

| Property           | Value                                                                                                                                                                                                      |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework          | Vitest `^4.1.6`. [VERIFIED: `package.json`]                                                                                                                                                                |
| Config file        | `vitest.config.ts`. [VERIFIED: codebase grep]                                                                                                                                                              |
| Quick run command  | `devcontainer exec --workspace-folder /mnt/private_yax_qy4/projects/paseo npx vitest run <changed-test-file> --bail=1`. [VERIFIED: `docs/testing.md`; VERIFIED: `AGENTS.md`]                               |
| Full suite command | Do not run locally; use targeted tests plus repo-required `npm run typecheck` and `npm run lint` inside devcontainer, with CI for broad verification. [VERIFIED: `AGENTS.md`; VERIFIED: `docs/testing.md`] |

### Phase Requirements -> Test Map

| Req ID  | Behavior                                                                                         | Test Type | Automated Command                                                                                                                                                                                                                                                                                                                              | File Exists?                         |
| ------- | ------------------------------------------------------------------------------------------------ | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| MODE-03 | Cursor SDK mode snapshot shows only YOLO when Sandbox unsupported and never shows Agent/Ask.     | unit      | `devcontainer exec --workspace-folder /mnt/private_yax_qy4/projects/paseo npx vitest run packages/server/src/server/agent/providers/cursor-sdk-agent.test.ts --bail=1`                                                                                                                                                                         | yes [VERIFIED: codebase grep]        |
| FEAT-01 | SDK model discovery preserves model metadata and treats empty list as provider error.            | unit      | `devcontainer exec --workspace-folder /mnt/private_yax_qy4/projects/paseo npx vitest run packages/server/src/server/agent/providers/cursor-sdk-agent.test.ts --bail=1`                                                                                                                                                                         | yes [VERIFIED: codebase grep]        |
| FEAT-02 | Context/thinking/fast map to reversible ids and SDK send params.                                 | unit      | `devcontainer exec --workspace-folder /mnt/private_yax_qy4/projects/paseo npx vitest run packages/server/src/server/agent/providers/cursor-sdk/model-options.test.ts --bail=1`                                                                                                                                                                 | no, Wave 0 [VERIFIED: codebase grep] |
| FEAT-03 | Draft fast discovery uses `client.listFeatures` and does not create scratch sessions.            | unit      | `devcontainer exec --workspace-folder /mnt/private_yax_qy4/projects/paseo npx vitest run packages/server/src/server/agent/providers/cursor-sdk-agent.test.ts --bail=1`                                                                                                                                                                         | yes [VERIFIED: codebase grep]        |
| UI-01   | Cursor SDK manifest copy and mode visuals are present without a badge.                           | unit      | `devcontainer exec --workspace-folder /mnt/private_yax_qy4/projects/paseo npx vitest run packages/server/src/server/agent/provider-registry.test.ts --bail=1`                                                                                                                                                                                  | yes [VERIFIED: codebase grep]        |
| UI-02   | App icon/name/model/mode/thinking/feature controls resolve Cursor SDK through existing surfaces. | unit      | `devcontainer exec --workspace-folder /mnt/private_yax_qy4/projects/paseo npx vitest run packages/app/src/components/provider-icon-name.test.ts packages/app/src/provider-selection/provider-selection.test.ts packages/app/src/provider-selection/resolve-agent-form.test.ts packages/app/src/composer/agent-controls/utils.test.ts --bail=1` | yes [VERIFIED: codebase grep]        |
| UI-03   | Cursor ACP and Cursor SDK remain side by side and behavior does not collapse.                    | unit      | `devcontainer exec --workspace-folder /mnt/private_yax_qy4/projects/paseo npx vitest run packages/server/src/server/agent/provider-registry.test.ts packages/app/src/components/provider-icon-name.test.ts --bail=1`                                                                                                                           | yes [VERIFIED: codebase grep]        |

### Sampling Rate

- **Per task commit:** run the changed focused test file(s) with `npx vitest run <file> --bail=1` inside devcontainer. [VERIFIED: `docs/testing.md`; VERIFIED: `AGENTS.md`]
- **Per wave merge:** run all Phase 03 touched focused tests inside devcontainer, then `npm run build:client` if protocol/client types changed and `npm run build:server` if server/CLI types changed. [VERIFIED: `AGENTS.md`; VERIFIED: `docs/development.md`]
- **Phase gate:** run targeted Phase 03 tests, `npm run format`, `npm run typecheck`, and `npm run lint` inside devcontainer; do not run broad local test suites. [VERIFIED: `AGENTS.md`; VERIFIED: `docs/testing.md`]

### Wave 0 Gaps

- [ ] `packages/server/src/server/agent/providers/cursor-sdk/model-options.test.ts` - covers reversible model/context/thinking/fast encode/decode and send-param assembly for FEAT-02. [ASSUMED]
- [ ] Extend `packages/server/src/server/agent/providers/cursor-sdk-agent.test.ts` - covers empty SDK model list as unavailable, no scratch session feature discovery, and YOLO-only unsupported Sandbox behavior. [VERIFIED: codebase grep]
- [ ] Extend `packages/app/src/provider-selection/resolve-agent-form.test.ts` and `packages/app/src/composer/agent-controls/utils.test.ts` - covers no implicit Cursor SDK thinking selection. [VERIFIED: codebase grep]
- [ ] Extend `packages/app/src/components/provider-icon-name.test.ts` - covers `cursor-sdk` resolving to Cursor brand catalog icon while `cursor` behavior remains unchanged. [VERIFIED: codebase grep]
- [ ] Extend `packages/app/src/provider-selection/provider-selection.test.ts` - covers no synthetic `Default` row for Cursor SDK error/empty metadata path. [VERIFIED: codebase grep]

## Security Domain

### Applicable ASVS Categories

| ASVS Category                 | Applies | Standard Control                                                                                                                                                                                                                             |
| ----------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V2 Authentication             | no      | Phase 03 does not add user authentication; provider authentication remains API-key based config/env resolution. [VERIFIED: `.planning/STATE.md`; VERIFIED: `packages/server/src/server/agent/providers/cursor-sdk-agent.ts`]                 |
| V3 Session Management         | no      | Phase 03 does not alter web/app login sessions. [VERIFIED: `.planning/ROADMAP.md`]                                                                                                                                                           |
| V4 Access Control             | yes     | Keep creation gated to ready providers and preserve existing unavailable/error paths. [VERIFIED: `packages/app/src/provider-selection/resolve-agent-form.ts`; VERIFIED: `packages/server/src/server/agent/provider-snapshot-manager.ts`]     |
| V5 Input Validation           | yes     | Decode and validate reversible model option ids and params against discovered SDK metadata before send; preserve protocol optional-field compatibility. [VERIFIED: `.planning/phases/03-manifest-and-ui-integration/03-CONTEXT.md`; ASSUMED] |
| V6 Cryptography               | no      | Phase 03 does not introduce new crypto; relay/E2E crypto remains outside this phase. [VERIFIED: `.planning/ROADMAP.md`; VERIFIED: `SECURITY.md`]                                                                                             |
| V7 Error Handling and Logging | yes     | Discovery errors should mark provider unavailable and expose diagnostics without logging secrets. [VERIFIED: `.planning/phases/03-manifest-and-ui-integration/03-CONTEXT.md`; VERIFIED: `AGENTS.md`]                                         |

### Known Threat Patterns for Cursor SDK Provider UI

| Pattern                                                               | STRIDE                                            | Standard Mitigation                                                                                                                                                                                                                                              |
| --------------------------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API key disclosure in logs, research, diagnostics, or tests           | Information Disclosure                            | Never print the key value; diagnostics should state missing/invalid credentials without including secrets. [VERIFIED: `AGENTS.md`; VERIFIED: `.planning/PROJECT.md`]                                                                                             |
| Tampered or stale encoded model option id sends unintended SDK params | Tampering                                         | Centralize decode and validate decoded `{ id, params }` against current SDK metadata before accepting persisted selections or sending. [VERIFIED: `.planning/phases/03-manifest-and-ui-integration/03-CONTEXT.md`; ASSUMED]                                      |
| Unsupported Sandbox displayed as selectable safety mode               | Elevation of Privilege / Safety Misrepresentation | Let runtime snapshot modes drive UI and put unsupported reason in diagnostics, not disabled picker rows. [VERIFIED: `.planning/phases/03-manifest-and-ui-integration/03-CONTEXT.md`; VERIFIED: `packages/server/src/server/agent/providers/cursor-sdk/modes.ts`] |
| Metadata discovery creates scratch sessions or workspace side effects | Denial of Service / Tampering                     | Use `Cursor.models.list` and `client.listFeatures`, not provider sessions, for draft metadata. [VERIFIED: `docs/providers.md`; VERIFIED: `packages/server/src/server/agent/agent-manager.ts`]                                                                    |
| Cursor ACP and Cursor SDK configuration confusion                     | Spoofing / Tampering                              | Keep provider ids and config namespaces separate; do not inherit `agents.providers.cursor.*` into `cursor-sdk`. [VERIFIED: `.planning/STATE.md`; VERIFIED: `docs/custom-providers.md`]                                                                           |

## Sources

### Primary (HIGH confidence)

- `.planning/phases/03-manifest-and-ui-integration/03-CONTEXT.md` - locked decisions, scope, canonical references. [VERIFIED: codebase grep]
- `.planning/REQUIREMENTS.md` - Phase 03 requirement ids and descriptions. [VERIFIED: codebase grep]
- `.planning/STATE.md` - prior phase decisions and Phase 02 completion state. [VERIFIED: codebase grep]
- `.planning/ROADMAP.md` - Phase 03 goal, success criteria, and plan split. [VERIFIED: codebase grep]
- `docs/providers.md` - provider integration and snapshot metadata conventions. [VERIFIED: codebase grep]
- `docs/custom-providers.md` - custom provider separation and provider id behavior. [VERIFIED: codebase grep]
- `docs/design.md` - app UI conventions. [VERIFIED: codebase grep]
- `docs/architecture.md` - package boundaries and provider lifecycle. [VERIFIED: codebase grep]
- `packages/protocol/src/provider-manifest.ts` - static built-in provider definitions. [VERIFIED: codebase grep]
- `packages/protocol/src/provider-icon-names.ts` - provider icon-name allowlists. [VERIFIED: codebase grep]
- `packages/protocol/src/agent-types.ts` - shared model/mode/feature types. [VERIFIED: codebase grep]
- `packages/server/src/server/agent/provider-registry.ts` - provider registration and model merge behavior. [VERIFIED: codebase grep]
- `packages/server/src/server/agent/provider-snapshot-manager.ts` - snapshot availability and model/mode discovery behavior. [VERIFIED: codebase grep]
- `packages/server/src/server/agent/providers/cursor-sdk-agent.ts` - Cursor SDK provider runtime integration. [VERIFIED: codebase grep]
- `packages/app/src/**` provider selection, icon, feature, and composer control files listed in this research. [VERIFIED: codebase grep]

### Secondary (MEDIUM confidence)

- `https://cursor.com/docs/sdk/typescript` - official Cursor TypeScript SDK documentation for `@cursor/sdk`, `Cursor.models.list`, and model send options. [CITED: https://cursor.com/docs/sdk/typescript]
- npm registry for `@cursor/sdk` version/time/repository metadata. [VERIFIED: npm registry]
- `gsd-tools query package-legitimacy check --ecosystem npm @cursor/sdk` - package legitimacy verdict and signals. [VERIFIED: gsd-tools]

### Tertiary (LOW confidence)

- Assumptions A1-A3 about exact internal encoding, feature id reuse, and no-implicit-thinking implementation shape. [ASSUMED]

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH - package versions and workspace versions were verified from local package manifests and npm registry. [VERIFIED: `package.json`; VERIFIED: `packages/server/package.json`; VERIFIED: npm registry]
- Architecture: HIGH - provider boundaries, snapshot flow, and app surfaces were verified from local docs and code. [VERIFIED: `docs/architecture.md`; VERIFIED: `docs/providers.md`; VERIFIED: codebase grep]
- Pitfalls: HIGH for existing behavior risks, MEDIUM for proposed implementation helpers - risks were verified in code, while exact helper shape remains planner discretion. [VERIFIED: codebase grep; ASSUMED]

**Research date:** 2026-06-13  
**Valid until:** 2026-06-20 for Cursor SDK metadata behavior because `@cursor/sdk` is fast-moving; 2026-07-13 for local Paseo architecture and app control paths. [VERIFIED: npm registry; ASSUMED]
