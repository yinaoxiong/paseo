import { z } from "zod";

import type {
  AgentStreamEvent,
  ToolCallDetail,
  ToolCallTimelineItem,
} from "../../agent-sdk-types.js";
import { normalizeToolCallStatus } from "../tool-call-mapper-utils.js";
import {
  formatCursorSdkDiagnostic,
  redactCursorSdkDiagnosticValue,
  toCursorSdkDiagnostic,
  type CursorSdkDiagnostic,
} from "./diagnostics.js";

export interface CursorSdkStreamEventMapping {
  events: AgentStreamEvent[];
  diagnostic?: CursorSdkDiagnostic;
}

export interface CursorSdkStreamEventContext {
  turnId?: string;
  runId?: string | null;
  requestId?: string | null;
  secrets?: Array<string | undefined>;
}

const CursorSdkEventSchema = z
  .object({
    type: z.string().optional(),
    id: z.string().optional(),
    messageId: z.string().optional(),
    message_id: z.string().optional(),
    agent_id: z.string().optional(),
    agentId: z.string().optional(),
    run_id: z.string().optional(),
    runId: z.string().optional(),
    request_id: z.string().optional(),
    requestId: z.string().optional(),
    status: z.unknown().optional(),
    code: z.unknown().optional(),
    errorCode: z.unknown().optional(),
    message: z.unknown().optional(),
    text: z.unknown().optional(),
    content: z.unknown().optional(),
    delta: z.unknown().optional(),
    call_id: z.string().optional(),
    callId: z.string().optional(),
    name: z.string().optional(),
    toolName: z.string().optional(),
    input: z.unknown().optional(),
    args: z.unknown().optional(),
    output: z.unknown().optional(),
    result: z.unknown().optional(),
    error: z.unknown().optional(),
  })
  .passthrough();

const CursorSdkStreamEnvelopeSchema = z
  .object({
    type: z.string().optional(),
    runId: z.string().optional(),
    requestId: z.string().optional(),
    message: z.unknown().optional(),
  })
  .passthrough();

const CursorSdkTerminalResultSchema = z
  .object({
    status: z.unknown().optional(),
    runId: z.string().optional(),
    run_id: z.string().optional(),
    requestId: z.string().optional(),
    request_id: z.string().optional(),
    code: z.unknown().optional(),
    errorCode: z.unknown().optional(),
    error: z.unknown().optional(),
    message: z.unknown().optional(),
  })
  .passthrough();

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const text = readString(value);
    if (text) return text;
  }
  return undefined;
}

function unwrapStreamEvent(event: unknown): {
  event: unknown;
  envelopeRunId?: string;
  envelopeRequestId?: string;
} {
  const parsed = CursorSdkStreamEnvelopeSchema.safeParse(event);
  if (!parsed.success) {
    return { event };
  }
  const envelope = parsed.data;
  if (envelope.type === "sdk_message" && envelope.message !== undefined) {
    return {
      event: envelope.message,
      envelopeRunId: envelope.runId,
      envelopeRequestId: envelope.requestId,
    };
  }
  return { event };
}

function readEventType(event: Record<string, unknown>): string {
  return firstString(event.type) ?? "unknown";
}

function readRunId(
  event: Record<string, unknown>,
  context: CursorSdkStreamEventContext,
  envelopeRunId?: string,
): string | undefined {
  return firstString(event.runId, event.run_id, envelopeRunId, context.runId);
}

function readRequestId(
  event: Record<string, unknown>,
  context: CursorSdkStreamEventContext,
  envelopeRequestId?: string,
): string | undefined {
  return firstString(event.requestId, event.request_id, envelopeRequestId, context.requestId);
}

function readSafeMessageId(event: Record<string, unknown>): string | undefined {
  return firstString(event.messageId, event.message_id, event.id);
}

function readNestedMessage(event: Record<string, unknown>): Record<string, unknown> | null {
  return readRecord(event.message);
}

