import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";

import type { AgentPersistenceHandle } from "../../agent-sdk-types.js";
import { resolvePaseoHome } from "../../../paseo-home.js";
import {
  CURSOR_SDK_METADATA_VALIDATION_CODE,
  CURSOR_SDK_PATH_VALIDATION_CODE,
} from "./diagnostics.js";

export const CursorSdkResumeMetadataSchema = z
  .object({
    runtime: z.literal("local"),
    cwd: z.string().trim().min(1),
    storePath: z.string().trim().min(1),
    model: z.string().trim().min(1).optional(),
    modeId: z.enum(["sandbox", "yolo"]),
    sandboxEnabled: z.boolean(),
  })
  .strict()
  .superRefine((metadata, context) => {
    const expectedSandboxEnabled = metadata.modeId === "sandbox";
    if (metadata.sandboxEnabled !== expectedSandboxEnabled) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sandboxEnabled"],
        message: "sandboxEnabled must match modeId",
      });
    }
  });

export type CursorSdkResumeMetadata = z.infer<typeof CursorSdkResumeMetadataSchema>;

export interface CursorSdkParsedPersistenceHandle {
  sessionId: string;
  sdkAgentId: string;
  metadata: CursorSdkResumeMetadata;
}

export interface CursorSdkStorePathInput {
  paseoHome?: string;
  sessionId: string;
}

export interface CursorSdkPersistenceHandleInput {
  sessionId: string;
  sdkAgentId: string;
  cwd: string;
  storePath: string;
  model?: string | null;
  modeId: "sandbox" | "yolo";
  sandboxEnabled: boolean;
}

export class CursorSdkPersistenceValidationError extends Error {
  constructor(
    message: string,
    readonly code:
      | typeof CURSOR_SDK_METADATA_VALIDATION_CODE
      | typeof CURSOR_SDK_PATH_VALIDATION_CODE,
  ) {
    super(message);
    this.name = "CursorSdkPersistenceValidationError";
  }
}

const SAFE_CURSOR_SDK_SESSION_ID = /^[A-Za-z0-9._-]+$/u;

function resolveCursorSdkPaseoHome(explicitPaseoHome?: string): string {
  if (explicitPaseoHome && explicitPaseoHome.trim().length > 0) {
    return path.resolve(explicitPaseoHome);
  }
  return resolvePaseoHome();
}

function assertNonEmptyString(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new CursorSdkPersistenceValidationError(
      `Invalid Cursor SDK persistence handle: ${fieldName} is required`,
      CURSOR_SDK_METADATA_VALIDATION_CODE,
    );
  }
  return normalized;
}

function assertSafeSessionId(value: string): string {
  const sessionId = assertNonEmptyString(value, "sessionId");
  if (
    sessionId === "." ||
    sessionId === ".." ||
    sessionId.includes("/") ||
    sessionId.includes("\\") ||
    !SAFE_CURSOR_SDK_SESSION_ID.test(sessionId)
  ) {
    throw new CursorSdkPersistenceValidationError(
      "Invalid Cursor SDK persistence handle: sessionId must be a safe path segment",
      CURSOR_SDK_METADATA_VALIDATION_CODE,
    );
  }
  return sessionId;
}

function isPathInsideRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function realpathIfExists(candidate: string): Promise<string> {
  try {
    return await fs.realpath(candidate);
  } catch (error) {
    if (isMissingPathError(error)) {
      return candidate;
    }
    throw error;
  }
}

async function lstatIfExists(
  candidate: string,
): Promise<Awaited<ReturnType<typeof fs.lstat>> | null> {
  try {
    return await fs.lstat(candidate);
  } catch (error) {
    if (isMissingPathError(error)) {
      return null;
    }
    throw error;
  }
}

