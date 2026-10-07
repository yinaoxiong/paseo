import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type {
  AgentOptions,
  Run,
  RunOperation,
  RunResult,
  RunStatus,
  SDKAgent,
  SDKMessage,
} from "@cursor/sdk";

import { createTestLogger } from "../../../test-utils/test-logger.js";
import { CursorSdkAgentClient } from "./cursor-sdk-agent.js";
import { expandCursorSdkModels, type CursorSdkModelListItem } from "./cursor-sdk/model-options.js";
import { createCursorSdkPersistenceHandle } from "./cursor-sdk/persistence.js";
import type {
  CursorSdkRuntimeModel,
  CursorSdkRuntime,
  CursorSdkSandboxSupport,
  CursorSdkRuntimeReadiness,
} from "./cursor-sdk/sdk-runtime.js";
import type { AgentMode, AgentSession, AgentStreamEvent } from "../agent-sdk-types.js";

interface FakeStore {
  readonly rootDir: string;
}

class Deferred<T> {
  promise: Promise<T>;
  resolve!: (value: T) => void;
  reject!: (error: unknown) => void;

  constructor() {
    this.promise = new Promise<T>((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }
}

class FakeRun implements Run {
  readonly id: string;
  readonly requestId: string;
  readonly agentId: string;
  status: RunStatus = "running";
  result?: string;
  model?: Run["model"];
  durationMs?: number;
  git?: Run["git"];
  createdAt?: number;
  cancelCalls = 0;
  waitCalls = 0;
  readonly waitResult = new Deferred<RunResult>();
  readonly streamEvents: SDKMessage[];

  constructor(
    input: {
      id?: string;
      agentId?: string;
      requestId?: string;
      supportsCancel?: boolean;
      streamEvents?: SDKMessage[];
    } = {},
  ) {
    this.id = input.id ?? "run-123";
    this.agentId = input.agentId ?? "sdk-agent-abc";
    this.requestId = input.requestId ?? "request-123";
    this.supportsCancel = input.supportsCancel ?? true;
    this.streamEvents = input.streamEvents ?? [];
  }

  private readonly supportsCancel: boolean;

  supports(operation: RunOperation): boolean {
    return operation === "cancel" ? this.supportsCancel : true;
  }

  unsupportedReason(operation: RunOperation): string | undefined {
    return operation === "cancel" && !this.supportsCancel ? "cancel unavailable" : undefined;
  }

  async *stream(): AsyncGenerator<SDKMessage, void> {
    for (const event of this.streamEvents) {
      yield event;
    }
  }

  async conversation(): Promise<[]> {
    return [];
  }

  async wait(): Promise<RunResult> {
    this.waitCalls += 1;
    return await this.waitResult.promise;
  }

  async cancel(): Promise<void> {
    this.cancelCalls += 1;
    this.status = "cancelled";
    this.waitResult.resolve({
      id: this.id,
      requestId: this.requestId,
      status: "cancelled",
    });
  }

  onDidChangeStatus(_listener: (status: RunStatus) => void): () => void {
    return () => {};
  }
}

class FakeSdkAgent implements SDKAgent {
  readonly agentId: string;
  model: SDKAgent["model"];
  closeCalls = 0;
  asyncDisposeCalls = 0;
  readonly sends: Array<{
    message: string | Parameters<SDKAgent["send"]>[0];
    options?: Parameters<SDKAgent["send"]>[1];
  }> = [];
  nextRun: FakeRun = new FakeRun();
  sendError: unknown = null;

  constructor(agentId = "sdk-agent-abc") {
    this.agentId = agentId;
  }

  async send(message: Parameters<SDKAgent["send"]>[0], options?: Parameters<SDKAgent["send"]>[1]) {
    this.sends.push({ message, options });
    if (this.sendError) {
      throw this.sendError;
    }
    return this.nextRun;
  }

  close(): void {
    this.closeCalls += 1;
  }

  async reload(): Promise<void> {}

  async [Symbol.asyncDispose](): Promise<void> {
    this.asyncDisposeCalls += 1;
  }

  async listArtifacts(): Promise<[]> {
    return [];
  }

  async downloadArtifact(_path: string): Promise<Buffer> {
    return Buffer.from("");
  }
}

class FakeCursorSdkRuntime implements CursorSdkRuntime {
  readiness: CursorSdkRuntimeReadiness = { available: true };
  sandboxSupport: CursorSdkSandboxSupport = { supported: true };
  models: CursorSdkRuntimeModel[] = [];
  stores: FakeStore[] = [];
  nextAgent = new FakeSdkAgent();
  nextResumedAgent = new FakeSdkAgent("resumed-sdk-agent");
  createAgentError: unknown = null;
  resumeAgentError: unknown = null;
  listModelsError: unknown = null;
  readonly calls = {
    checkReadiness: 0,
    checkSandboxSupport: 0,
    listModels: 0,
    createJsonlStore: 0,
    createAgent: 0,
    resumeAgent: 0,
  };
  readonly createAgentOptions: AgentOptions[] = [];
  readonly resumeAgentCalls: Array<{ agentId: string; options?: Partial<AgentOptions> }> = [];
  readonly listModelsOptions: Array<{ apiKey?: string } | undefined> = [];

  async checkReadiness(): Promise<CursorSdkRuntimeReadiness> {
    this.calls.checkReadiness += 1;
    return this.readiness;
  }

  async checkSandboxSupport(): Promise<CursorSdkSandboxSupport> {
    this.calls.checkSandboxSupport += 1;
    return this.sandboxSupport;
  }

  async listModels(options?: { apiKey?: string }): Promise<CursorSdkRuntimeModel[]> {
    this.calls.listModels += 1;
    this.listModelsOptions.push(options);
    if (this.listModelsError) {
      throw this.listModelsError;
    }
    return this.models;
  }

  async createJsonlStore(storePath: string): Promise<FakeStore> {
    this.calls.createJsonlStore += 1;
    const store = { rootDir: storePath };
    this.stores.push(store);
    return store;
  }

  async createAgent(options?: AgentOptions): Promise<SDKAgent> {
    this.calls.createAgent += 1;
    this.createAgentOptions.push(options ?? {});
    if (this.createAgentError) {
      throw this.createAgentError;
    }
    return this.nextAgent;
  }

  async resumeAgent(agentId: string, options?: Partial<AgentOptions>): Promise<SDKAgent> {
    this.calls.resumeAgent += 1;
    this.resumeAgentCalls.push({ agentId, options });
    if (this.resumeAgentError) {
      throw this.resumeAgentError;
    }
    return this.nextResumedAgent;
  }
}

function createClient(
  runtime: FakeCursorSdkRuntime,
  runtimeSettings?: ConstructorParameters<typeof CursorSdkAgentClient>[0]["runtimeSettings"],
): CursorSdkAgentClient {
  return new CursorSdkAgentClient({
    logger: createTestLogger(),
    runtimeSettings,
    runtime,
  });
}

function collectSessionEvents(session: AgentSession): {
  events: AgentStreamEvent[];
  waitForTerminal: Promise<AgentStreamEvent>;
} {
  const events: AgentStreamEvent[] = [];
  const waitForTerminal = new Promise<AgentStreamEvent>((resolve) => {
    session.subscribe((event) => {
      events.push(event);
      if (
        event.type === "turn_completed" ||
        event.type === "turn_failed" ||
        event.type === "turn_canceled"
      ) {
        resolve(event);
      }
    });
  });
  return { events, waitForTerminal };
}

async function waitForCondition(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error("Timed out waiting for condition");
}

async function expectRejectedMessageRedacted(action: () => Promise<unknown>): Promise<void> {
  let rejection: unknown;
  try {
    await action();
  } catch (error) {
    rejection = error;
  }

  expect(rejection).toBeInstanceOf(Error);
  if (!(rejection instanceof Error)) {
    throw new Error("Expected action to reject with an Error");
  }
  const message = rejection.message;
  expect(message).toContain("[redacted]");
  expect(message).not.toContain("provider-secret-key");
  expect(message).not.toContain("sk-live-secret-token");
  expect(message).not.toContain("Bearer");
  expect((rejection as Error & { cause?: unknown }).cause).toBeUndefined();
}

const SDK_MODELS = [
  {
    id: "gpt-5.5",
    displayName: "GPT-5.5",
    parameters: [
      {
        id: "context",
        displayName: "Context",
        values: [
          { value: "272k", displayName: "272K" },
          { value: "1m", displayName: "1M" },
        ],
      },
      {
        id: "reasoning",
        displayName: "Reasoning",
        values: [
          { value: "low", displayName: "Low" },
          { value: "high", displayName: "High" },
        ],
      },
      {
        id: "fast",
        displayName: "Fast",
        values: [
          { value: "false", displayName: "Off" },
          { value: "true", displayName: "On" },
        ],
      },
    ],
  },
] satisfies CursorSdkModelListItem[];

function findModelOption(label: string): string {
  const option = expandCursorSdkModels(SDK_MODELS).find((model) => model.label === label);
  if (!option) {
    throw new Error(`Missing model option '${label}'`);
  }
  return option.id;
}

function findThinkingOption(modelLabel: string, thinkingLabel: string): string {
  const model = expandCursorSdkModels(SDK_MODELS).find((option) => option.label === modelLabel);
  const thinkingOption = model?.thinkingOptions?.find((option) => option.label === thinkingLabel);
  if (!thinkingOption) {
    throw new Error(`Missing thinking option '${thinkingLabel}'`);
  }
  return thinkingOption.id;
}

describe("CursorSdkAgentClient", () => {
  const originalCursorApiKey = process.env.CURSOR_API_KEY;

  beforeEach(() => {
    delete process.env.CURSOR_API_KEY;
  });

  afterEach(() => {
    if (originalCursorApiKey === undefined) {
      delete process.env.CURSOR_API_KEY;
    } else {
      process.env.CURSOR_API_KEY = originalCursorApiKey;
    }
  });

  test("isAvailable is false without a provider or process API key and does not create SDK agents", async () => {
    const runtime = new FakeCursorSdkRuntime();
    const client = createClient(runtime);

    await expect(client.isAvailable()).resolves.toBe(false);

    expect(runtime.calls).toEqual({
      checkReadiness: 1,
      checkSandboxSupport: 0,
      listModels: 0,
      createJsonlStore: 0,
      createAgent: 0,
      resumeAgent: 0,
    });
  });

  test("missing credentials reject create and resume before SDK stores or agents are touched", async () => {
    const createRuntime = new FakeCursorSdkRuntime();
    const createClientWithoutKey = createClient(createRuntime);

    await expect(
      createClientWithoutKey.createSession(
        {
          provider: "cursor-sdk",
          cwd: "/workspace/project",
          modeId: "yolo",
        },
        { agentId: "paseo-agent-create-missing-key" },
      ),
    ).rejects.toThrow(/CURSOR_API_KEY is not configured/u);

    expect(createRuntime.calls).toEqual({
      checkReadiness: 1,
      checkSandboxSupport: 0,
      listModels: 0,
      createJsonlStore: 0,
      createAgent: 0,
      resumeAgent: 0,
    });

    const resumeRuntime = new FakeCursorSdkRuntime();
    const paseoHome = "/tmp/paseo-home-resume-missing-key";
    const resumeClientWithoutKey = createClient(resumeRuntime, {
      env: { PASEO_HOME: paseoHome },
    });
    const handle = createCursorSdkPersistenceHandle({
      sessionId: "paseo-agent-resume-missing-key",
      sdkAgentId: "sdk-agent-abc",
      cwd: "/workspace/project",
      storePath: `${paseoHome}/providers/cursor-sdk/stores/paseo-agent-resume-missing-key`,
      modeId: "yolo",
      sandboxEnabled: false,
    });

    await expect(resumeClientWithoutKey.resumeSession(handle)).rejects.toThrow(
      /CURSOR_API_KEY is not configured/u,
    );

    expect(resumeRuntime.calls).toEqual({
      checkReadiness: 1,
      checkSandboxSupport: 0,
      listModels: 0,
      createJsonlStore: 0,
      createAgent: 0,
      resumeAgent: 0,
    });
  });

  test("does not advertise MCP support until Cursor SDK options are wired", () => {
    const runtime = new FakeCursorSdkRuntime();
    const client = createClient(runtime);

    expect(client.capabilities.supportsMcpServers).toBe(false);
  });

  test("key resolution prefers provider config over process env without exposing key material", async () => {
    process.env.CURSOR_API_KEY = "process-secret-key";
    const runtime = new FakeCursorSdkRuntime();
    const client = createClient(runtime, {
      env: {
        CURSOR_API_KEY: "provider-secret-key",
      },
    });

    await expect(client.isAvailable()).resolves.toBe(true);

    const { diagnostic } = await client.getDiagnostic();
    expect(diagnostic).toContain("API key source: provider-config");
    expect(diagnostic).not.toContain("provider-secret-key");
    expect(diagnostic).not.toContain("process-secret-key");
    expect(diagnostic).not.toContain("provider-secret");
    expect(diagnostic).not.toContain("process-secret");
  });

  test("SDK readiness failures make provider unavailable and diagnostics are redacted", async () => {
    const runtime = new FakeCursorSdkRuntime();
    runtime.readiness = {
      available: false,
      error: Object.assign(new Error("Native sqlite binding failed for sk-live-secret-token"), {
        name: "ConfigurationError",
        code: "SQLITE_NATIVE_LOAD_FAILED",
        status: 500,
        operation: "import",
        endpoint: "file:///tmp/native",
        headers: {
          authorization: "Bearer sk-live-secret-token",
        },
      }),
    };
    const client = createClient(runtime, {
      env: {
        CURSOR_API_KEY: "sk-live-secret-token",
      },
    });

    await expect(client.isAvailable()).resolves.toBe(false);

    const { diagnostic } = await client.getDiagnostic();
    expect(diagnostic).toContain("SDK readiness: Error");
    expect(diagnostic).toContain("Error class: ConfigurationError");
    expect(diagnostic).toContain("Operation: import");
    expect(diagnostic).toContain("Endpoint: file:///tmp/native");
    expect(diagnostic).toContain("SQLITE_NATIVE_LOAD_FAILED");
    expect(diagnostic).not.toContain("sk-live-secret-token");
    expect(diagnostic).not.toContain("authorization");
    expect(diagnostic).not.toContain("Bearer");
  });

  test("fetchCatalog marks YOLO unattended and includes Sandbox only when side-effect-free support passes", async () => {
    const runtime = new FakeCursorSdkRuntime();
    runtime.models = SDK_MODELS;
    const client = createClient(runtime, {
      env: {
        CURSOR_API_KEY: "provider-secret-key",
      },
    });

    await expect(
      client.fetchCatalog({ scope: "workspace", cwd: "/tmp/cursor-sdk", force: false }),
    ).resolves.toMatchObject({
      modes: [
        expect.objectContaining({
          id: "sandbox",
          label: "Sandbox",
          isUnattended: false,
        }),
        expect.objectContaining({
          id: "yolo",
          label: "YOLO",
          isUnattended: true,
        }),
      ],
    });

    expect(runtime.calls.createAgent).toBe(0);
    expect(runtime.calls.resumeAgent).toBe(0);

    runtime.sandboxSupport = {
      supported: false,
      reason: "Local SDK sandboxing is not supported in this environment.",
    };

    await expect(
      client.fetchCatalog({ scope: "workspace", cwd: "/tmp/cursor-sdk", force: true }),
    ).resolves.toMatchObject({
      modes: [
        expect.objectContaining({
          id: "yolo",
          label: "YOLO",
          isUnattended: true,
        }),
      ],
    });

    expect(runtime.calls.checkSandboxSupport).toBe(2);
    expect(runtime.calls.createAgent).toBe(0);
    expect(runtime.calls.resumeAgent).toBe(0);
  });

  test("fetchCatalog uses Cursor SDK discovery with provider API key and expands metadata", async () => {
    const runtime = new FakeCursorSdkRuntime();
    runtime.models = SDK_MODELS;
    const client = createClient(runtime, {
      env: {
        CURSOR_API_KEY: "provider-secret-key",
      },
    });

    const catalog = await client.fetchCatalog({
      scope: "workspace",
      cwd: "/workspace/project",
      force: false,
    });

    expect(catalog.models).toEqual([
      expect.objectContaining({ provider: "cursor-sdk", label: "GPT-5.5 - 272K" }),
      expect.objectContaining({ provider: "cursor-sdk", label: "GPT-5.5 - 1M" }),
    ]);
    expect(catalog.modes.length).toBeGreaterThan(0);

    expect(runtime.listModelsOptions).toEqual([{ apiKey: "provider-secret-key" }]);
    expect(runtime.calls.createAgent).toBe(0);
    expect(runtime.calls.resumeAgent).toBe(0);
  });

  test("empty SDK model discovery rejects before provider config can mask it", async () => {
    const runtime = new FakeCursorSdkRuntime();
    runtime.models = [];
    const client = createClient(runtime, {
      env: {
        CURSOR_API_KEY: "provider-secret-key",
      },
    });

    await expect(
      client.fetchCatalog({ scope: "workspace", cwd: "/workspace/project", force: false }),
    ).rejects.toThrow(/model discovery returned no models/u);

    expect(runtime.calls.listModels).toBe(1);
    expect(runtime.calls.createAgent).toBe(0);
    expect(runtime.calls.resumeAgent).toBe(0);
  });

  test("listFeatures uses SDK metadata discovery without creating scratch sessions", async () => {
    const runtime = new FakeCursorSdkRuntime();
    runtime.models = SDK_MODELS;
    const modelId = findModelOption("GPT-5.5 - 1M");
    const client = createClient(runtime, {
      env: {
        CURSOR_API_KEY: "provider-secret-key",
      },
    });

    await expect(
      client.listFeatures({
        provider: "cursor-sdk",
        cwd: "/workspace/project",
        model: modelId,
      }),
    ).resolves.toEqual([expect.objectContaining({ id: "fast_mode", value: false })]);

    expect(runtime.listModelsOptions).toEqual([{ apiKey: "provider-secret-key" }]);
    expect(runtime.calls.createAgent).toBe(0);
    expect(runtime.calls.resumeAgent).toBe(0);
  });

  test("running sessions expose fast mode when the selected SDK model supports it", async () => {
    const runtime = new FakeCursorSdkRuntime();
    runtime.models = SDK_MODELS;
    const modelId = findModelOption("GPT-5.5 - 1M");
    const session = await createClient(runtime, {
      env: {
        CURSOR_API_KEY: "provider-secret-key",
        PASEO_HOME: "/tmp/paseo-home-features",
      },
    }).createSession(
      {
        provider: "cursor-sdk",
        cwd: "/workspace/project",
        model: modelId,
        featureValues: { fast_mode: true },
        modeId: "yolo",
      },
      { agentId: "paseo-agent-features" },
    );

    expect(session.features).toEqual([
      expect.objectContaining({ id: "fast_mode", type: "toggle", value: true }),
    ]);

    if (!session.setFeature) {
      throw new Error("Cursor SDK session is missing setFeature");
    }
    await session.setFeature("fast_mode", false);

    expect(session.features).toEqual([
      expect.objectContaining({ id: "fast_mode", type: "toggle", value: false }),
    ]);
  });

  test("createSession builds a controlled JSONL store and passes explicit SDK local options", async () => {
    const runtime = new FakeCursorSdkRuntime();
    const paseoHome = "/tmp/paseo-home-create";
    const client = createClient(runtime, {
      env: {
        CURSOR_API_KEY: "provider-secret-key",
        PASEO_HOME: paseoHome,
      },
    });

    const session = await client.createSession(
      {
        provider: "cursor-sdk",
        cwd: "/workspace/project",
        model: "composer-2.5",
        modeId: "sandbox",
      },
      { agentId: "paseo-agent-123" },
    );

    expect(runtime.calls.checkReadiness).toBe(1);
    expect(runtime.calls.checkSandboxSupport).toBe(1);
    expect(runtime.calls.createJsonlStore).toBe(1);
    expect(runtime.calls.createAgent).toBe(1);
    expect(runtime.createAgentOptions[0]).toMatchObject({
      apiKey: "provider-secret-key",
      model: { id: "composer-2.5" },
      local: {
        cwd: "/workspace/project",
        store: runtime.stores[0],
        sandboxOptions: { enabled: true },
      },
    });
    expect(runtime.stores[0]?.rootDir).toBe(
      "/tmp/paseo-home-create/providers/cursor-sdk/stores/paseo-agent-123",
    );
    expect(await session.getRuntimeInfo()).toMatchObject({
      provider: "cursor-sdk",
      sessionId: "paseo-agent-123",
      model: "composer-2.5",
      modeId: "sandbox",
      extra: {
        nativeHandle: "sdk-agent-abc",
      },
    });
  });

  test("default create config and sessions use YOLO when Sandbox support is unavailable", async () => {
    const runtime = new FakeCursorSdkRuntime();
    runtime.sandboxSupport = {
      supported: false,
      reason: "Local SDK sandboxing is not supported in this environment.",
    };
    const client = createClient(runtime, {
      env: {
        CURSOR_API_KEY: "provider-secret-key",
        PASEO_HOME: "/tmp/paseo-home-default-yolo",
      },
    });

    expect(
      client.resolveCreateConfig({
        provider: "cursor-sdk",
        requestedMode: undefined,
        featureValues: undefined,
        parent: null,
        unattended: false,
        availableModes: [
          {
            id: "yolo",
            label: "YOLO",
            isUnattended: true,
          },
        ],
      }),
    ).toEqual({
      modeId: "yolo",
      featureValues: undefined,
    });

    const session = await client.createSession(
      {
        provider: "cursor-sdk",
        cwd: "/workspace/project",
      },
      { agentId: "paseo-agent-123" },
    );

    expect(runtime.calls.createAgent).toBe(1);
    expect(runtime.createAgentOptions[0]).toMatchObject({
      local: {
        sandboxOptions: { enabled: false },
      },
    });
    expect(await session.getCurrentMode()).toBe("yolo");
  });

  test("default create config uses Sandbox when dynamic modes include Sandbox", () => {
    const runtime = new FakeCursorSdkRuntime();
    const client = createClient(runtime);
    const availableModes: AgentMode[] = [
      {
        id: "sandbox",
        label: "Sandbox",
        isUnattended: false,
      },
      {
        id: "yolo",
        label: "YOLO",
        isUnattended: true,
      },
    ];

    expect(
      client.resolveCreateConfig({
        provider: "cursor-sdk",
        requestedMode: undefined,
        featureValues: undefined,
        parent: null,
        unattended: false,
        availableModes,
      }),
    ).toEqual({
      modeId: "sandbox",
      featureValues: undefined,
    });

    expect(
      client.resolveCreateConfig({
        provider: "cursor-sdk",
        requestedMode: "yolo",
        featureValues: undefined,
        parent: null,
        unattended: false,
        availableModes,
      }),
    ).toEqual({
      modeId: "yolo",
      featureValues: undefined,
    });
  });

  test("create config rejects non-v1 Cursor SDK mode ids", () => {
    const runtime = new FakeCursorSdkRuntime();
    const client = createClient(runtime);
    const availableModes: AgentMode[] = [
      {
        id: "sandbox",
        label: "Sandbox",
        isUnattended: false,
      },
      {
        id: "yolo",
        label: "YOLO",
        isUnattended: true,
      },
    ];

    for (const requestedMode of ["agent", "ask"]) {
      expect(() =>
        client.resolveCreateConfig({
          provider: "cursor-sdk",
          requestedMode,
          featureValues: undefined,
          parent: null,
          unattended: false,
          availableModes,
        }),
      ).toThrow(/Invalid Cursor SDK mode/u);
    }
  });

  test("session creation and resume reject Ask and Agent mode ids before SDK calls", async () => {
    for (const modeId of ["agent", "ask"]) {
      const createRuntime = new FakeCursorSdkRuntime();
      const createClientForMode = createClient(createRuntime, {
        env: {
          CURSOR_API_KEY: "provider-secret-key",
          PASEO_HOME: `/tmp/paseo-home-invalid-create-${modeId}`,
        },
      });

      await expect(
        createClientForMode.createSession(
          {
            provider: "cursor-sdk",
            cwd: "/workspace/project",
            modeId,
          },
          { agentId: `paseo-agent-invalid-create-${modeId}` },
        ),
      ).rejects.toThrow(/Invalid Cursor SDK mode/u);
      expect(createRuntime.calls).toEqual({
        checkReadiness: 0,
        checkSandboxSupport: 0,
        listModels: 0,
        createJsonlStore: 0,
        createAgent: 0,
        resumeAgent: 0,
      });

      const resumeRuntime = new FakeCursorSdkRuntime();
      const paseoHome = `/tmp/paseo-home-invalid-resume-${modeId}`;
      const resumeClientForMode = createClient(resumeRuntime, {
        env: {
          CURSOR_API_KEY: "provider-secret-key",
          PASEO_HOME: paseoHome,
        },
      });
      const handle = createCursorSdkPersistenceHandle({
        sessionId: `paseo-agent-invalid-resume-${modeId}`,
        sdkAgentId: "sdk-agent-abc",
        cwd: "/workspace/project",
        storePath: `${paseoHome}/providers/cursor-sdk/stores/paseo-agent-invalid-resume-${modeId}`,
        modeId: "yolo",
        sandboxEnabled: false,
      });

      await expect(resumeClientForMode.resumeSession(handle, { modeId })).rejects.toThrow(
        /Invalid Cursor SDK mode/u,
      );
      expect(resumeRuntime.calls).toEqual({
        checkReadiness: 0,
        checkSandboxSupport: 0,
        listModels: 0,
        createJsonlStore: 0,
        createAgent: 0,
        resumeAgent: 0,
      });
    }
  });

  test("cross-provider unattended parents resolve to Cursor SDK YOLO instead of inheriting foreign modes", () => {
    const runtime = new FakeCursorSdkRuntime();
    const client = createClient(runtime);
    const availableModes: AgentMode[] = [
      {
        id: "sandbox",
        label: "Sandbox",
        isUnattended: false,
      },
      {
        id: "yolo",
        label: "YOLO",
        isUnattended: true,
      },
    ];

    expect(
      client.resolveCreateConfig({
        provider: "cursor-sdk",
        requestedMode: undefined,
        featureValues: undefined,
        parent: {
          provider: "opencode",
          modeId: "orchestrator",
          isUnattended: true,
        },
        unattended: false,
        availableModes,
      }),
    ).toEqual({
      modeId: "yolo",
      featureValues: undefined,
    });

    expect(() =>
      client.resolveCreateConfig({
        provider: "cursor-sdk",
        requestedMode: undefined,
        featureValues: undefined,
        parent: {
          provider: "opencode",
          modeId: "orchestrator",
          isUnattended: false,
        },
        unattended: false,
        availableModes,
      }),
    ).toThrow(/cannot inherit mode/u);
  });

  test("SDK operation failures rethrow redacted public errors", async () => {
    const secretMessage =
      "request failed with CURSOR_API_KEY=provider-secret-key authorization: Bearer sk-live-secret-token";

    const createRuntime = new FakeCursorSdkRuntime();
    createRuntime.createAgentError = new Error(secretMessage);
    const createFailureClient = createClient(createRuntime, {
      env: {
        CURSOR_API_KEY: "provider-secret-key",
        PASEO_HOME: "/tmp/paseo-home-redacted-create",
      },
    });
    await expectRejectedMessageRedacted(() =>
      createFailureClient.createSession(
        {
          provider: "cursor-sdk",
          cwd: "/workspace/project",
          modeId: "yolo",
        },
        { agentId: "paseo-agent-123" },
      ),
    );

    const resumeRuntime = new FakeCursorSdkRuntime();
    resumeRuntime.resumeAgentError = new Error(secretMessage);
    const resumeFailureClient = createClient(resumeRuntime, {
      env: {
        CURSOR_API_KEY: "provider-secret-key",
        PASEO_HOME: "/tmp/paseo-home-redacted-resume",
      },
    });
    const handle = createCursorSdkPersistenceHandle({
      sessionId: "paseo-agent-123",
      sdkAgentId: "sdk-agent-abc",
      cwd: "/workspace/project",
      storePath: "/tmp/paseo-home-redacted-resume/providers/cursor-sdk/stores/paseo-agent-123",
      modeId: "yolo",
      sandboxEnabled: false,
    });
    await expectRejectedMessageRedacted(() => resumeFailureClient.resumeSession(handle));

    const listRuntime = new FakeCursorSdkRuntime();
    listRuntime.listModelsError = new Error(secretMessage);
    const listFailureClient = createClient(listRuntime, {
      env: {
        CURSOR_API_KEY: "provider-secret-key",
      },
    });
    await expectRejectedMessageRedacted(() =>
      listFailureClient.fetchCatalog({
        scope: "workspace",
        cwd: "/workspace/project",
        force: false,
      }),
    );
  });

  test("setMode rejects live changes that would alter SDK sandbox options", async () => {
    const sandboxRuntime = new FakeCursorSdkRuntime();
    const sandboxSession = await createClient(sandboxRuntime, {
      env: {
        CURSOR_API_KEY: "provider-secret-key",
        PASEO_HOME: "/tmp/paseo-home-live-sandbox",
      },
    }).createSession(
      {
        provider: "cursor-sdk",
        cwd: "/workspace/project",
        modeId: "sandbox",
      },
      { agentId: "paseo-agent-123" },
    );

    await expect(sandboxSession.setMode("yolo")).rejects.toThrow(
      /sandbox mode changes require a new session/u,
    );
    expect(await sandboxSession.getCurrentMode()).toBe("sandbox");
    expect(sandboxSession.describePersistence()).toMatchObject({
      metadata: {
        modeId: "sandbox",
        sandboxEnabled: true,
      },
    });

    const yoloRuntime = new FakeCursorSdkRuntime();
    const yoloSession = await createClient(yoloRuntime, {
      env: {
        CURSOR_API_KEY: "provider-secret-key",
        PASEO_HOME: "/tmp/paseo-home-live-yolo",
      },
    }).createSession(
      {
        provider: "cursor-sdk",
        cwd: "/workspace/project",
        modeId: "yolo",
      },
      { agentId: "paseo-agent-456" },
    );

    await expect(yoloSession.setMode("sandbox")).rejects.toThrow(
      /sandbox mode changes require a new session/u,
    );
    await expect(yoloSession.setMode("yolo")).resolves.toBeUndefined();
    expect(yoloRuntime.calls.createAgent).toBe(1);
    expect(yoloRuntime.calls.resumeAgent).toBe(0);
  });

  test("resumeSession validates persistence, applies explicit overrides, and keeps persistence secret-free", async () => {
    const runtime = new FakeCursorSdkRuntime();
    const client = createClient(runtime, {
      env: {
        CURSOR_API_KEY: "provider-secret-key",
        PASEO_HOME: "/tmp/paseo-home-resume",
      },
    });
    const handle = createCursorSdkPersistenceHandle({
      sessionId: "paseo-agent-123",
      sdkAgentId: "sdk-agent-abc",
      cwd: "/workspace/project",
      storePath: "/tmp/paseo-home-resume/providers/cursor-sdk/stores/paseo-agent-123",
      model: "composer-2.5",
      modeId: "sandbox",
      sandboxEnabled: true,
    });

    const session = await client.resumeSession(handle, {
      model: "composer-2.6",
      modeId: "yolo",
    });

    expect(runtime.calls.resumeAgent).toBe(1);
    expect(runtime.resumeAgentCalls[0]).toMatchObject({
      agentId: "sdk-agent-abc",
      options: {
        apiKey: "provider-secret-key",
        model: { id: "composer-2.6" },
        local: {
          cwd: "/workspace/project",
          store: runtime.stores[0],
          sandboxOptions: { enabled: false },
        },
      },
    });
    expect(session.describePersistence()).toEqual({
      provider: "cursor-sdk",
      sessionId: "paseo-agent-123",
      nativeHandle: "resumed-sdk-agent",
      metadata: {
        runtime: "local",
        cwd: "/workspace/project",
        storePath: "/tmp/paseo-home-resume/providers/cursor-sdk/stores/paseo-agent-123",
        model: "composer-2.6",
        modeId: "yolo",
        sandboxEnabled: false,
      },
    });
    expect(JSON.stringify(session.describePersistence())).not.toContain("provider-secret-key");
  });

  test("resumeSession rejects persisted Sandbox when current sandbox support is unavailable before SDK resume", async () => {
    const runtime = new FakeCursorSdkRuntime();
    runtime.sandboxSupport = {
      supported: false,
      reason: "Local SDK sandboxing is not supported in this environment.",
    };
    const client = createClient(runtime, {
      env: {
        CURSOR_API_KEY: "provider-secret-key",
        PASEO_HOME: "/tmp/paseo-home-sandbox",
      },
    });
    const handle = createCursorSdkPersistenceHandle({
      sessionId: "paseo-agent-123",
      sdkAgentId: "sdk-agent-abc",
      cwd: "/workspace/project",
      storePath: "/tmp/paseo-home-sandbox/providers/cursor-sdk/stores/paseo-agent-123",
      modeId: "sandbox",
      sandboxEnabled: true,
    });

    await expect(client.resumeSession(handle)).rejects.toThrow(/Sandbox.*not supported/u);
    expect(runtime.calls.resumeAgent).toBe(0);
  });

  test("failed explicit resume overrides reject without falling back to persisted options", async () => {
    const runtime = new FakeCursorSdkRuntime();
    runtime.resumeAgentError = new Error("model composer-2.6 rejected");
    const client = createClient(runtime, {
      env: {
        CURSOR_API_KEY: "provider-secret-key",
        PASEO_HOME: "/tmp/paseo-home-failure",
      },
    });
    const handle = createCursorSdkPersistenceHandle({
      sessionId: "paseo-agent-123",
      sdkAgentId: "sdk-agent-abc",
      cwd: "/workspace/project",
      storePath: "/tmp/paseo-home-failure/providers/cursor-sdk/stores/paseo-agent-123",
      model: "composer-2.5",
      modeId: "sandbox",
      sandboxEnabled: true,
    });

    await expect(
      client.resumeSession(handle, { model: "composer-2.6", modeId: "yolo" }),
    ).rejects.toThrow(/model composer-2.6 rejected/u);
    expect(runtime.calls.resumeAgent).toBe(1);
    expect(runtime.resumeAgentCalls[0]?.options).toMatchObject({
      model: { id: "composer-2.6" },
      local: {
        sandboxOptions: { enabled: false },
      },
    });
  });

  test("model, thinking, and fast changes apply through next-turn SDK send params without restarting", async () => {
    const runtime = new FakeCursorSdkRuntime();
    runtime.models = SDK_MODELS;
    runtime.nextAgent.nextRun = new FakeRun();
    const modelId = findModelOption("GPT-5.5 - 1M");
    const lowReasoning = findThinkingOption("GPT-5.5 - 1M", "Low");
    const highReasoning = findThinkingOption("GPT-5.5 - 1M", "High");
    const session = await createClient(runtime, {
      env: {
        CURSOR_API_KEY: "provider-secret-key",
        PASEO_HOME: "/tmp/paseo-home-next-turn",
      },
    }).createSession(
      {
        provider: "cursor-sdk",
        cwd: "/workspace/project",
        model: modelId,
        thinkingOptionId: lowReasoning,
        featureValues: { fast_mode: false },
        modeId: "yolo",
      },
      { agentId: "paseo-agent-789" },
    );

    expect(runtime.createAgentOptions[0]?.model).toEqual({
      id: "gpt-5.5",
      params: [
        { id: "context", value: "1m" },
        { id: "reasoning", value: "low" },
      ],
    });

    await session.setThinkingOption?.(highReasoning);
    await session.setFeature?.("fast_mode", true);
    const { waitForTerminal } = collectSessionEvents(session);
    await session.startTurn("hello");
    await waitForCondition(() => runtime.nextAgent.sends.length === 1);

    expect(runtime.nextAgent.sends[0]?.options).toEqual({
      model: {
        id: "gpt-5.5",
        params: [
          { id: "context", value: "1m" },
          { id: "reasoning", value: "high" },
          { id: "fast", value: "true" },
        ],
      },
    });

    await session.setThinkingOption?.(lowReasoning);
    await session.setFeature?.("fast_mode", false);

    expect(runtime.calls.createAgent).toBe(1);
    expect(runtime.calls.resumeAgent).toBe(0);
    expect(runtime.nextAgent.closeCalls).toBe(0);
    expect(runtime.nextAgent.nextRun.cancelCalls).toBe(0);

    runtime.nextAgent.nextRun.waitResult.resolve({
      id: "run-123",
      requestId: "request-123",
      status: "finished",
    });
    await expect(waitForTerminal).resolves.toMatchObject({ type: "turn_completed" });
  });

  test("setModel rejects stale encoded SDK model ids before mutating runtime state", async () => {
    const runtime = new FakeCursorSdkRuntime();
    runtime.models = SDK_MODELS;
    const modelId = findModelOption("GPT-5.5 - 1M");
    const staleModelId = expandCursorSdkModels([
      { id: "stale-model", displayName: "Stale Model" },
    ])[0]?.id;
    if (!staleModelId) {
      throw new Error("Missing stale encoded model fixture");
    }
    const session = await createClient(runtime, {
      env: {
        CURSOR_API_KEY: "provider-secret-key",
        PASEO_HOME: "/tmp/paseo-home-stale-model",
      },
    }).createSession(
      {
        provider: "cursor-sdk",
        cwd: "/workspace/project",
        model: modelId,
        modeId: "yolo",
      },
      { agentId: "paseo-agent-stale-model" },
    );
    const modelChangedEvents: AgentStreamEvent[] = [];
    session.subscribe((event) => {
      if (event.type === "model_changed") {
        modelChangedEvents.push(event);
      }
    });

    if (!session.setModel) {
      throw new Error("Cursor SDK session is missing setModel");
    }
    await expect(session.setModel(staleModelId)).rejects.toThrow(/Unknown Cursor SDK model/u);

    expect((await session.getRuntimeInfo()).model).toBe(modelId);
    expect(modelChangedEvents).toEqual([]);
  });

  test("startTurn emits one canonical user row, mapped SDK events, and terminal completion", async () => {
    const runtime = new FakeCursorSdkRuntime();
    runtime.nextAgent.nextRun = new FakeRun({
      streamEvents: [
        {
          type: "user",
          agent_id: "sdk-agent-abc",
          run_id: "run-123",
          message: {
            role: "user",
            content: [{ type: "text", text: "hello" }],
          },
        },
        {
          type: "assistant",
          agent_id: "sdk-agent-abc",
          run_id: "run-123",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "assistant answer" }],
          },
        },
        {
          type: "thinking",
          agent_id: "sdk-agent-abc",
          run_id: "run-123",
          text: "checking context",
        },
        {
          type: "tool_call",
          agent_id: "sdk-agent-abc",
          run_id: "run-123",
          call_id: "call-1",
          name: "shell",
          status: "completed",
          args: { command: "npm test", workingDirectory: "/workspace/project" },
          result: {
            status: "success",
            value: {
              exitCode: 0,
              signal: "",
              stdout: "passed",
              stderr: "",
              executionTime: 12,
            },
          },
        },
      ],
    });
    runtime.nextAgent.nextRun.waitResult.resolve({
      id: "run-123",
      requestId: "request-123",
      status: "finished",
    });
    const client = createClient(runtime, {
      env: {
        CURSOR_API_KEY: "provider-secret-key",
        PASEO_HOME: "/tmp/paseo-home-stream",
      },
    });
    const session = await client.createSession(
      {
        provider: "cursor-sdk",
        cwd: "/workspace/project",
        modeId: "yolo",
      },
      { agentId: "paseo-agent-123" },
    );
    const { events, waitForTerminal } = collectSessionEvents(session);

    await session.startTurn("hello", { clientMessageId: "paseo-message-1" });
    await waitForTerminal;

    const timelineItems = events
      .filter((event) => event.type === "timeline")
      .map((event) => event.item);
    expect(timelineItems.filter((item) => item.type === "user_message")).toEqual([
      {
        type: "user_message",
        text: "hello",
        messageId: "paseo-message-1",
        clientMessageId: "paseo-message-1",
      },
    ]);
    expect(timelineItems).toEqual([
      {
        type: "user_message",
        text: "hello",
        messageId: "paseo-message-1",
        clientMessageId: "paseo-message-1",
      },
      { type: "assistant_message", text: "assistant answer" },
      { type: "reasoning", text: "checking context" },
      {
        type: "tool_call",
        callId: "call-1",
        name: "shell",
        status: "completed",
        detail: {
          type: "shell",
          command: "npm test",
          cwd: "/workspace/project",
          output: "passed",
          exitCode: 0,
        },
        error: null,
      },
    ]);
    expect(events.at(-1)).toMatchObject({
      type: "turn_completed",
      provider: "cursor-sdk",
    });
  });

