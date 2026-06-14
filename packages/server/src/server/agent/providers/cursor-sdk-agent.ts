import { randomUUID } from "node:crypto";
import type { AgentOptions, LocalAgentStore, Run, SDKAgent } from "@cursor/sdk";
import type { Logger } from "pino";

import type {
  AgentCapabilityFlags,
  AgentClient,
  AgentCreateConfigUnattendedInput,
  AgentFeature,
  AgentLaunchContext,
  AgentMode,
  AgentModelDefinition,
  AgentPersistenceHandle,
  AgentPromptInput,
  AgentRunOptions,
  AgentRunResult,
  AgentRuntimeInfo,
  AgentSession,
  AgentSessionConfig,
  AgentStreamEvent,
  ListModelsOptions,
  ListModesOptions,
  ResolveAgentCreateConfigInput,
  ResolveAgentCreateConfigResult,
} from "../agent-sdk-types.js";
import { resolveDefaultAgentCreateConfig } from "../create-agent-mode.js";
import type { ProviderRuntimeSettings } from "../provider-launch-config.js";
import { renderPromptAttachmentAsText } from "../prompt-attachments.js";
import { runProviderTurn } from "./provider-runner.js";
import {
  CURSOR_SDK_CANCEL_UNSUPPORTED_CODE,
  formatCursorSdkDiagnostic,
  redactCursorSdkDiagnosticValue,
  toCursorSdkDiagnostic,
  type CursorSdkApiKeySource,
  type CursorSdkDiagnostic,
} from "./cursor-sdk/diagnostics.js";
import { mapCursorSdkStreamEvent, mapCursorSdkTerminalStatus } from "./cursor-sdk/event-mapper.js";
import {
  buildCursorSdkFeatures,
  buildCursorSdkSendModelSelection,
  expandCursorSdkModels,
  isCursorSdkEncodedModelOptionId,
  type CursorSdkModelListItem,
  type CursorSdkModelSelection,
} from "./cursor-sdk/model-options.js";
import {
  CURSOR_SDK_SANDBOX_MODE,
  CURSOR_SDK_YOLO_MODE,
  listCursorSdkModes,
  resolveCursorSdkMode,
} from "./cursor-sdk/modes.js";
import {
  assertCursorSdkStorePath,
  buildCursorSdkStorePath,
  createCursorSdkPersistenceHandle,
  parseCursorSdkPersistenceHandle,
} from "./cursor-sdk/persistence.js";
import {
  ProductionCursorSdkRuntime,
  type CursorSdkRuntime,
  type CursorSdkRuntimeModel,
  type CursorSdkRuntimeReadiness,
  type CursorSdkSandboxSupport,
} from "./cursor-sdk/sdk-runtime.js";

const CURSOR_SDK_CAPABILITIES: AgentCapabilityFlags = {
  supportsStreaming: true,
  supportsSessionPersistence: true,
  supportsDynamicModes: true,
  supportsMcpServers: false,
  supportsReasoningStream: true,
  supportsToolInvocations: true,
};

export interface CursorSdkAgentClientOptions {
  logger: Logger;
  runtimeSettings?: ProviderRuntimeSettings;
  runtime?: CursorSdkRuntime;
}

interface ResolvedCursorSdkApiKey {
  apiKey?: string;
  source: CursorSdkApiKeySource;
}

interface CursorSdkPreflightResult {
  apiKey: string;
  apiKeySource: Exclude<CursorSdkApiKeySource, "missing">;
  readiness: CursorSdkRuntimeReadiness;
}

type CursorSdkModeId = "sandbox" | "yolo";

function modeIdToSandboxEnabled(modeId: CursorSdkModeId): boolean {
  return modeId === CURSOR_SDK_SANDBOX_MODE.id;
}

function normalizeCursorSdkModel(model: string | null | undefined): string | null {
  if (typeof model !== "string") {
    return null;
  }
  const normalized = model.trim();
  return normalized.length > 0 ? normalized : null;
}

function redactedCursorSdkErrorMessage(
  error: unknown,
  fallback: string,
  secrets: Array<string | undefined> = [],
): string {
  const raw = error instanceof Error && error.message.trim().length > 0 ? error.message : fallback;
  return redactCursorSdkDiagnosticValue(raw, secrets) ?? fallback;
}

