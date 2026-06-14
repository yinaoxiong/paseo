# Phase 03: Manifest and UI Integration - Pattern Map

**Mapped:** 2026-06-13
**Files analyzed:** 22
**Analogs found:** 22 / 22

## File Classification

| New/Modified File                                                             | Role              | Data Flow                    | Closest Analog                                                                      | Match Quality |
| ----------------------------------------------------------------------------- | ----------------- | ---------------------------- | ----------------------------------------------------------------------------------- | ------------- |
| `packages/protocol/src/provider-manifest.ts`                                  | config            | transform                    | `packages/protocol/src/provider-manifest.ts`                                        | exact         |
| `packages/protocol/src/provider-icon-names.ts`                                | config            | transform                    | `packages/protocol/src/provider-icon-names.ts`                                      | exact         |
| `packages/protocol/src/agent-types.ts`                                        | model             | request-response             | `AgentModelDefinition.metadata` in same file                                        | exact         |
| `packages/server/src/server/agent/providers/cursor-sdk/sdk-runtime.ts`        | service           | request-response             | `ProductionCursorSdkRuntime.listModels`                                             | exact         |
| `packages/server/src/server/agent/providers/cursor-sdk/model-options.ts`      | utility           | transform                    | `expandCursorParameterizedModels` in `cursor-acp-agent.ts`                          | role-match    |
| `packages/server/src/server/agent/providers/cursor-sdk-agent.ts`              | service           | streaming + request-response | existing `CursorSdkAgentClient` / `CursorSdkAgentSession`                           | exact         |
| `packages/server/src/server/agent/providers/cursor-sdk/modes.ts`              | utility           | transform                    | same file `listCursorSdkModes`                                                      | exact         |
| `packages/server/src/server/agent/provider-registry.ts`                       | service           | request-response             | `buildProviderRegistry` provider factory/merge path                                 | exact         |
| `packages/server/src/server/agent/provider-snapshot-manager.ts`               | service           | request-response             | `refreshProvider` / `getReadyProvider`                                              | exact         |
| `packages/app/src/components/provider-icon-name.ts`                           | utility           | transform                    | same file `resolveProviderIconName`                                                 | exact         |
| `packages/app/src/components/provider-icons.ts`                               | component utility | transform                    | catalog icon resolver in same file                                                  | exact         |
| `packages/app/src/provider-selection/provider-selection.ts`                   | utility           | transform                    | same file `buildEntryModelSelection`                                                | exact         |
| `packages/app/src/provider-selection/resolve-agent-form.ts`                   | utility           | transform                    | same file `resolveThinkingOptionId`                                                 | exact         |
| `packages/app/src/hooks/use-agent-form-state.ts`                              | hook              | event-driven                 | `resolve-agent-form.ts` reducer helpers                                             | role-match    |
| `packages/app/src/hooks/use-draft-agent-features.ts`                          | hook              | request-response             | same file feature query/prune path                                                  | exact         |
| `packages/app/src/hooks/use-providers-snapshot.ts`                            | hook              | request-response             | same file snapshot query/refresh path                                               | exact         |
| `packages/app/src/components/combined-model-selector.tsx`                     | component         | event-driven                 | `provider-selection.ts` model row builders                                          | role-match    |
| `packages/app/src/composer/agent-controls/index.tsx`                          | component         | event-driven                 | `resolveAgentModelSelection` in `utils.ts`                                          | role-match    |
| `packages/app/src/composer/agent-controls/mode-control.tsx`                   | component         | event-driven                 | dynamic mode labels from `utils.ts` / manifest modes                                | role-match    |
| `packages/app/src/composer/agent-controls/utils.ts`                           | utility           | transform                    | same file model/thinking selection helpers                                          | exact         |
| `packages/server/src/server/agent/providers/cursor-sdk/model-options.test.ts` | test              | transform                    | `cursor-sdk-agent.test.ts` fake runtime + `cursor-acp-agent.ts` parameter expansion | role-match    |
| Existing focused tests listed in validation                                   | test              | request-response + transform | existing test files named below                                                     | exact         |

