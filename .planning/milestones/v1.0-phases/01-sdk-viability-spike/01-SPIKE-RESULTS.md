# Phase 1 Spike Results: SDK Viability

## Recommendation

Adjust scope

The `@cursor/sdk` dependency can be installed and imported in the server workspace, and the SDK exposes useful startup/config/auth errors for provider diagnostics. After adding `CURSOR_API_KEY` through `.dev/paseo-home/config.json`, credentialed live probes proved the unsandboxed YOLO local lifecycle path: create/send/stream/wait, cancellation, and cross-process `Agent.resume` with `JsonlLocalAgentStore`.

This remains `Adjust scope`, not unconditional `Proceed`, because `local.sandboxOptions.enabled = true` fails in this Linux devcontainer with SDK `ConfigurationError`: "Local SDK sandboxing was requested, but sandboxing is not supported in this environment." Phase 2 may implement the experimental local provider around the proven YOLO path and shared lifecycle abstractions, but Sandbox must be capability-gated or surfaced as unavailable with a clear diagnostic until proven in a supported runtime.

## Evidence Matrix

| Experiment category              | Result                                                                                                                                                                         | Evidence file                                                                                                                                          | Provider impact                                                                                                                       |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Dependency/import                | Passed after `npm rebuild sqlite3` repaired the native binding left missing by `--ignore-scripts` install. Exports verified: `Agent`, `Cursor`, and `JsonlLocalAgentStore`.    | `.planning/phases/01-sdk-viability-spike/results/import.json`                                                                                          | SDK can remain a real server dependency, but native lifecycle scripts are a dependency risk to preserve in docs and build validation. |
| Auth/model probe                 | Passed. Missing-key, invalid-key, and invalid-model probes all produced classifiable startup/config/auth diagnostics with a real configured key available.                     | `.planning/phases/01-sdk-viability-spike/results/auth-config-errors.json`                                                                              | Provider can distinguish startup/config/auth/model diagnostics before a run exists.                                                   |
| Create/send/stream/wait: Sandbox | Failed with SDK `ConfigurationError` because local sandboxing is unsupported in this devcontainer/runtime.                                                                     | `.planning/phases/01-sdk-viability-spike/results/create-send-stream-wait-sandbox.json`                                                                 | Sandbox must be capability-gated or shown unavailable; do not silently fall back to YOLO.                                             |
| Create/send/stream/wait: YOLO    | Passed. `Agent.create`, `agent.send`, streaming, and `run.wait()` produced `terminalStatus: "finished"` using `composer-2.5` and `JsonlLocalAgentStore`.                       | `.planning/phases/01-sdk-viability-spike/results/create-send-stream-wait-yolo.json`                                                                    | YOLO local lifecycle can map onto Paseo's direct-provider turn lifecycle.                                                             |
| Cancellation: Sandbox            | Failed with the same unsupported-sandbox `ConfigurationError` before a live run existed.                                                                                       | `.planning/phases/01-sdk-viability-spike/results/cancel.json`                                                                                          | Sandbox cancellation remains unproven because sandbox startup fails first.                                                            |
| Cancellation: YOLO               | Passed. `run.supports("cancel")` returned true, `run.cancel()` was issued, and `run.wait()` returned `terminalStatus: "cancelled"`.                                            | `.planning/phases/01-sdk-viability-spike/results/cancel-yolo.json`                                                                                     | Cancellation can map to Paseo interrupt/`turn_canceled` semantics for the YOLO path.                                                  |
| Cross-process resume: Sandbox    | Failed/blocked because sandbox startup did not produce a live handle.                                                                                                          | `.planning/phases/01-sdk-viability-spike/results/resume-create.json`, `.planning/phases/01-sdk-viability-spike/results/resume-followup.json`           | Sandbox resume remains unproven until sandbox startup is supported.                                                                   |
| Cross-process resume: YOLO       | Passed. Process A produced a local SDK `agentId`/store handle; Process B resumed the same agent and proved continuity.                                                         | `.planning/phases/01-sdk-viability-spike/results/resume-create-yolo.json`, `.planning/phases/01-sdk-viability-spike/results/resume-followup-yolo.json` | `nativeHandle = sdkAgentId` plus the same JSONL store path is viable for Paseo resume metadata.                                       |
| Error taxonomy                   | Passed for observed startup/config/auth/model errors and cancellation terminal status. In-run `run.wait().status === "error"` remains unobserved.                              | `.planning/phases/01-sdk-viability-spike/results/auth-config-errors.json`, `.planning/phases/01-sdk-viability-spike/results/cancel-yolo.json`          | Map observed failures now; keep generic in-run error behavior as a Phase 2/4 validation item.                                         |
| Final verification               | Passed for formatting, lint, typecheck, scripts/results secret scan, and bounded result artifacts. Raw SDK stores are ignored because they contain full local run transcripts. | `.planning/phases/01-sdk-viability-spike/results/verification.json`                                                                                    | Phase 1 evidence artifacts are clean and bounded; no raw API key values were recorded.                                                |