function redactedCursorSdkError(
  error: unknown,
  fallback: string,
  secrets: Array<string | undefined> = [],
): Error {
  return new Error(redactedCursorSdkErrorMessage(error, fallback, secrets));
}

function buildCursorSdkAgentOptions(input: {
  apiKey: string;
  model?: CursorSdkModelSelection | null;
  cwd: string;
  store: LocalAgentStore;
  sandboxEnabled: boolean;
}): AgentOptions {
  return {
    apiKey: input.apiKey,
    ...(input.model ? { model: input.model } : {}),
    mode: "agent",
    local: {
      cwd: input.cwd,
      store: input.store,
      sandboxOptions: { enabled: input.sandboxEnabled },
    },
  };
}

interface CursorSdkSessionInit {
  sessionId: string;
  sdkAgent: SDKAgent;
  config: AgentSessionConfig;
  storePath: string;
  model?: string | null;
  modeId: CursorSdkModeId;
  sandboxEnabled: boolean;
  availableModes: AgentMode[];
  modelOptions: CursorSdkModelListItem[];
  thinkingOptionId?: string | null;
  featureValues?: Record<string, unknown>;
  redactionSecrets: string[];
}

class CursorSdkAgentSession implements AgentSession {
  readonly provider = "cursor-sdk" as const;
  readonly capabilities = CURSOR_SDK_CAPABILITIES;
  readonly id: string;

  private readonly storePath: string;
  private readonly config: AgentSessionConfig;
  private readonly subscribers = new Set<(event: AgentStreamEvent) => void>();
  private availableModes: AgentMode[];
  private sdkAgent: SDKAgent | null;
  private model: string | null;
  private thinkingOptionId: string | null;
  private featureValues: Record<string, unknown>;
  private modelOptions: CursorSdkModelListItem[];
  private modeId: CursorSdkModeId;
  private sandboxEnabled: boolean;
  private activeRun: Run | null = null;
  private readonly redactionSecrets: string[];
  private pendingSend: Promise<void> | null = null;
  private activeForegroundTurnId: string | null = null;
  private recentStreamDiagnostic: string | null = null;
  private closed = false;

  constructor(input: CursorSdkSessionInit) {
    this.id = input.sessionId;
    this.sdkAgent = input.sdkAgent;
    this.config = { ...input.config, provider: this.provider };
    this.storePath = input.storePath;
    this.model = input.model ?? null;
    this.thinkingOptionId = input.thinkingOptionId ?? null;
    this.featureValues = { ...input.featureValues };
    this.modelOptions = input.modelOptions;
    this.modeId = input.modeId;
    this.sandboxEnabled = input.sandboxEnabled;
    this.availableModes = input.availableModes;
    this.redactionSecrets = input.redactionSecrets;
  }

  get features(): AgentFeature[] {
    return buildCursorSdkFeatures({
      modelId: this.model,
      models: this.modelOptions,
      featureValues: this.featureValues,
    });
  }

  async run(prompt: AgentPromptInput, options?: AgentRunOptions): Promise<AgentRunResult> {
    return runProviderTurn({
      prompt,
      runOptions: options,
      startTurn: (p, o) => this.startTurn(p, o),
      subscribe: (callback) => this.subscribe(callback),
      getSessionId: () => this.id,
    });
  }

  async startTurn(
    prompt: AgentPromptInput,
    options?: AgentRunOptions,
  ): Promise<{ turnId: string }> {
    if (this.closed || !this.sdkAgent) {
      throw new Error("Cursor SDK session is closed");
    }
    if (this.activeForegroundTurnId) {
      throw new Error("A foreground turn is already active");
    }

    const turnId = randomUUID();
    const promptText = this.toPromptText(prompt);
    const messageId = options?.messageId ?? `cursor-sdk-user-${turnId}`;
    this.activeForegroundTurnId = turnId;
    this.recentStreamDiagnostic = null;
    this.emit({ type: "turn_started", provider: this.provider, turnId });
    this.emit({
      type: "timeline",
      provider: this.provider,
      turnId,
      item: { type: "user_message", text: promptText, messageId },
    });
    this.scheduleSendAndPump(promptText, turnId);

    return { turnId };
  }