function collectTextBlocks(value: unknown): string[] {
  if (typeof value === "string" && value.length > 0) {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      if (typeof item === "string" && item.length > 0) {
        return [item];
      }
      const record = readRecord(item);
      if (!record) {
        return [];
      }
      if (record.type === "text") {
        const text = readString(record.text);
        return text ? [text] : [];
      }
      return [];
    });
  }
  return [];
}

function readAssistantText(event: Record<string, unknown>): string | undefined {
  const nestedMessage = readNestedMessage(event);
  const parts = [
    ...collectTextBlocks(event.text),
    ...collectTextBlocks(event.delta),
    ...collectTextBlocks(event.content),
    ...collectTextBlocks(nestedMessage?.content),
  ];
  return parts.length > 0 ? parts.join("\n") : undefined;
}

function readReasoningText(event: Record<string, unknown>): string | undefined {
  const nestedMessage = readNestedMessage(event);
  const parts = [
    ...collectTextBlocks(event.text),
    ...collectTextBlocks(event.delta),
    ...collectTextBlocks(event.content),
    ...collectTextBlocks(nestedMessage?.content),
  ];
  return parts.length > 0 ? parts.join("\n") : undefined;
}

function buildDiagnostic(input: {
  event: Record<string, unknown>;
  context: CursorSdkStreamEventContext;
  eventType: string;
  operation?: string;
  runId?: string;
  requestId?: string;
  status?: string;
  code?: string;
  error?: unknown;
}): CursorSdkDiagnostic {
  return toCursorSdkDiagnostic(input.error, {
    operation: input.operation ?? "stream",
    eventType: input.eventType,
    runId: input.runId,
    requestId: input.requestId,
    status: input.status ?? readString(input.event.status),
    code: input.code ?? firstString(input.event.code, input.event.errorCode),
    secrets: input.context.secrets,
  });
}

export function mapCursorSdkStreamEvent(
  event: unknown,
  context: CursorSdkStreamEventContext = {},
): CursorSdkStreamEventMapping {
  const unwrapped = unwrapStreamEvent(event);
  const parsed = CursorSdkEventSchema.safeParse(unwrapped.event);
  if (!parsed.success) {
    return {
      events: [],
      diagnostic: toCursorSdkDiagnostic(new Error("Malformed Cursor SDK stream event"), {
        operation: "stream",
        eventType: "unknown",
        runId: context.runId ?? undefined,
        requestId: context.requestId ?? undefined,
        secrets: context.secrets,
      }),
    };
  }

  const sdkEvent = parsed.data;
  const eventType = readEventType(sdkEvent);
  const runId = readRunId(sdkEvent, context, unwrapped.envelopeRunId);
  const requestId = readRequestId(sdkEvent, context, unwrapped.envelopeRequestId);

  if (eventType === "assistant") {
    const text = readAssistantText(sdkEvent);
    if (!text) {
      return {
        events: [],
        diagnostic: buildDiagnostic({ event: sdkEvent, context, eventType, runId, requestId }),
      };
    }
    const item = {
      type: "assistant_message" as const,
      text,
      ...(readSafeMessageId(sdkEvent) ? { messageId: readSafeMessageId(sdkEvent) } : {}),
    };
    return {
      events: [
        {
          type: "timeline",
          provider: "cursor-sdk",
          ...(context.turnId ? { turnId: context.turnId } : {}),
          item,
        },
      ],
    };
  }

  if (eventType === "thinking" || eventType === "reasoning") {
    const text = readReasoningText(sdkEvent);
    if (!text) {
      return {
        events: [],
        diagnostic: buildDiagnostic({ event: sdkEvent, context, eventType, runId, requestId }),
      };
    }
    return {
      events: [
        {
          type: "timeline",
          provider: "cursor-sdk",
          ...(context.turnId ? { turnId: context.turnId } : {}),
          item: { type: "reasoning", text },
        },
      ],
    };
  }

  if (eventType === "tool_call") {
    const item = mapCursorSdkToolCall(sdkEvent);
    if (!item) {
      return {
        events: [],
        diagnostic: buildDiagnostic({ event: sdkEvent, context, eventType, runId, requestId }),
      };
    }
    return {
      events: [
        {
          type: "timeline",
          provider: "cursor-sdk",
          ...(context.turnId ? { turnId: context.turnId } : {}),
          item,
        },
      ],
    };
  }

  return {
    events: [],
    diagnostic: buildDiagnostic({
      event: sdkEvent,
      context,
      eventType,
      runId,
      requestId,
    }),
  };
}