## Pattern Assignments

### `packages/protocol/src/provider-manifest.ts` (config, transform)

**Analog:** `packages/protocol/src/provider-manifest.ts`

**Imports and types pattern** (lines 1-30):

```typescript
import { z } from "zod";
import type { AgentMode } from "./agent-types.js";

export type AgentModeColorTier = "safe" | "moderate" | "dangerous" | "planning" | `#${string}`;
export interface AgentProviderDefinition {
  id: string;
  label: string;
  description: string;
  enabledByDefault?: boolean;
  defaultModeId: string | null;
  modes: AgentProviderModeDefinition[];
}
```

**Static Cursor SDK mode visuals** (lines 145-162):

```typescript
const CURSOR_SDK_MODES: AgentProviderModeDefinition[] = [
  { id: "sandbox", label: "Sandbox", icon: "ShieldCheck", colorTier: "safe", isUnattended: false },
  { id: "yolo", label: "YOLO", icon: "ShieldOff", colorTier: "dangerous", isUnattended: true },
];
```

**Provider entry pattern** (lines 234-246):

```typescript
{
  id: "cursor",
  label: "Cursor",
  description: "Cursor via Agent Client Protocol with CLI login based behavior",
  defaultModeId: "https://agentclientprotocol.com/protocol/session-modes#agent",
  modes: CURSOR_ACP_MODES,
},
{
  id: "cursor-sdk",
  label: "Cursor SDK",
  description: "Experimental direct Cursor SDK provider for local agents",
  defaultModeId: "yolo",
  modes: CURSOR_SDK_MODES,
},
```

**Planner note:** update only `cursor-sdk` copy/default metadata; do not rename `cursor`. Static modes are visual metadata. Dynamic snapshot modes still own availability.

### `packages/protocol/src/agent-types.ts` (model, request-response)

**Analog:** existing optional model/feature metadata fields.

**Model and snapshot pattern** (lines 69-108):

```typescript
export interface AgentModelDefinition {
  provider: AgentProvider;
  id: string;
  label: string;
  description?: string;
  isDefault?: boolean;
  metadata?: AgentMetadata;
  thinkingOptions?: AgentSelectOption[];
  defaultThinkingOptionId?: string;
}

export interface ProviderSnapshotEntry {
  provider: AgentProvider;
  status: ProviderStatus;
  enabled: boolean;
  error?: string;
  models?: AgentModelDefinition[];
  modes?: AgentMode[];
}
```

**Feature pattern** (lines 110-131):

```typescript
export interface AgentFeatureToggle {
  type: "toggle";
  id: string;
  label: string;
  description?: string;
  tooltip?: string;
  icon?: string;
  value: boolean;
}
export type AgentFeature = AgentFeatureToggle | AgentFeatureSelect;
```

**Planner note:** prefer optional `metadata` on `AgentModelDefinition` / `AgentSelectOption` for reversible Cursor SDK parameter data. If protocol shape changes are unavoidable, keep them optional and backward-compatible.

### `packages/server/src/server/agent/providers/cursor-sdk/sdk-runtime.ts` (service, request-response)

**Analog:** `ProductionCursorSdkRuntime.listModels`.

**SDK import boundary** (lines 1-23):

```typescript
import type { AgentOptions, LocalAgentStore, SDKAgent, SDKModel } from "@cursor/sdk";

export type CursorSdkRuntimeModel = string | Pick<SDKModel, "id" | "displayName" | "description">;

