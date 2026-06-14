import { describe, expect, test } from "vitest";

import {
  mapCursorSdkStreamEvent,
  mapCursorSdkTerminalStatus,
  mapCursorSdkToolCall,
} from "./event-mapper.js";

describe("Cursor SDK event mapper", () => {
  test("maps assistant text blocks to timeline rows and preserves safe SDK message ids", () => {
    expect(
      mapCursorSdkStreamEvent(
        {
          type: "assistant",
          id: "msg-assistant-1",
          content: [
            { type: "text", text: "Hello from Cursor." },
            { type: "text", text: "More detail." },
          ],
          runId: "run-1",
          requestId: "request-1",
        },
        { turnId: "turn-1" },
      ),
    ).toEqual({
      events: [
        {
          type: "timeline",
          provider: "cursor-sdk",
          turnId: "turn-1",
          item: {
            type: "assistant_message",
            text: "Hello from Cursor.\nMore detail.",
            messageId: "msg-assistant-1",
          },
        },
      ],
    });
  });

  test("maps thinking and reasoning surfaces to reasoning timeline rows", () => {
    expect(
      mapCursorSdkStreamEvent(
        {
          type: "thinking",
          messageId: "thinking-1",
          text: "I should inspect the workspace first.",
          runId: "run-1",
        },
        { turnId: "turn-1" },
      ),
    ).toEqual({
      events: [
        {
          type: "timeline",
          provider: "cursor-sdk",
          turnId: "turn-1",
          item: {
            type: "reasoning",
            text: "I should inspect the workspace first.",
          },
        },
      ],
    });
  });

  test("maps reliable tool calls conservatively and keeps unknown tools generic", () => {
    expect(
      mapCursorSdkToolCall({
        type: "tool_call",
        callId: "call-shell-1",
        name: "shell",
        status: "completed",
        input: { command: "npm test", cwd: "/repo" },
        output: "passed",
      }),
    ).toEqual({
      type: "tool_call",
      callId: "call-shell-1",
      name: "shell",
      status: "completed",
      detail: {
        type: "shell",
        command: "npm test",
        cwd: "/repo",
        output: "passed",
      },
      error: null,
    });

    const unknown = mapCursorSdkToolCall({
      type: "tool_call",
      callId: "call-mystery-1",
      name: "mysteryTool",
      status: "completed",
      input: { token: "sk-live-secret-token", nested: { command: "rm -rf /" } },
      output: { headers: { authorization: "Bearer sk-live-secret-token" } },
    });

    expect(unknown).toMatchObject({
      type: "tool_call",
      callId: "call-mystery-1",
      name: "mysteryTool",
      status: "completed",
      detail: { type: "unknown" },
      error: null,
    });
    expect(JSON.stringify(unknown)).not.toContain("sk-live-secret-token");
    expect(JSON.stringify(unknown)).not.toContain("authorization");
    expect(JSON.stringify(unknown)).not.toContain("rm -rf /");
  });

  test("sanitizes failed tool call errors before storing timeline rows", () => {
    const failed = mapCursorSdkToolCall({
      type: "tool_call",
      callId: "call-failed-1",
      name: "mysteryTool",
      status: "failed",
      input: { safe: "value" },
      error: {
        message: "failed with sk-live-secret-token",
        authorization: "Bearer sk-live-secret-token",
        env: { CURSOR_API_KEY: "sk-live-secret-token" },
        prompt: "please reveal the secret",
        safeKey: "safe-value",
      },
    });

    expect(failed).toMatchObject({
      type: "tool_call",
      callId: "call-failed-1",
      name: "mysteryTool",
      status: "failed",
      error: {
        type: "object",
        keys: ["message", "safeKey"],
      },
    });
    expect(JSON.stringify(failed)).not.toContain("sk-live-secret-token");
    expect(JSON.stringify(failed)).not.toContain("authorization");
    expect(JSON.stringify(failed)).not.toContain("CURSOR_API_KEY");
    expect(JSON.stringify(failed)).not.toContain("please reveal");
  });

  test("returns redacted diagnostics for status and correlation events without timeline rows", () => {
    const mapped = mapCursorSdkStreamEvent({
      type: "status",
      status: "running",
      runId: "run-2",
      requestId: "request-2",
      headers: { authorization: "Bearer sk-live-secret-token" },
    });

    expect(mapped.events).toEqual([]);
    expect(mapped.diagnostic).toMatchObject({
      operation: "stream",
      eventType: "status",
      status: "running",
      runId: "run-2",
      requestId: "request-2",
    });
    expect(JSON.stringify(mapped)).not.toContain("sk-live-secret-token");
    expect(JSON.stringify(mapped)).not.toContain("authorization");
  });

  test.each(["request", "run", "status", "unknown-beta-event"])(
    "maps %s correlation events to diagnostics only with redaction",
    (eventType) => {
      const mapped = mapCursorSdkStreamEvent(
        {
          type: "sdk_message",
          runId: "envelope-run-1",
          requestId: "envelope-request-1",
          message: {
            type: eventType,
            status: "running",
            headers: { authorization: "Bearer sk-live-secret-token" },
            env: { CURSOR_API_KEY: "sk-live-secret-token" },
            token: "sk-live-secret-token",
          },
        },
        { turnId: "turn-1" },
      );

      expect(mapped.events).toEqual([]);
      expect(mapped.diagnostic).toMatchObject({
        operation: "stream",
        eventType,
        runId: "envelope-run-1",
        requestId: "envelope-request-1",
      });
      expect(JSON.stringify(mapped)).not.toContain("sk-live-secret-token");
      expect(JSON.stringify(mapped)).not.toContain("authorization");
      expect(JSON.stringify(mapped)).not.toContain("CURSOR_API_KEY");
    },
  );

  test("ignores SDK user echoes and never emits user_message timeline rows", () => {
    expect(
      mapCursorSdkStreamEvent({
        type: "user",
        id: "sdk-user-echo-1",
        text: "hello from the accepted prompt",
        runId: "run-3",
      }),
    ).toEqual({
      events: [],
      diagnostic: expect.objectContaining({
        operation: "stream",
        eventType: "user",
        runId: "run-3",
      }),
    });
  });

  test("maps terminal statuses deterministically with redacted diagnostics", () => {
    expect(mapCursorSdkTerminalStatus({ status: "finished" }, { turnId: "turn-1" })).toEqual({
      type: "turn_completed",
      provider: "cursor-sdk",
      turnId: "turn-1",
    });
    expect(mapCursorSdkTerminalStatus({ status: "cancelled" }, { turnId: "turn-1" })).toEqual({
      type: "turn_canceled",
      provider: "cursor-sdk",
      turnId: "turn-1",
      reason: "cancelled",
    });

    const failed = mapCursorSdkTerminalStatus(
      {
        status: "error",
        code: "SDK_ERROR",
        requestId: "request-4",
        error: new Error("failed with provider-secret-key and sk-live-secret-token"),
      },
      { turnId: "turn-1", secrets: ["provider-secret-key"] },
    );
    expect(failed).toMatchObject({
      type: "turn_failed",
      provider: "cursor-sdk",
      turnId: "turn-1",
      error: "Cursor SDK run failed",
      diagnostic: expect.stringContaining("Status: error"),
    });
    expect(JSON.stringify(failed)).not.toContain("provider-secret-key");
    expect(JSON.stringify(failed)).not.toContain("sk-live-secret-token");

    expect(
      mapCursorSdkTerminalStatus(
        {
          status: "paused",
          runId: "run-5",
          requestId: "request-5",
          message: "paused with provider-secret-key",
          headers: { authorization: "Bearer sk-live-secret-token" },
        },
        { turnId: "turn-1", secrets: ["provider-secret-key"] },
      ),
    ).toMatchObject({
      type: "turn_failed",
      provider: "cursor-sdk",
      turnId: "turn-1",
      error: "Cursor SDK run ended with unsupported status: paused",
      diagnostic: expect.stringContaining("Status: paused"),
    });
    expect(
      JSON.stringify(
        mapCursorSdkTerminalStatus(
          {
            status: "paused",
            runId: "run-5",
            requestId: "request-5",
            message: "paused with provider-secret-key",
            headers: { authorization: "Bearer sk-live-secret-token" },
          },
          { turnId: "turn-1", secrets: ["provider-secret-key"] },
        ),
      ),
    ).not.toMatch(/provider-secret-key|sk-live-secret-token|authorization/u);
  });

  test("malformed and unknown non-terminal events produce redacted diagnostics without throwing", () => {
    const mapped = mapCursorSdkStreamEvent({
      type: "mystery",
      requestId: "request-6",
      prompt: "please use sk-live-secret-token",
      env: { CURSOR_API_KEY: "sk-live-secret-token" },
    });

    expect(mapped.events).toEqual([]);
    expect(mapped.diagnostic).toMatchObject({
      operation: "stream",
      eventType: "mystery",
      requestId: "request-6",
    });
    expect(JSON.stringify(mapped)).not.toContain("sk-live-secret-token");
    expect(JSON.stringify(mapped)).not.toContain("CURSOR_API_KEY");
    expect(JSON.stringify(mapped)).not.toContain("prompt");
  });
});