  subscribe(_callback: (event: AgentStreamEvent) => void): () => void {
    this.subscribers.add(_callback);
    return () => {
      this.subscribers.delete(_callback);
    };
  }

  async *streamHistory(): AsyncGenerator<AgentStreamEvent> {}

  async getRuntimeInfo(): Promise<AgentRuntimeInfo> {
    return {
      provider: this.provider,
      sessionId: this.id,
      model: this.model,
      thinkingOptionId: this.thinkingOptionId,
      modeId: this.modeId,
      extra: {
        runtime: "local",
        nativeHandle: this.sdkAgent?.agentId ?? null,
      },
    };
  }

  async getAvailableModes(): Promise<AgentMode[]> {
    return this.availableModes;
  }

  async getCurrentMode(): Promise<string | null> {
    return this.modeId;
  }

  async setMode(modeId: string): Promise<void> {
    const mode = resolveCursorSdkMode(modeId);
    const nextModeId = mode.id as CursorSdkModeId;
    const nextSandboxEnabled = modeIdToSandboxEnabled(nextModeId);
    if (nextSandboxEnabled !== this.sandboxEnabled) {
      throw new Error(
        "Cursor SDK sandbox mode changes require a new session with fresh SDK local options",
      );
    }
    this.modeId = nextModeId;
    this.sandboxEnabled = nextSandboxEnabled;
    this.emit({
      type: "mode_changed",
      provider: this.provider,
      currentModeId: this.modeId,
      availableModes: this.availableModes,
    });
  }

  getPendingPermissions(): [] {
    return [];
  }

  async respondToPermission(): Promise<void> {}

  describePersistence(): AgentPersistenceHandle | null {
    if (!this.sdkAgent) {
      return null;
    }
    return createCursorSdkPersistenceHandle({
      sessionId: this.id,
      sdkAgentId: this.sdkAgent.agentId,
      cwd: this.config.cwd,
      storePath: this.storePath,
      model: this.model,
      modeId: this.modeId,
      sandboxEnabled: this.sandboxEnabled,
    });
  }

  async interrupt(): Promise<void> {
    if (!this.activeRun && this.pendingSend) {
      await this.pendingSend;
    }
    const activeRun = this.activeRun;
    if (!activeRun) {
      return;
    }
    if (!activeRun.supports("cancel")) {
      const reason =
        activeRun.unsupportedReason("cancel") ?? "Cursor SDK run does not support cancel";
      this.finishTurn({
        type: "turn_failed",
        provider: this.provider,
        turnId: this.activeForegroundTurnId ?? undefined,
        error: reason,
        code: CURSOR_SDK_CANCEL_UNSUPPORTED_CODE,
        diagnostic: this.formatDiagnostic(new Error(reason), "interrupt"),
      });
      return;
    }
    await activeRun.cancel();
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.activeRun = null;
    this.pendingSend = null;
    this.activeForegroundTurnId = null;
    this.subscribers.clear();
    const agent = this.sdkAgent;
    this.sdkAgent = null;
    if (!agent) {
      return;
    }
    if (Symbol.asyncDispose in agent && typeof agent[Symbol.asyncDispose] === "function") {
      await agent[Symbol.asyncDispose]();
      return;
    }
    agent.close();
  }

  async setModel(modelId: string | null): Promise<void> {
    const nextModel = normalizeCursorSdkModel(modelId);
    if (
      nextModel &&
      isCursorSdkEncodedModelOptionId(nextModel) &&
      !buildCursorSdkSendModelSelection({
        modelId: nextModel,
        thinkingOptionId: null,
        featureValues: {},
        models: this.modelOptions,
      })
    ) {
      throw new Error(`Unknown Cursor SDK model: ${nextModel}`);
    }

    this.model = nextModel;
    if (
      this.thinkingOptionId &&
      !buildCursorSdkSendModelSelection({
        modelId: this.model,
        thinkingOptionId: this.thinkingOptionId,
        featureValues: {},
        models: this.modelOptions,
      })
    ) {
      this.thinkingOptionId = null;
    }
    if (buildCursorSdkFeatures({ modelId: this.model, models: this.modelOptions }).length === 0) {
      delete this.featureValues.fast_mode;
    }
    this.emit({
      type: "model_changed",
      provider: this.provider,
      runtimeInfo: await this.getRuntimeInfo(),
    });
  }