  test("startTurn returns before a fast SDK completion emits a terminal event", async () => {
    const runtime = new FakeCursorSdkRuntime();
    runtime.nextAgent.nextRun = new FakeRun();
    runtime.nextAgent.nextRun.waitResult.resolve({
      id: "run-123",
      requestId: "request-123",
      status: "finished",
    });
    const client = createClient(runtime, {
      env: {
        CURSOR_API_KEY: "provider-secret-key",
        PASEO_HOME: "/tmp/paseo-home-fast-completion",
      },
    });
    const session = await client.createSession(
      {
        provider: "cursor-sdk",
        cwd: "/workspace/project",
        modeId: "yolo",
      },
      { agentId: "paseo-agent-123" },
    );
    const { events, waitForTerminal } = collectSessionEvents(session);

    const result = await session.startTurn("hello", { clientMessageId: "paseo-message-1" });

    expect(result.turnId).toBeTruthy();
    expect(events.map((event) => event.type)).toEqual(["turn_started", "timeline"]);
    await expect(waitForTerminal).resolves.toMatchObject({
      type: "turn_completed",
      provider: "cursor-sdk",
      turnId: result.turnId,
    });
  });

  test("startTurn emits redacted public errors when SDK send fails", async () => {
    const runtime = new FakeCursorSdkRuntime();
    runtime.nextAgent.sendError = new Error(
      "send failed with provider-secret-key authorization: Bearer sk-live-secret-token",
    );
    const client = createClient(runtime, {
      env: {
        CURSOR_API_KEY: "provider-secret-key",
        PASEO_HOME: "/tmp/paseo-home-redacted-send",
      },
    });
    const session = await client.createSession(
      {
        provider: "cursor-sdk",
        cwd: "/workspace/project",
        modeId: "yolo",
      },
      { agentId: "paseo-agent-123" },
    );
    const { waitForTerminal } = collectSessionEvents(session);

    await session.startTurn("hello", { clientMessageId: "paseo-message-1" });
    const failed = await waitForTerminal;

    expect(failed).toMatchObject({
      type: "turn_failed",
      provider: "cursor-sdk",
      error: expect.stringContaining("[redacted]"),
      diagnostic: expect.stringContaining("Message: send failed"),
    });
    expect(JSON.stringify(failed)).not.toContain("provider-secret-key");
    expect(JSON.stringify(failed)).not.toContain("sk-live-secret-token");
    expect(JSON.stringify(failed)).not.toContain("Bearer");
  });