Every result JSON from 01-01 and the credentialed follow-up is referenced above. The live lifecycle categories now separate unsupported Sandbox behavior from proven YOLO behavior.

## Commands and Environment

The spike used `@cursor/sdk` version `1.0.18`, Node `v22.22.3`, and npm `10.9.8` inside the devcontainer. Credentialed follow-up result JSON records `hasCursorApiKey: true` and `cursorApiKeySource: "provider-config"`; the key value is not stored in result artifacts.

Reproduction commands from 01-01, with credential values omitted:

```bash
devcontainer exec --workspace-folder /mnt/private_yax_qy4/projects/paseo npm install --workspace=@getpaseo/server --ignore-scripts @cursor/sdk
devcontainer exec --workspace-folder /mnt/private_yax_qy4/projects/paseo npm rebuild sqlite3
devcontainer exec --workspace-folder /mnt/private_yax_qy4/projects/paseo npm run format:files -- packages/server/package.json package-lock.json .planning/phases/01-sdk-viability-spike/scripts/check-import.ts .planning/phases/01-sdk-viability-spike/scripts/cursor-sdk-spike-utils.ts .planning/phases/01-sdk-viability-spike/scripts/lifecycle-cancel.ts .planning/phases/01-sdk-viability-spike/scripts/lifecycle-create-send-wait.ts .planning/phases/01-sdk-viability-spike/scripts/lifecycle-resume-create.ts .planning/phases/01-sdk-viability-spike/scripts/lifecycle-resume-followup.ts .planning/phases/01-sdk-viability-spike/scripts/probe-sdk-errors.ts
devcontainer exec --workspace-folder /mnt/private_yax_qy4/projects/paseo npm run typecheck
devcontainer exec --workspace-folder /mnt/private_yax_qy4/projects/paseo npm run lint
```

Credentialed lifecycle probes should be rerun later with the Cursor API key present through the configured provider runtime environment or daemon environment. Do not write the key value to Markdown, JSON, logs, `AgentPersistenceHandle.metadata`, SDK store files, or provider-scoped directories.

Raw SDK JSONL stores contain full prompts, tool calls, model output, and test continuity tokens. They are intentionally ignored by `.gitignore` via `.planning/phases/*/stores/`; keep durable evidence in redacted result JSON instead.

## Provider Design Guidance

The guidance below is for Phase 2 planning only. `CursorSdkAgentClient` and `CursorSdkAgentSession` are future Phase 2 symbols, not Phase 1 code. The design must remain local-runtime only, must preserve Cursor ACP as a separate provider, and must not create production provider files during Phase 1.

### Persistence Handle and Store

Use Paseo's existing `AgentPersistenceHandle` shape. `nativeHandle` is the SDK `agentId`, matching the direct-provider pattern where the provider-native resume token is stored in `nativeHandle`.