export interface CursorSdkRuntime {
  listModels(options?: { apiKey?: string }): Promise<CursorSdkRuntimeModel[]>;
  createAgent(options?: AgentOptions): Promise<SDKAgent>;
  resumeAgent(agentId: string, options?: Partial<AgentOptions>): Promise<SDKAgent>;
}
```

**Model discovery pattern** (lines 44-47):

```typescript
async listModels(options?: { apiKey?: string }): Promise<CursorSdkRuntimeModel[]> {
  const { Cursor } = await import("@cursor/sdk");
  return await Cursor.models.list({ apiKey: options?.apiKey });
}
```

**Planner note:** widen `CursorSdkRuntimeModel` to preserve SDK `parameters` and `variants`; do not introduce a scratch agent session for metadata.

### `packages/server/src/server/agent/providers/cursor-sdk/model-options.ts` (utility, transform)

**Analog:** `packages/server/src/server/agent/providers/cursor-acp-agent.ts`

**Parameterized model expansion pattern** (lines 287-341):

```typescript
function buildCursorThinkingOptions(
  option: CursorSelectConfigOption | undefined,
): AgentSelectOption[] | undefined {
  const choices = flattenCursorSelectOptions(option.options);
  return choices.map((choice) => ({
    id: choice.value,
    label: choice.name,
    description: choice.description ?? undefined,
    isDefault: choice.value === option.currentValue,
  }));
}

export function expandCursorParameterizedModels(
  response: unknown,
  currentModelId: string | null,
): AgentModelDefinition[] {
  const models = parseCursorAvailableModelsResponse(response);
  return models.flatMap((model) => {
    const thinkingOptions = buildCursorThinkingOptions(thinkingOption);
    const parameterCombinations = buildCursorParameterCombinations(modelConfigOptions);
    return parameterCombinations.map((parameters) => ({
      provider: "acp",
      id: formatCursorModelVariantId(model.value, parameters),
      label: buildCursorVariantLabel(model, parameters),
      isDefault: isCursorVariantDefault(model, currentModelId, parameters),
      thinkingOptions,
      defaultThinkingOptionId,
    }));
  });
}
```

**Cursor SDK differences to apply:** emit `provider: "cursor-sdk"`; context variants become separate rows; do not emit a bare base row when context exists; do not set SDK default context/thinking as preferred; boolean thinking labels must be `Thinking On` / `Thinking Off`; encode ids reversibly to SDK `ModelSelection` `{ id, params }`.

### `packages/server/src/server/agent/providers/cursor-sdk-agent.ts` (service, streaming + request-response)

**Analog:** existing `CursorSdkAgentClient` and `CursorSdkAgentSession`.

**Imports and dependency injection pattern** (lines 1-56):

```typescript
import type { AgentOptions, LocalAgentStore, Run, SDKAgent } from "@cursor/sdk";
import type { Logger } from "pino";
import type {
  AgentClient,
  AgentFeature,
  AgentModelDefinition,
  AgentSession,
} from "../agent-sdk-types.js";
import { ProductionCursorSdkRuntime, type CursorSdkRuntime } from "./cursor-sdk/sdk-runtime.js";
```

**Create/resume SDK options pattern** (lines 115-132):

```typescript
function buildCursorSdkAgentOptions(input: {
  apiKey: string;
  model?: string | null;
  cwd: string;
  store: LocalAgentStore;
  sandboxEnabled: boolean;
}): AgentOptions {
  return {
    apiKey: input.apiKey,
    ...(input.model ? { model: { id: input.model } } : {}),
    mode: "agent",
    local: {
      cwd: input.cwd,
      store: input.store,
      sandboxOptions: { enabled: input.sandboxEnabled },
    },
  };
}
```

**Next-turn model send pattern** (lines 331-365):

```typescript
async setModel(modelId: string | null): Promise<void> {
  this.model = modelId && modelId.trim().length > 0 ? modelId : null;
  this.emit({ type: "model_changed", provider: this.provider, runtimeInfo: await this.getRuntimeInfo() });
}

private buildSendOptions(): Parameters<SDKAgent["send"]>[1] {
  return this.model ? { model: { id: this.model } } : undefined;
}

