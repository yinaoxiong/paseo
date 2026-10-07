import { mkdtemp, mkdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import type { AgentPersistenceHandle } from "../../agent-sdk-types.js";
import {
  buildCursorSdkStorePath,
  createCursorSdkPersistenceHandle,
  parseCursorSdkPersistenceHandle,
} from "./persistence.js";

describe("Cursor SDK persistence helpers", () => {
  let tempRoot: string;
  let paseoHome: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(tmpdir(), "paseo-cursor-sdk-persistence-"));
    paseoHome = path.join(tempRoot, "paseo-home");
  });

  afterEach(() => {
    delete process.env.PASEO_HOME;
  });

  test("builds provider and session scoped store paths under PASEO_HOME", () => {
    expect(buildCursorSdkStorePath({ paseoHome, sessionId: "agent-123" })).toBe(
      path.join(paseoHome, "providers", "cursor-sdk", "stores", "agent-123"),
    );
  });

  test("creates and parses strict secret-free metadata with nativeHandle as SDK agent id", async () => {
    const storePath = buildCursorSdkStorePath({ paseoHome, sessionId: "agent-123" });
    const handle = createCursorSdkPersistenceHandle({
      sessionId: "agent-123",
      sdkAgentId: "sdk-agent-abc",
      cwd: path.join(tempRoot, "workspace"),
      storePath,
      model: "composer-2.5",
      modeId: "yolo",
      sandboxEnabled: false,
    });

    expect(handle).toEqual({
      provider: "cursor-sdk",
      sessionId: "agent-123",
      nativeHandle: "sdk-agent-abc",
      metadata: {
        runtime: "local",
        cwd: path.join(tempRoot, "workspace"),
        storePath,
        model: "composer-2.5",
        modeId: "yolo",
        sandboxEnabled: false,
      },
    });

    await expect(parseCursorSdkPersistenceHandle(handle, { paseoHome })).resolves.toEqual({
      sessionId: "agent-123",
      sdkAgentId: "sdk-agent-abc",
      metadata: handle.metadata,
    });
  });

  test.each(["nativeHandle", "storePath", "cwd", "runtime", "modeId", "sandboxEnabled"])(
    "rejects handles missing %s",
    async (missingField) => {
      const storePath = buildCursorSdkStorePath({ paseoHome, sessionId: "agent-123" });
      const handle: AgentPersistenceHandle = {
        provider: "cursor-sdk",
        sessionId: "agent-123",
        nativeHandle: "sdk-agent-abc",
        metadata: {
          runtime: "local",
          cwd: path.join(tempRoot, "workspace"),
          storePath,
          modeId: "sandbox",
          sandboxEnabled: true,
        },
      };
      if (missingField === "nativeHandle") {
        delete handle.nativeHandle;
      } else {
        delete (handle.metadata as Record<string, unknown>)[missingField];
      }

      await expect(parseCursorSdkPersistenceHandle(handle, { paseoHome })).rejects.toThrow(
        /Invalid Cursor SDK persistence handle/u,
      );
    },
  );

  test.each([
    ["relative traversal", "../escape"],
    [
      "root-prefix lookalike",
      path.join(
        `${path.join("paseo-home", "providers", "cursor-sdk", "stores")}-evil`,
        "agent-123",
      ),
    ],
    ["absolute outside path", path.join(tmpdir(), "outside-cursor-sdk-store")],
  ])("rejects %s store paths outside the controlled root", async (_name, storePath) => {
    const handle: AgentPersistenceHandle = {
      provider: "cursor-sdk",
      sessionId: "agent-123",
      nativeHandle: "sdk-agent-abc",
      metadata: {
        runtime: "local",
        cwd: path.join(tempRoot, "workspace"),
        storePath,
        modeId: "yolo",
        sandboxEnabled: false,
      },
    };

    await expect(parseCursorSdkPersistenceHandle(handle, { paseoHome })).rejects.toThrow(
      /outside the controlled Cursor SDK store root/u,
    );
  });

  test("rejects traversal session ids even when storePath follows the escaped root", async () => {
    const escapedStorePath = path.resolve(tempRoot, "escaped-store");
    const handle: AgentPersistenceHandle = {
      provider: "cursor-sdk",
      sessionId: "../../../../escaped-store",
      nativeHandle: "sdk-agent-abc",
      metadata: {
        runtime: "local",
        cwd: path.join(tempRoot, "workspace"),
        storePath: escapedStorePath,
        modeId: "yolo",
        sandboxEnabled: false,
      },
    };

    await expect(parseCursorSdkPersistenceHandle(handle, { paseoHome })).rejects.toThrow(
      /sessionId must be a safe path segment/u,
    );
  });

  test.each([".", "..", "agent/123", "agent\\123", "agent 123"])(
    "rejects unsafe session id %s while building store paths",
    (sessionId) => {
      expect(() => buildCursorSdkStorePath({ paseoHome, sessionId })).toThrow(
        /sessionId must be a safe path segment/u,
      );
    },
  );

  test("rejects existing symlink escapes before constructing a Cursor SDK store", async () => {
    const storePath = buildCursorSdkStorePath({ paseoHome, sessionId: "agent-123" });
    const outsideStore = path.join(tempRoot, "outside-store");
    await mkdir(path.dirname(storePath), { recursive: true });
    await mkdir(outsideStore, { recursive: true });
    await symlink(outsideStore, storePath, "dir");

    const handle = createCursorSdkPersistenceHandle({
      sessionId: "agent-123",
      sdkAgentId: "sdk-agent-abc",
      cwd: path.join(tempRoot, "workspace"),
      storePath,
      modeId: "yolo",
      sandboxEnabled: false,
    });

    await expect(parseCursorSdkPersistenceHandle(handle, { paseoHome })).rejects.toThrow(
      /outside the controlled Cursor SDK store root/u,
    );
  });

  test("rejects symlinked store roots before creating a new session store", async () => {
    const storeRoot = path.join(paseoHome, "providers", "cursor-sdk", "stores");
    const outsideStoreRoot = path.join(tempRoot, "outside-store-root");
    await mkdir(path.dirname(storeRoot), { recursive: true });
    await mkdir(outsideStoreRoot, { recursive: true });
    await symlink(outsideStoreRoot, storeRoot, "dir");

    const handle = createCursorSdkPersistenceHandle({
      sessionId: "agent-123",
      sdkAgentId: "sdk-agent-abc",
      cwd: path.join(tempRoot, "workspace"),
      storePath: buildCursorSdkStorePath({ paseoHome, sessionId: "agent-123" }),
      modeId: "yolo",
      sandboxEnabled: false,
    });

    await expect(parseCursorSdkPersistenceHandle(handle, { paseoHome })).rejects.toThrow(
      /store root must not contain symlinked ancestors/u,
    );
  });

  test("rejects secret-shaped metadata without echoing secret values or raw metadata", async () => {
    const handle: AgentPersistenceHandle = {
      provider: "cursor-sdk",
      sessionId: "agent-123",
      nativeHandle: "sdk-agent-abc",
      metadata: {
        runtime: "local",
        cwd: path.join(tempRoot, "workspace"),
        storePath: buildCursorSdkStorePath({ paseoHome, sessionId: "agent-123" }),
        modeId: "yolo",
        sandboxEnabled: false,
        CURSOR_API_KEY: "sk-live-super-secret",
        authorization: "Bearer sk-live-super-secret",
        headers: { authorization: "Bearer sk-live-super-secret" },
        env: { CURSOR_API_KEY: "sk-live-super-secret" },
      },
    };

    await expect(parseCursorSdkPersistenceHandle(handle, { paseoHome })).rejects.toThrow(
      /Invalid Cursor SDK persistence handle/u,
    );
    await expect(parseCursorSdkPersistenceHandle(handle, { paseoHome })).rejects.not.toThrow(
      /sk-live-super-secret|Bearer|\{"runtime"/u,
    );
  });

  test("rejects mode and sandbox mismatches", async () => {
    const handle: AgentPersistenceHandle = {
      provider: "cursor-sdk",
      sessionId: "agent-123",
      nativeHandle: "sdk-agent-abc",
      metadata: {
        runtime: "local",
        cwd: path.join(tempRoot, "workspace"),
        storePath: buildCursorSdkStorePath({ paseoHome, sessionId: "agent-123" }),
        modeId: "sandbox",
        sandboxEnabled: false,
      },
    };

    await expect(parseCursorSdkPersistenceHandle(handle, { paseoHome })).rejects.toThrow(
      /sandboxEnabled must match modeId/u,
    );
  });
});