```json
{
  "provider": "cursor-sdk",
  "sessionId": "<paseoSessionId>",
  "nativeHandle": "<sdkAgentId>",
  "metadata": {
    "runtime": "local",
    "cwd": "<workspace cwd>",
    "storePath": "${PASEO_HOME}/providers/cursor-sdk/stores/{paseoSessionId}",
    "model": "<model id>",
    "modeId": "sandbox | yolo",
    "sandboxEnabled": true
  }
}
```

Production SDK JSONL stores should use `${PASEO_HOME}/providers/cursor-sdk/stores/{paseoSessionId}`. The store path is provider-scoped and session-scoped so local SDK records are not mixed with other providers or other Paseo agents. Phase 2 should pass the same store path when creating and resuming a local SDK agent; it should not rely on process-wide default SDK stores in a long-running daemon.

`AgentPersistenceHandle.metadata` may store only resume context: `runtime`, `cwd`, `storePath`, `model`, `modeId`, and `sandboxEnabled`. No API key value belongs in `AgentPersistenceHandle.metadata`, result JSON, SDK store files, `$PASEO_HOME` provider directories, or Markdown artifacts. API key lookup remains a runtime concern through provider runtime settings/env, not persisted session state.

Credentialed YOLO evidence proves the handle shape: `resume-create-yolo.json` stores the SDK `agentId` plus `cwd`, `storePath`, `runtime`, `model`, `modeId`, and `sandboxEnabled`; `resume-followup-yolo.json` resumes that same agent and validates continuity. Sandbox handle creation is still unproven because sandbox startup fails before a run exists.

### Future `CursorSdkAgentClient` Responsibilities

`CursorSdkAgentClient` should implement the direct `AgentClient` contract and own provider-level concerns:

- `createSession`: resolve runtime settings, credential presence, model, mode, cwd, store path, and create a local SDK agent.
- `resumeSession`: read `nativeHandle` as the SDK `agentId`, validate metadata, rebuild the same local store, and call `Agent.resume(agentId)`.
- `listModels`: use SDK model discovery when credentials are available and return stable model metadata without creating empty local sessions.
- `isAvailable`: check SDK import plus Cursor API key presence from provider runtime settings/env and return unavailable/diagnostic state when missing.
- Diagnostics: expose startup/config/auth details such as missing key, invalid key, unsupported sandbox, or native dependency errors without leaking secret values.

### Future `CursorSdkAgentSession` Responsibilities

`CursorSdkAgentSession` should implement the running `AgentSession` contract and own SDK run state:

- `startTurn`: call `agent.send`, record SDK `agentId`/run id where available, stream SDK messages, and emit canonical Paseo turn/timeline events.
- `subscribe`: publish `AgentStreamEvent` values to the manager while preserving a single foreground turn.
- `streamHistory`: replay any stored SDK/Paseo history needed after resume or import.
- `describePersistence`: return the `AgentPersistenceHandle` with SDK `agentId` in `nativeHandle` and the metadata fields above.
- `interrupt`: check the active SDK run for cancellation support and request cancellation when supported.
- `close`: dispose/close the SDK agent and any active run watchers.
- `run`: wrap `startTurn`/`subscribe` with the existing provider-runner pattern so callers receive `AgentRunResult`.

### Error Mapping

Startup/config/auth failures are SDK throws that happen before a run exists. Observed examples are missing-key `ConfigurationError` and invalid-key `AuthenticationError` from `.planning/phases/01-sdk-viability-spike/results/auth-config-errors.json`. Researched SDK classes that Phase 2 should preserve in diagnostics include `AuthenticationError`, `RateLimitError`, `ConfigurationError`, `NetworkError`, `UnsupportedRunOperationError`, and `UnknownAgentError`.