const run = await this.sdkAgent.send(promptText, this.buildSendOptions());
```

**Model discovery and error redaction pattern** (lines 605-617):

```typescript
async listModels(_options: ListModelsOptions): Promise<AgentModelDefinition[]> {
  const preflight = await this.preflight("listModels");
  try {
    const models = await this.runtime.listModels({ apiKey: preflight.apiKey });
    return models.map((model) => this.toAgentModel(model));
  } catch (error) {
    this.lastDiagnostic = toCursorSdkDiagnostic(error, { operation: "listModels", secrets: [preflight.apiKey] });
    throw redactedCursorSdkError(error, "Cursor SDK list models failed", [preflight.apiKey]);
  }
}
```

**Availability and diagnostics pattern** (lines 649-699):

```typescript
if (!readiness.available) return false;
if (!key.apiKey) {
  this.lastDiagnostic = {
    apiKeySource: "missing",
    message: "CURSOR_API_KEY is not configured for the Cursor SDK provider.",
  };
  return false;
}
```

**Planner note:** add `listFeatures(config)` here, using the Claude fast-mode pattern below. Empty SDK model list should throw or otherwise make snapshot status `error`/`unavailable` for `cursor-sdk`; provider-config models may enrich only after SDK discovery succeeds.

### `packages/server/src/server/agent/providers/cursor-sdk/modes.ts` (utility, transform)

**Analog:** same file.

**Dynamic mode availability pattern** (lines 4-28):

```typescript
export const CURSOR_SDK_SANDBOX_MODE: AgentMode = {
  id: "sandbox",
  label: "Sandbox",
  icon: "ShieldCheck",
  colorTier: "safe",
};
export const CURSOR_SDK_YOLO_MODE: AgentMode = {
  id: "yolo",
  label: "YOLO",
  icon: "ShieldOff",
  colorTier: "dangerous",
  isUnattended: true,
};

export function listCursorSdkModes(sandboxSupport: CursorSdkSandboxSupport): AgentMode[] {
  return sandboxSupport.supported
    ? [CURSOR_SDK_SANDBOX_MODE, CURSOR_SDK_YOLO_MODE]
    : [CURSOR_SDK_YOLO_MODE];
}
```

**Planner note:** preserve this pattern. Do not show disabled Sandbox in creation/composer controls when snapshot modes omit it.

### `packages/server/src/server/agent/provider-registry.ts` (service, request-response)

**Analog:** factory and provider model merge path.

**Factory pattern** (lines 108-135):

```typescript
const PROVIDER_CLIENT_FACTORIES: Record<string, ProviderClientFactory> = {
  cursor: (logger, runtimeSettings) =>
    new CursorACPAgentClient({
      logger,
      command: getCursorACPCommand(runtimeSettings),
      env: runtimeSettings?.env,
    }),
  "cursor-sdk": (logger, runtimeSettings) => new CursorSdkAgentClient({ logger, runtimeSettings }),
};
```

**Runtime settings merge pattern** (lines 200-221):

```typescript
return {
  command: override?.command ?? base?.command,
  env: base?.env || override?.env ? { ...base?.env, ...override?.env } : undefined,
  disallowedTools:
    base?.disallowedTools || override?.disallowedTools
      ? [...(base?.disallowedTools ?? []), ...(override?.disallowedTools ?? [])]
      : undefined,
};
```

**Planner note:** avoid registry model replacement masking Cursor SDK discovery failure. Keep `cursor` and `cursor-sdk` factories separate.

### `packages/server/src/server/agent/provider-snapshot-manager.ts` (service, request-response)

**Analog:** snapshot warm/cache/error contract.

**Ready-provider enforcement** (lines 287-314, 436-450):

```typescript
async listModels(input: ProviderSnapshotProviderOptions): Promise<AgentModelDefinition[]> {
  const entry = await this.getReadyProvider(input);
  return entry.models ?? [];
}

private async getReadyProvider(input: ProviderSnapshotProviderOptions): Promise<ProviderSnapshotEntry> {
  const entry = await this.getProvider(input);
  if (!entry.enabled) throw new Error(`Provider '${entry.provider}' is disabled`);
  if (entry.status === "ready") return entry;
  if (entry.status === "error") throw new Error(entry.error ?? `Failed to load provider '${entry.provider}'`);
  throw new Error(`Provider '${entry.provider}' is not available`);
}
```

**Cache/refresh pattern** (lines 509-567):

```typescript
private async warmUp(cwd: string, providers?: AgentProvider[]): Promise<void> {
  await this.loadProviders({ cwd, providers: providers ?? this.getProviderIds(), force: false });
}