  test("pumpRun emits redacted public errors when SDK stream or wait fails", async () => {
    const runtime = new FakeCursorSdkRuntime();
    const run = new FakeRun();
    runtime.nextAgent.nextRun = run;
    const client = createClient(runtime, {
      env: {
        CURSOR_API_KEY: "provider-secret-key",
        PASEO_HOME: "/tmp/paseo-home-redacted-run",
      },
    });
    const session = await client.createSession(
      {
        provider: "cursor-sdk",
        cwd: "/workspace/project",
        modeId: "yolo",
      },
      { agentId: "paseo-agent-123" },
    );
    const { waitForTerminal } = collectSessionEvents(session);

    await session.startTurn("hello", { clientMessageId: "paseo-message-1" });
    await waitForCondition(() => run.waitCalls > 0);
    run.waitResult.reject(
      new Error("wait failed with provider-secret-key authorization: Bearer sk-live-secret-token"),
    );
    const failed = await waitForTerminal;

    expect(failed).toMatchObject({
      type: "turn_failed",
      provider: "cursor-sdk",
      error: expect.stringContaining("[redacted]"),
      diagnostic: expect.stringContaining("Message: wait failed"),
    });
    expect(JSON.stringify(failed)).not.toContain("provider-secret-key");
    expect(JSON.stringify(failed)).not.toContain("sk-live-secret-token");
    expect(JSON.stringify(failed)).not.toContain("Bearer");
  });