  async setThinkingOption(thinkingOptionId: string | null): Promise<void> {
    const normalizedThinkingOptionId =
      typeof thinkingOptionId === "string" && thinkingOptionId.trim().length > 0
        ? thinkingOptionId
        : null;
    if (
      normalizedThinkingOptionId &&
      !buildCursorSdkSendModelSelection({
        modelId: this.model,
        thinkingOptionId: normalizedThinkingOptionId,
        featureValues: {},
        models: this.modelOptions,
      })
    ) {
      throw new Error(`Unknown Cursor SDK thinking option: ${normalizedThinkingOptionId}`);
    }
    this.thinkingOptionId = normalizedThinkingOptionId;
  }

  async setFeature(featureId: string, value: unknown): Promise<void> {
    if (featureId !== "fast_mode") {
      throw new Error(`Unknown Cursor SDK feature: ${featureId}`);
    }
    const enabled = value === true;
    if (
      enabled &&
      buildCursorSdkFeatures({ modelId: this.model, models: this.modelOptions }).length === 0
    ) {
      throw new Error(
        `Cursor SDK fast mode is not available for model '${this.model ?? "default"}'`,
      );
    }
    this.featureValues = { ...this.featureValues, fast_mode: enabled };
  }

  private buildSendOptions(): Parameters<SDKAgent["send"]>[1] {
    if (!this.model) {
      return undefined;
    }
    const model = buildCursorSdkSendModelSelection({
      modelId: this.model,
      thinkingOptionId: this.thinkingOptionId,
      featureValues: this.featureValues,
      models: this.modelOptions,
    });
    if (!model) {
      throw new Error("Cursor SDK model selection is no longer available");
    }
    return { model };
  }

  private scheduleSendAndPump(promptText: string, turnId: string): void {
    let pending: Promise<void>;
    pending = new Promise((resolve) => {
      setImmediate(() => {
        void this.sendAndPump(promptText, turnId).finally(() => {
          if (this.pendingSend === pending) {
            this.pendingSend = null;
          }
          resolve();
        });
      });
    });
    this.pendingSend = pending;
  }

  private async sendAndPump(promptText: string, turnId: string): Promise<void> {
    if (this.closed || !this.sdkAgent || this.activeForegroundTurnId !== turnId) {
      return;
    }
    try {
      const run = await this.sdkAgent.send(promptText, this.buildSendOptions());
      if (this.closed || this.activeForegroundTurnId !== turnId) {
        return;
      }
      this.activeRun = run;
      void this.pumpRun(run, turnId);
    } catch (error) {
      this.finishTurn({
        type: "turn_failed",
        provider: this.provider,
        turnId,
        error: this.redactErrorMessage(error, "Cursor SDK send failed"),
        diagnostic: this.formatDiagnostic(error, "startTurn"),
      });
    }
  }

  private async pumpRun(run: Run, turnId: string): Promise<void> {
    try {
      for await (const message of run.stream()) {
        const mapped = mapCursorSdkStreamEvent(message, {
          turnId,
          runId: run.id,
          requestId: run.requestId,
          secrets: this.redactionSecrets,
        });
        if (mapped.diagnostic) {
          this.recentStreamDiagnostic = formatCursorSdkDiagnostic(mapped.diagnostic);
        }
        for (const event of mapped.events) {
          this.emit(event);
        }
      }
      const result = await run.wait();
      const terminalEvent = mapCursorSdkTerminalStatus(result, {
        turnId,
        runId: run.id,
        requestId: run.requestId,
        secrets: this.redactionSecrets,
      });
      if (terminalEvent.type === "turn_failed" && !terminalEvent.diagnostic) {
        this.finishTurn({
          ...terminalEvent,
          diagnostic: this.recentStreamDiagnostic ?? this.formatDiagnostic(result, "wait"),
        });
        return;
      }
      this.finishTurn(terminalEvent);
    } catch (error) {
      this.finishTurn({
        type: "turn_failed",
        provider: this.provider,
        turnId,
        error: this.redactErrorMessage(error, "Cursor SDK run failed"),
        diagnostic: this.formatDiagnostic(error, "run"),
      });
    }
  }