| SDK surface                                                    | Paseo mapping                                                                                      | Notes                                                                                                                                                           |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SDK import/native dependency failure                           | Provider unavailable or provider diagnostic                                                        | Include native dependency context such as `sqlite3` binding failure; do not start a session just to discover this.                                              |
| Missing key `ConfigurationError` before run exists             | Provider unavailable/diagnostic from `isAvailable()` or `turn_failed` during `startTurn`           | This is not an in-run failure and should not create a fake SDK session.                                                                                         |
| Invalid key `AuthenticationError` before run exists            | Provider unavailable/diagnostic from `isAvailable()` or `turn_failed` during `startTurn`           | Include SDK `status`, `code`, `operation`, and `endpoint` when present, without secret values.                                                                  |
| `RateLimitError` before run exists                             | `turn_failed` or provider diagnostic                                                               | Preserve retry-after/status metadata when available, but do not auto-retry in v1.                                                                               |
| `NetworkError` before run exists                               | `turn_failed` or provider diagnostic                                                               | Mark as transient only through diagnostic metadata.                                                                                                             |
| `ConfigurationError` for unsupported sandbox or invalid model  | `turn_failed` or provider diagnostic                                                               | Invalid-model probing is now live-observed with a credentialed key. Unsupported sandbox should keep Sandbox mode unavailable or failed with a clear diagnostic. |
| `UnsupportedRunOperationError` or `run.supports(op) === false` | Capability-specific diagnostic, not a generic run failure                                          | Check `run.supports("cancel")` before cancellation and record `unsupportedReason("cancel")` when available.                                                     |
| `UnknownAgentError` during resume                              | `turn_failed` during `resumeSession`/`startTurn`, or provider diagnostic if surfaced before a turn | Treat stale or missing local store/agent id as a resume failure requiring user-visible diagnostics.                                                             |

In-run failures are terminal run outcomes after a run exists:

| SDK run outcome                     | Paseo mapping    | Notes                                                                            |
| ----------------------------------- | ---------------- | -------------------------------------------------------------------------------- |
| `run.wait().status === "finished"`  | `turn_completed` | Also emit final assistant text/timeline and usage where SDK provides it.         |
| `run.wait().status === "error"`     | `turn_failed`    | Include SDK run id/request id/status/code in diagnostic metadata when available. |
| `run.wait().status === "cancelled"` | `turn_canceled`  | Treat cancellation as a non-success terminal event, not as a provider crash.     |

`isRetryable` is diagnostic metadata, not an automatic v1 retry policy. The provider may display or log it so the user understands whether retry is reasonable, but Phase 2 should not blindly retry `agent.send`, `Agent.create`, `Agent.resume`, or `Cursor.models.list()` because that can duplicate local runs or obscure auth/config failures.

### Availability and Model Discovery

`isAvailable()` should check two independent conditions:

1. The SDK can be imported and required native pieces are usable enough for the operation being reported.
2. A Cursor API key is present through provider runtime settings/env. Phase 2 should prefer `agents.providers.cursor-sdk.env` from `$PASEO_HOME/config.json` through existing provider runtime settings, then fall back to daemon environment if that is the selected implementation path.

Missing credentials should make the provider unavailable or diagnostic-rich before launch. It should not be hidden by creating a local session that fails later.

`listModels()` should use stable SDK model discovery such as `Cursor.models.list()` and map returned model IDs, parameter definitions, and preset variants into existing `AgentModelDefinition`/thinking option shapes when stable. Model discovery must avoid creating empty Cursor SDK sessions. This follows the provider snapshot guidance in `docs/providers.md`: metadata APIs are preferred over scratch sessions because scratch sessions can leak into provider history/import surfaces.

### Mode Mapping

Sandbox and YOLO are the only v1 modes.

| Paseo mode id | SDK local option                       | UI/safety guidance                                                                                                                | Evidence status                                                                                 |
| ------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `sandbox`     | `local.sandboxOptions.enabled = true`  | Label as Sandbox. Treat it as the safer intent, but show it unavailable in runtimes where the SDK reports unsupported sandboxing. | Failed with unsupported-sandbox `ConfigurationError` in `create-send-stream-wait-sandbox.json`. |
| `yolo`        | `local.sandboxOptions.enabled = false` | Label as YOLO, dangerous, and unattended. It is unrestricted headless execution, not a safe mode.                                 | Passed in `create-send-stream-wait-yolo.json`.                                                  |