export function mapCursorSdkTerminalStatus(
  result: unknown,
  context: CursorSdkStreamEventContext = {},
): Extract<AgentStreamEvent, { type: "turn_completed" | "turn_failed" | "turn_canceled" }> {
  const parsed = CursorSdkTerminalResultSchema.safeParse(result);
  const record = parsed.success ? parsed.data : {};
  const rawStatus = firstString(record.status, typeof result === "string" ? result : undefined);
  const status = rawStatus?.toLowerCase();
  const turn = context.turnId ? { turnId: context.turnId } : {};

  if (status === "finished") {
    return {
      type: "turn_completed",
      provider: "cursor-sdk",
      ...turn,
    };
  }

  if (status === "cancelled" || status === "canceled") {
    return {
      type: "turn_canceled",
      provider: "cursor-sdk",
      ...turn,
      reason: "cancelled",
    };
  }

  const runId = firstString(record.runId, record.run_id, context.runId);
  const requestId = firstString(record.requestId, record.request_id, context.requestId);
  const code = firstString(record.code, record.errorCode);
  const diagnostic = formatCursorSdkDiagnostic(
    toCursorSdkDiagnostic(record.error ?? record.message, {
      operation: "wait",
      eventType: "terminal",
      runId,
      requestId,
      status: rawStatus,
      code,
      secrets: context.secrets,
    }),
  );
  if (status === "error") {
    return {
      type: "turn_failed",
      provider: "cursor-sdk",
      ...turn,
      error: "Cursor SDK run failed",
      diagnostic,
    };
  }

  return {
    type: "turn_failed",
    provider: "cursor-sdk",
    ...turn,
    error: rawStatus
      ? `Cursor SDK run ended with unsupported status: ${rawStatus}`
      : "Cursor SDK run ended without a terminal status",
    diagnostic,
  };
}

function readToolCallInput(event: Record<string, unknown>): unknown {
  return event.input ?? event.args ?? null;
}

function readToolCallOutput(event: Record<string, unknown>): unknown {
  const result = event.output ?? event.result ?? null;
  const resultRecord = readRecord(result);
  if (resultRecord?.status === "success") {
    return resultRecord.value ?? null;
  }
  return result;
}

function readToolCallError(event: Record<string, unknown>): unknown {
  if (event.error !== undefined && event.error !== null) {
    return event.error;
  }
  const result = event.result ?? event.output;
  const resultRecord = readRecord(result);
  if (resultRecord?.status === "error") {
    return resultRecord.error ?? { message: "Tool call failed" };
  }
  return null;
}

function readFromRecord(record: Record<string, unknown> | null, ...keys: string[]): unknown {
  if (!record) return undefined;
  for (const key of keys) {
    if (record[key] !== undefined) return record[key];
  }
  return undefined;
}

function outputText(value: unknown): string | undefined {
  const direct = readString(value);
  if (direct) return direct;
  const record = readRecord(value);
  const stdout = readString(record?.stdout);
  const stderr = readString(record?.stderr);
  if (stdout && stderr) return `${stdout}\n${stderr}`;
  return (
    stdout ??
    stderr ??
    firstString(record?.text, record?.content, record?.output, record?.fileContentAfterWrite)
  );
}