  test("structured prompt attachments are rendered and unsupported images are rejected", async () => {
    const runtime = new FakeCursorSdkRuntime();
    runtime.nextAgent.nextRun.waitResult.resolve({
      id: "run-123",
      requestId: "request-123",
      status: "finished",
    });
    const client = createClient(runtime, {
      env: {
        CURSOR_API_KEY: "provider-secret-key",
        PASEO_HOME: "/tmp/paseo-home-attachments",
      },
    });
    const session = await client.createSession(
      {
        provider: "cursor-sdk",
        cwd: "/workspace/project",
        modeId: "yolo",
      },
      { agentId: "paseo-agent-123" },
    );
    const firstTurn = collectSessionEvents(session);

    await session.startTurn([
      { type: "text", text: "Review this" },
      {
        type: "github_issue",
        mimeType: "application/github-issue",
        number: 55,
        title: "Improve startup error details",
        url: "https://github.com/getpaseo/paseo/issues/55",
        body: "Body",
      },
    ]);
    await firstTurn.waitForTerminal;

    expect(runtime.nextAgent.sends[0]?.message).toContain("Review this");
    expect(runtime.nextAgent.sends[0]?.message).toContain(
      "GitHub Issue #55: Improve startup error details",
    );

    await expect(
      session.startTurn([{ type: "image", data: "base64-image", mimeType: "image/png" }]),
    ).rejects.toThrow(/does not support image prompt blocks/u);
  });