  private finishTurn(
    event: Extract<AgentStreamEvent, { type: "turn_completed" | "turn_failed" | "turn_canceled" }>,
  ): void {
    if (
      this.activeForegroundTurnId &&
      event.turnId &&
      this.activeForegroundTurnId !== event.turnId
    ) {
      return;
    }
    this.emit(event);
    this.activeRun = null;
    this.activeForegroundTurnId = null;
  }

  private emit(event: AgentStreamEvent): void {
    for (const subscriber of this.subscribers) {
      subscriber(event);
    }
  }

  private toPromptText(prompt: AgentPromptInput): string {
    if (typeof prompt === "string") {
      return prompt;
    }
    return prompt
      .map((block) => {
        if ("type" in block && block.type === "text") {
          return block.text;
        }
        if ("type" in block && block.type === "image") {
          throw new Error("Cursor SDK does not support image prompt blocks");
        }
        return renderPromptAttachmentAsText(block);
      })
      .filter((text) => text.trim().length > 0)
      .join("\n\n");
  }

  private redactErrorMessage(error: unknown, fallback: string): string {
    return redactedCursorSdkErrorMessage(error, fallback, this.redactionSecrets);
  }

  private formatDiagnostic(error: unknown, operation: string): string {
    return formatCursorSdkDiagnostic(
      toCursorSdkDiagnostic(error, {
        operation,
        model: this.model,
        sandboxEnabled: this.sandboxEnabled,
        sdkAgentId: this.sdkAgent?.agentId,
        runId: this.activeRun?.id,
        requestId: this.activeRun?.requestId,
        secrets: this.redactionSecrets,
      }),
    );
  }
}

export class CursorSdkAgentClient implements AgentClient {
  readonly provider = "cursor-sdk" as const;
  readonly capabilities = CURSOR_SDK_CAPABILITIES;

  private readonly logger: Logger;
  private readonly runtimeSettings?: ProviderRuntimeSettings;
  private readonly runtime: CursorSdkRuntime;
  private lastReadiness: CursorSdkRuntimeReadiness | null = null;
  private lastSandboxSupport: CursorSdkSandboxSupport | null = null;
  private lastDiagnostic: CursorSdkDiagnostic | null = null;

  constructor(options: CursorSdkAgentClientOptions) {
    this.logger = options.logger.child({ module: "agent", provider: "cursor-sdk" });
    this.runtimeSettings = options.runtimeSettings;
    this.runtime = options.runtime ?? new ProductionCursorSdkRuntime();
  }

  async createSession(
    config: AgentSessionConfig,
    launchContext?: AgentLaunchContext,
  ): Promise<AgentSession> {
    const modeId = this.resolveRequestedModeId(config.modeId);
    const model = normalizeCursorSdkModel(config.model);
    const preflight = await this.preflight("createSession", { modeId, model });
    const modelOptions = await this.resolveSessionModelOptions({
      model,
      thinkingOptionId: config.thinkingOptionId,
      featureValues: config.featureValues,
      preflight,
      operation: "createSession",
    });
    const sdkModel = model
      ? buildCursorSdkSendModelSelection({
          modelId: model,
          thinkingOptionId: config.thinkingOptionId,
          featureValues: config.featureValues,
          models: modelOptions,
        })
      : null;
    if (model && !sdkModel) {
      throw new Error("Cursor SDK model selection is no longer available");
    }
    await this.assertModeSupported(modeId, "createSession");
    const paseoHome = this.resolvePaseoHome();
    const sessionId = launchContext?.agentId ?? randomUUID();
    const storePath = buildCursorSdkStorePath({ paseoHome, sessionId });
    await assertCursorSdkStorePath({ paseoHome, sessionId, storePath });
    const store = await this.runtime.createJsonlStore(storePath);
    const sandboxEnabled = modeIdToSandboxEnabled(modeId);
    const availableModes = await this.getAvailableModesForSession();
    try {
      const sdkAgent = await this.runtime.createAgent(
        buildCursorSdkAgentOptions({
          apiKey: preflight.apiKey,
          model: sdkModel,
          cwd: config.cwd,
          store,
          sandboxEnabled,
        }),
      );
      return new CursorSdkAgentSession({
        sessionId,
        sdkAgent,
        config: { ...config, provider: this.provider, modeId, model: model ?? undefined },
        storePath,
        model,
        modeId,
        sandboxEnabled,
        availableModes,
        modelOptions,
        thinkingOptionId: config.thinkingOptionId,
        featureValues: config.featureValues,
        redactionSecrets: [preflight.apiKey],
      });
    } catch (error) {
      this.lastDiagnostic = toCursorSdkDiagnostic(error, {
        operation: "createSession",
        apiKeySource: preflight.apiKeySource,
        model,
        sandboxEnabled,
        secrets: [preflight.apiKey],
      });
      throw redactedCursorSdkError(error, "Cursor SDK create failed", [preflight.apiKey]);
    }
  }