`local.autoReview` is not a v1 mode and is not a security boundary. It must not be presented as Ask mode, approval mode, or a substitute for human-in-the-loop permission handling. No Ask mode is exposed in v1. No generic Agent mode is exposed in v1. A generic "Agent" label would hide the actual sandbox state and contradict the Phase 1 safety boundary.

### Cancellation, Resume, and Disposal

YOLO cancellation is live-proven, and Sandbox cancellation remains blocked by unsupported sandbox startup. Phase 2 should implement cancellation around SDK capability checks:

- Keep the active SDK `Run` handle for the foreground turn.
- Before calling cancel, check `run.supports("cancel")`.
- If unsupported, record `run.unsupportedReason("cancel")` when available and emit a diagnostic rather than pretending cancellation succeeded.
- If supported, call `run.cancel()` and wait for the terminal result.
- Map `run.wait().status === "cancelled"` to `turn_canceled`; `cancel-yolo.json` observed this exact terminal status.

YOLO resume is live-proven across processes, and Sandbox resume remains blocked by unsupported sandbox startup. Phase 2 should implement the handle path below:

- Store SDK `agentId` in `AgentPersistenceHandle.nativeHandle`.
- Store `runtime`, `cwd`, `storePath`, `model`, `modeId`, and `sandboxEnabled` in metadata.
- Rebuild the same `JsonlLocalAgentStore` from `storePath`.
- Call `Agent.resume(agentId)` with the same JSONL store and runtime context.
- Send a follow-up prompt that proves conversation continuity before marking cross-process resume as validated; `resume-followup-yolo.json` proves this for the unsandboxed local path.

Disposal is non-negotiable for daemon stability:

- Use `agent.close()` or `agent[Symbol.asyncDispose]()` cleanup for every created/resumed SDK agent.
- Ensure `close()` is idempotent on `CursorSdkAgentSession`.
- Clear active run handles, subscribers, and pending turn state after `turn_completed`, `turn_failed`, or `turn_canceled`.
- Do not rely on process exit to release SDK stores, child processes, HTTP clients, or local executor resources.

### Scope Fences

Phase 1 is docs/design only after 01-01 dependency and probe artifacts. This plan must not edit:

- `packages/server/src/server/agent/provider-registry.ts`
- `packages/protocol/src/provider-manifest.ts`
- `packages/server/src/server/agent/providers/*`
- production `cursor-sdk` provider files
- app UI files
- secret storage or credential persistence files

Those files may be referenced as Phase 2 analogs, but any implementation or registration belongs to later plans.

## Final Documentation Verification

Requirement coverage:

- `SDK-02`: Addressed as adjusted-scope live evidence. YOLO `Agent.create`, `agent.send`, streaming, `run.wait`, cancellation, and `Agent.resume` are proven; Sandbox remains unsupported in this devcontainer/runtime.
- `SDK-03`: Addressed with observed startup/config/auth error taxonomy and Phase 2 mappings for in-run error/cancellation outcomes.
- `SDK-01`: Preserved from 01-01 evidence; dependency/import passed after native `sqlite3` rebuild.

Verification commands run for 01-02 T5:

- `rg -n "SDK-02|SDK-03|D-01|D-02|D-03|D-04|D-05|D-06|D-07|D-08|D-09|D-10|D-11|D-12|D-13|D-14|D-15|D-16|D-17|D-18|D-19|D-20" .planning/phases/01-sdk-viability-spike/01-SPIKE-RESULTS.md` — initially found all decision IDs and revealed the missing explicit requirement strings; this section fixes that coverage.
- `devcontainer exec --workspace-folder /mnt/private_yax_qy4/projects/paseo npm run format:files -- .planning/phases/01-sdk-viability-spike/01-SPIKE-RESULTS.md` — passed.
- `devcontainer exec --workspace-folder /mnt/private_yax_qy4/projects/paseo npm run typecheck` — passed.
- `devcontainer exec --workspace-folder /mnt/private_yax_qy4/projects/paseo npm run lint` — passed.
- No full test suite was run for this docs/design plan.
- Secret scan for raw key assignments or token-shaped values returned no matches.

