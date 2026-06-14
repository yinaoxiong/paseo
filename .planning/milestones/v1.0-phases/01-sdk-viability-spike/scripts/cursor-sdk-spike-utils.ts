import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { SDKAgent, SDKMessage } from "@cursor/sdk";

export const phaseRoot = ".planning/phases/01-sdk-viability-spike";
export const resultsDir = path.join(phaseRoot, "results");
export const storesDir = path.join(phaseRoot, "stores");
export const defaultModel = process.env.CURSOR_SDK_SPIKE_MODEL ?? "composer-2.5";

export interface ParsedArgs {
  readonly flags: Map<string, string | boolean>;
  readonly positionals: string[];
}

export interface CursorApiKeyResolution {
  readonly hasCursorApiKey: boolean;
  readonly source: "provider-config" | "env" | "absent";
  readonly value?: string;
  readonly configPath?: string;
}

export interface SerializedSdkError {
  readonly className: string;
  readonly name: string;
  readonly message: string;
  readonly code?: string;
  readonly status?: number;
  readonly isRetryable?: boolean;
  readonly requestId?: string;
  readonly operation?: string;
  readonly endpoint?: string;
}

export interface SpikeEnvironment {
  readonly node: string;
  readonly npm: string;
  readonly packageVersion: string;
  readonly hasCursorApiKey: boolean;
  readonly cursorApiKeySource: CursorApiKeyResolution["source"];
}

export interface ScratchGitRepo {
  readonly cwd: string;
  readonly seedFile: string;
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const flags = new Map<string, string | boolean>();
  const positionals: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }

    const [rawName, inlineValue] = arg.slice(2).split("=", 2);
    if (!rawName) {
      throw new Error(`Invalid argument: ${arg}`);
    }
    if (inlineValue !== undefined) {
      flags.set(rawName, inlineValue);
      continue;
    }

    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      flags.set(rawName, next);
      index += 1;
    } else {
      flags.set(rawName, true);
    }
  }

  return { flags, positionals };
}

export function getStringFlag(
  args: ParsedArgs,
  name: string,
  fallback?: string,
): string | undefined {
  const value = args.flags.get(name);
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  return fallback;
}

export function getBooleanFlag(args: ParsedArgs, name: string): boolean {
  return args.flags.get(name) === true;
}

export function resolveResultPath(fileName: string): string {
  return path.join(resultsDir, fileName);
}

export function resolveStorePath(sessionId: string): string {
  return path.join(storesDir, sessionId);
}

export async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export function readCursorApiKey(): CursorApiKeyResolution {
  const paseoHome = process.env.PASEO_HOME;
  const configPath = paseoHome ? path.join(paseoHome, "config.json") : undefined;
  const configKey = configPath ? readProviderConfigCursorApiKey(configPath) : undefined;
  if (configKey) {
    return {
      hasCursorApiKey: true,
      source: "provider-config",
      value: configKey,
      configPath,
    };
  }

  const envKey = readNonEmptyString(process.env.CURSOR_API_KEY);
  if (envKey) {
    return {
      hasCursorApiKey: true,
      source: "env",
      value: envKey,
      configPath,
    };
  }

  return {
    hasCursorApiKey: false,
    source: "absent",
    configPath,
  };
}

export function buildEnvironment(apiKey: CursorApiKeyResolution): SpikeEnvironment {
  return {
    node: process.version,
    npm: execFileSync("npm", ["--version"], { encoding: "utf8" }).trim(),
    packageVersion: readCursorSdkPackageVersion(),
    hasCursorApiKey: apiKey.hasCursorApiKey,
    cursorApiKeySource: apiKey.source,
  };
}

export async function writeRedactedJson(
  filePath: string,
  value: unknown,
  secrets: readonly string[] = [],
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const redacted = redactSecrets(value, secrets);
  await writeFile(filePath, `${JSON.stringify(redacted, null, 2)}\n`, "utf8");
}

export function redactSecrets(value: unknown, secrets: readonly string[] = []): unknown {
  if (typeof value === "string") {
    return redactString(value, secrets);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactSecrets(item, secrets));
  }
  if (isRecord(value)) {
    const next: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (isSecretKeyName(key)) {
        next[key] = item ? "[REDACTED]" : item;
      } else {
        next[key] = redactSecrets(item, secrets);
      }
    }
    return next;
  }
  return value;
}

export function serializeSdkError(
  error: unknown,
  secrets: readonly string[] = [],
): SerializedSdkError {
  const record = isRecord(error) ? error : {};
  const fallbackMessage = error instanceof Error ? error.message : String(error);
  return {
    className: error instanceof Error ? error.constructor.name : "NonErrorThrown",
    name: error instanceof Error ? error.name : "NonErrorThrown",
    message: truncate(redactString(fallbackMessage, secrets), 800),
    code: readString(record.code),
    status: readNumber(record.status),
    isRetryable: readBoolean(record.isRetryable),
    requestId: readString(record.requestId),
    operation: readString(record.operation),
    endpoint: readString(record.endpoint),
  };
}