  async resumeSession(
    handle: AgentPersistenceHandle,
    overrides?: Partial<AgentSessionConfig>,
  ): Promise<AgentSession> {
    const paseoHome = this.resolvePaseoHome();
    const parsed = await parseCursorSdkPersistenceHandle(handle, { paseoHome });
    const metadata = parsed.metadata;
    const modeId = this.resolveRequestedModeId(overrides?.modeId ?? metadata.modeId);
    const model = normalizeCursorSdkModel(overrides?.model ?? metadata.model);
    const preflight = await this.preflight("resumeSession", { modeId, model });
    const thinkingOptionId = overrides?.thinkingOptionId;
    const featureValues = overrides?.featureValues;
    const modelOptions = await this.resolveSessionModelOptions({
      model,
      thinkingOptionId,
      featureValues,
      preflight,
      operation: "resumeSession",
    });
    const sdkModel = model
      ? buildCursorSdkSendModelSelection({
          modelId: model,
          thinkingOptionId,
          featureValues,
          models: modelOptions,
        })
      : null;
    if (model && !sdkModel) {
      throw new Error("Cursor SDK model selection is no longer available");
    }
    await this.assertModeSupported(modeId, "resumeSession");
    const storePath = await assertCursorSdkStorePath({
      paseoHome,
      sessionId: parsed.sessionId,
      storePath: metadata.storePath,
    });
    const store = await this.runtime.createJsonlStore(storePath);
    const sandboxEnabled = modeIdToSandboxEnabled(modeId);
    const availableModes = await this.getAvailableModesForSession();
    try {
      const sdkAgent = await this.runtime.resumeAgent(
        parsed.sdkAgentId,
        buildCursorSdkAgentOptions({
          apiKey: preflight.apiKey,
          model: sdkModel,
          cwd: metadata.cwd,
          store,
          sandboxEnabled,
        }),
      );
      return new CursorSdkAgentSession({
        sessionId: parsed.sessionId,
        sdkAgent,
        config: {
          provider: this.provider,
          cwd: metadata.cwd,
          modeId,
          model: model ?? undefined,
        },
        storePath,
        model,
        modeId,
        sandboxEnabled,
        availableModes,
        modelOptions,
        thinkingOptionId,
        featureValues,
        redactionSecrets: [preflight.apiKey],
      });
    } catch (error) {
      this.lastDiagnostic = toCursorSdkDiagnostic(error, {
        operation: "resumeSession",
        apiKeySource: preflight.apiKeySource,
        model,
        sandboxEnabled,
        sdkAgentId: parsed.sdkAgentId,
        secrets: [preflight.apiKey],
      });
      throw redactedCursorSdkError(error, "Cursor SDK resume failed", [preflight.apiKey]);
    }
  }

  async listModels(_options: ListModelsOptions): Promise<AgentModelDefinition[]> {
    const preflight = await this.preflight("listModels");
    return expandCursorSdkModels(await this.listSdkRuntimeModels(preflight, "listModels"));
  }

  async listModes(_options: ListModesOptions): Promise<AgentMode[]> {
    const sandboxSupport = await this.checkSandboxSupport();
    return listCursorSdkModes(sandboxSupport);
  }

  async listFeatures(config: AgentSessionConfig): Promise<AgentFeature[]> {
    const preflight = await this.preflight("listFeatures", { model: config.model });
    return buildCursorSdkFeatures({
      modelId: config.model,
      models: await this.listSdkRuntimeModels(preflight, "listFeatures"),
      featureValues: config.featureValues,
    });
  }