## Risks and Limits

- YOLO `Agent.create`, `agent.send`, `run.stream`, `run.wait`, `run.cancel`, and `Agent.resume` behavior is proven only in disposable scratch repositories, not yet wired through Paseo production provider code.
- Sandbox runtime support in this Linux devcontainer fails with SDK `ConfigurationError`; do not silently downgrade Sandbox to YOLO.
- `JsonlLocalAgentStore` continuity is live-proven for YOLO, but production store lifecycle, cleanup, and daemon restart behavior still need Phase 2/4 validation.
- The SDK imported only after native `sqlite3` rebuild, so install posture and lifecycle scripts remain a build/release risk.
- `local.autoReview` must not be treated as approval or a security boundary.
- Phase 1 must not edit `packages/server/src/server/agent/provider-registry.ts`, `packages/protocol/src/provider-manifest.ts`, app UI, secret storage, or a production Cursor SDK provider.

## Decision Coverage

| Decision | Coverage        | Evidence                                                                                                             |
| -------- | --------------- | -------------------------------------------------------------------------------------------------------------------- |
| D-01     | Proven          | Real SDK calls ran after `CURSOR_API_KEY` was configured through provider config.                                    |
| D-02     | Proven          | Live probes used scratch repositories under `/tmp`, not `/mnt/private_yax_qy4/projects/paseo`.                       |
| D-03     | Proven for YOLO | YOLO lifecycle, cancellation, and resume passed; Sandbox failed with unsupported-sandbox diagnostics.                |
| D-04     | Proven          | Failed/blocked evidence records provider impact instead of silently falling back.                                    |
| D-05     | Proven          | Scripts/results and this conclusion live under `.planning/phases/01-sdk-viability-spike/`.                           |
| D-06     | Proven          | `@cursor/sdk` was added to `packages/server` in 01-01.                                                               |
| D-07     | Proven          | 01-01 verification ran format, typecheck, and lint.                                                                  |
| D-08     | Proven risk     | `--ignore-scripts` install required `npm rebuild sqlite3` before import passed.                                      |
| D-09     | Not triggered   | Evidence supports adjusting scope, not removing the dependency.                                                      |
| D-10     | Proven          | YOLO live probes wrote and resumed from `JsonlLocalAgentStore`; raw stores are ignored, redacted summaries are kept. |
| D-11     | Proven for YOLO | Resume create/follow-up produced a live continuity proof in YOLO mode.                                               |
| D-12     | Proven for YOLO | Persistence mapping stores SDK `agentId` in `nativeHandle`/handle evidence.                                          |
| D-13     | Proven for YOLO | Metadata fields are present in `resume-create-yolo.json` and `resume-followup-yolo.json`.                            |
| D-14     | Proven for YOLO | Store convention is exercised by YOLO probes and remains the production recommendation.                              |
| D-15     | Adjusted        | YOLO mapping executed successfully; Sandbox mapping fails because SDK sandboxing is unsupported here.                |
| D-16     | Proven guidance | `local.autoReview` remains out of v1 mode scope.                                                                     |
| D-17     | Guidance only   | Key lookup should reuse provider runtime settings/env, with values omitted from artifacts.                           |
| D-18     | Proven guidance | No new secret store was added.                                                                                       |
| D-19     | Proven          | No cloud agents were run or planned for v1.                                                                          |
| D-20     | Proven          | Result files record key presence/source only, not key values.                                                        |

## SPIKE RESULTS COMPLETE