private async refreshProviders(cwd: string, providers: AgentProvider[]): Promise<void> {
  await this.loadProviders({ cwd, providers, force: true });
}

private async loadProviders(options: ProviderLoadOptions): Promise<void> {
  await Promise.allSettled(options.providers.map((provider) => this.loadProvider({ ...options, provider })));
}
```

**Planner note:** keep cold/warm/explicit-refresh semantics; do not force-refresh selector open.

### `packages/app/src/components/provider-icon-name.ts` and `provider-icons.ts` (utility/component, transform)

**Analog:** icon-name resolver plus catalog fallback.

**Resolver pattern** (`provider-icon-name.ts` lines 1-22):

```typescript
const BUILTIN_PROVIDER_IDS = new Set(BUILTIN_PROVIDER_ICON_NAMES);
const KNOWN_PROVIDER_IDS = new Set(KNOWN_PROVIDER_ICON_NAMES);

export function resolveProviderIconName(provider: string): ProviderIconName {
  if (BUILTIN_PROVIDER_IDS.has(provider)) return { kind: "builtin", id: provider };
  if (KNOWN_PROVIDER_IDS.has(provider)) return { kind: "catalog", id: provider };
  return { kind: "bot" };
}
```

**Catalog icon pattern** (`provider-icons.ts` lines 30-70):

```typescript
function getCatalogProviderIcon(provider: string): ProviderIconComponent {
  const iconSvg = CATALOG_ICON_SVGS.get(provider);
  if (!iconSvg) return Bot;
  const icon = createCatalogIcon(provider, iconSvg);
  catalogIconComponents.set(provider, icon);
  return icon;
}

export function getProviderIcon(provider: string): ProviderIconComponent {
  const name = resolveProviderIconName(provider);
  if (name.kind === "catalog") return getCatalogProviderIcon(name.id);
  return Bot;
}
```

**Planner note:** map `cursor-sdk` to catalog id `cursor` or another existing Cursor catalog icon route. Do not add `cursor-sdk` to built-in icons unless an actual built-in icon component is registered.

### `packages/app/src/provider-selection/provider-selection.ts` (utility, transform)

**Analog:** existing model row and snapshot status handling.

**Synthetic default behavior to guard** (lines 40-83):

```typescript
function buildModelSelection(
  provider: string,
  providerLabel: string,
  models: AgentModelDefinition[] | null,
): ProviderModelSelection {
  if (models === null) return { kind: "loading" };
  if (models.length === 0) {
    return { kind: "models", rows: [buildSyntheticDefaultRow(provider, providerLabel)] };
  }
  return { kind: "models", rows: buildModelRows(provider, providerLabel, models) };
}
```

**Error path pattern** (lines 85-105):

```typescript
if (entry.status === "loading") return { kind: "loading" };
return {
  kind: "error",
  message:
    entry.error ??
    (entry.status === "unavailable"
      ? i18n.t("providerSelection.unavailable")
      : i18n.t("providerSelection.unknownError")),
};
```

**Readiness pattern** (lines 275-311):

```typescript
if (input.selection.isModelLoading)
  return { ok: false, reason: i18n.t("providerSelection.readiness.modelDefaultsLoading") };
