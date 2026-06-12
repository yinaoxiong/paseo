import { basename } from "node:path";
import type { ClientCapabilities, SessionConfigOption } from "@agentclientprotocol/sdk";
import type { Logger } from "pino";

import type {
  AgentModelDefinition,
  AgentSelectOption,
  ListModelsOptions,
} from "../agent-sdk-types.js";
import { GenericACPAgentClient } from "./generic-acp-agent.js";
import type {
  ACPProviderModelWriterContext,
  ACPProviderModelWriteResult,
  SpawnedACPProcess,
} from "./acp-agent.js";

interface CursorACPAgentClientOptions {
  logger: Logger;
  command: [string, ...string[]];
  env?: Record<string, string>;
  providerId?: string;
  label?: string;
  providerParams?: unknown;
}

const CURSOR_INITIAL_COMMANDS_WAIT_TIMEOUT_MS = 10_000;
const CURSOR_LIST_AVAILABLE_MODELS_METHOD = "cursor/list_available_models";
const CURSOR_PARAMETERIZED_MODEL_PICKER_CAPABILITIES: ClientCapabilities = {
  fs: {
    readTextFile: true,
    writeTextFile: true,
  },
  terminal: true,
  _meta: {
    parameterizedModelPicker: true,
  },
};
const CURSOR_PROBE_ENV: Record<string, string> = { NO_BROWSER: "true" };

export class CursorACPAgentClient extends GenericACPAgentClient {
  private readonly cursorCommand: [string, ...string[]];

  constructor(options: CursorACPAgentClientOptions) {
    super({
      logger: options.logger,
      command: options.command,
      env: options.env,
      providerId: options.providerId,
      label: options.label,
      providerParams: options.providerParams,
      clientCapabilities: CURSOR_PARAMETERIZED_MODEL_PICKER_CAPABILITIES,
      modelWriter: writeCursorModelVariant,
      // cursor-agent publishes slash commands asynchronously via available_commands_update.
      waitForInitialCommands: true,
      initialCommandsWaitTimeoutMs: CURSOR_INITIAL_COMMANDS_WAIT_TIMEOUT_MS,
    });
    this.cursorCommand = options.command;
  }

  override async listModels(options: ListModelsOptions): Promise<AgentModelDefinition[]> {
    if (this.canUseCursorModelsFallback()) {
      const models = await this.listCursorModelsFromACP(options);
      if (models.length > 0) {
        return models;
      }
    }

    const acpModels = await super.listModels(options);
    if (acpModels.length > 0) {
      return acpModels;
    }

    return acpModels;
  }

  private canUseCursorModelsFallback(): boolean {
    return basename(this.cursorCommand[0]) === "cursor-agent";
  }

  private async listCursorModelsFromACP(
    options: ListModelsOptions,
  ): Promise<AgentModelDefinition[]> {
    let probe: SpawnedACPProcess | null = null;
    try {
      const activeProbe = await this.spawnProcess(CURSOR_PROBE_ENV);
      probe = activeProbe;
      const session = await this.runACPRequest(() =>
        activeProbe.connection.newSession({
          cwd: options.cwd,
          mcpServers: [],
        }),
      );
      const response = await this.runACPRequest(() =>
        activeProbe.connection.extMethod(CURSOR_LIST_AVAILABLE_MODELS_METHOD, {}),
      );
      return expandCursorParameterizedModels(response, session.models?.currentModelId ?? null);
    } catch (error) {
      this.logger.warn(
        { err: error, provider: "cursor" },
        "Failed to list Cursor parameterized models via ACP extension",
      );
      return [];
    } finally {
      if (probe) {
        await this.closeProbe(probe);
      }
    }
  }
}

type CursorSelectConfigOption = Extract<SessionConfigOption, { type: "select" }>;

interface CursorSelectChoice {
  value: string;
  name: string;
  description?: string | null;
}

interface CursorModelConfig {
  value: string;
  name: string;
  configOptions: CursorSelectConfigOption[];
}

