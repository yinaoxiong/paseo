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
    typeof value.fontCount === "number" &&
    Number.isSafeInteger(value.fontCount) &&
    value.fontCount >= 0 &&
    typeof value.renderMs === "number" &&
    Number.isFinite(value.renderMs) &&
    value.renderMs >= 0
  ) {
    return {
      type: "size",
      revision: value.revision,
      width: value.width,
      height: value.height,
      fontCount: value.fontCount,
      renderMs: value.renderMs,
    };
  }
  return null;
}
