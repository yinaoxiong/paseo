import type { AgentMode } from "../../agent-sdk-types.js";
import type { CursorSdkSandboxSupport } from "./sdk-runtime.js";

export const CURSOR_SDK_SANDBOX_MODE: AgentMode = {
  id: "sandbox",
  label: "Sandbox",
  description: "Run Cursor SDK local agents with sandboxing enabled.",
  icon: "ShieldCheck",
  colorTier: "safe",
  isUnattended: false,
};

export const CURSOR_SDK_YOLO_MODE: AgentMode = {
  id: "yolo",
  label: "YOLO",
  description: "Run Cursor SDK local agents without sandboxing.",
  icon: "ShieldOff",
  colorTier: "dangerous",
  isUnattended: true,
};

export const CURSOR_SDK_MODES: AgentMode[] = [CURSOR_SDK_SANDBOX_MODE, CURSOR_SDK_YOLO_MODE];

export function listCursorSdkModes(sandboxSupport: CursorSdkSandboxSupport): AgentMode[] {
  return sandboxSupport.supported
    ? [CURSOR_SDK_SANDBOX_MODE, CURSOR_SDK_YOLO_MODE]
    : [CURSOR_SDK_YOLO_MODE];
}

export function resolveCursorSdkMode(modeId: string): AgentMode {
  const mode = CURSOR_SDK_MODES.find((candidate) => candidate.id === modeId);
  if (!mode) {
    throw new Error(`Invalid Cursor SDK mode '${modeId}'`);
  }
  return mode;
}