interface CursorModelParameter {
  id: string;
  value: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function isCursorSelectChoice(value: unknown): value is CursorSelectChoice {
  return isRecord(value) && typeof value.value === "string" && typeof value.name === "string";
}

function flattenCursorSelectOptions(
  options: CursorSelectConfigOption["options"],
): CursorSelectChoice[] {
  const result: CursorSelectChoice[] = [];
  for (const option of options) {
    if (isCursorSelectChoice(option)) {
      result.push(option);
      continue;
    }
    if (isRecord(option) && Array.isArray(option.options)) {
      result.push(
        ...flattenCursorSelectOptions(option.options as CursorSelectConfigOption["options"]),
      );
    }
  }
  return result;
}

function isCursorSelectConfigOption(value: unknown): value is CursorSelectConfigOption {
  return (
    isRecord(value) &&
    value.type === "select" &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    Array.isArray(value.options)
  );
}

function parseCursorAvailableModelsResponse(response: unknown): CursorModelConfig[] {
  if (!isRecord(response) || !Array.isArray(response.models)) {
    return [];
  }

  return response.models.flatMap((model): CursorModelConfig[] => {
    if (!isRecord(model) || typeof model.value !== "string" || typeof model.name !== "string") {
      return [];
    }
    const configOptions = Array.isArray(model.configOptions)
      ? model.configOptions.filter(isCursorSelectConfigOption)
      : [];
    return [{ value: model.value, name: model.name, configOptions }];
  });
}

function isThoughtConfigOption(
  option: Pick<SessionConfigOption, "id" | "name" | "category">,
): boolean {
  const id = option.id.trim().toLowerCase();
  const name = option.name.trim().toLowerCase();
  return (
    option.category === "thought_level" ||
    id === "reasoning" ||
    id === "thinking" ||
    id === "effort" ||
    id === "thought_level" ||
    name.includes("reasoning") ||
    name.includes("thinking") ||
    name.includes("effort")
  );
}

function formatCursorModelVariantId(modelId: string, parameters: CursorModelParameter[]): string {
  const normalized = parameters
    .filter((parameter) => parameter.id && parameter.value)
    .sort((left, right) => left.id.localeCompare(right.id));
  if (normalized.length === 0) {
    return modelId;
  }
  return `${modelId}[${normalized
    .map((parameter) => `${parameter.id}=${parameter.value}`)
    .join(",")}]`;
}

function parseCursorModelVariantId(modelId: string): {
  modelId: string;
  parameters: CursorModelParameter[];
} | null {
  const match = /^([^[\]]+)(?:\[(.*)\])?$/.exec(modelId.trim());
  if (!match) {
    return null;
  }
  const baseModelId = match[1]?.trim();
  if (!baseModelId) {
    return null;
  }
  const rawParameters = match[2]?.trim();
  if (!rawParameters) {
    return { modelId: baseModelId, parameters: [] };
  }
  const parameters = rawParameters
    .split(",")
    .map((entry) => {
      const separatorIndex = entry.indexOf("=");
      if (separatorIndex <= 0) {
        return null;
      }
      const id = entry.slice(0, separatorIndex).trim();
      const value = entry.slice(separatorIndex + 1).trim();
      return id && value ? { id, value } : null;
    })
    .filter((parameter): parameter is CursorModelParameter => parameter !== null);
  return { modelId: baseModelId, parameters };
}

function getCurrentSelectValue(option: CursorSelectConfigOption): string | null {
  return typeof option.currentValue === "string" && option.currentValue
    ? option.currentValue
    : (flattenCursorSelectOptions(option.options)[0]?.value ?? null);
}

function buildCursorParameterCombinations(
  options: CursorSelectConfigOption[],
): CursorModelParameter[][] {
  let combinations: CursorModelParameter[][] = [[]];
  for (const option of options) {
    const choices = flattenCursorSelectOptions(option.options);
    if (choices.length === 0) {
      continue;
    }
    combinations = combinations.flatMap((combination) =>
      choices.map((choice) => combination.concat({ id: option.id, value: choice.value })),
    );
  }
  return combinations;
}

function buildCursorVariantLabel(
  model: CursorModelConfig,
  parameters: CursorModelParameter[],
): string {
  const parts: string[] = [];
  for (const parameter of parameters) {
    const option = model.configOptions.find((candidate) => candidate.id === parameter.id);
    const choice = option
      ? flattenCursorSelectOptions(option.options).find(
          (candidate) => candidate.value === parameter.value,
        )
      : null;
    if (!choice) {
      continue;
    }
    if (parameter.id === "fast" && parameter.value === "false") {
      continue;
    }
    parts.push(choice.name);
  }
  return parts.length > 0 ? `${model.name} ${parts.join(" ")}` : model.name;
}

function buildCursorThinkingOptions(
  option: CursorSelectConfigOption | undefined,
): AgentSelectOption[] | undefined {
  if (!option) {
    return undefined;
  }
  const choices = flattenCursorSelectOptions(option.options);
  if (choices.length === 0) {
    return undefined;
  }
  return choices.map((choice) => ({
    id: choice.value,
    label: choice.name,
    description: choice.description ?? undefined,
    isDefault: choice.value === option.currentValue,
  }));
}

function isCursorVariantDefault(
  model: CursorModelConfig,
  currentModelId: string | null,
  parameters: CursorModelParameter[],
): boolean {
  if (model.value !== currentModelId) {
    return false;
  }
  return parameters.every((parameter) => {
    const option = model.configOptions.find((candidate) => candidate.id === parameter.id);
    return option ? getCurrentSelectValue(option) === parameter.value : false;
  });
}

export function expandCursorParameterizedModels(
  response: unknown,
  currentModelId: string | null,
): AgentModelDefinition[] {
  const models = parseCursorAvailableModelsResponse(response);
  return models.flatMap((model) => {
    const thinkingOption = model.configOptions.find(isThoughtConfigOption);
    const thinkingOptions = buildCursorThinkingOptions(thinkingOption);
    const defaultThinkingOptionId =
      thinkingOptions?.find((option) => option.isDefault)?.id ?? thinkingOptions?.[0]?.id;
    const modelConfigOptions = model.configOptions.filter(
      (option) => !isThoughtConfigOption(option),
    );
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

export async function writeCursorModelVariant(
  context: ACPProviderModelWriterContext,
): Promise<ACPProviderModelWriteResult> {
  const parsed = parseCursorModelVariantId(context.requestedModelId);
  const modelOption = context.selection.configOption;
  if (!parsed || !modelOption) {
    return { handled: false };
  }

  let configOptions = context.configOptions;
  const modelResponse = await context.connection.setSessionConfigOption({
    sessionId: context.sessionId,
    configId: modelOption.id,
    value: parsed.modelId,
  });
  configOptions = modelResponse.configOptions;

  let thinkingOptionId: string | undefined;
  for (const parameter of parsed.parameters) {
    const response = await context.connection.setSessionConfigOption({
      sessionId: context.sessionId,
      configId: parameter.id,
      value: parameter.value,
    });
    configOptions = response.configOptions;
    const option = configOptions.find(
      (candidate) => candidate.id === parameter.id && candidate.type === "select",
    );
    if (option && isThoughtConfigOption(option)) {
      thinkingOptionId = parameter.value;
    }
  }

  return {
    handled: true,
    currentModelId: context.requestedModelId,
    thinkingOptionId,
    configOptions,
  };
}