const SHELL_TOOL_NAMES = new Set(["shell", "bash", "terminal", "run_command"]);
const READ_TOOL_NAMES = new Set(["read", "read_file"]);
const EDIT_TOOL_NAMES = new Set(["edit", "edit_file"]);
const WRITE_TOOL_NAMES = new Set(["write", "write_file"]);
const SEARCH_TOOL_NAMES = new Set([
  "search",
  "grep",
  "glob",
  "web_search",
  "semsearch",
  "semantic_search",
]);
const FETCH_TOOL_NAMES = new Set(["fetch", "web_fetch"]);

function deriveShellToolDetail(
  inputRecord: Record<string, unknown> | null,
  output: unknown,
): ToolCallDetail | null {
  const command = firstString(
    readFromRecord(inputRecord, "command"),
    readFromRecord(inputRecord, "cmd"),
  );
  if (!command) return null;
  const cwd = firstString(
    readFromRecord(inputRecord, "cwd"),
    readFromRecord(inputRecord, "workingDirectory"),
  );
  const text = outputText(output);
  const exitCode = readNumber(readRecord(output)?.exitCode);
  return {
    type: "shell",
    command,
    ...(cwd ? { cwd } : {}),
    ...(text ? { output: text } : {}),
    ...(exitCode !== undefined ? { exitCode } : {}),
  };
}

function deriveReadToolDetail(
  inputRecord: Record<string, unknown> | null,
  output: unknown,
): ToolCallDetail | null {
  const filePath = firstString(
    readFromRecord(inputRecord, "filePath"),
    readFromRecord(inputRecord, "path"),
  );
  if (!filePath) return null;
  const content = outputText(output);
  const offset = readNumber(readFromRecord(inputRecord, "offset"));
  const limit = readNumber(readFromRecord(inputRecord, "limit"));
  return {
    type: "read",
    filePath,
    ...(content ? { content } : {}),
    ...(offset !== undefined ? { offset } : {}),
    ...(limit !== undefined ? { limit } : {}),
  };
}

function deriveEditToolDetail(
  inputRecord: Record<string, unknown> | null,
  output: unknown,
): ToolCallDetail | null {
  const filePath = firstString(
    readFromRecord(inputRecord, "filePath"),
    readFromRecord(inputRecord, "path"),
  );
  if (!filePath) return null;
  const oldString = firstString(
    readFromRecord(inputRecord, "oldString"),
    readFromRecord(inputRecord, "old_string"),
  );
  const newString = firstString(
    readFromRecord(inputRecord, "newString"),
    readFromRecord(inputRecord, "new_string"),
  );
  const unifiedDiff = firstString(readFromRecord(inputRecord, "unifiedDiff"), outputText(output));
  return {
    type: "edit",
    filePath,
    ...(oldString ? { oldString } : {}),
    ...(newString ? { newString } : {}),
    ...(unifiedDiff ? { unifiedDiff } : {}),
  };
}

function deriveWriteToolDetail(inputRecord: Record<string, unknown> | null): ToolCallDetail | null {
  const filePath = firstString(
    readFromRecord(inputRecord, "filePath"),
    readFromRecord(inputRecord, "path"),
  );
  const content = firstString(
    readFromRecord(inputRecord, "content"),
    readFromRecord(inputRecord, "fileText"),
    readFromRecord(inputRecord, "text"),
  );
  if (!filePath || !content) return null;
  return {
    type: "write",
    filePath,
    content,
  };
}

function normalizeSearchToolName(
  normalizedName: string,
): "search" | "grep" | "glob" | "web_search" {
  if (normalizedName === "search") return "search";
  if (normalizedName === "glob") return "glob";
  if (normalizedName === "web_search") return "web_search";
  return "grep";
}

function deriveSearchToolDetail(
  normalizedName: string,
  inputRecord: Record<string, unknown> | null,
  output: unknown,
): ToolCallDetail | null {
  const query = firstString(
    readFromRecord(inputRecord, "query"),
    readFromRecord(inputRecord, "pattern"),
  );
  if (!query) return null;
  const content = outputText(output);
  return {
    type: "search",
    query,
    toolName: normalizeSearchToolName(normalizedName),
    ...(content ? { content } : {}),
  };
}

