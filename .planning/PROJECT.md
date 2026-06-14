# Paseo Native Cursor SDK Provider

## What This Is

This project shipped an experimental native Cursor provider for Paseo using the TypeScript `@cursor/sdk`. It runs alongside the existing Cursor ACP integration rather than replacing it, so Paseo can validate SDK-specific lifecycle, model, store, and permission behavior without destabilizing current Cursor support.

The first version focuses on local Cursor SDK agents in Paseo's direct provider architecture. It exposes two clear permission modes, Sandbox and YOLO, instead of using the ambiguous "Agent" label.

## Core Value

Paseo can launch, monitor, resume, and control Cursor SDK agents as a first-class provider with clear local execution safety semantics.

## Current State

v1.0 Cursor SDK Provider shipped on 2026-06-14.

- `cursor-sdk` is implemented as a side-by-side direct provider backed by `@cursor/sdk`.
- Cursor ACP remains available as `cursor`; v1.0 did not replace or merge it.
- Local SDK lifecycle, resume persistence, cancellation, stream mapping, model/thinking/fast metadata, and existing app controls are wired and covered by targeted tests.
- Provider docs capture current beta limitations, including `CURSOR_API_KEY` auth, unsupported Linux Sandbox in the verified devcontainer, no Ask mode, no SDK MCP injection, and no credential store.
- Milestone archives live under `.planning/milestones/`; detailed execution artifacts are under `.planning/milestones/v1.0-phases/`.
- Detailed Git history remains on branch `gsd/v1.0-milestone`; private daily-use branch receives the milestone as a squash commit.

## Requirements

### Validated

- [x] Phase 1 confirmed `@cursor/sdk` can be added to the server workspace and imported after rebuilding native `sqlite3` bindings in the devcontainer.
- [x] Phase 1 captured SDK startup/auth/config diagnostics: missing key returns `ConfigurationError`; invalid key returns `AuthenticationError` with HTTP 401.
- [x] Phase 1 produced credentialed phase-local probes proving YOLO create/send/stream/wait, cancellation, and cross-process resume through `@cursor/sdk`.
- [x] Phase 1 confirmed Sandbox currently fails in this Linux devcontainer with SDK `ConfigurationError` for unsupported local sandboxing; it must be capability-gated or surfaced as unavailable, never silently downgraded to YOLO.
- [x] v1.0 completed the native `cursor-sdk` provider milestone with deterministic tests, docs, code review, UAT, integration audit, and goal-backward verification.
- [x] `cursor-sdk` is a side-by-side direct provider backed by `@cursor/sdk`, independent from the existing Cursor ACP catalog entry.
- [x] Local SDK agent lifecycle operations are wired through Paseo's `AgentClient` and `AgentSession` contracts for create/send/stream/wait/cancel/resume, with live service behavior treated as explicit UAT or real-smoke evidence.
- [x] Provider persistence stores enough non-secret handle data to resume Cursor SDK agents across daemon restarts while keeping the SDK agent id in `nativeHandle`.
- [x] v1 exposes only Sandbox and YOLO modes, with mode labels that communicate sandbox state instead of generic agent behavior.
- [x] Cursor SDK models, thinking options, and fast behavior use Paseo's existing model and feature controls when SDK metadata is stable enough to avoid misleading defaults.
- [x] Cursor ACP behavior remains unchanged; the SDK provider stays experimental and documented with current beta limitations.

### Active

No active requirements. Start the next milestone with `$gsd-new-milestone`, which creates a fresh `.planning/REQUIREMENTS.md`.

### Out of Scope

- Interactive per-tool human approval - the Cursor SDK does not currently expose a stable host approval response path comparable to Claude's native permission tools.
- Reusing local Cursor app or CLI login state - v1 assumes SDK authentication through `CURSOR_API_KEY` or an explicit SDK API key mechanism.
- Replacing the existing Cursor ACP provider - ACP remains available for users who want Cursor CLI login based behavior.
- Cloud Cursor agents - local runtime is the first target; cloud can be added after local lifecycle and persistence are stable.
- Full custom tool injection - SDK custom tools can be evaluated later after the provider lifecycle is proven.

