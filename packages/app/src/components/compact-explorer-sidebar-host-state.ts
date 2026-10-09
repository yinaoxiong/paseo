import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import type { ActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import type { WorkspaceDescriptor } from "@/stores/session-store";
import type { CheckoutStatusPayload } from "@/git/checkout-status-cache";

export interface CompactExplorerSidebarHostModel {
  serverId: string;
  workspaceId: string;
  persistenceKey: string;
  workspaceRoot: string;
  isGit: boolean;
}

interface ResolveCompactExplorerSidebarHostModelInput {
  previous: CompactExplorerSidebarHostModel | null;
  selection: ActiveWorkspaceSelection | null;
  workspace: WorkspaceDescriptor | null;
  checkoutStatus?: Pick<CheckoutStatusPayload, "cwd" | "isGit" | "error" | "refreshState">;
}

function trimNonEmpty(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readGitFact(
  status: ResolveCompactExplorerSidebarHostModelInput["checkoutStatus"],
  workspaceRoot: string,
): boolean | null {
  // A paused/error status can carry isGit:false only because the wire union
  // requires it. It cannot erase the workspace's known repository identity.
  if (
    !status ||
    status.cwd !== workspaceRoot ||
    status.error ||
    status.refreshState === "paused" ||
    status.refreshState === "unknown"
  ) {
    return null;
  }
  return status.isGit;
}

export function resolveCompactExplorerSidebarHostModel(
  input: ResolveCompactExplorerSidebarHostModelInput,
): CompactExplorerSidebarHostModel | null {
  const serverId = trimNonEmpty(input.selection?.serverId);
  const workspaceId = trimNonEmpty(input.selection?.workspaceId);
  if (!serverId || !workspaceId) {
    return null;
  }

  const persistenceKey = buildWorkspaceTabPersistenceKey({ serverId, workspaceId });
  if (!persistenceKey) {
    return null;
  }

  const previousForSelection =
    input.previous &&
    input.previous.serverId === serverId &&
    input.previous.workspaceId === workspaceId
      ? input.previous
      : null;

  const workspace = input.workspace?.id === workspaceId ? input.workspace : null;
  const workspaceRoot =
    trimNonEmpty(workspace?.workspaceDirectory) ?? previousForSelection?.workspaceRoot ?? "";
  const knownGit = workspace
    ? workspace.projectKind === "git"
    : (previousForSelection?.isGit ?? false);
  const isGit = readGitFact(input.checkoutStatus, workspaceRoot) ?? knownGit;

  return {
    serverId,
    workspaceId,
    persistenceKey,
    workspaceRoot,
    isGit,
  };
}