if (!hasSelectedModel && input.selection.availableModels.length > 0) {
  return { ok: false, reason: i18n.t("providerSelection.readiness.noModelAvailable") };
}
```

**Planner note:** for `cursor-sdk`, empty successful model discovery must become an error/unavailable entry before this code can synthesize `Default`, or this utility must special-case `cursor-sdk` empty models to `kind: "error"`.

### `packages/app/src/provider-selection/resolve-agent-form.ts` (utility, transform)

**Analog:** form reducer and thinking resolution helpers.

**Selectable status pattern** (lines 56-61):

```typescript
export const RESOLVABLE_PROVIDER_STATUSES = new Set<ProviderSnapshotEntry["status"]>([
  "ready",
  "loading",
]);
export const SELECTABLE_PROVIDER_STATUSES = new Set<ProviderSnapshotEntry["status"]>(["ready"]);
```

**Thinking fallback to guard** (lines 127-145):

```typescript
export function resolveThinkingOptionId(args: {
  availableModels: AgentModelDefinition[] | null;
  modelId: string;
  requestedThinkingOptionId: string;
}): string {
  const effectiveModel = resolveEffectiveModel(args.availableModels, args.modelId);
  const thinkingOptions = effectiveModel?.thinkingOptions ?? [];
  if (thinkingOptions.length === 0) return "";
  if (
    normalizedThinkingOptionId &&
    thinkingOptions.some((option) => option.id === normalizedThinkingOptionId)
  ) {
    return normalizedThinkingOptionId;
  }
  return effectiveModel?.defaultThinkingOptionId ?? thinkingOptions[0]?.id ?? "";
}
```

**Reducer paths using thinking selection** (lines 494-518, 544-559):

```typescript
const nextThinkingOptionId = pickNextThinkingOptionForProvider({
  providerModels,
  providerPrefs,
  modelId: nextModelId,
});

const nextThinkingOptionId = resolveThinkingOptionId({
  availableModels: action.availableModels,
  modelId: nextModelId,
  requestedThinkingOptionId: state.userModified.thinkingOptionId ? state.form.thinkingOptionId : "",
});
```

**Planner note:** Cursor SDK must not auto-select `thinkingOptions[0]`. Add a provider-aware guard or model metadata flag that keeps invalid/unset SDK thinking blank while preserving existing Codex/Claude behavior.

### `packages/app/src/hooks/use-draft-agent-features.ts` (hook, request-response)

**Analog:** existing draft feature discovery/pruning.

**Query key and config pattern** (lines 44-80):

```typescript
const draftConfig = useMemo<DraftFeatureConfig | null>(() => {
  if (!normalizedProvider || !normalizedCwd) return null;
  return {
    provider: normalizedProvider,
    cwd: normalizedCwd,
    ...(modeId ? { modeId } : {}),
    ...(modelId ? { model: modelId } : {}),
    ...(thinkingOptionId ? { thinkingOptionId } : {}),
  };
}, [modeId, modelId, normalizedCwd, normalizedProvider, thinkingOptionId]);

const payload = await client.listProviderFeatures(draftConfig);
return payload.features ?? [];
```

**Invalid feature cleanup pattern** (lines 83-116):

```typescript
const featureValues = resolveFeatureValues({
  features: availableFeatures,
  persistedFeatureValues,
  localFeatureValues,
});
const features = applyFeatureValues(availableFeatures, featureValues);

const next = pruneFeatureValues(localFeatureValues, availableFeatures);
if (next !== localFeatureValues) setLocalFeatureValues(next);
```

**Planner note:** `fast_mode` should appear only when the selected Cursor SDK model exposes `fast`; default is false/off; stale fast preferences must be pruned on model/metadata changes.

### `packages/app/src/hooks/use-providers-snapshot.ts` (hook, request-response)

**Analog:** existing snapshot fetch/refresh and selector-open stale behavior.

**Fetch/refresh pattern** (lines 37-67):

```typescript
export async function fetchProvidersSnapshot(input: {
  client: ProvidersSnapshotClient;
  cwd: string | null;
}) {
  return input.client.getProvidersSnapshot(providersSnapshotRequestOptions({ cwd: input.cwd }));
}