export async function createScratchGitRepo(experiment: string): Promise<ScratchGitRepo> {
  const rawDir = await mkdtemp(path.join(tmpdir(), `paseo-cursor-sdk-${experiment}-`));
  const cwd = realpathSync(rawDir);
  const seedFile = path.join(cwd, "README.md");
  writeFileSync(
    seedFile,
    [
      "# Cursor SDK Spike Scratch Repo",
      "",
      "This disposable git repository is used only for Paseo Cursor SDK spike probes.",
      "",
    ].join("\n"),
    "utf8",
  );
  execFileSync("git", ["init", "-b", "main"], { cwd, stdio: "ignore" });
  execFileSync("git", ["add", "README.md"], { cwd, stdio: "ignore" });
  execFileSync(
    "git",
    [
      "-c",
      "user.email=paseo-spike@example.invalid",
      "-c",
      "user.name=Paseo Spike",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-m",
      "seed scratch repo",
    ],
    { cwd, stdio: "ignore" },
  );
  return { cwd, seedFile };
}

export function assertNotPaseoCheckout(cwd: string): void {
  const repoRoot = realpathSync(process.cwd());
  const realCwd = realpathSync(cwd);
  if (realCwd === repoRoot) {
    throw new Error(`Refusing to run Cursor SDK probe in Paseo checkout: ${realCwd}`);
  }
}

export async function disposeSdkAgent(agent: SDKAgent | null | undefined): Promise<void> {
  if (!agent) {
    return;
  }
  await agent[Symbol.asyncDispose]();
}

export function countStreamEvent(typeCounts: Record<string, number>, event: SDKMessage): void {
  typeCounts[event.type] = (typeCounts[event.type] ?? 0) + 1;
}

export function previewText(value: unknown, limit = 500): string | null {
  if (typeof value !== "string") {
    return null;
  }
  return truncate(value.replace(/\s+/g, " ").trim(), limit);
}

export function getAgentIdPrefix(agentId: string | undefined): string | null {
  if (!agentId) {
    return null;
  }
  const separatorIndex = agentId.indexOf("-");
  return separatorIndex > 0 ? agentId.slice(0, separatorIndex) : "local";
}

export function makeSessionId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

export function providerImpactForBlockedAuth(capability: string): string {
  return `${capability} could not be live-verified without CURSOR_API_KEY; Phase 2 must treat availability/auth diagnostics as a first-class provider state.`;
}

export function providerImpactForFailure(capability: string): string {
  return `${capability} needs design adjustment before production provider implementation.`;
}

function readProviderConfigCursorApiKey(configPath: string): string | undefined {
  if (!existsSync(configPath)) {
    return undefined;
  }
  const config = JSON.parse(readFileSync(configPath, "utf8")) as unknown;
  if (!isRecord(config)) {
    return undefined;
  }
  const agents = config.agents;
  if (!isRecord(agents)) {
    return undefined;
  }
  const providers = agents.providers;
  if (!isRecord(providers)) {
    return undefined;
  }
  const cursorSdk = providers["cursor-sdk"];
  if (!isRecord(cursorSdk)) {
    return undefined;
  }
  const env = cursorSdk.env;
  if (!isRecord(env)) {
    return undefined;
  }
  return readNonEmptyString(env.CURSOR_API_KEY);
}

function readCursorSdkPackageVersion(): string {
  const packagePath = path.join(process.cwd(), "node_modules", "@cursor", "sdk", "package.json");
  const packageJson = JSON.parse(readFileSync(packagePath, "utf8")) as unknown;
  if (!isRecord(packageJson)) {
    throw new Error(`Unexpected @cursor/sdk package metadata at ${packagePath}`);
  }
  const version = readString(packageJson.version);
  if (!version) {
    throw new Error(`Missing @cursor/sdk version in ${packagePath}`);
  }
  return version;
}

function redactString(value: string, secrets: readonly string[]): string {
  let redacted = value;
  for (const secret of secrets) {
    if (secret) {
      redacted = redacted.split(secret).join("[REDACTED]");
    }
  }
  const cursorApiKeyAssignmentPattern = new RegExp(
    ["CURSOR_API_KEY", "=([^\\s\"'`]+)"].join(""),
    "g",
  );
  const cursorApiKeyRedaction = ["CURSOR_API_KEY", "="].join("") + "[REDACTED]";
  return redacted
    .replace(cursorApiKeyAssignmentPattern, () => cursorApiKeyRedaction)
    .replace(/sk-[A-Za-z0-9_-]+/g, "sk-[REDACTED]")
    .replace(/cursor_[A-Za-z0-9_-]+/g, "cursor_[REDACTED]");
}

function isSecretKeyName(key: string): boolean {
  const normalized = key.toLowerCase();
  if (normalized.startsWith("has") || normalized.endsWith("source")) {
    return false;
  }
  const separated = splitCamelCaseKeyName(key);
  return /(^|[_-])(api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret[_-]?key|client[_-]?secret|secret|password)$/i.test(
    separated,
  );
}

function splitCamelCaseKeyName(key: string): string {
  return key.replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2").replace(/([a-z0-9])([A-Z])/g, "$1_$2");
}

function truncate(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit)}...`;
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
