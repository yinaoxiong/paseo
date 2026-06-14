---
phase: 03
slug: manifest-and-ui-integration
status: planned
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-13
---

# Phase 03 - Validation Strategy

Per-phase validation contract for feedback sampling during execution.

## Test Infrastructure

| Property           | Value                                                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Framework          | Vitest 4.1.6                                                                                                                          |
| Config file        | `vitest.config.ts`; app/server package configs as used by targeted files                                                              |
| Quick run command  | `devcontainer exec --workspace-folder /mnt/private_yax_qy4/projects/paseo npx vitest run <changed-test-file> --bail=1`                |
| Full suite command | Do not run a full suite locally; use targeted changed test files plus `npm run typecheck` and `npm run lint` inside the devcontainer. |
| Estimated runtime  | Targeted tests should stay under 60 seconds each; typecheck/lint may take longer.                                                     |

## Sampling Rate

- **After every task commit:** Run the task's targeted `<automated>` command from the plan.
- **After every plan wave:** Run all targeted files touched by that wave, then rebuild affected declaration stacks before `npm run typecheck` and `npm run lint` inside the devcontainer.
- **Before phase verification:** Run all Phase 03 targeted tests, `npm run format`, `npm run typecheck`, and `npm run lint` inside the devcontainer.
- **Max feedback latency:** One task should not proceed past its implementation commit without running its targeted test.

## Per-Task Verification Map

| Task ID  | Plan  | Wave | Requirement      | Threat Ref | Secure Behavior                                                                                                                               | Test Type | Automated Command                                                                                                                                                                                                                                                                       | File Exists                                              | Status  |
| -------- | ----- | ---- | ---------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ------- |
| 03-01-01 | 03-01 | 1    | UI-01, UI-03     | T-03-01-01 | `cursor-sdk` manifest copy and static mode visuals are independent from existing Cursor ACP metadata.                                         | unit      | `devcontainer exec --workspace-folder /mnt/private_yax_qy4/projects/paseo npx vitest run packages/server/src/server/agent/provider-registry.test.ts --bail=1`                                                                                                                           | Existing file must be extended.                          | pending |
| 03-01-02 | 03-01 | 1    | UI-02, UI-03     | T-03-01-02 | `cursor-sdk` resolves to the Cursor brand icon while `cursor` ACP icon behavior remains unchanged.                                            | unit      | `devcontainer exec --workspace-folder /mnt/private_yax_qy4/projects/paseo npx vitest run packages/app/src/components/provider-icon-name.test.ts --bail=1`                                                                                                                               | Existing file must be extended.                          | pending |
| 03-01-03 | 03-01 | 1    | MODE-03          | T-03-01-03 | Snapshot modes show only YOLO when Sandbox is unsupported and never expose Agent or Ask.                                                      | unit      | `devcontainer exec --workspace-folder /mnt/private_yax_qy4/projects/paseo npx vitest run packages/server/src/server/agent/providers/cursor-sdk-agent.test.ts --bail=1`                                                                                                                  | Existing file must be extended.                          | pending |
| 03-02-01 | 03-02 | 2    | FEAT-01, FEAT-02 | T-03-02-01 | SDK model metadata is expanded into reversible Paseo options without dropping context variants, thinking, or fast metadata.                   | unit      | `devcontainer exec --workspace-folder /mnt/private_yax_qy4/projects/paseo npx vitest run packages/server/src/server/agent/providers/cursor-sdk/model-options.test.ts --bail=1`                                                                                                          | Wave 0 creates this file.                                | pending |
| 03-02-02 | 03-02 | 2    | FEAT-01, UI-02   | T-03-02-02 | Empty or failed SDK model discovery marks `cursor-sdk` unavailable and cannot surface a synthetic `Default` model row.                        | unit      | `devcontainer exec --workspace-folder /mnt/private_yax_qy4/projects/paseo npx vitest run packages/server/src/server/agent/providers/cursor-sdk-agent.test.ts packages/app/src/provider-selection/provider-selection.test.ts --bail=1`                                                   | Existing files must be extended.                         | pending |
| 03-02-03 | 03-02 | 2    | FEAT-02, FEAT-03 | T-03-02-03 | Selected context, reasoning/thinking, and fast values are validated and sent on the next SDK turn without creating scratch sessions.          | unit      | `devcontainer exec --workspace-folder /mnt/private_yax_qy4/projects/paseo npx vitest run packages/server/src/server/agent/providers/cursor-sdk/model-options.test.ts packages/server/src/server/agent/providers/cursor-sdk-agent.test.ts --bail=1`                                      | Model-options test file pending; Cursor SDK test exists. | pending |
| 03-03-01 | 03-03 | 3    | UI-02, UI-03     | T-03-03-01 | Agent form resolution, provider/model selection, and thinking utilities keep Cursor SDK selections explicit and preserve Cursor ACP behavior. | unit      | `devcontainer exec --workspace-folder /mnt/private_yax_qy4/projects/paseo npx vitest run packages/app/src/provider-selection/provider-selection.test.ts packages/app/src/provider-selection/resolve-agent-form.test.ts packages/app/src/composer/agent-controls/utils.test.ts --bail=1` | Existing files must be extended.                         | pending |
| 03-04-01 | 03-04 | 4    | FEAT-02, FEAT-03 | T-03-04-01 | Stale Cursor SDK `fast_mode` values are pruned from local and persisted feature preferences when refreshed metadata no longer exposes fast.   | unit      | `devcontainer exec --workspace-folder /mnt/private_yax_qy4/projects/paseo npx vitest run packages/app/src/hooks/feature-preferences.test.ts --bail=1`                                                                                                                                   | Existing file must be extended.                          | pending |
| 03-04-02 | 03-04 | 4    | UI-02, UI-03     | T-03-04-02 | Cursor SDK fast uses existing composer feature controls, keeps the shared Zap/yellow treatment, and does not introduce Cursor SDK-only UI.    | unit      | `devcontainer exec --workspace-folder /mnt/private_yax_qy4/projects/paseo npx vitest run packages/app/src/hooks/feature-preferences.test.ts packages/app/src/composer/agent-controls/utils.test.ts --bail=1`                                                                            | Existing files must be extended where touched.           | pending |