  resolveCreateConfig(input: ResolveAgentCreateConfigInput): ResolveAgentCreateConfigResult {
    let requestedMode = input.requestedMode;
    if (requestedMode === undefined && input.parent?.provider === this.provider) {
      requestedMode = input.parent.modeId ?? undefined;
    }
    if (requestedMode === undefined && !input.parent) {
      requestedMode = input.availableModes?.some((mode) => mode.id === CURSOR_SDK_SANDBOX_MODE.id)
        ? CURSOR_SDK_SANDBOX_MODE.id
        : CURSOR_SDK_YOLO_MODE.id;
    }
    if (requestedMode) {
      resolveCursorSdkMode(requestedMode);
    }
    const resolved = resolveDefaultAgentCreateConfig({ ...input, requestedMode });
    return {
      ...resolved,
      modeId: resolved.modeId ?? CURSOR_SDK_YOLO_MODE.id,
    };
  }

  isCreateConfigUnattended(input: AgentCreateConfigUnattendedInput): boolean {
    return (
      input.modeId === CURSOR_SDK_YOLO_MODE.id || input.config.modeId === CURSOR_SDK_YOLO_MODE.id
    );
  }

  async isAvailable(): Promise<boolean> {
    this.logger.trace("Checking Cursor SDK availability");
    const readiness = await this.checkReadiness();
    const key = this.resolveApiKey();
    if (!readiness.available) {
      this.lastDiagnostic = toCursorSdkDiagnostic(readiness.error, {
        apiKeySource: key.source,
        secrets: [key.apiKey],
      });
      return false;
    }
    if (!key.apiKey) {
      this.lastDiagnostic = {
        apiKeySource: "missing",
        message: "CURSOR_API_KEY is not configured for the Cursor SDK provider.",
      };
      return false;
    }
    this.lastDiagnostic = {
      apiKeySource: key.source,
      message: "Cursor SDK provider is available.",
    };
    return true;
  }

  async getDiagnostic(): Promise<{ diagnostic: string }> {
    const readiness = this.lastReadiness ?? (await this.checkReadiness());
    const sandboxSupport = this.lastSandboxSupport ?? (await this.checkSandboxSupport());
    const key = this.resolveApiKey();
    const diagnostic =
      this.lastDiagnostic ??
      (readiness.available
        ? ({
            apiKeySource: key.source,
            message: key.apiKey
              ? "Cursor SDK provider is available."
              : "CURSOR_API_KEY is not configured for the Cursor SDK provider.",
          } satisfies CursorSdkDiagnostic)
        : toCursorSdkDiagnostic(readiness.error, {
            apiKeySource: key.source,
            secrets: [key.apiKey],
          }));
    return {
      diagnostic: formatCursorSdkDiagnostic(diagnostic, {
        sdkReadiness: readiness.available ? "Available" : "Error",
        sandboxSupport: sandboxSupport.supported
          ? "Supported"
          : (sandboxSupport.reason ?? "Unsupported"),
      }),
    };
  }

  private resolveApiKey(): ResolvedCursorSdkApiKey {
    const providerKey = this.runtimeSettings?.env?.CURSOR_API_KEY;
    if (providerKey && providerKey.trim().length > 0) {
      return { apiKey: providerKey, source: "provider-config" };
    }
    const processKey = process.env.CURSOR_API_KEY;
    if (processKey && processKey.trim().length > 0) {
      return { apiKey: processKey, source: "process-env" };
    }
    return { source: "missing" };
  }

  private async checkReadiness(): Promise<CursorSdkRuntimeReadiness> {
    const readiness = await this.runtime.checkReadiness();
    this.lastReadiness = readiness;
    return readiness;
  }

  private async checkSandboxSupport(): Promise<CursorSdkSandboxSupport> {
    const support = await this.runtime.checkSandboxSupport();
    this.lastSandboxSupport = support;
    if (!support.supported && support.error) {
      const key = this.resolveApiKey();
      this.lastDiagnostic = toCursorSdkDiagnostic(support.error, {
        operation: "checkSandboxSupport",
        apiKeySource: key.source,
        secrets: [key.apiKey],
      });
    }
    return support;
  }

  private resolvePaseoHome(): string | undefined {
    const providerPaseoHome = this.runtimeSettings?.env?.PASEO_HOME;
    return typeof providerPaseoHome === "string" && providerPaseoHome.trim().length > 0
      ? providerPaseoHome
      : undefined;
  }

