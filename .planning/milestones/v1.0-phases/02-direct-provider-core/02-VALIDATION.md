---
phase: 02
slug: direct-provider-core
status: planned
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-13
---

# Phase 02 - Validation Strategy

Per-phase validation contract for feedback sampling during execution.

## Test Infrastructure

| Property           | Value                                                                                                                                                                  |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework          | Vitest 4.1.6                                                                                                                                                           |
| Config file        | `packages/server/vitest.config.ts` and root `vitest.config.ts`                                                                                                         |
| Quick run command  | `devcontainer exec --workspace-folder /mnt/private_yax_qy4/projects/paseo npx vitest run packages/server/src/server/agent/providers/cursor-sdk-agent.test.ts --bail=1` |
| Full suite command | Do not run a full suite locally; use targeted changed test files plus `npm run typecheck` and `npm run lint` inside the devcontainer.                                  |
| Estimated runtime  | Targeted tests should stay under 60 seconds each; typecheck/lint may take longer.                                                                                      |

## Sampling Rate

- **After every task commit:** Run the task's targeted `<automated>` command from the plan.
- **After every plan wave:** Run all targeted files touched by that wave, then `npm run typecheck` and `npm run lint` inside the devcontainer.
- **Before phase verification:** Run targeted Cursor SDK provider tests, registry/manifest tests touched in this phase, `npm run typecheck`, and `npm run lint`.
- **Max feedback latency:** One task should not proceed past its implementation commit without running its targeted test.

## Per-Task Verification Map

| Task ID  | Plan  | Wave | Requirement                                 | Threat Ref                                     | Secure Behavior                                                                                                                   | Test Type | Automated Command                                                                                                                                                                                                                                 | File Exists                                                       | Status  |
| -------- | ----- | ---- | ------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------- |
| 02-01-01 | 02-01 | 1    | PROV-02, MODE-01, MODE-02                   | T-02-01-01, T-02-01-02, T-02-01-04, T-02-01-05 | Availability, diagnostics, and mode listing are side-effect-free, redacted, and fail closed for unsupported Sandbox.              | unit      | `devcontainer exec --workspace-folder /mnt/private_yax_qy4/projects/paseo npx vitest run packages/server/src/server/agent/providers/cursor-sdk-agent.test.ts --bail=1`                                                                            | Pending; task creates provider test file.                         | pending |
| 02-01-02 | 02-01 | 1    | PROV-01, MODE-01, MODE-02                   | T-02-01-03, T-02-01-04, T-02-01-07             | `cursor-sdk` registry/manifest metadata is isolated from Cursor ACP and marks YOLO unattended/dangerous.                          | unit      | `devcontainer exec --workspace-folder /mnt/private_yax_qy4/projects/paseo npx vitest run packages/server/src/server/agent/provider-registry.test.ts packages/server/src/server/agent/providers/cursor-sdk-agent.test.ts --bail=1`                 | `provider-registry.test.ts` exists; Cursor SDK test file pending. | pending |
| 02-02-01 | 02-02 | 2    | PROV-04                                     | T-02-02-01, T-02-02-02                         | Resume metadata is strict, secret-free, and store paths remain under the controlled provider root.                                | unit      | `devcontainer exec --workspace-folder /mnt/private_yax_qy4/projects/paseo npx vitest run packages/server/src/server/agent/providers/cursor-sdk/persistence.test.ts --bail=1`                                                                      | Pending; task creates persistence test file.                      | pending |
| 02-02-02 | 02-02 | 2    | PROV-02, PROV-04, PROV-05, MODE-01, MODE-02 | T-02-02-03, T-02-02-05, T-02-02-06, T-02-02-07 | Create/resume/interrupt/close repeat preflight, reject unsupported Sandbox, preserve explicit YOLO, and clear active run state.   | unit      | `devcontainer exec --workspace-folder /mnt/private_yax_qy4/projects/paseo npx vitest run packages/server/src/server/agent/providers/cursor-sdk-agent.test.ts packages/server/src/server/agent/providers/cursor-sdk/persistence.test.ts --bail=1`  | Cursor SDK and persistence test files pending.                    | pending |
| 02-03-01 | 02-03 | 3    | PROV-03, PROV-05                            | T-02-03-02, T-02-03-03, T-02-03-04, T-02-03-05 | SDK stream events map conservatively, terminal statuses map deterministically, and unknown events are redacted diagnostics.       | unit      | `devcontainer exec --workspace-folder /mnt/private_yax_qy4/projects/paseo npx vitest run packages/server/src/server/agent/providers/cursor-sdk/event-mapper.test.ts --bail=1`                                                                     | Pending; task creates event mapper test file.                     | pending |
| 02-03-02 | 02-03 | 3    | PROV-03, PROV-05                            | T-02-03-01, T-02-03-05, T-02-03-06             | Session emits exactly one canonical user row, ignores SDK user echoes, and finishes turns for completed/canceled/failed outcomes. | unit      | `devcontainer exec --workspace-folder /mnt/private_yax_qy4/projects/paseo npx vitest run packages/server/src/server/agent/providers/cursor-sdk-agent.test.ts packages/server/src/server/agent/providers/cursor-sdk/event-mapper.test.ts --bail=1` | Cursor SDK and event mapper test files pending.                   | pending |

## Wave 0 Requirements

- Existing Vitest infrastructure is present.
- `packages/server/src/server/agent/providers/cursor-sdk-agent.test.ts` must be created by plan 02-01 before provider behavior is accepted.
- `packages/server/src/server/agent/providers/cursor-sdk/persistence.test.ts` must be created by plan 02-02 before resume/persistence behavior is accepted.
- `packages/server/src/server/agent/providers/cursor-sdk/event-mapper.test.ts` must be created by plan 02-03 before stream mapping behavior is accepted.
- `packages/server/src/server/agent/provider-registry.test.ts` already exists and must be extended by plan 02-01.

## Manual-Only Verifications

| Behavior                                                         | Requirement      | Why Manual                                                                                                                                     | Test Instructions                                                                                                                                                                                                                       |
| ---------------------------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Live Cursor SDK auth and provider availability with a real key   | PROV-01, PROV-02 | Unit tests must use injectable fakes and must not add auth gates; live provider checks depend on local credentials and SDK beta service state. | Optional after automated phase verification: with `CURSOR_API_KEY` configured in `$PASEO_HOME/config.json` or daemon env, create a disposable `cursor-sdk` agent in YOLO mode and confirm provider diagnostics contain no key material. |
| Sandbox support in a runtime that supports Cursor SDK sandboxing | MODE-01          | Current devcontainer is known unsupported from Phase 1; the phase must prove fail-closed behavior here, not live Sandbox execution.            | Optional in a supported runtime only: confirm `listModes()` includes Sandbox when the side-effect-free support helper reports supported and `Agent.create` receives `sandboxOptions.enabled = true`.                                    |

## Validation Sign-Off

- [x] All tasks have `<automated>` verify commands or Wave 0-created test files.
- [x] Sampling continuity: no 3 consecutive tasks lack automated verification.
- [x] Wave 0-created test files cover all pending test-file references.
- [x] No watch-mode flags appear in automated commands.
- [x] Feedback latency is bounded by targeted test commands after each task.
- [x] `nyquist_compliant: true` is set in frontmatter.

**Approval:** approved 2026-06-13