function isMissingPathError(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

function formatMetadataValidationFailure(result: z.ZodSafeParseError<unknown>): string {
  const firstIssue = result.error.issues[0];
  const pathLabel = firstIssue?.path.length ? firstIssue.path.join(".") : "metadata";
  const reason = firstIssue?.message ?? "metadata is invalid";
  return `Invalid Cursor SDK persistence handle: ${pathLabel} ${reason}`;
}

export function buildCursorSdkStoreRoot(options: { paseoHome?: string } = {}): string {
  return path.join(
    resolveCursorSdkPaseoHome(options.paseoHome),
    "providers",
    "cursor-sdk",
    "stores",
  );
}

export function buildCursorSdkStorePath(input: CursorSdkStorePathInput): string {
  const sessionId = assertSafeSessionId(input.sessionId);
  return path.join(buildCursorSdkStoreRoot({ paseoHome: input.paseoHome }), sessionId);
}

async function assertCursorSdkStoreRootAncestors(input: { paseoHome?: string }): Promise<void> {
  const paseoHome = resolveCursorSdkPaseoHome(input.paseoHome);
  const candidates = [
    path.join(paseoHome, "providers"),
    path.join(paseoHome, "providers", "cursor-sdk"),
    path.join(paseoHome, "providers", "cursor-sdk", "stores"),
  ];
  for (const candidate of candidates) {
    const stat = await lstatIfExists(candidate);
    if (stat?.isSymbolicLink()) {
      throw new CursorSdkPersistenceValidationError(
        "Cursor SDK store root must not contain symlinked ancestors",
        CURSOR_SDK_PATH_VALIDATION_CODE,
      );
    }
  }
}

export async function assertCursorSdkStorePath(input: {
  paseoHome?: string;
  sessionId: string;
  storePath: string;
}): Promise<string> {
  const storeRoot = path.resolve(buildCursorSdkStoreRoot({ paseoHome: input.paseoHome }));
  const expectedRoot = path.resolve(buildCursorSdkStorePath(input));
  const requestedStorePath = path.resolve(assertNonEmptyString(input.storePath, "storePath"));

  if (
    !isPathInsideRoot(storeRoot, requestedStorePath) ||
    !isPathInsideRoot(expectedRoot, requestedStorePath)
  ) {
    throw new CursorSdkPersistenceValidationError(
      "Cursor SDK store path is outside the controlled Cursor SDK store root",
      CURSOR_SDK_PATH_VALIDATION_CODE,
    );
  }

  await assertCursorSdkStoreRootAncestors({ paseoHome: input.paseoHome });

  const existingRoot = await realpathIfExists(expectedRoot);
  const existingStorePath = await realpathIfExists(requestedStorePath);
  const realExpectedRoot = path.resolve(existingRoot);
  const realStorePath = path.resolve(existingStorePath);

  if (
    !isPathInsideRoot(realExpectedRoot, realStorePath) ||
    !isPathInsideRoot(expectedRoot, realStorePath)
  ) {
    throw new CursorSdkPersistenceValidationError(
      "Cursor SDK store path is outside the controlled Cursor SDK store root",
      CURSOR_SDK_PATH_VALIDATION_CODE,
    );
  }

  return requestedStorePath;
}

export function createCursorSdkPersistenceHandle(
  input: CursorSdkPersistenceHandleInput,
): AgentPersistenceHandle {
  const metadataCandidate = {
    runtime: "local",
    cwd: input.cwd,
    storePath: input.storePath,
    ...(input.model ? { model: input.model } : {}),
    modeId: input.modeId,
    sandboxEnabled: input.sandboxEnabled,
  } satisfies CursorSdkResumeMetadata;
  const parsed = CursorSdkResumeMetadataSchema.safeParse(metadataCandidate);
  if (!parsed.success) {
    throw new CursorSdkPersistenceValidationError(
      formatMetadataValidationFailure(parsed),
      CURSOR_SDK_METADATA_VALIDATION_CODE,
    );
  }

  return {
    provider: "cursor-sdk",
    sessionId: assertSafeSessionId(input.sessionId),
    nativeHandle: assertNonEmptyString(input.sdkAgentId, "nativeHandle"),
    metadata: parsed.data,
  };
}

export async function parseCursorSdkPersistenceHandle(
  handle: AgentPersistenceHandle,
  options: { paseoHome?: string } = {},
): Promise<CursorSdkParsedPersistenceHandle> {
  if (handle.provider !== "cursor-sdk") {
    throw new CursorSdkPersistenceValidationError(
      "Invalid Cursor SDK persistence handle: provider must be cursor-sdk",
      CURSOR_SDK_METADATA_VALIDATION_CODE,
    );
  }
  const sessionId = assertSafeSessionId(handle.sessionId);
  const sdkAgentId = assertNonEmptyString(handle.nativeHandle ?? "", "nativeHandle");
  const parsed = CursorSdkResumeMetadataSchema.safeParse(handle.metadata);
  if (!parsed.success) {
    throw new CursorSdkPersistenceValidationError(
      formatMetadataValidationFailure(parsed),
      CURSOR_SDK_METADATA_VALIDATION_CODE,
    );
  }

  const storePath = await assertCursorSdkStorePath({
    paseoHome: options.paseoHome,
    sessionId,
    storePath: parsed.data.storePath,
  });

  return {
    sessionId,
    sdkAgentId,
    metadata: {
      ...parsed.data,
      storePath,
    },
  };
}
