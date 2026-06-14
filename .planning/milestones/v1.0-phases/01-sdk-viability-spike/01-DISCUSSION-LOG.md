# Phase 1: SDK Viability Spike - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-13
**Phase:** 1-SDK Viability Spike
**Areas discussed:** Real SDK Call Boundary, Dependency Shape, Persistence and Resume Probe, Safety and Auth Boundary

---

## Real SDK Call Boundary

| Question          | Option                 | Description                                                                                                                                   | Selected |
| ----------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| SDK spike scope   | Full scratch lifecycle | Use `CURSOR_API_KEY` to validate `create/send/stream/wait/cancel/resume` in a temporary scratch workspace, without touching the current repo. | yes      |
| SDK spike scope   | Two-stage              | First validate install/import/types, then run a real SDK lifecycle after explicit confirmation.                                               | no       |
| SDK spike scope   | Static only            | Do not call Cursor agent or consume API key; validate only static/type behavior.                                                              | no       |
| Stop rule         | Bounded evidence       | Try at most two corrections per core capability, then record error/evidence/impact instead of continuing indefinitely.                        | yes      |
| Stop rule         | Fix until green        | Keep debugging environment or script issues until the full lifecycle succeeds or SDK support is disproven.                                    | no       |
| Stop rule         | Fail fast              | Stop on the first failure of any core capability.                                                                                             | no       |
| Artifact location | Phase directory        | Store scripts, logs, and conclusions under `.planning/phases/01-sdk-viability-spike/`.                                                        | yes      |
| Artifact location | Temporary only         | Keep scripts in `/tmp` or `.dev`, and write only final conclusions to GSD docs.                                                               | no       |
| Artifact location | Repo scripts           | Promote reusable scripts into repo `scripts/` or test helpers.                                                                                | no       |
| Scratch isolation | Temporary git repo     | Run SDK with `cwd` pointing at a minimal temporary git repo; current Paseo checkout remains read-only context.                                | yes      |
| Scratch isolation | Copied fixture         | Copy a small Paseo fixture into scratch workspace for a more realistic structure.                                                             | no       |
| Scratch isolation | Current repo sandbox   | Run directly against current repo with SDK sandbox enabled.                                                                                   | no       |

**User's choice:** Full scratch lifecycle with bounded evidence, phase-local artifacts, and a temporary minimal git repo.
**Notes:** Real SDK behavior is required because lifecycle, stream, cancel, resume, and headless tool behavior cannot be proven from static reading alone.

---

## Dependency Shape

| Question            | Option                     | Description                                                                                                      | Selected |
| ------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------- |
| Dependency handling | Real server dependency     | Add `@cursor/sdk` to `packages/server` and validate true package/native/type behavior through the devcontainer.  | yes      |
| Dependency handling | Temporary only             | Install the SDK only in a throwaway location and add the dependency later.                                       | no       |
| Dependency handling | Two-step                   | Temporarily validate import, then add the server dependency in the same phase.                                   | no       |
| Commit scope        | Phase 1 spike commit       | Commit dependency changes together with spike scripts/results and verification.                                  | yes      |
| Commit scope        | Separate dependency commit | Commit only `package.json`/lockfile first, then spike separately.                                                | no       |
| Commit scope        | Delay commit               | Do not commit dependency until Phase 2 provider implementation.                                                  | no       |
| Install scripts     | Start with ignore-scripts  | Respect the devcontainer's `--ignore-scripts` posture first; record risk if SDK runtime needs lifecycle scripts. | yes      |
| Install scripts     | Allow scripts              | Use npm default lifecycle scripts, accepting possible downloads/postinstall delays.                              | no       |
| Install scripts     | Research first             | Defer install strategy until package behavior is researched.                                                     | no       |
| Failure cleanup     | Remove dependency          | If SDK is unsuitable, remove the dependency and keep the spike conclusion.                                       | yes      |
| Failure cleanup     | Keep dependency            | Leave the beta SDK dependency in place even if Phase 1 fails.                                                    | no       |
| Failure cleanup     | Decide later               | Do not lock cleanup policy now.                                                                                  | no       |

**User's choice:** Add `@cursor/sdk` to `packages/server` during Phase 1, validate inside devcontainer, start with `--ignore-scripts`, and remove the dependency if the SDK is unsuitable.
**Notes:** Cursor SDK has native/runtime dependencies, so dependency behavior itself is part of the spike.