## Wave 0 Requirements

- `packages/server/src/server/agent/providers/cursor-sdk/model-options.test.ts` - covers reversible model/context/thinking/fast encode/decode and send-param assembly for FEAT-02.
- Extend `packages/server/src/server/agent/providers/cursor-sdk-agent.test.ts` - covers empty SDK model list as unavailable, no scratch session feature discovery, and YOLO-only unsupported Sandbox behavior.
- Extend `packages/app/src/provider-selection/resolve-agent-form.test.ts` and `packages/app/src/composer/agent-controls/utils.test.ts` - covers no implicit Cursor SDK thinking selection.
- Extend `packages/app/src/components/provider-icon-name.test.ts` - covers `cursor-sdk` resolving to Cursor brand catalog icon while `cursor` behavior remains unchanged.
- Extend `packages/app/src/provider-selection/provider-selection.test.ts` - covers no synthetic `Default` row for Cursor SDK error/empty metadata paths.

## Manual-Only Verifications

| Behavior                                                  | Requirement    | Why Manual                                                                                 | Test Instructions                                                                                                                                                                                                                    |
| --------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Live Cursor SDK model discovery with a real key           | FEAT-01, UI-02 | Unit tests must not depend on real credentials or upstream SDK service state.              | Optional after automated verification: with `CURSOR_API_KEY` configured in `$PASEO_HOME/config.json` or daemon env, explicitly refresh the provider snapshot and confirm `cursor-sdk` shows SDK models without logging key material. |
| Side-by-side app inspection for Cursor ACP and Cursor SDK | UI-02, UI-03   | Visual confirmation can catch label/icon density issues not fully covered by helper tests. | Optional targeted UI check: open provider selection/composer controls and confirm `Cursor` and `Cursor SDK` appear independently, with `cursor-sdk` using Cursor icon and YOLO-only mode when Sandbox is unsupported.                |

## Validation Sign-Off

- [x] All tasks have `<automated>` verify commands or Wave 0-created test files.
- [x] Sampling continuity: no 3 consecutive tasks lack automated verification.
- [x] Wave 0-created test files cover all pending test-file references across the 4-plan set.
- [x] No watch-mode flags appear in automated commands.
- [x] Feedback latency is bounded by targeted test commands after each task.
- [x] `nyquist_compliant: true` is set in frontmatter.

**Approval:** approved 2026-06-13
