import { describe, expect, test } from "vitest";
import {
  CheckoutRefreshResponseSchema,
  CheckoutStatusResponseSchema,
  GitActivityPolicySchema,
  MutableDaemonConfigSchema,
  MutableDaemonConfigPatchSchema,
  ServerInfoStatusPayloadSchema,
  SessionOutboundMessageSchema,
  normalizeGitActivityPolicy,
} from "./messages.js";

const LEGACY_GIT_STATUS_PAYLOAD = {
  cwd: "/workspace",
  error: null,
  requestId: "status-1",
  isGit: true,
  isPaseoOwnedWorktree: false,
  repoRoot: "/workspace",
  currentBranch: "main",
  isDirty: false,
  baseRef: "main",
  aheadBehind: { ahead: 0, behind: 0 },
  aheadOfOrigin: 0,
  behindOfOrigin: 0,
  hasRemote: true,
  remoteUrl: "git@example.test:org/repo.git",
};

const LEGACY_NON_GIT_STATUS_PAYLOAD = {
  cwd: "/workspace",
  error: null,
  requestId: "status-2",
  isGit: false,
  isPaseoOwnedWorktree: false,
  repoRoot: null,
  currentBranch: null,
  isDirty: null,
  baseRef: null,
  aheadBehind: null,
  aheadOfOrigin: null,
  behindOfOrigin: null,
  hasRemote: false,
  remoteUrl: null,
};

function mutableConfig() {
  return {
    mcp: { injectIntoAgents: true },
    browserTools: { enabled: false },
    providers: {},
    metadataGeneration: { providers: [] },
    autoArchiveAfterMerge: false,
    enableTerminalAgentHooks: false,
    appendSystemPrompt: "",
  };
}

describe("Git activity policy config", () => {
  test("accepts the three host-global policies and nothing else", () => {
    expect(GitActivityPolicySchema.parse("auto")).toBe("auto");
    expect(GitActivityPolicySchema.parse("manual")).toBe("manual");
    expect(GitActivityPolicySchema.parse("enabled")).toBe("enabled");
    expect(GitActivityPolicySchema.safeParse("inherit").success).toBe(false);
    expect(GitActivityPolicySchema.safeParse("project").success).toBe(false);
  });

  test("normalizes an absent or invalid value to auto outside the wire schema", () => {
    expect(normalizeGitActivityPolicy(undefined)).toBe("auto");
    expect(normalizeGitActivityPolicy(null)).toBe("auto");
    expect(normalizeGitActivityPolicy("manual")).toBe("manual");
    expect(normalizeGitActivityPolicy("not-a-policy")).toBe("auto");
  });

  test("keeps policy optional on the mutable config and preserves process limits", () => {
    const withoutPolicy = MutableDaemonConfigSchema.parse({
      ...mutableConfig(),
      git: { maxProcessesPerSecond: 5, maxProcessConcurrency: 2 },
    });
    expect(withoutPolicy.git?.policy).toBeUndefined();
    expect(withoutPolicy.git).toMatchObject({
      maxProcessesPerSecond: 5,
      maxProcessConcurrency: 2,
    });

    const withPolicy = MutableDaemonConfigSchema.parse({
      ...mutableConfig(),
      git: { maxProcessesPerSecond: 5, maxProcessConcurrency: 2, policy: "manual" },
    });
    expect(withPolicy.git).toEqual({
      maxProcessesPerSecond: 5,
      maxProcessConcurrency: 2,
      policy: "manual",
    });
  });

  test("patch carries only the policy and rejects an unknown policy", () => {
    expect(MutableDaemonConfigPatchSchema.parse({ git: { policy: "enabled" } }).git).toEqual({
      policy: "enabled",
    });
    expect(() => MutableDaemonConfigPatchSchema.parse({ git: { policy: "sometimes" } })).toThrow();
  });

  test("an old client payload without git.policy still parses", () => {
    const parsed = MutableDaemonConfigSchema.parse(mutableConfig());
    expect(parsed.git).toBeUndefined();
    expect(normalizeGitActivityPolicy(parsed.git?.policy)).toBe("auto");
  });
});

describe("Git activity capability", () => {
  test("absent flag is not advertised as supported", () => {
    const legacy = ServerInfoStatusPayloadSchema.parse({
      status: "server_info",
      serverId: "server-1",
      features: {},
    });
    expect(legacy.features?.gitActivityPolicy).toBeUndefined();
    expect(legacy.features?.gitManualRefresh).toBeUndefined();

    const current = ServerInfoStatusPayloadSchema.parse({
      status: "server_info",
      serverId: "server-1",
      features: { gitActivityPolicy: true, gitManualRefresh: true },
    });
    expect(current.features?.gitActivityPolicy).toBe(true);
    expect(current.features?.gitManualRefresh).toBe(true);
  });
});