export async function refreshAndApplyProvidersSnapshot(input: { providers?: AgentProvider[] }) {
  const refreshResult = await input.client.refreshProvidersSnapshot(
    providersSnapshotRequestOptions({ cwd: input.cwd, providers: input.providers }),
  );
  const snapshot = await fetchProvidersSnapshot({ client: input.client, cwd: input.cwd });
  input.queryClient.setQueryData(providersSnapshotQueryKey(input.serverId, input.cwd), snapshot);
  return refreshResult;
}
```

**Selector-open decision** (lines 89-103):

```typescript
if (!input.selectedProvider) return "refetch-stale";
const selectedEntry = input.entries?.find((entry) => entry.provider === input.selectedProvider);
if (!selectedEntry || selectedEntry.status === "loading") return "refetch-always";
return "refetch-stale";
```

**Planner note:** preserve this behavior; explicit refresh is the recovery path for Cursor SDK model failures.

### `packages/app/src/composer/agent-controls/utils.ts`, `index.tsx`, `mode-control.tsx` (utility/components, event-driven)

**Analog:** composer utility model/thinking selection.

**Feature color and thinking label pattern** (`utils.ts` lines 36-91):

```typescript
export function getFeatureHighlightColor(featureId: string): FeatureHighlightColor {
  switch (featureId) {
    case "fast_mode":
      return "yellow";
    default:
      return "default";
  }
}

export function formatThinkingOptionLabel(option: ControlLabelInput): string {
  if (compactId === "xhigh" || compactLabel === "xhigh")
    return i18n.t("agentControls.thinking.extraHigh");
  return formatControlLabel(option, true);
}
```

**Running-agent fallback to guard** (`utils.ts` lines 126-145, 202-219):

```typescript
function resolveThinkingId(explicitThinkingOptionId, selectedModel) {
  if (explicitThinkingOptionId && explicitThinkingOptionId !== "default")
    return explicitThinkingOptionId;
  return selectedModel?.defaultThinkingOptionId ?? null;
}

function resolveEffectiveThinking(thinkingOptions, resolvedThinkingId) {
  const selectedThinking =
    thinkingOptions?.find((option) => option.id === resolvedThinkingId) ?? null;
  return selectedThinking ?? thinkingOptions?.[0] ?? null;
}
```

**Planner note:** preserve existing composer control composition, but avoid displaying/sending the first Cursor SDK thinking option when unset. Add explicit boolean label handling for `Thinking On` / `Thinking Off` before generic sentence casing if needed.

## Test Pattern Assignments

### `packages/server/src/server/agent/providers/cursor-sdk/model-options.test.ts`

**Analogs:** `cursor-sdk-agent.test.ts` fake runtime + `cursor-acp-agent.ts` expansion tests.

**Fake SDK runtime pattern** (`cursor-sdk-agent.test.ts` lines 153-190):

```typescript
class FakeCursorSdkRuntime implements CursorSdkRuntime {
  readiness: CursorSdkRuntimeReadiness = { available: true };
  sandboxSupport: CursorSdkSandboxSupport = { supported: true };
  models: string[] = [];
  listModelsError: unknown = null;
  readonly calls = {
    checkReadiness: 0,
    checkSandboxSupport: 0,
    listModels: 0,
    createAgent: 0,
    resumeAgent: 0,
  };

  async listModels(): Promise<string[]> {
    this.calls.listModels += 1;
    if (this.listModelsError) throw this.listModelsError;
    return this.models;
  }
}
```

**Session send assertion pattern** (`cursor-sdk-agent.test.ts` lines 110-132, 436-444):

```typescript
readonly sends: Array<{ message: string | Parameters<SDKAgent["send"]>[0]; options?: Parameters<SDKAgent["send"]>[1] }> = [];
async send(message, options) {
  this.sends.push({ message, options });
  return this.nextRun;
}

