import { Buffer } from "node:buffer";

import type {
  AgentFeature,
  AgentFeatureToggle,
  AgentModelDefinition,
  AgentSelectOption,
} from "../../agent-sdk-types.js";

export interface CursorSdkModelParameterValueDefinition {
  value: string;
  displayName?: string;
}

export interface CursorSdkModelParameterDefinition {
  id: string;
  displayName?: string;
  values: CursorSdkModelParameterValueDefinition[];
}

export interface CursorSdkModelParameterValue {
  id: string;
  value: string;
}

export interface CursorSdkModelVariant {
  params: CursorSdkModelParameterValue[];
  displayName: string;
  description?: string;
  isDefault?: boolean;
}

export interface CursorSdkModelListItem {
  id: string;
  displayName: string;
  description?: string;
  aliases?: string[];
  parameters?: CursorSdkModelParameterDefinition[];
  variants?: CursorSdkModelVariant[];
}

export interface CursorSdkModelSelection {
  id: string;
  params?: CursorSdkModelParameterValue[];
}

const MODEL_OPTION_PREFIX = "cursor-sdk-model:";
const THINKING_OPTION_PREFIX = "cursor-sdk-thinking:";
const CURSOR_SDK_FAST_MODE_FEATURE: Omit<AgentFeatureToggle, "value"> = {
  type: "toggle",
  id: "fast_mode",
  label: "Fast",
  description: "Lower latency Cursor SDK responses where the selected model supports it",
  tooltip: "Toggle fast mode",
  icon: "zap",
};

interface EncodedModelOption {
  v: 1;
  id: string;
  params?: CursorSdkModelParameterValue[];
}

