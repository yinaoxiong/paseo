import { describe, expect, it } from "vitest";
import {
  resolveCompactExplorerSidebarHostModel,
  type CompactExplorerSidebarHostModel,
} from "@/components/compact-explorer-sidebar-host-state";
import type { WorkspaceDescriptor } from "@/stores/session-store";

function createWorkspace(
  input: Partial<WorkspaceDescriptor> & Pick<WorkspaceDescriptor, "id">,
): WorkspaceDescriptor {
  return {
    id: input.id,
    projectId: input.projectId ?? "project-1",
    projectDisplayName: input.projectDisplayName ?? "Project 1",
    projectRootPath: input.projectRootPath ?? "/repo",
    workspaceDirectory: input.workspaceDirectory ?? "/repo",
    projectKind: input.projectKind ?? "git",
    workspaceKind: input.workspaceKind ?? "local_checkout",
    name: input.name ?? "main",
    status: input.status ?? "done",
    archivingAt: input.archivingAt ?? null,
    statusEnteredAt: null,
    diffStat: input.diffStat ?? null,
    scripts: input.scripts ?? [],
  };
}

function createModel(
  overrides: Partial<CompactExplorerSidebarHostModel> = {},
): CompactExplorerSidebarHostModel {
  return {
    serverId: overrides.serverId ?? "server-1",
    workspaceId: overrides.workspaceId ?? "workspace-a",
    persistenceKey: overrides.persistenceKey ?? "server-1:workspace-a",
    workspaceRoot: overrides.workspaceRoot ?? "/repo/a",
    isGit: overrides.isGit ?? true,
  };
}

describe("resolveCompactExplorerSidebarHostModel", () => {
  it("keeps Changes available for a known Git workspace before status is readable", () => {
    const result = resolveCompactExplorerSidebarHostModel({
      previous: null,
      selection: { serverId: "server-1", workspaceId: "workspace-a" },
      workspace: createWorkspace({ id: "workspace-a" }),
      checkoutStatus: undefined,
    });

    expect(result?.isGit).toBe(true);
  });

  it("retains the last workspace root for the same active selection while the workspace reloads", () => {
    const previous = createModel();

    const result = resolveCompactExplorerSidebarHostModel({
      previous,
      selection: { serverId: "server-1", workspaceId: "workspace-a" },
      workspace: null,
      checkoutStatus: undefined,
    });

    expect(result).toEqual({
      serverId: "server-1",
      workspaceId: "workspace-a",
      persistenceKey: "server-1:workspace-a",
      workspaceRoot: "/repo/a",
      isGit: true,
    });
  });

  it("switches ownership to the active workspace instead of leaking the previous one", () => {
    const previous = createModel();

    const result = resolveCompactExplorerSidebarHostModel({
      previous,
      selection: { serverId: "server-1", workspaceId: "workspace-b" },
      workspace: null,
      checkoutStatus: undefined,
    });

    expect(result).toEqual({
      serverId: "server-1",
      workspaceId: "workspace-b",
      persistenceKey: "server-1:workspace-b",
      workspaceRoot: "",
      isGit: false,
    });
  });

  it("does not retain a previous owner when there is no active workspace selection", () => {
    const result = resolveCompactExplorerSidebarHostModel({
      previous: createModel(),
      selection: null,
      workspace: null,
      checkoutStatus: undefined,
    });

    expect(result).toBeNull();
  });

  it("uses the current workspace directory when it is available", () => {
    const result = resolveCompactExplorerSidebarHostModel({
      previous: null,
      selection: { serverId: "server-1", workspaceId: "workspace-a" },
      workspace: createWorkspace({ id: "workspace-a", workspaceDirectory: "/repo/current" }),
      checkoutStatus: { cwd: "/repo/current", isGit: true, error: null },
    });

    expect(result).toEqual({
      serverId: "server-1",
      workspaceId: "workspace-a",
      persistenceKey: "server-1:workspace-a",
      workspaceRoot: "/repo/current",
      isGit: true,
    });
  });

  it.each([
    {
      error: { code: "NOT_ALLOWED" as const, message: "Git activity paused" },
      refreshState: "paused" as const,
    },
    { error: null, refreshState: "paused" as const },
    {
      error: { code: "UNKNOWN" as const, message: "Status unavailable" },
      refreshState: "unknown" as const,
    },
    { error: null, refreshState: "unknown" as const },
  ])("does not treat an unavailable status as a non-Git fact: %j", ({ error, refreshState }) => {
    const result = resolveCompactExplorerSidebarHostModel({
      previous: null,
      selection: { serverId: "server-1", workspaceId: "workspace-a" },
      workspace: createWorkspace({ id: "workspace-a" }),
      checkoutStatus: { cwd: "/repo", isGit: false, error, refreshState },
    });

    expect(result?.isGit).toBe(true);
  });

  it("honors a successful non-Git status over older project metadata", () => {
    const result = resolveCompactExplorerSidebarHostModel({
      previous: createModel(),
      selection: { serverId: "server-1", workspaceId: "workspace-a" },
      workspace: createWorkspace({ id: "workspace-a" }),
      checkoutStatus: { cwd: "/repo", isGit: false, error: null, refreshState: "fresh" },
    });

    expect(result?.isGit).toBe(false);
  });

  it.each(["non_git", "directory"] as const)(
    "does not invent Git identity for %s projects",
    (projectKind) => {
      const result = resolveCompactExplorerSidebarHostModel({
        previous: createModel(),
        selection: { serverId: "server-1", workspaceId: "workspace-a" },
        workspace: createWorkspace({ id: "workspace-a", projectKind, workspaceKind: "directory" }),
        checkoutStatus: { cwd: "/repo", isGit: false, error: null, refreshState: "paused" },
      });

      expect(result?.isGit).toBe(false);
    },
  );

  it("accepts a successful Git status for a directory project", () => {
    const result = resolveCompactExplorerSidebarHostModel({
      previous: null,
      selection: { serverId: "server-1", workspaceId: "workspace-a" },
      workspace: createWorkspace({
        id: "workspace-a",
        projectKind: "directory",
        workspaceKind: "directory",
      }),
      checkoutStatus: { cwd: "/repo", isGit: true, error: null },
    });

    expect(result?.isGit).toBe(true);
  });

  it("ignores status from a previous directory", () => {
    const result = resolveCompactExplorerSidebarHostModel({
      previous: createModel(),
      selection: { serverId: "server-1", workspaceId: "workspace-a" },
      workspace: createWorkspace({ id: "workspace-a", workspaceDirectory: "/new" }),
      checkoutStatus: { cwd: "/repo/a", isGit: false, error: null },
    });

    expect(result?.workspaceRoot).toBe("/new");
    expect(result?.isGit).toBe(true);
  });

  it("does not retain a Git identity across hosts with the same workspace id", () => {
    const result = resolveCompactExplorerSidebarHostModel({
      previous: createModel(),
      selection: { serverId: "server-2", workspaceId: "workspace-a" },
      workspace: null,
      checkoutStatus: { cwd: "/repo/a", isGit: true, error: null },
    });

    expect(result?.workspaceRoot).toBe("");
    expect(result?.isGit).toBe(false);
  });

  it("does not adopt a descriptor for a different selected workspace", () => {
    const result = resolveCompactExplorerSidebarHostModel({
      previous: createModel(),
      selection: { serverId: "server-1", workspaceId: "workspace-b" },
      workspace: createWorkspace({ id: "workspace-a" }),
    });

    expect(result?.workspaceRoot).toBe("");
    expect(result?.isGit).toBe(false);
  });
});