expect(runtime.createAgentOptions[0]).toMatchObject({
  apiKey: "provider-secret-key",
  model: { id: "composer-2.5" },
});
```

**Cover:** reversible encode/decode, context expansion order, boolean thinking labels with raw SDK values, fast default false, stale/tampered selection rejection.

### Existing focused test files to extend

**`provider-icon-name.test.ts` analog** (lines 10-24):

```typescript
expect(resolveProviderIconName("claude")).toEqual({ kind: "builtin", id: "claude" });
expect(resolveProviderIconName("gemini")).toEqual({ kind: "catalog", id: "gemini" });
expect(resolveProviderIconName("custom-claude-profile")).toEqual({ kind: "bot" });
```

Add `cursor-sdk` -> Cursor catalog icon, and preserve `cursor` behavior.

**`provider-selection.test.ts` analog** (lines 69-98, 113-140):

```typescript
it("synthesizes a default model row for ready enabled providers without explicit models", () => { ... });
it("surfaces non-ready providers with their state-specific selection", () => { ... });
```

Add Cursor SDK empty/error case proving no synthetic `Default` row.

**`resolve-agent-form.test.ts` analog** (lines 112-167):

```typescript
it("falls back to defaultThinkingOptionId when requested option is invalid", () => { ... });
it("falls back to first option when no default and requested is invalid", () => { ... });
```

Add Cursor SDK no-implicit-thinking-default cases while preserving existing generic fallback.

**`utils.test.ts` analog** (lines 71-85, 154-198):

```typescript
expect(formatThinkingOptionLabel({ id: "xhigh", label: "xhigh" })).toBe("Extra high");
expect(selection.selectedThinkingId).toBe("low");
```

Add boolean `Thinking On` / `Thinking Off` and running-agent no-first-thinking fallback for Cursor SDK.

**`provider-registry.test.ts` analog** (lines 6-45, 108-135 in source registry):
Mock constructors already track `cursorSdk`; extend assertions that `cursor` and `cursor-sdk` remain separate and provider config models do not replace failed SDK discovery.

## Shared Patterns

### Provider Snapshot Availability

**Source:** `docs/providers.md`; `provider-snapshot-manager.ts` lines 287-314 and 509-567
**Apply to:** server snapshot/model discovery and app selector behavior.

Cold reads may probe; warm reads stay cached; explicit refresh is the recovery path. Cursor SDK SDK-metadata failure or empty SDK list should surface as `error`/`unavailable`, keeping diagnostics visible and creation blocked.

### Secret Redaction

**Source:** `cursor-sdk-agent.ts` lines 98-113, 610-617, 674-699
**Apply to:** all Cursor SDK model discovery and send-option errors.

Use `toCursorSdkDiagnostic`, `formatCursorSdkDiagnostic`, and `redactedCursorSdkError`; never include `CURSOR_API_KEY` values in errors/tests.

### Fast Toggle

**Source:** `claude/feature-definitions.ts` lines 9-47; `claude/agent.ts` lines 1412-1417
**Apply to:** Cursor SDK `listFeatures(config)`.

```typescript
export const CLAUDE_FAST_MODE_FEATURE: Omit<AgentFeatureToggle, "value"> = {
  type: "toggle",
  id: "fast_mode",
  label: "Fast",
  tooltip: "Toggle fast mode",
  icon: "zap",
};

async listFeatures(config: AgentSessionConfig): Promise<AgentFeature[]> {
  return buildClaudeFeatures({
    modelId: claudeConfig.model,
    fastModeEnabled: claudeConfig.featureValues?.fast_mode === true,
  });
}
```

Cursor SDK equivalent should expose `fast_mode` only for selected model metadata with `fast`, and `value` defaults to `false` unless explicitly enabled.

### Existing UI System

**Source:** `docs/design.md`; `03-UI-SPEC.md`
**Apply to:** provider picker, model selector, composer controls, diagnostics.

Reuse `CombinedModelSelector`, `Combobox`, existing composer controls, provider diagnostics, and feature controls. Do not add a Cursor SDK-only picker, badge, page, or hardcoded visual treatment.

## No Analog Found

None. Every expected new/modified file has either an exact existing path or a strong role-match analog. The only new implementation file, `packages/server/src/server/agent/providers/cursor-sdk/model-options.ts`, should copy patterns from `cursor-acp-agent.ts` parameter expansion and `cursor-sdk-agent.test.ts` fake-runtime test style.

## Metadata

**Analog search scope:** `packages/protocol/src`, `packages/server/src/server/agent`, `packages/app/src/components`, `packages/app/src/provider-selection`, `packages/app/src/hooks`, `packages/app/src/composer/agent-controls`, `docs/`, phase artifacts.
**Files scanned:** 80+ via `rg --files` / targeted `rg`.
**Pattern extraction date:** 2026-06-13
