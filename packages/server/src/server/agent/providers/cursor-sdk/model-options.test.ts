import { describe, expect, test } from "vitest";

import {
  buildCursorSdkFeatures,
  buildCursorSdkSendModelSelection,
  decodeCursorSdkModelOptionId,
  expandCursorSdkModels,
  type CursorSdkModelListItem,
} from "./model-options.js";

const SDK_MODELS = [
  {
    id: "auto",
    displayName: "Auto",
    description: "Cursor default routing",
  },
  {
    id: "gpt-5.5",
    displayName: "GPT-5.5",
    description: "Flagship GPT model",
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
          { value: "none", displayName: "None" },
          { value: "low", displayName: "Low" },
          { value: "extra-high", displayName: "Extra High" },
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
    variants: [
      {
        displayName: "GPT-5.5",
        params: [
          { id: "context", value: "272k" },
          { id: "reasoning", value: "none" },
          { id: "fast", value: "false" },
        ],
        isDefault: true,
      },
      {
        displayName: "GPT-5.5",
        params: [
          { id: "fast", value: "true" },
          { id: "context", value: "272k" },
          { id: "reasoning", value: "low" },
        ],
      },
      {
        displayName: "GPT-5.5",
        params: [
          { id: "context", value: "1m" },
          { id: "reasoning", value: "none" },
          { id: "fast", value: "false" },
        ],
      },
      {
        displayName: "GPT-5.5",
        params: [
          { id: "context", value: "1m" },
          { id: "reasoning", value: "extra-high" },
          { id: "fast", value: "true" },
        ],
      },
    ],
  },
  {
    id: "opus-4.8",
    displayName: "Opus 4.8",
    parameters: [
      {
        id: "effort",
        displayName: "Effort",
        values: [
          { value: "low", displayName: "Low" },
          { value: "max", displayName: "Max" },
        ],
      },
      {
        id: "thinking",
        displayName: "Thinking",
        values: [
          { value: "false", displayName: "Off" },
          { value: "true", displayName: "On" },
        ],
      },
    ],
  },
] satisfies CursorSdkModelListItem[];

