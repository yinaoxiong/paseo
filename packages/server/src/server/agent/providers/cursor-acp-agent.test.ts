import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import { afterEach, describe, expect, test, vi } from "vitest";

import type { SpawnedACPProcess, SessionStateResponse } from "./acp-agent.js";
import {
  CursorACPAgentClient,
  expandCursorParameterizedModels,
  writeCursorModelVariant,
} from "./cursor-acp-agent.js";
import { createTestLogger } from "../../../test-utils/test-logger.js";

afterEach(() => {
  vi.restoreAllMocks();
});

const cursorModelExtensionResponse = {
  models: [
    {
      value: "gpt-5.5",
      name: "GPT-5.5",
      configOptions: [
        {
          id: "context",
          name: "Context",
          category: "model_config",
          type: "select",
          currentValue: "272k",
          options: [
            { value: "272k", name: "272K" },
            { value: "1m", name: "1M" },
          ],
        },
        {
          id: "reasoning",
          name: "Reasoning",
          category: "thought_level",
          type: "select",
          currentValue: "medium",
          options: [
            { value: "none", name: "None" },
            { value: "medium", name: "Medium" },
            { value: "high", name: "High" },
          ],
        },
        {
          id: "fast",
          name: "Fast",
          category: "model_config",
          type: "select",
          currentValue: "false",
          options: [
            { value: "false", name: "Off" },
            { value: "true", name: "Fast" },
          ],
        },
      ],
    },
  ],
};

describe("expandCursorParameterizedModels", () => {
  test("expands Cursor model config options into selectable model variants", () => {
    expect(expandCursorParameterizedModels(cursorModelExtensionResponse, "gpt-5.5")).toEqual([
      {
        provider: "acp",
        id: "gpt-5.5[context=272k,fast=false]",
        label: "GPT-5.5 272K",
        isDefault: true,
        thinkingOptions: [
          { id: "none", label: "None", description: undefined, isDefault: false },
          { id: "medium", label: "Medium", description: undefined, isDefault: true },
          { id: "high", label: "High", description: undefined, isDefault: false },
        ],
        defaultThinkingOptionId: "medium",
      },
      {
        provider: "acp",
        id: "gpt-5.5[context=272k,fast=true]",
        label: "GPT-5.5 272K Fast",
        isDefault: false,
        thinkingOptions: [
          { id: "none", label: "None", description: undefined, isDefault: false },
          { id: "medium", label: "Medium", description: undefined, isDefault: true },
          { id: "high", label: "High", description: undefined, isDefault: false },
        ],
        defaultThinkingOptionId: "medium",
      },
      {
        provider: "acp",
        id: "gpt-5.5[context=1m,fast=false]",
        label: "GPT-5.5 1M",
        isDefault: false,
        thinkingOptions: [
          { id: "none", label: "None", description: undefined, isDefault: false },
          { id: "medium", label: "Medium", description: undefined, isDefault: true },
          { id: "high", label: "High", description: undefined, isDefault: false },
        ],
        defaultThinkingOptionId: "medium",
      },
      {
        provider: "acp",
        id: "gpt-5.5[context=1m,fast=true]",
        label: "GPT-5.5 1M Fast",
        isDefault: false,
        thinkingOptions: [
          { id: "none", label: "None", description: undefined, isDefault: false },
          { id: "medium", label: "Medium", description: undefined, isDefault: true },
          { id: "high", label: "High", description: undefined, isDefault: false },
        ],
        defaultThinkingOptionId: "medium",
      },
    ]);
  });
});

