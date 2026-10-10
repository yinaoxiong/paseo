export const MAX_MATH_RENDER_HEIGHT = 65536;
export const MAX_MATH_SCROLL_REGIONS = 64;
import type { MobilePanelGestureRegion } from "@/mobile-panels/gesture-regions";

export interface MathRuntimeRequest {
  revision: number;
  html: string;
  width: number;
  fontSize: number;
  lineHeight: number;
  color: string;
  linkColor: string;
  codeColor: string;
  codeBackground: string;
  fontWeight?: string;
  fontStyle?: string;
  fontFamily?: string;
  codeFontSize?: number;
}

export type MathRuntimeMessage =
  | { type: "ready" }
  | { type: "failed"; revision: number }
  | { type: "link"; revision: number; index: number }
  | {
      type: "size";
      revision: number;
      width: number;
      height: number;
      fontCount: number;
      renderMs: number;
      horizontalScrollRegions: MobilePanelGestureRegion[];
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function parseRegions(
  value: unknown,
  width: number,
  height: number,
): MobilePanelGestureRegion[] | null {
  if (!Array.isArray(value) || value.length > MAX_MATH_SCROLL_REGIONS) return null;
  const regions: MobilePanelGestureRegion[] = [];
  for (const region of value) {
    if (!isRecord(region) || !isPositive(region.width) || !isPositive(region.height)) return null;
    if (
      typeof region.x !== "number" ||
      !Number.isFinite(region.x) ||
      region.x < 0 ||
      typeof region.y !== "number" ||
      !Number.isFinite(region.y) ||
      region.y < 0 ||
      region.x + region.width > width + 0.5 ||
      region.y + region.height > height + 0.5
    )
      return null;
    regions.push({ x: region.x, y: region.y, width: region.width, height: region.height });
  }
  return regions;
}

export function parseMathRuntimeRequest(value: unknown): MathRuntimeRequest | null {
  if (!isRecord(value) || !isRevision(value.revision)) return null;
  if (typeof value.html !== "string") return null;
  if (!isPositive(value.width) || !isPositive(value.fontSize) || !isPositive(value.lineHeight)) {
    return null;
  }
  if (
    typeof value.color !== "string" ||
    typeof value.linkColor !== "string" ||
    typeof value.codeColor !== "string" ||
    typeof value.codeBackground !== "string"
  ) {
    return null;
  }
  const typography = parseTypography(value);
  if (!typography) return null;
  return {
    revision: value.revision,
    html: value.html,
    width: value.width,
    fontSize: value.fontSize,
    lineHeight: value.lineHeight,
    color: value.color,
    linkColor: value.linkColor,
    codeColor: value.codeColor,
    codeBackground: value.codeBackground,
    ...typography,
  };
}

export function parseMathRuntimeMessage(value: unknown): MathRuntimeMessage | null {
  if (!isRecord(value)) return null;
  if (value.type === "ready") return { type: "ready" };
  if (!isRevision(value.revision)) return null;
  if (value.type === "failed") return { type: "failed", revision: value.revision };
  if (value.type === "link") {
    if (typeof value.index !== "number" || !Number.isSafeInteger(value.index) || value.index < 0) {
      return null;
    }
    return { type: "link", revision: value.revision, index: value.index };
  }
  if (
    value.type === "size" &&
    isPositive(value.width) &&
    isPositive(value.height) &&
    value.height <= MAX_MATH_RENDER_HEIGHT &&
    typeof value.fontCount === "number" &&
    Number.isSafeInteger(value.fontCount) &&
    value.fontCount >= 0 &&
    typeof value.renderMs === "number" &&
    Number.isFinite(value.renderMs) &&
    value.renderMs >= 0
  ) {
    const horizontalScrollRegions = parseRegions(
      value.horizontalScrollRegions,
      value.width,
      value.height,
    );
    if (!horizontalScrollRegions) return null;
    return {
      type: "size",
      revision: value.revision,
      width: value.width,
      height: value.height,
      fontCount: value.fontCount,
      renderMs: value.renderMs,
      horizontalScrollRegions,
    };
  }
  return null;
}

function parseTypography(value: Record<string, unknown>) {
  const fontWeight = value.fontWeight ?? "normal";
  const fontStyle = value.fontStyle ?? "normal";
  const fontFamily = value.fontFamily ?? "system-ui";
  const codeFontSize = value.codeFontSize ?? value.fontSize;
  if (
    typeof fontWeight !== "string" ||
    !/^(normal|bold|[1-9]00)$/.test(fontWeight) ||
    !["normal", "italic"].includes(String(fontStyle)) ||
    typeof fontFamily !== "string" ||
    fontFamily.length > 1024 ||
    !isPositive(codeFontSize)
  )
    return null;
  return { fontWeight, fontStyle: String(fontStyle), fontFamily, codeFontSize };
}