## Next Milestone Goals

- Define fresh requirements before doing more Cursor SDK expansion.
- Consider Cursor SDK cloud runtime only after local lifecycle and persistence remain stable.
- Revisit SDK custom tools/MCP wiring only if the SDK exposes a stable supported configuration path.
- Revisit Ask/approval mode only if Cursor SDK exposes a stable host approval response API.

## Context

- Paseo's direct provider contract lives in `packages/server/src/server/agent/agent-sdk-types.ts`.
- Existing direct provider references include Claude, Codex, OpenCode, Pi, OMP, and dev mock providers.
- Provider discovery, static mode visuals, and client UI metadata flow through `packages/protocol/src/provider-manifest.ts` and server provider snapshots.
- Cursor ACP was tested and does not expose a YOLO mode through ACP `availableModes`, `session/set_mode`, or `session/set_config_option`.
- Cursor SDK is public beta. Treat API shape and runtime behavior as integration risks and isolate the provider accordingly.
- Phase 1's spike recommendation was `Adjust scope`: dependency/import, auth/config/model diagnostics, and YOLO lifecycle/cancel/resume are proven with a credentialed SDK run; Sandbox is not proven because this runtime reports unsupported local sandboxing.
- Local Cursor SDK credentials for this checkout should live in `.dev/paseo-home/config.json` at `agents.providers.cursor-sdk.env.CURSOR_API_KEY`. That file is gitignored; planning docs must record only this location, never the key value. The runtime/probes should read that path first, then fall back to process env `CURSOR_API_KEY`.

## Constraints

- **Protocol compatibility**: Any schema additions must be optional or backward-compatible; new feature availability should be capability-gated rather than simulated through legacy fallbacks.
- **Provider isolation**: The SDK provider must not mutate existing Cursor ACP behavior or user provider overrides.
- **Auth boundary**: Do not invent a Paseo-managed credential store in this milestone; use existing environment/config paths unless requirements change.
- **Safety semantics**: Mode labels must reflect sandbox behavior. Do not expose a generic "Agent" mode that hides whether sandboxing is enabled.
- **Testing scope**: Run only targeted tests for changed files and always run typecheck and lint after code changes.

## Key Decisions

| Decision                                                       | Rationale                                                                                                             | Outcome  |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | -------- |
| Build a side-by-side `cursor-sdk` direct provider              | The SDK is beta and differs from ACP in auth, lifecycle, and approval behavior                                        | Accepted |
| Expose only Sandbox and YOLO in v1                             | "Agent" would be misleading because Cursor CLI agent behavior can run with sandbox disabled                           | Accepted |
| Keep Cursor ACP unchanged                                      | It uses Cursor CLI login and remains useful while SDK auth requires API key                                           | Accepted |
| Start with local SDK runtime only                              | Local runtime matches Paseo's current product value and avoids cloud repo/auth scope in the first milestone           | Accepted |
| Proceed from Phase 1 with adjusted scope                       | YOLO lifecycle/cancel/resume are live-proven, but Sandbox is unsupported in this runtime and must be capability-gated | Accepted |
| Store Cursor SDK credential in local dev config                | Keeps the key out of git while making its expected location discoverable to future agents                             | Accepted |
| Use provider-level metadata APIs for Cursor SDK model/features | Avoids empty scratch SDK sessions and keeps metadata discovery side-effect-free                                       | Accepted |
| Keep fast/thinking on shared composer controls                 | Avoids provider-specific UI while preserving explicit SDK option semantics                                            | Accepted |
| Treat live SDK/API behavior as UAT or real-smoke evidence      | Keeps default tests deterministic and independent of credentials, credits, and upstream service drift                 | Accepted |

---

_Last updated: 2026-06-14 after v1.0 milestone completion_