function deriveFetchToolDetail(
  inputRecord: Record<string, unknown> | null,
  output: unknown,
): ToolCallDetail | null {
  const url = firstString(readFromRecord(inputRecord, "url"));
  if (!url) return null;
  const prompt = firstString(readFromRecord(inputRecord, "prompt"));
  const result = outputText(output);
  return {
    type: "fetch",
    url,
    ...(prompt ? { prompt } : {}),
    ...(result ? { result } : {}),
  };
}

function deriveKnownToolDetail(
  name: string,
  input: unknown,
  output: unknown,
): ToolCallDetail | null {
  const inputRecord = readRecord(input);
  const normalizedName = name.trim().toLowerCase();
  if (SHELL_TOOL_NAMES.has(normalizedName)) return deriveShellToolDetail(inputRecord, output);
  if (READ_TOOL_NAMES.has(normalizedName)) return deriveReadToolDetail(inputRecord, output);
  if (EDIT_TOOL_NAMES.has(normalizedName)) return deriveEditToolDetail(inputRecord, output);
  if (WRITE_TOOL_NAMES.has(normalizedName)) return deriveWriteToolDetail(inputRecord);
  if (SEARCH_TOOL_NAMES.has(normalizedName)) {
    return deriveSearchToolDetail(normalizedName, inputRecord, output);
  }
  if (FETCH_TOOL_NAMES.has(normalizedName)) return deriveFetchToolDetail(inputRecord, output);
  return null;
}

const SENSITIVE_KEY_PATTERN =
  /(?:api[_-]?key|authorization|bearer|headers|env|password|prompt|secret|token)/iu;

function sanitizeUnknownToolValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string") {
    const redacted = redactCursorSdkDiagnosticValue(value);
    if (!redacted) return "";
    return redacted.length > 500 ? `${redacted.slice(0, 500)}...[truncated]` : redacted;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return { type: "array", length: value.length };
  }
  if (isRecord(value)) {
    return {
      type: "object",
      keys: Object.keys(value)
        .filter((key) => !SENSITIVE_KEY_PATTERN.test(key))
        .slice(0, 8),
    };
  }
  return { type: typeof value };
}

function sanitizeToolError(error: unknown): unknown {
  if (error === null || error === undefined) {
    return { message: "Tool call failed" };
  }
  if (typeof error === "string") {
    return { message: sanitizeUnknownToolValue(error) };
  }
  if (error instanceof Error) {
    return {
      name: error.name,
      message: sanitizeUnknownToolValue(error.message),
    };
  }
  return sanitizeUnknownToolValue(error);
}

export function mapCursorSdkToolCall(event: unknown): ToolCallTimelineItem | null {
  const parsed = CursorSdkEventSchema.safeParse(event);
  if (!parsed.success) {
    return null;
  }
  const sdkEvent = parsed.data;
  const callId = firstString(sdkEvent.callId, sdkEvent.call_id, sdkEvent.id);
  const name = firstString(sdkEvent.name, sdkEvent.toolName);
  if (!callId || !name) {
    return null;
  }

  const input = readToolCallInput(sdkEvent);
  const output = readToolCallOutput(sdkEvent);
  const error = readToolCallError(sdkEvent);
  const status = normalizeToolCallStatus(readString(sdkEvent.status), error, output);
  const detail = deriveKnownToolDetail(name, input, output) ?? {
    type: "unknown" as const,
    input: sanitizeUnknownToolValue(input),
    output: sanitizeUnknownToolValue(output),
  };

  if (status === "failed") {
    return {
      type: "tool_call",
      callId,
      name,
      status: "failed",
      detail,
      error: sanitizeToolError(error),
    };
  }

  return {
    type: "tool_call",
    callId,
    name,
    status,
    detail,
    error: null,
  };
}
