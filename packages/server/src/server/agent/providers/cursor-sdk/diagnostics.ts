import { formatProviderDiagnostic, type DiagnosticEntry } from "../diagnostic-utils.js";

export type CursorSdkApiKeySource = "provider-config" | "process-env" | "missing";

export const CURSOR_SDK_METADATA_VALIDATION_CODE = "CURSOR_SDK_METADATA_INVALID";
export const CURSOR_SDK_PATH_VALIDATION_CODE = "CURSOR_SDK_STORE_PATH_INVALID";
export const CURSOR_SDK_CANCEL_UNSUPPORTED_CODE = "CURSOR_SDK_CANCEL_UNSUPPORTED";

export interface CursorSdkDiagnosticContext {
  operation?: string;
  endpoint?: string;
  apiKeySource?: CursorSdkApiKeySource;
  model?: string | null;
  sandboxEnabled?: boolean;
  sdkAgentId?: string | null;
  runId?: string | null;
  requestId?: string | null;
  eventType?: string | null;
  status?: string | null;
  code?: string | null;
  secrets?: Array<string | undefined>;
}

export interface CursorSdkDiagnostic {
  errorClass?: string;
  message?: string;
  status?: string;
  code?: string;
  operation?: string;
  endpoint?: string;
  apiKeySource?: CursorSdkApiKeySource;
  model?: string;
  sandbox?: string;
  sdkAgentId?: string;
  runId?: string;
  requestId?: string;
  eventType?: string;
}

const KEY_SHAPED_PATTERNS = [
  /\b(?:sk|key|api)[-_][A-Za-z0-9][A-Za-z0-9._-]{5,}\b/gu,
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*\b/giu,
  /\bCURSOR_API_KEY\b\s*[:=]\s*["']?[^"'\s,}]+/giu,
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function readProperty(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

function stringifySafe(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") {
    return String(value);
  }
  return undefined;
}

function secretFragments(secret: string): string[] {
  const trimmed = secret.trim();
  if (trimmed.length < 4) return [];
  const fragments = new Set<string>([trimmed]);
  for (const part of trimmed.split(/[^A-Za-z0-9_-]+/u)) {
    if (part.length >= 4) fragments.add(part);
  }
  if (trimmed.length >= 8) {
    fragments.add(trimmed.slice(0, 8));
    fragments.add(trimmed.slice(-8));
  }
  return [...fragments].filter((fragment) => fragment.length >= 4);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

export function redactCursorSdkDiagnosticValue(
  value: string | undefined,
  secrets: Array<string | undefined> = [],
): string | undefined {
  if (!value) return value;
  let redacted = value;
  for (const secret of secrets) {
    if (!secret) continue;
    for (const fragment of secretFragments(secret)) {
      redacted = redacted.replace(new RegExp(escapeRegExp(fragment), "gu"), "[redacted]");
    }
  }
  for (const pattern of KEY_SHAPED_PATTERNS) {
    redacted = redacted.replace(pattern, "[redacted]");
  }
  return redacted
    .replace(/\bauthorization\b\s*[:=]\s*[^,\n}]+/giu, "authorization: [redacted]")
    .replace(/\bheaders\b\s*[:=]\s*\{[^}]*\}/giu, "headers: [redacted]")
    .replace(/\benv\b\s*[:=]\s*\{[^}]*\}/giu, "env: [redacted]");
}

export function toCursorSdkDiagnostic(
  error: unknown,
  context: CursorSdkDiagnosticContext = {},
): CursorSdkDiagnostic {
  const secrets = context.secrets ?? [];
  const message = redactCursorSdkDiagnosticValue(
    error instanceof Error ? error.message : stringifySafe(error),
    secrets,
  );
  const errorClass =
    stringifySafe(readProperty(error, "name")) ?? (error instanceof Error ? error.name : undefined);

  return {
    errorClass: redactCursorSdkDiagnosticValue(errorClass, secrets),
    message,
    status: redactCursorSdkDiagnosticValue(
      context.status ?? stringifySafe(readProperty(error, "status")),
      secrets,
    ),
    code: redactCursorSdkDiagnosticValue(
      context.code ?? stringifySafe(readProperty(error, "code")),
      secrets,
    ),
    operation: redactCursorSdkDiagnosticValue(
      context.operation ?? stringifySafe(readProperty(error, "operation")),
      secrets,
    ),
    endpoint: redactCursorSdkDiagnosticValue(
      context.endpoint ?? stringifySafe(readProperty(error, "endpoint")),
      secrets,
    ),
    apiKeySource: context.apiKeySource,
    model: redactCursorSdkDiagnosticValue(context.model ?? undefined, secrets),
    sandbox:
      typeof context.sandboxEnabled === "boolean" ? String(context.sandboxEnabled) : undefined,
    sdkAgentId: redactCursorSdkDiagnosticValue(context.sdkAgentId ?? undefined, secrets),
    runId: redactCursorSdkDiagnosticValue(context.runId ?? undefined, secrets),
    requestId: redactCursorSdkDiagnosticValue(
      context.requestId ?? stringifySafe(readProperty(error, "requestId")),
      secrets,
    ),
    eventType: redactCursorSdkDiagnosticValue(context.eventType ?? undefined, secrets),
  };
}

function pushEntry(entries: DiagnosticEntry[], label: string, value: string | undefined): void {
  if (value && value.trim().length > 0) {
    entries.push({ label, value });
  }
}

export function formatCursorSdkDiagnostic(
  diagnostic: CursorSdkDiagnostic,
  options: { sdkReadiness?: string; sandboxSupport?: string } = {},
): string {
  const entries: DiagnosticEntry[] = [];
  pushEntry(entries, "SDK readiness", options.sdkReadiness);
  pushEntry(entries, "API key source", diagnostic.apiKeySource);
  pushEntry(entries, "Sandbox support", options.sandboxSupport);
  pushEntry(entries, "Error class", diagnostic.errorClass);
  pushEntry(entries, "Message", diagnostic.message);
  pushEntry(entries, "Status", diagnostic.status);
  pushEntry(entries, "Code", diagnostic.code);
  pushEntry(entries, "Operation", diagnostic.operation);
  pushEntry(entries, "Endpoint", diagnostic.endpoint);
  pushEntry(entries, "Model", diagnostic.model);
  pushEntry(entries, "Sandbox enabled", diagnostic.sandbox);
  pushEntry(entries, "SDK agent id", diagnostic.sdkAgentId);
  pushEntry(entries, "Run id", diagnostic.runId);
  pushEntry(entries, "Request id", diagnostic.requestId);
  pushEntry(entries, "Event type", diagnostic.eventType);
  return formatProviderDiagnostic("Cursor SDK", entries);
}