  test("run returns final assistant text and timeline without duplicate user rows", async () => {
    const runtime = new FakeCursorSdkRuntime();
    runtime.nextAgent.nextRun = new FakeRun({
      streamEvents: [
        {
          type: "user",
          agent_id: "sdk-agent-abc",
          run_id: "run-123",
          message: { role: "user", content: [{ type: "text", text: "hello" }] },
        },
        {
          type: "assistant",
          agent_id: "sdk-agent-abc",
          run_id: "run-123",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "final answer" }],
          },
        },
      ],
    });
    runtime.nextAgent.nextRun.waitResult.resolve({
      id: "run-123",
      requestId: "request-123",
      status: "finished",
    });
    const client = createClient(runtime, {
      env: {
        CURSOR_API_KEY: "provider-secret-key",
        PASEO_HOME: "/tmp/paseo-home-run",
      },
    });
    const session = await client.createSession(
      {
        provider: "cursor-sdk",
        cwd: "/workspace/project",
        modeId: "yolo",
      },
      { agentId: "paseo-agent-123" },
    );

    const result = await session.run("hello", { clientMessageId: "paseo-message-1" });

    expect(result.finalText).toBe("final answer");
    expect(result.timeline.filter((item) => item.type === "user_message")).toEqual([
      {
        type: "user_message",
        text: "hello",
        messageId: "paseo-message-1",
        clientMessageId: "paseo-message-1",
      },
    ]);
  });

  test("terminal error and unknown statuses fail with diagnostics and clear foreground state", async () => {
    const runtime = new FakeCursorSdkRuntime();
    runtime.nextAgent.nextRun = new FakeRun({
      streamEvents: [
        {
          type: "unknown-beta-event",
          agent_id: "sdk-agent-abc",
          run_id: "run-123",
          request_id: "request-123",
          env: { CURSOR_API_KEY: "sk-live-secret-token" },
        } as unknown as SDKMessage,
      ],
    });
    runtime.nextAgent.nextRun.waitResult.resolve({
      id: "run-123",
      requestId: "request-123",
      status: "error",
    });
    const client = createClient(runtime, {
      env: {
        CURSOR_API_KEY: "provider-secret-key",
        PASEO_HOME: "/tmp/paseo-home-failed-terminal",
      },
    });
    const session = await client.createSession(
      {
        provider: "cursor-sdk",
        cwd: "/workspace/project",
        modeId: "yolo",
      },
      { agentId: "paseo-agent-123" },
    );
    const first = collectSessionEvents(session);

    await session.startTurn("fail once", { clientMessageId: "paseo-message-1" });
    const failed = await first.waitForTerminal;

    expect(failed).toMatchObject({
      type: "turn_failed",
      provider: "cursor-sdk",
      error: "Cursor SDK run failed",
      diagnostic: expect.stringContaining("Status: error"),
    });
    expect(JSON.stringify(failed)).not.toContain("sk-live-secret-token");

    runtime.nextAgent.nextRun = new FakeRun();
    runtime.nextAgent.nextRun.waitResult.resolve({
      id: "run-456",
      requestId: "request-456",
      status: "paused" as RunResult["status"],
    });
    const second = collectSessionEvents(session);
    await session.startTurn("fail with unknown terminal", {
      clientMessageId: "paseo-message-2",
    });
    const unknown = await second.waitForTerminal;

    expect(unknown).toMatchObject({
      type: "turn_failed",
      provider: "cursor-sdk",
      error: "Cursor SDK run ended with unsupported status: paused",
      diagnostic: expect.stringContaining("Status: paused"),
    });
  });

  test("interrupt uses SDK cancel support checks and maps cancelled waits to turn_canceled", async () => {
    const runtime = new FakeCursorSdkRuntime();
    runtime.nextAgent.nextRun = new FakeRun({ supportsCancel: true });
    const client = createClient(runtime, {
      env: {
        CURSOR_API_KEY: "provider-secret-key",
        PASEO_HOME: "/tmp/paseo-home-cancel",
      },
    });
    const session = await client.createSession(
      {
        provider: "cursor-sdk",
        cwd: "/workspace/project",
        model: "composer-2.5",
        modeId: "yolo",
      },
      { agentId: "paseo-agent-123" },
    );
    const events: AgentStreamEvent[] = [];
    session.subscribe((event) => events.push(event));

    await session.startTurn("stop soon");
    await session.interrupt();

    expect(runtime.nextAgent.nextRun.cancelCalls).toBe(1);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "turn_started", provider: "cursor-sdk" }),
        expect.objectContaining({
          type: "timeline",
          item: expect.objectContaining({ type: "user_message", text: "stop soon" }),
        }),
        expect.objectContaining({ type: "turn_canceled", provider: "cursor-sdk" }),
      ]),
    );
  });

  test("interrupt emits a diagnostic when SDK cancel is unsupported and close is idempotent", async () => {
    const runtime = new FakeCursorSdkRuntime();
    runtime.nextAgent.nextRun = new FakeRun({ supportsCancel: false });
    const client = createClient(runtime, {
      env: {
        CURSOR_API_KEY: "provider-secret-key",
        PASEO_HOME: "/tmp/paseo-home-close",
      },
    });
    const session = await client.createSession(
      {
        provider: "cursor-sdk",
        cwd: "/workspace/project",
        model: "composer-2.5",
        modeId: "yolo",
      },
      { agentId: "paseo-agent-123" },
    );
    const events: AgentStreamEvent[] = [];
    session.subscribe((event) => events.push(event));

    await session.startTurn("cannot cancel");
    await session.interrupt();
    await session.close();
    await session.close();

    expect(runtime.nextAgent.nextRun.cancelCalls).toBe(0);
    expect(runtime.nextAgent.closeCalls + runtime.nextAgent.asyncDisposeCalls).toBe(1);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "turn_failed",
          provider: "cursor-sdk",
          code: "CURSOR_SDK_CANCEL_UNSUPPORTED",
        }),
      ]),
    );
  });
});
