import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useCheckoutGitActionsStore } from "./actions-store";
import { useSessionStore } from "@/stores/session-store";

interface ChangesRefreshInput {
  serverId: string;
  cwd: string;
  workspaceId: string | null | undefined;
  explicitOnly: boolean;
  ignoreWhitespace: boolean;
}

export function useChangesRefresh({
  serverId,
  cwd,
  workspaceId,
  explicitOnly,
  ignoreWhitespace,
}: ChangesRefreshInput) {
  const { t } = useTranslation();
  const runRefresh = useCheckoutGitActionsStore((s) => s.refresh);
  // COMPAT(gitManualRefresh): added in v0.9.2+personal.2, remove after
  // 2027-09-26 once all private hosts support uncached explicit diff reads.
  const manualRefreshSupported = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.gitManualRefresh === true,
  );
  const isRefreshing =
    useCheckoutGitActionsStore((s) => s.getStatus({ serverId, cwd, actionId: "refresh" })) ===
    "pending";
  const [failure, setFailure] = useState<{ scope: string; message: string } | null>(null);
  const scope = JSON.stringify([serverId, cwd]);
  const error = failure?.scope === scope ? failure.message : null;
  const onRefresh = useCallback(() => {
    if (isRefreshing) return;
    if (explicitOnly && !manualRefreshSupported) {
      setFailure({ scope, message: t("workspace.git.diff.manualRefreshHostUpdate") });
      return;
    }
    setFailure(null);
    void runRefresh({
      serverId,
      cwd,
      diff: explicitOnly ? { workspaceId: workspaceId ?? undefined, ignoreWhitespace } : undefined,
    }).catch((cause) => {
      setFailure({
        scope,
        message: cause instanceof Error ? cause.message : t("workspace.git.diff.failedRefresh"),
      });
    });
  }, [
    serverId,
    cwd,
    workspaceId,
    explicitOnly,
    manualRefreshSupported,
    ignoreWhitespace,
    isRefreshing,
    runRefresh,
    scope,
    t,
  ]);
  return useMemo(() => ({ isRefreshing, onRefresh, error }), [isRefreshing, onRefresh, error]);
}
