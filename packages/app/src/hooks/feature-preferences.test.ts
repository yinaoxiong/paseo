import { describe, expect, it } from "vitest";

import {
  applyFeatureValues,
  pruneFeatureValues,
  replaceProviderFeatureValues,
  resolveFeatureValues,
} from "./feature-preferences";

describe("feature-preferences", () => {
  const features = [
    {
      type: "toggle" as const,
      id: "fast_mode",
      label: "Fast",
      value: false,
    },
    {
      type: "toggle" as const,
      id: "plan_mode",
      label: "Plan",
      value: false,
    },
  ];

  it("restores persisted values for available features", () => {
    expect(
      resolveFeatureValues({
        features,
        persistedFeatureValues: {
          fast_mode: true,
          unknown_feature: true,
        },
        localFeatureValues: {},
      }),
    ).toEqual({
      fast_mode: true,
    });
  });

  it("prefers local values over persisted values", () => {
    expect(
      resolveFeatureValues({
        features,
        persistedFeatureValues: {
          fast_mode: true,
          plan_mode: false,
        },
        localFeatureValues: {
          fast_mode: false,
        },
      }),
    ).toEqual({
      fast_mode: false,
      plan_mode: false,
    });
  });

  it("prunes persisted Cursor SDK fast values when fast is unavailable", () => {
    const withoutFast = features.filter((feature) => feature.id !== "fast_mode");

    expect(
      pruneFeatureValues(
        {
          fast_mode: true,
          plan_mode: true,
        },
        withoutFast,
      ),
    ).toEqual({
      plan_mode: true,
    });
  });

  it("replaces provider feature values instead of merging stale fast values back in", () => {
    const preferences = replaceProviderFeatureValues({
      preferences: {
        provider: "cursor-sdk",
        providerPreferences: {
          "cursor-sdk": {
            model: "sdk:gpt-5.5:context=1m",
            featureValues: {
              fast_mode: true,
              plan_mode: true,
            },
          },
          cursor: {
            featureValues: {
              fast_mode: true,
            },
          },
        },
      },
      provider: "cursor-sdk",
      featureValues: {
        plan_mode: true,
      },
    });

    expect(preferences.providerPreferences?.["cursor-sdk"]?.featureValues).toEqual({
      plan_mode: true,
    });
    expect(preferences.providerPreferences?.cursor?.featureValues).toEqual({
      fast_mode: true,
    });
  });

  it("removes the provider featureValues record when no features remain", () => {
    const preferences = replaceProviderFeatureValues({
      preferences: {
        providerPreferences: {
          "cursor-sdk": {
            featureValues: {
              fast_mode: true,
            },
          },
        },
      },
      provider: "cursor-sdk",
      featureValues: {},
    });

    expect(preferences.providerPreferences?.["cursor-sdk"]?.featureValues).toBeUndefined();
  });

  it("keeps newly available Cursor SDK fast off when no user value exists", () => {
    const featureValues = resolveFeatureValues({
      features,
      persistedFeatureValues: {},
      localFeatureValues: {},
    });

    expect(featureValues).toEqual({});
    expect(applyFeatureValues(features, featureValues)).toEqual(features);
    expect(features.find((feature) => feature.id === "fast_mode")?.value).toBe(false);
  });
});