describe("Cursor SDK model options", () => {
  test("expands SDK models in SDK order and emits no bare base row when context exists", () => {
    const rows = expandCursorSdkModels(SDK_MODELS);

    expect(rows.map((row) => row.label)).toEqual([
      "Auto",
      "GPT-5.5 - 272K",
      "GPT-5.5 - 1M",
      "Opus 4.8",
    ]);
    expect(rows.map((row) => row.id)).not.toContain("gpt-5.5");
    expect(rows.every((row) => row.provider === "cursor-sdk")).toBe(true);
    expect(new Set(rows.map((row) => row.label)).size).toBe(rows.length);
  });

  test("decodes composite-variant context rows without adding reasoning or fast defaults", () => {
    const gptRows = expandCursorSdkModels(SDK_MODELS).filter((row) =>
      row.label.startsWith("GPT-5.5 - "),
    );

    expect(gptRows.map((row) => decodeCursorSdkModelOptionId(row.id, SDK_MODELS))).toEqual([
      {
        id: "gpt-5.5",
        params: [{ id: "context", value: "272k" }],
      },
      {
        id: "gpt-5.5",
        params: [{ id: "context", value: "1m" }],
      },
    ]);
    expect(gptRows[0]?.id).not.toBe(gptRows[1]?.id);
  });

  test("maps reasoning, effort, and boolean thinking while preserving raw SDK values", () => {
    const rows = expandCursorSdkModels(SDK_MODELS);
    const gpt = rows.find((row) => row.label === "GPT-5.5 - 272K");
    const opus = rows.find((row) => row.label === "Opus 4.8");

    expect(gpt?.thinkingOptions?.map((option) => option.label)).toEqual([
      "None",
      "Low",
      "Extra High",
    ]);
    expect(gpt?.thinkingOptions?.map((option) => option.metadata)).toEqual([
      { cursorSdkParameter: { id: "reasoning", value: "none" } },
      { cursorSdkParameter: { id: "reasoning", value: "low" } },
      { cursorSdkParameter: { id: "reasoning", value: "extra-high" } },
    ]);
    expect(opus?.thinkingOptions?.map((option) => option.label)).toEqual([
      "Low",
      "Max",
      "Thinking Off",
      "Thinking On",
    ]);
    expect(opus?.thinkingOptions?.map((option) => option.metadata)).toContainEqual({
      cursorSdkParameter: { id: "thinking", value: "true" },
    });
  });

  test("does not mark context or thinking options as defaults", () => {
    const rows = expandCursorSdkModels(SDK_MODELS);
    const thinkingOptions = rows.flatMap((row) => row.thinkingOptions ?? []);

    expect(rows.some((row) => row.isDefault === true)).toBe(false);
    expect(rows.some((row) => row.defaultThinkingOptionId)).toBe(false);
    expect(thinkingOptions.some((option) => option.isDefault === true)).toBe(false);
  });

  test("builds fast feature only for models that expose fast and defaults it to false", () => {
    const rows = expandCursorSdkModels(SDK_MODELS);
    const auto = rows.find((row) => row.label === "Auto");
    const gpt = rows.find((row) => row.label === "GPT-5.5 - 272K");

    expect(buildCursorSdkFeatures({ modelId: auto?.id ?? null, models: SDK_MODELS })).toEqual([]);
    expect(buildCursorSdkFeatures({ modelId: gpt?.id ?? null, models: SDK_MODELS })).toEqual([
      expect.objectContaining({
        id: "fast_mode",
        label: "Fast",
        value: false,
      }),
    ]);
    expect(
      buildCursorSdkFeatures({
        modelId: gpt?.id ?? null,
        models: SDK_MODELS,
        featureValues: { fast_mode: true },
      }),
    ).toEqual([expect.objectContaining({ id: "fast_mode", value: true })]);
    expect(
      buildCursorSdkSendModelSelection({
        modelId: gpt?.id ?? null,
        featureValues: { fast_mode: false },
        models: SDK_MODELS,
      }),
    ).toEqual({
      id: "gpt-5.5",
      params: [{ id: "context", value: "272k" }],
    });
  });

  test("rejects tampered ids and stale unsupported options before send", () => {
    const rows = expandCursorSdkModels(SDK_MODELS);
    const gpt = rows.find((row) => row.label === "GPT-5.5 - 272K");
    const reasoningLow = gpt?.thinkingOptions?.find((option) => option.label === "Low");
    const staleModels = [
      {
        id: "gpt-5.5",
        displayName: "GPT-5.5",
        parameters: [
          {
            id: "context",
            displayName: "Context",
            values: [{ value: "1m", displayName: "1M" }],
          },
        ],
      },
    ] satisfies CursorSdkModelListItem[];

    expect(decodeCursorSdkModelOptionId("cursor-sdk-model:not-json", SDK_MODELS)).toBeNull();
    expect(decodeCursorSdkModelOptionId(gpt?.id ?? "", staleModels)).toBeNull();
    expect(
      buildCursorSdkSendModelSelection({
        modelId: gpt?.id ?? null,
        thinkingOptionId: "cursor-sdk-thinking:not-json",
        featureValues: { fast_mode: true },
        models: SDK_MODELS,
      }),
    ).toBeNull();
    expect(
      buildCursorSdkSendModelSelection({
        modelId: gpt?.id ?? null,
        thinkingOptionId: reasoningLow?.id ?? null,
        featureValues: { fast_mode: true },
        models: staleModels,
      }),
    ).toBeNull();
    expect(
      buildCursorSdkSendModelSelection({
        modelId: gpt?.id ?? null,
        thinkingOptionId: reasoningLow?.id ?? null,
        featureValues: { fast_mode: true },
        models: SDK_MODELS,
      }),
    ).toEqual({
      id: "gpt-5.5",
      params: [
        { id: "context", value: "272k" },
        { id: "reasoning", value: "low" },
        { id: "fast", value: "true" },
      ],
    });
  });
});