describe("workspace git activity projection", () => {
  test("workspace projection stays valid with and without gitActivity", () => {
    const base = {
      id: "ws-1",
      projectId: "proj-1",
      projectDisplayName: "proj",
      projectRootPath: "/workspace",
      projectKind: "git",
      workspaceKind: "checkout",
      name: "repo",
      status: "running",
      activityAt: "2026-09-24T00:00:00.000Z",
      scripts: [],
      gitRuntime: null,
      githubRuntime: {},
    };

    const legacy = SessionOutboundMessageSchema.parse({
      type: "workspace_update",
      payload: { kind: "upsert", workspace: base },
    });
    expect(
      legacy.payload.kind === "upsert" ? legacy.payload.workspace.gitActivity : undefined,
    ).toBeUndefined();

    const current = SessionOutboundMessageSchema.parse({
      type: "workspace_update",
      payload: {
        kind: "upsert",
        workspace: {
          ...base,
          gitActivity: {
            configuredPolicy: "auto",
            effectiveMode: "manual",
            reason: "storage_network",
            lastCheckedAt: "2026-09-24T00:00:00.000Z",
          },
        },
      },
    });
    expect(
      current.payload.kind === "upsert" ? current.payload.workspace.gitActivity : undefined,
    ).toEqual({
      configuredPolicy: "auto",
      effectiveMode: "manual",
      reason: "storage_network",
      lastCheckedAt: "2026-09-24T00:00:00.000Z",
    });
  });

  test("accepts a never-checked projection with a null timestamp", () => {
    const parsed = SessionOutboundMessageSchema.parse({
      type: "workspace_update",
      payload: {
        kind: "upsert",
        workspace: {
          id: "ws-1",
          projectId: "proj-1",
          projectDisplayName: "proj",
          projectRootPath: "/workspace",
          projectKind: "git",
          workspaceKind: "checkout",
          name: "repo",
          status: "running",
          activityAt: null,
          scripts: [],
          gitRuntime: null,
          githubRuntime: {},
          gitActivity: {
            configuredPolicy: "manual",
            effectiveMode: "manual",
            reason: "policy_manual",
            lastCheckedAt: null,
          },
        },
      },
    });
    expect(parsed.payload.kind === "upsert" && parsed.payload.workspace.gitActivity).toEqual({
      configuredPolicy: "manual",
      effectiveMode: "manual",
      reason: "policy_manual",
      lastCheckedAt: null,
    });
  });
});

describe("checkout status refresh state", () => {
  test("status payloads parse without the new fields", () => {
    const parsed = CheckoutStatusResponseSchema.parse({
      type: "checkout_status_response",
      payload: LEGACY_GIT_STATUS_PAYLOAD,
    });
    expect(parsed.payload.refreshState).toBeUndefined();
    expect(parsed.payload.lastRefreshedAt).toBeUndefined();
    expect(parsed.payload.isGit).toBe(true);
  });

  test("carries refreshState and lastRefreshedAt when the daemon supplies them", () => {
    const parsed = CheckoutStatusResponseSchema.parse({
      type: "checkout_status_response",
      payload: {
        ...LEGACY_GIT_STATUS_PAYLOAD,
        refreshState: "paused",
        lastRefreshedAt: null,
      },
    });
    expect(parsed.payload).toMatchObject({ refreshState: "paused", lastRefreshedAt: null });
  });

  test("paused status is distinguishable from a non-Git fact", () => {
    const parsed = CheckoutStatusResponseSchema.parse({
      type: "checkout_status_response",
      payload: {
        ...LEGACY_NON_GIT_STATUS_PAYLOAD,
        error: { code: "NOT_ALLOWED", message: "Automatic Git queries are paused" },
        refreshState: "paused",
        lastRefreshedAt: null,
      },
    });
    // The closed error enum is unchanged: pausing reuses NOT_ALLOWED, and the
    // isGit:false placeholder must never be read as a non-Git fact.
    expect(parsed.payload.error?.code).toBe("NOT_ALLOWED");
    expect(parsed.payload.refreshState).toBe("paused");
  });

  test("does not extend the closed CheckoutErrorCode enum", () => {
    const statusWithError = (code: string) => ({
      type: "checkout_status_response",
      payload: { ...LEGACY_NON_GIT_STATUS_PAYLOAD, error: { code, message: "x" } },
    });

    // The four existing codes stay legal; a policy pause reuses NOT_ALLOWED.
    for (const code of ["NOT_GIT_REPO", "NOT_ALLOWED", "MERGE_CONFLICT", "UNKNOWN"]) {
      expect(CheckoutStatusResponseSchema.safeParse(statusWithError(code)).success).toBe(true);
    }
    // A new member would be unparseable for old clients, so it is not allowed.
    for (const code of ["PAUSED", "GIT_ACTIVITY_PAUSED", "MANUAL"]) {
      expect(CheckoutStatusResponseSchema.safeParse(statusWithError(code)).success).toBe(false);
    }
  });
});

describe("explicit refresh response", () => {
  test("parses a legacy refresh response with no status", () => {
    expect(
      CheckoutRefreshResponseSchema.parse({
        type: "checkout.refresh.response",
        payload: { cwd: "/workspace", success: true, error: null, requestId: "refresh-1" },
      }).payload.status,
    ).toBeUndefined();
  });

  test("returns the real snapshot produced by the refresh", () => {
    const parsed = CheckoutRefreshResponseSchema.parse({
      type: "checkout.refresh.response",
      payload: {
        cwd: "/workspace",
        success: true,
        error: null,
        requestId: "refresh-1",
        status: {
          ...LEGACY_GIT_STATUS_PAYLOAD,
          requestId: "refresh-1",
          refreshState: "fresh",
        },
      },
    });
    expect(parsed.payload.status).toMatchObject({
      requestId: "refresh-1",
      refreshState: "fresh",
      isGit: true,
    });
  });
});
