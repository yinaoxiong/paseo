---
phase: 01-sdk-viability-spike
status: passed
score: 91
verified_at: "2026-06-13T08:38:00Z"
requirements:
  - SDK-01
  - SDK-02
  - SDK-03
human_needed: false
next_action: "Proceed to Phase 2 planning with adjusted scope: YOLO lifecycle/cancel/resume are live-proven; Sandbox must be capability-gated because this runtime reports unsupported sandboxing."
---

# Phase 01 Verification: SDK Viability Spike

## Verdict

Phase 01 passes goal verification as an evidence-backed spike with an `Adjust scope` recommendation.

The original autonomous spike was blocked by missing `CURSOR_API_KEY`; the credentialed follow-up now proves the unsandboxed YOLO local lifecycle path. `Agent.create`, `agent.send`, streaming, `run.wait`, `run.cancel`, and cross-process `Agent.resume` all produced redacted evidence in disposable scratch repositories.

The phase goal was to prove whether `@cursor/sdk` can support the required local provider lifecycle inside Paseo. The current evidence-backed answer is: install/import, startup/auth/model diagnostics, and YOLO lifecycle/cancel/resume are viable; Sandbox fails in this Linux devcontainer because the SDK reports local sandboxing unsupported. Phase 2 may proceed as an adjusted-scope experimental provider that does not silently downgrade Sandbox to YOLO.

## Score

**91 / 100**

Deductions:

- `SDK-02` is live-proven for YOLO but not for Sandbox because this runtime rejects SDK local sandboxing.
- In-run SDK `error` terminal status is still mapped from research/design, not observed from a live failing run.
- The SDK import path required `npm rebuild sqlite3` after an `--ignore-scripts` install, creating build/release risk.

## Must-Have Checks

| Check                                                      | Status                       | Evidence                                                                                                                                                                                            |
| ---------------------------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plans declare required IDs from `REQUIREMENTS.md`          | Pass                         | `01-01-PLAN.md` declares `SDK-01`, `SDK-02`, `SDK-03`; `01-02-PLAN.md` declares `SDK-02`, `SDK-03`; all IDs exist in `REQUIREMENTS.md`.                                                             |
| SDK server dependency and import boundary                  | Pass                         | `packages/server/package.json` contains `@cursor/sdk`; `package-lock.json` contains `node_modules/@cursor/sdk`; `results/import.json` passed for `Agent`, `Cursor`, and `JsonlLocalAgentStore`.     |
| Local lifecycle harness exists for create/send/stream/wait | Pass with live YOLO evidence | `scripts/lifecycle-create-send-wait.ts` creates scratch git repos, uses `JsonlLocalAgentStore`, maps Sandbox/YOLO options, and `results/create-send-stream-wait-yolo.json` passed.                  |
| Sandbox and YOLO mode mapping                              | Pass with adjusted scope     | Sandbox records `sandboxEnabled: true` and fails with unsupported-sandbox `ConfigurationError`; YOLO records `sandboxEnabled: false` and passes. Neither records the Paseo checkout as SDK cwd.     |
| Cancellation harness and result                            | Pass with live YOLO evidence | `scripts/lifecycle-cancel.ts` supports Sandbox/YOLO mode output, checks `run.supports("cancel")`, and `results/cancel-yolo.json` observed terminal `cancelled`.                                     |
| Cross-process resume harness and result                    | Pass with live YOLO evidence | Resume create/follow-up scripts model `Agent.resume(agentId)` with the same JSONL store; `resume-followup-yolo.json` proves continuity and redacts the synthetic token.                             |
| Startup/config/auth and in-run errors separated            | Pass with caveat             | Missing-key `ConfigurationError`, invalid-key `AuthenticationError`, invalid-model `ConfigurationError`, and cancellation terminal status are observed; generic in-run error remains design-mapped. |
| Redacted machine evidence                                  | Pass                         | All result JSON files exist; scripts/results secret scan passed; full phase scan only matched regex instructions in plan files.                                                                     |
| Final recommendation is explicit                           | Pass                         | `01-SPIKE-RESULTS.md` recommends exactly `Adjust scope` and contains `## SPIKE RESULTS COMPLETE`.                                                                                                   |
| Production provider files untouched                        | Pass                         | No `cursor-sdk` implementation or registration appears in production provider registry, manifest, or provider files.                                                                                |
| Post-fix review complete                                   | Pass                         | `01-REVIEW.md` reports `completed_no_findings` with prior issues resolved.                                                                                                                          |

## Requirement Coverage

| Requirement | Verification Status                            | Notes                                                                                                                                                                                                                                                                      |
| ----------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SDK-01`    | Satisfied                                      | The server workspace dependency exists and static import works. Evidence includes `packages/server/package.json`, `package-lock.json`, and `results/import.json`. The native `sqlite3` rebuild requirement remains a release risk, not a blocker for the spike.            |
| `SDK-02`    | Satisfied for YOLO; adjusted scope for Sandbox | Credentialed follow-up validates live `Agent.create`, `agent.send`, streaming, `run.wait`, cancellation, and `Agent.resume` for `sandboxEnabled: false`. Sandbox remains unsupported in this devcontainer/runtime and must be capability-gated or surfaced as unavailable. |
| `SDK-03`    | Satisfied with residual limits                 | Startup/config/auth surfaces are observed and documented separately. In-run failures and cancellation outcomes are documented as mappings but not live-observed, which is correctly listed as residual risk in `01-SPIKE-RESULTS.md`.                                      |

## Residual Risks

- Production provider lifecycle validation is still required after wiring the SDK through Paseo's `AgentClient` and `AgentSession`; current proof uses phase-local scripts and scratch repos.
- Sandbox support fails in this Linux/devcontainer environment and must not silently fall back to YOLO.
- Cross-process resume is proven for YOLO, but daemon restart, store cleanup, and stale-handle handling still need implementation tests.
- `Cursor.models.list()` discovery still needs provider-level verification, although invalid-model handling is now live-observed.
- `REQUIREMENTS.md` marks `SDK-02` complete, but the evidence supports "covered by blocked spike evidence", not "live validated". Treat that checkbox as traceability complete, not capability proof.

## Next Action

Proceed to Phase 2 with the adjusted-scope boundary already documented in `01-SPIKE-RESULTS.md`: build an experimental local provider path around the proven YOLO lifecycle, keep Sandbox/YOLO explicit, surface unsupported Sandbox as a diagnostic instead of falling back, and avoid Ask/generic Agent mode.