---

## Persistence and Resume Probe

| Question        | Option                    | Description                                                                                           | Selected |
| --------------- | ------------------------- | ----------------------------------------------------------------------------------------------------- | -------- |
| Store probe     | PASEO_HOME scoped JSONL   | Use `JsonlLocalAgentStore` under a Paseo-controlled path for inspectable evidence and resume testing. | yes      |
| Store probe     | Default SQLite            | Use SDK's default SQLite store under its default state root.                                          | no       |
| Store probe     | Both                      | Validate JSONL and default SQLite behavior.                                                           | no       |
| Resume standard | Context follow-up         | Prove cross-process conversation continuity with `Agent.resume(agentId)` and a follow-up prompt.      | yes      |
| Resume standard | API only                  | Only prove that `Agent.resume` returns a handle and can send.                                         | no       |
| Resume standard | List/get/run APIs         | Focus on `Agent.list`, `Agent.get`, `listRuns`, or `getRun`.                                          | no       |
| Handle shape    | agentId + store + runtime | Store SDK `agentId` in `nativeHandle`, plus store path/runtime/model/mode metadata.                   | yes      |
| Handle shape    | agentId only              | Store only SDK `agentId` and infer the rest from fixed provider paths.                                | no       |
| Handle shape    | agentId + run ids         | Store `agentId`, `runId`, and `requestId`, with store path by convention.                             | no       |
| Store path      | Provider/session scoped   | Use `${PASEO_HOME}/providers/cursor-sdk/stores/{paseoSessionId}`.                                     | yes      |
| Store path      | Shared provider store     | Use a single `${PASEO_HOME}/cursor-sdk-store`.                                                        | no       |
| Store path      | SDK default               | Let SDK choose its default state root.                                                                | no       |

**User's choice:** Use a Paseo-scoped JSONL store with cross-process context continuity as the resume proof.
**Notes:** The provider design should preserve enough metadata to resume correctly after daemon restart.

---

## Safety and Auth Boundary

| Question           | Option                    | Description                                                                                                         | Selected |
| ------------------ | ------------------------- | ------------------------------------------------------------------------------------------------------------------- | -------- |
| Mode mapping probe | Explicit Sandbox and YOLO | Verify Sandbox with `sandboxOptions.enabled=true`; verify YOLO with sandbox disabled and no autoReview.             | yes      |
| Mode mapping probe | Sandbox only              | Verify only the safe default path in Phase 1.                                                                       | no       |
| Mode mapping probe | Document only             | Do not run different permission configurations.                                                                     | no       |
| Auto-review scope  | Document, not v1 mode     | Record what `local.autoReview` means, but do not add it to v1 modes.                                                | yes      |
| Auto-review scope  | Optional probe            | Run it if time allows, but keep it out of v1 mode metadata.                                                         | no       |
| Auto-review scope  | Include in v1             | Add Auto-review as a third v1 mode.                                                                                 | no       |
| API key config     | Provider env preferred    | Read `agents.providers.cursor-sdk.env.CURSOR_API_KEY` from `$PASEO_HOME/config.json`, then fallback to process env. | yes      |
| API key config     | Process env only          | Only read daemon process `CURSOR_API_KEY`.                                                                          | no       |
| API key config     | New secret store          | Design a separate encrypted/keychain-backed secret store.                                                           | no       |
| Cloud and secrets  | Local-only and redacted   | Ban cloud runtime; record only whether the key exists, never the key value.                                         | yes      |
| Cloud and secrets  | Cloud research only       | Do not run cloud, but document future cloud possibilities.                                                          | no       |
| Cloud and secrets  | Allow cloud probe         | Use cloud runtime as a comparison if local behavior is insufficient.                                                | no       |

**User's choice:** Probe Sandbox and YOLO, keep Auto-review out of v1, read API key from provider env config with process env fallback, prohibit cloud, and redact all secret values.
**Notes:** The user asked specifically to plan where the API key should be stored and how Paseo reads it; existing `$PASEO_HOME/config.json` provider env is the preferred path.

---

## the agent's Discretion

- Exact spike script names, prompt wording, and result file names are left to the planner/executor.

## Deferred Ideas

- Cursor SDK cloud runtime.
- Auto-review as a possible future third mode.
- A dedicated encrypted Cursor API key store or UI-managed key flow.