  private resolveRequestedModeId(modeId: string | null | undefined): CursorSdkModeId {
    const requestedModeId = modeId ?? CURSOR_SDK_YOLO_MODE.id;
    const mode = resolveCursorSdkMode(requestedModeId);
    return mode.id as CursorSdkModeId;
  }

  private async getAvailableModesForSession(): Promise<AgentMode[]> {
    const sandboxSupport = this.lastSandboxSupport ?? (await this.checkSandboxSupport());
    return listCursorSdkModes(sandboxSupport);
  }

  private async assertModeSupported(modeId: CursorSdkModeId, operation: string): Promise<void> {
    if (modeId !== CURSOR_SDK_SANDBOX_MODE.id) {
      return;
    }
    const sandboxSupport = await this.checkSandboxSupport();
    if (sandboxSupport.supported) {
      return;
    }
    const reason =
      sandboxSupport.reason ??
      "Cursor SDK Sandbox is not supported in the current runtime environment.";
    this.lastDiagnostic = {
      operation,
      sandbox: "true",
      message: reason,
    };
    throw new Error(`Cursor SDK Sandbox is not supported: ${reason}`);
  }

  private async preflight(
    operation: string,
    context: { modeId?: string | null; model?: string | null } = {},
  ): Promise<CursorSdkPreflightResult> {
    const readiness = await this.checkReadiness();
    const key = this.resolveApiKey();
    if (!readiness.available) {
      this.lastDiagnostic = toCursorSdkDiagnostic(readiness.error, {
        operation,
        apiKeySource: key.source,
        model: context.model,
        secrets: [key.apiKey],
      });
      throw new Error("Cursor SDK runtime is unavailable");
    }
    if (!key.apiKey) {
      this.lastDiagnostic = {
        apiKeySource: "missing",
        operation,
        model: context.model ?? undefined,
        message: "CURSOR_API_KEY is not configured for the Cursor SDK provider.",
      };
      throw new Error("CURSOR_API_KEY is not configured for the Cursor SDK provider");
    }
    if (context.modeId) {
      resolveCursorSdkMode(context.modeId);
    }
    return {
      apiKey: key.apiKey,
      apiKeySource: key.source === "missing" ? "process-env" : key.source,
      readiness,
    };
  }

  private toSdkModelListItem(model: CursorSdkRuntimeModel): CursorSdkModelListItem {
    if (typeof model === "string") {
      return {
        id: model,
        displayName: model,
      };
    }
    return {
      id: model.id,
      displayName: model.displayName,
      description: model.description,
      aliases: model.aliases,
      parameters: model.parameters,
      variants: model.variants,
    };
  }

  private async listSdkRuntimeModels(
    preflight: CursorSdkPreflightResult,
    operation: string,
  ): Promise<CursorSdkModelListItem[]> {
    try {
      const models = (await this.runtime.listModels({ apiKey: preflight.apiKey })).map((model) =>
        this.toSdkModelListItem(model),
      );
      if (models.length === 0) {
        throw new Error("Cursor SDK model discovery returned no models");
      }
      return models;
    } catch (error) {
      this.lastDiagnostic = toCursorSdkDiagnostic(error, {
        operation,
        apiKeySource: preflight.apiKeySource,
        secrets: [preflight.apiKey],
      });
      throw redactedCursorSdkError(error, "Cursor SDK list models failed", [preflight.apiKey]);
    }
  }

  private async resolveSessionModelOptions(input: {
    model: string | null;
    thinkingOptionId?: string | null;
    featureValues?: Record<string, unknown>;
    preflight: CursorSdkPreflightResult;
    operation: string;
  }): Promise<CursorSdkModelListItem[]> {
    if (!input.model) {
      return [];
    }
    const requiresSdkMetadata =
      isCursorSdkEncodedModelOptionId(input.model) ||
      (typeof input.thinkingOptionId === "string" && input.thinkingOptionId.trim().length > 0) ||
      input.featureValues?.fast_mode === true;
    if (requiresSdkMetadata) {
      return await this.listSdkRuntimeModels(input.preflight, input.operation);
    }
    return [{ id: input.model, displayName: input.model }];
  }
}
