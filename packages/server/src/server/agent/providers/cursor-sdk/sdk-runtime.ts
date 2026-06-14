import { promises as fs } from "node:fs";
import type { AgentOptions, LocalAgentStore, SDKAgent, SDKModel } from "@cursor/sdk";

export interface CursorSdkRuntimeReadiness {
  available: boolean;
  error?: unknown;
}

export interface CursorSdkSandboxSupport {
  supported: boolean;
  reason?: string;
  error?: unknown;
}

export type CursorSdkRuntimeModel =
  | string
  | Pick<SDKModel, "id" | "displayName" | "description" | "aliases" | "parameters" | "variants">;

export interface CursorSdkRuntime {
  checkReadiness(): Promise<CursorSdkRuntimeReadiness>;
  checkSandboxSupport(): Promise<CursorSdkSandboxSupport>;
  listModels(options?: { apiKey?: string }): Promise<CursorSdkRuntimeModel[]>;
  createJsonlStore(storePath: string): Promise<LocalAgentStore>;
  createAgent(options?: AgentOptions): Promise<SDKAgent>;
  resumeAgent(agentId: string, options?: Partial<AgentOptions>): Promise<SDKAgent>;
}

export class ProductionCursorSdkRuntime implements CursorSdkRuntime {
  async checkReadiness(): Promise<CursorSdkRuntimeReadiness> {
    try {
      await import("@cursor/sdk");
      return { available: true };
    } catch (error) {
      return { available: false, error };
    }
  }

  async checkSandboxSupport(): Promise<CursorSdkSandboxSupport> {
    return {
      supported: false,
      reason:
        "Cursor SDK does not expose a verified side-effect-free local sandbox capability probe in this runtime.",
    };
  }

  async listModels(options?: { apiKey?: string }): Promise<CursorSdkRuntimeModel[]> {
    const { Cursor } = await import("@cursor/sdk");
    return await Cursor.models.list({ apiKey: options?.apiKey });
  }

  async createJsonlStore(storePath: string): Promise<LocalAgentStore> {
    const { JsonlLocalAgentStore } = await import("@cursor/sdk");
    await fs.mkdir(storePath, { recursive: true });
    return new JsonlLocalAgentStore(storePath);
  }

  async createAgent(options?: AgentOptions): Promise<SDKAgent> {
    const { Agent } = await import("@cursor/sdk");
    if (!options) {
      throw new Error("Cursor SDK createAgent requires options");
    }
    return await Agent.create(options);
  }

  async resumeAgent(agentId: string, options?: Partial<AgentOptions>): Promise<SDKAgent> {
    const { Agent } = await import("@cursor/sdk");
    return await Agent.resume(agentId, options);
  }
}