interface EncodedThinkingOption {
  v: 1;
  param: CursorSdkModelParameterValue;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function encodePayload(payload: EncodedModelOption | EncodedThinkingOption): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodePayload(value: string): unknown {
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function encodeModelOption(selection: CursorSdkModelSelection): string {
  const payload: EncodedModelOption = { v: 1, id: selection.id };
  if (selection.params && selection.params.length > 0) {
    payload.params = selection.params;
  }
  return `${MODEL_OPTION_PREFIX}${encodePayload(payload)}`;
}

function encodeThinkingOption(parameter: CursorSdkModelParameterValue): string {
  return `${THINKING_OPTION_PREFIX}${encodePayload({ v: 1, param: parameter })}`;
}

function decodeModelOptionId(modelId: string): EncodedModelOption | null {
  if (!modelId.startsWith(MODEL_OPTION_PREFIX)) {
    return null;
  }
  const payload = decodePayload(modelId.slice(MODEL_OPTION_PREFIX.length));
  if (!isRecord(payload) || payload.v !== 1 || typeof payload.id !== "string") {
    return null;
  }
  const rawParams = payload.params;
  if (rawParams !== undefined) {
    if (!Array.isArray(rawParams)) {
      return null;
    }
    const params = rawParams.filter(isCursorSdkModelParameterValue);
    if (params.length !== rawParams.length) {
      return null;
    }
    return params.length > 0 ? { v: 1, id: payload.id, params } : { v: 1, id: payload.id };
  }
  return { v: 1, id: payload.id };
}

function decodeThinkingOptionId(thinkingOptionId: string): EncodedThinkingOption | null {
  if (!thinkingOptionId.startsWith(THINKING_OPTION_PREFIX)) {
    return null;
  }
  const payload = decodePayload(thinkingOptionId.slice(THINKING_OPTION_PREFIX.length));
  if (!isRecord(payload) || payload.v !== 1 || !isCursorSdkModelParameterValue(payload.param)) {
    return null;
  }
  return { v: 1, param: payload.param };
}

function isCursorSdkModelParameterValue(value: unknown): value is CursorSdkModelParameterValue {
  return isRecord(value) && typeof value.id === "string" && typeof value.value === "string";
}

function normalizeComparisonValue(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function isContextParameter(parameter: CursorSdkModelParameterDefinition): boolean {
  const id = normalizeComparisonValue(parameter.id);
  const displayName = normalizeComparisonValue(parameter.displayName);
  return id === "context" || id === "context_length" || displayName.includes("context");
}

function isThinkingParameter(parameter: CursorSdkModelParameterDefinition): boolean {
  const id = normalizeComparisonValue(parameter.id);
  const displayName = normalizeComparisonValue(parameter.displayName);
  return (
    id === "reasoning" ||
    id === "effort" ||
    id === "thinking" ||
    id === "thought_level" ||
    displayName.includes("reasoning") ||
    displayName.includes("effort") ||
    displayName.includes("thinking")
  );
}

function isFastParameter(parameter: CursorSdkModelParameterDefinition): boolean {
  const id = normalizeComparisonValue(parameter.id);
  const displayName = normalizeComparisonValue(parameter.displayName);
  return id === "fast" || displayName === "fast";
}

function getModelParameters(model: CursorSdkModelListItem): CursorSdkModelParameterDefinition[] {
  return model.parameters ?? [];
}

function getContextParameter(
  model: CursorSdkModelListItem,
): CursorSdkModelParameterDefinition | null {
  return getModelParameters(model).find(isContextParameter) ?? null;
}

function getFastParameter(model: CursorSdkModelListItem): CursorSdkModelParameterDefinition | null {
  return getModelParameters(model).find(isFastParameter) ?? null;
}

function findParameter(
  model: CursorSdkModelListItem,
  parameterId: string,
): CursorSdkModelParameterDefinition | null {
  return getModelParameters(model).find((parameter) => parameter.id === parameterId) ?? null;
}

function parameterSupportsValue(
  model: CursorSdkModelListItem,
  parameter: CursorSdkModelParameterValue,
): boolean {
  return (
    findParameter(model, parameter.id)?.values.some((value) => value.value === parameter.value) ??
    false
  );
}

function validateModelSelection(
  selection: CursorSdkModelSelection,
  models: readonly CursorSdkModelListItem[],
): CursorSdkModelSelection | null {
  const model = models.find((candidate) => candidate.id === selection.id);
  if (!model) {
    return null;
  }
  const params = selection.params ?? [];
  if (!params.every((parameter) => parameterSupportsValue(model, parameter))) {
    return null;
  }
  return params.length > 0 ? { id: selection.id, params } : { id: selection.id };
}

function findMatchingVariant(
  model: CursorSdkModelListItem,
  params: readonly CursorSdkModelParameterValue[],
): CursorSdkModelVariant | null {
  return (
    model.variants?.find(
      (variant) =>
        variant.params.length === params.length &&
        params.every((parameter) =>
          variant.params.some(
            (candidate) => candidate.id === parameter.id && candidate.value === parameter.value,
          ),
        ),
    ) ?? null
  );
}

function buildContextRows(model: CursorSdkModelListItem): CursorSdkModelSelection[] {
  const contextParameter = getContextParameter(model);
  if (!contextParameter || contextParameter.values.length === 0) {
    return [{ id: model.id }];
  }
  return contextParameter.values.map((value) => ({
    id: model.id,
    params: [{ id: contextParameter.id, value: value.value }],
  }));
}

function buildContextLabel(
  model: CursorSdkModelListItem,
  selection: CursorSdkModelSelection,
): string {
  const contextParam = selection.params?.find((parameter) =>
    findParameter(model, parameter.id)?.values.some((value) => value.value === parameter.value),
  );
  if (!contextParam) {
    return model.displayName;
  }
  const matchingVariant = findMatchingVariant(model, [contextParam]);
  const valueLabel =
    findParameter(model, contextParam.id)?.values.find(
      (value) => value.value === contextParam.value,
    )?.displayName ?? contextParam.value;
  return `${model.displayName} - ${matchingVariant?.displayName ?? valueLabel}`;
}

function formatThinkingLabel(
  parameter: CursorSdkModelParameterDefinition,
  value: CursorSdkModelParameterValueDefinition,
): string {
  if (normalizeComparisonValue(parameter.id) === "thinking") {
    return value.value === "true" ? "Thinking On" : "Thinking Off";
  }
  return value.displayName ?? value.value;
}

function buildThinkingOptions(model: CursorSdkModelListItem): AgentSelectOption[] | undefined {
  const options = getModelParameters(model)
    .filter(isThinkingParameter)
    .flatMap((parameter) =>
      parameter.values.map((value) => {
        const cursorSdkParameter = { id: parameter.id, value: value.value };
        return {
          id: encodeThinkingOption(cursorSdkParameter),
          label: formatThinkingLabel(parameter, value),
          metadata: { cursorSdkParameter },
        } satisfies AgentSelectOption;
      }),
    );
  return options.length > 0 ? options : undefined;
}

export function expandCursorSdkModels(
  models: readonly CursorSdkModelListItem[],
): AgentModelDefinition[] {
  return models.flatMap((model) => {
    const thinkingOptions = buildThinkingOptions(model);
    return buildContextRows(model).map((selection) => ({
      provider: "cursor-sdk",
      id: encodeModelOption(selection),
      label: buildContextLabel(model, selection),
      description: model.description,
      metadata: {
        cursorSdkModelSelection: selection,
      },
      thinkingOptions,
    }));
  });
}

export function decodeCursorSdkModelOptionId(
  modelId: string | null | undefined,
  models: readonly CursorSdkModelListItem[],
): CursorSdkModelSelection | null {
  if (!modelId) {
    return null;
  }
  const decoded = decodeModelOptionId(modelId);
  if (!decoded) {
    return models.some((model) => model.id === modelId) ? { id: modelId } : null;
  }
  return validateModelSelection(
    decoded.params && decoded.params.length > 0
      ? { id: decoded.id, params: decoded.params }
      : { id: decoded.id },
    models,
  );
}

export function isCursorSdkEncodedModelOptionId(modelId: string | null | undefined): boolean {
  return typeof modelId === "string" && modelId.startsWith(MODEL_OPTION_PREFIX);
}

function mergeParameter(
  params: CursorSdkModelParameterValue[],
  next: CursorSdkModelParameterValue,
): CursorSdkModelParameterValue[] {
  return params.some((parameter) => parameter.id === next.id)
    ? params.map((parameter) => (parameter.id === next.id ? next : parameter))
    : params.concat(next);
}

export function buildCursorSdkSendModelSelection(input: {
  modelId: string | null | undefined;
  thinkingOptionId?: string | null;
  featureValues?: Record<string, unknown> | undefined;
  models: readonly CursorSdkModelListItem[];
}): CursorSdkModelSelection | null {
  const baseSelection = decodeCursorSdkModelOptionId(input.modelId, input.models);
  if (!baseSelection) {
    return null;
  }
  const model = input.models.find((candidate) => candidate.id === baseSelection.id);
  if (!model) {
    return null;
  }

  let params = [...(baseSelection.params ?? [])];
  if (input.thinkingOptionId) {
    const thinking = decodeThinkingOptionId(input.thinkingOptionId);
    if (!thinking || !parameterSupportsValue(model, thinking.param)) {
      return null;
    }
    params = mergeParameter(params, thinking.param);
  }

  if (input.featureValues?.fast_mode === true) {
    const fastParameter = getFastParameter(model);
    if (!fastParameter?.values.some((value) => value.value === "true")) {
      return null;
    }
    params = mergeParameter(params, { id: fastParameter.id, value: "true" });
  }

  return params.length > 0 ? { id: baseSelection.id, params } : { id: baseSelection.id };
}

export function buildCursorSdkFeatures(input: {
  modelId: string | null | undefined;
  models: readonly CursorSdkModelListItem[];
  featureValues?: Record<string, unknown> | undefined;
}): AgentFeature[] {
  const selection = decodeCursorSdkModelOptionId(input.modelId, input.models);
  if (!selection) {
    return [];
  }
  const model = input.models.find((candidate) => candidate.id === selection.id);
  if (!model) {
    return [];
  }
  const fastParameter = getFastParameter(model);
  if (!fastParameter?.values.some((value) => value.value === "true")) {
    return [];
  }
  return [
    {
      ...CURSOR_SDK_FAST_MODE_FEATURE,
      value: input.featureValues?.fast_mode === true,
    },
  ];
}