describe("writeCursorModelVariant", () => {
  test("writes model and parameter config options for synthetic Cursor variants", async () => {
    const configOptions: SessionConfigOption[] = [
      {
        id: "model",
        name: "Model",
        category: "model",
        type: "select",
        currentValue: "gpt-5.5",
        options: [{ value: "gpt-5.5", name: "GPT-5.5" }],
      },
      {
        id: "context",
        name: "Context",
        category: "model_config",
        type: "select",
        currentValue: "272k",
        options: [{ value: "1m", name: "1M" }],
      },
      {
        id: "reasoning",
        name: "Reasoning",
        category: "thought_level",
        type: "select",
        currentValue: "medium",
        options: [{ value: "high", name: "High" }],
      },
      {
        id: "fast",
        name: "Fast",
        category: "model_config",
        type: "select",
        currentValue: "false",
        options: [{ value: "true", name: "Fast" }],
      },
    ];
    const setSessionConfigOption = vi.fn(async () => ({ configOptions }));

    await expect(
      writeCursorModelVariant({
        connection: { setSessionConfigOption } as never,
        sessionId: "session-1",
        requestedModelId: "gpt-5.5[context=1m,fast=true,reasoning=high]",
        currentModelId: "gpt-5.5",
        selection: {
          availableModel: null,
          configOption: configOptions[0] as Extract<SessionConfigOption, { type: "select" }>,
          configChoice: null,
          hasAvailableModels: true,
        },
        configOptions,
        logger: createTestLogger(),
      }),
    ).resolves.toEqual({
      handled: true,
      currentModelId: "gpt-5.5[context=1m,fast=true,reasoning=high]",
      thinkingOptionId: "high",
      configOptions,
    });

    expect(setSessionConfigOption).toHaveBeenNthCalledWith(1, {
      sessionId: "session-1",
      configId: "model",
      value: "gpt-5.5",
    });
    expect(setSessionConfigOption).toHaveBeenNthCalledWith(2, {
      sessionId: "session-1",
      configId: "context",
      value: "1m",
    });
    expect(setSessionConfigOption).toHaveBeenNthCalledWith(3, {
      sessionId: "session-1",
      configId: "fast",
      value: "true",
    });
    expect(setSessionConfigOption).toHaveBeenNthCalledWith(4, {
      sessionId: "session-1",
      configId: "reasoning",
      value: "high",
    });
  });
});

describe("CursorACPAgentClient model discovery", () => {
  class TestCursorACPAgentClient extends CursorACPAgentClient {
    constructor(options: {
      command?: [string, ...string[]];
      env?: Record<string, string>;
      response: SessionStateResponse;
      extResponse?: unknown;
      extError?: Error;
    }) {
      super({
        logger: createTestLogger(),
        command: options.command ?? ["cursor-agent", "acp"],
        env: options.env,
      });
      this.response = options.response;
      this.extResponse = options.extResponse;
      this.extError = options.extError;
    }

    private readonly response: SessionStateResponse;
    private readonly extResponse: unknown;
    private readonly extError: Error | undefined;

    protected override async spawnProcess(): Promise<SpawnedACPProcess> {
      return {
        child: { kill: vi.fn(), exitCode: 0, signalCode: null, once: vi.fn() },
        connection: {
          newSession: vi.fn().mockResolvedValue(this.response),
          extMethod: this.extError
            ? vi.fn().mockRejectedValue(this.extError)
            : vi.fn().mockResolvedValue(this.extResponse ?? { models: [] }),
        },
        initialize: { agentCapabilities: {} },
      } as SpawnedACPProcess;
    }

    protected override async closeProbe(): Promise<void> {}
  }

  test("uses Cursor ACP extension to list parameterized model variants", async () => {
    const client = new TestCursorACPAgentClient({
      response: {
        sessionId: "session-1",
        models: { currentModelId: "gpt-5.5", availableModels: [] },
        configOptions: [],
      },
      extResponse: cursorModelExtensionResponse,
    });

    const models = await client.listModels({ cwd: "/tmp/cursor", force: false });

    expect(models.map((model) => [model.id, model.label, model.isDefault])).toEqual([
      ["gpt-5.5[context=272k,fast=false]", "GPT-5.5 272K", true],
      ["gpt-5.5[context=272k,fast=true]", "GPT-5.5 272K Fast", false],
      ["gpt-5.5[context=1m,fast=false]", "GPT-5.5 1M", false],
      ["gpt-5.5[context=1m,fast=true]", "GPT-5.5 1M Fast", false],
    ]);
  });

  test("falls back to ACP models when Cursor extension fails", async () => {
    const client = new TestCursorACPAgentClient({
      response: {
        sessionId: "session-1",
        models: {
          currentModelId: "acp-model",
          availableModels: [{ modelId: "acp-model", name: "ACP Model", description: null }],
        },
        configOptions: [],
      },
      extError: new Error("extension unavailable"),
    });

    await expect(client.listModels({ cwd: "/tmp/cursor", force: false })).resolves.toEqual([
      {
        provider: "acp",
        id: "acp-model",
        label: "ACP Model",
        description: undefined,
        isDefault: true,
        thinkingOptions: undefined,
        defaultThinkingOptionId: undefined,
      },
    ]);
  });

  test("does not run Cursor-specific discovery when command is not cursor-agent", async () => {
    const client = new TestCursorACPAgentClient({
      command: ["other-agent", "acp"],
      response: { sessionId: "session-1", models: null, configOptions: [] },
      extResponse: cursorModelExtensionResponse,
    });

    await expect(client.listModels({ cwd: "/tmp/cursor", force: false })).resolves.toEqual([]);
  });
});
