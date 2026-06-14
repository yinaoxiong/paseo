# Phase 2: Direct Provider Core - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-13
**Phase:** 2-Direct Provider Core
**Areas discussed:** Provider boundary and availability, Sandbox handling, Persistence and resume contract, Stream and timeline mapping depth

---

## Provider Boundary and Availability

| Question                 | Option                 | Description                                                                                      | Selected |
| ------------------------ | ---------------------- | ------------------------------------------------------------------------------------------------ | -------- |
| Missing `CURSOR_API_KEY` | Mark unavailable       | Provider snapshot shows unavailable and diagnostic; no SDK session is created.                   | ✓        |
| Missing `CURSOR_API_KEY` | Fail at launch         | Provider remains selectable and fails when creating an agent.                                    |          |
| Missing `CURSOR_API_KEY` | Hide completely        | Provider disappears from visible provider lists.                                                 |          |
| Probe depth              | Lightweight check      | Check SDK import/native readiness and key presence; deeper auth/model failures happen elsewhere. | ✓        |
| Probe depth              | Network verification   | Verify key with Cursor API during availability checks.                                           |          |
| Probe depth              | Key only               | Only check whether env has a key.                                                                |          |
| In-process env boundary  | Pass explicitly        | Resolve provider env and pass key as SDK config where supported.                                 | ✓        |
| In-process env boundary  | Narrow env scope       | Temporarily set/restore `process.env` only around SDK calls if required.                         |          |
| In-process env boundary  | Global process env     | Write `process.env.CURSOR_API_KEY` globally in the daemon.                                       |          |
| Diagnostic detail        | Structured redacted    | Keep useful SDK fields while filtering secrets.                                                  | ✓        |
| Diagnostic detail        | Short user sentence    | Show only a terse friendly error.                                                                |          |
| Diagnostic detail        | Raw SDK passthrough    | Show raw SDK error object.                                                                       |          |
| Create/resume preflight  | Check at entry         | Repeat critical checks in `createSession()`/`resumeSession()`.                                   | ✓        |
| Create/resume preflight  | Trust snapshot only    | Assume provider snapshot is still current.                                                       |          |
| Create/resume preflight  | Diagnose after failure | Try SDK first, explain only after failure.                                                       |          |
| Cursor ACP isolation     | Fully isolated         | `cursor-sdk` reads only its own config and does not inherit `cursor` ACP behavior.               | ✓        |
| Cursor ACP isolation     | Fallback read          | Try `cursor` config when `cursor-sdk` lacks config.                                              |          |
| Cursor ACP isolation     | Shared config          | Treat Cursor ACP and Cursor SDK as one config group.                                             |          |
| Key source diagnostic    | Show source            | Show present/missing and provider-config/process-env source, without key content.                | ✓        |
| Key source diagnostic    | Show presence only     | Show only whether a key exists.                                                                  |          |
| Key source diagnostic    | Show nothing           | Do not mention key presence or source.                                                           |          |
| Invalid key / 401        | Diagnostic failure     | Fail operation with redacted diagnostic; snapshot may show error/unavailable until refresh.      | ✓        |
| Invalid key / 401        | Turn failure only      | Only fail the current turn without provider-state impact.                                        |          |
| Invalid key / 401        | Auto retry             | Retry SDK calls automatically.                                                                   |          |

**User's choice:** Mark unavailable, lightweight checks, explicit SDK config, structured redacted diagnostics, entry preflight, full Cursor ACP isolation, key source diagnostic, and diagnostic failure on auth errors.

**Notes:** User asked future discussion to be in Chinese, with plain-language explanation and best-practice framing before each question.

---

## Sandbox Handling

| Question                       | Option                     | Description                                                                                  | Selected |
| ------------------------------ | -------------------------- | -------------------------------------------------------------------------------------------- | -------- |
| Unsupported Sandbox visibility | Do not list as available   | Runtime `listModes()` omits Sandbox when known unsupported; explicit requests fail closed.   | ✓        |
| Unsupported Sandbox visibility | List but fail              | Still show Sandbox as selectable, then fail at create time.                                  |          |
| Unsupported Sandbox visibility | Hide concept               | Expose only YOLO until Sandbox is verified.                                                  |          |
| Sandbox resume mismatch        | Reject resume              | Refuse to resume Sandbox handles in unsupported environments.                                | ✓        |
| Sandbox resume mismatch        | Ask to convert to YOLO     | Prompt user to convert safety mode.                                                          |          |
| Sandbox resume mismatch        | Automatically use YOLO     | Resume by downgrading to YOLO.                                                               |          |
| Capability detection           | Side-effect-free probing   | Use SDK capability APIs, known failure cache, or environment diagnostics; no scratch agents. | ✓        |
| Capability detection           | Preflight scratch create   | Create a scratch SDK agent to test Sandbox support.                                          |          |
| Capability detection           | Only decide at real create | Discover support only when a user starts Sandbox.                                            |          |
| Mode metadata                  | Explicit safety metadata   | YOLO is unattended/dangerous; Sandbox is not unattended; labels are explicit.                | ✓        |
| Mode metadata                  | Treat both as defaults     | No special unattended or dangerous metadata.                                                 |          |
| Mode metadata                  | Mark both unattended       | Both modes are treated as unattended.                                                        |          |

**User's choice:** Omit unsupported Sandbox from runtime-available modes, reject unsafe resume, use side-effect-free capability detection, and mark mode safety semantics explicitly.

**Notes:** The fail-closed rule applies even when stale clients/configs explicitly request Sandbox.

---

## Persistence and Resume Contract

| Question            | Option                         | Description                                                                                                    | Selected |
| ------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------- | -------- |
| Metadata validation | Strict validation              | Missing/inconsistent `nativeHandle`, `storePath`, `cwd`, `runtime`, `modeId`, or sandbox state rejects resume. | ✓        |
| Metadata validation | Best-effort fill               | Infer missing fields from current config or defaults.                                                          |          |
| Metadata validation | Only check agentId             | Resume with SDK agentId only.                                                                                  |          |
| Store path policy   | Controlled root                | Use `$PASEO_HOME/providers/cursor-sdk/stores/{paseoSessionId}` and restore only from that root.                | ✓        |
| Store path policy   | Trust metadata                 | Use any metadata `storePath`.                                                                                  |          |
| Store path policy   | SDK default path               | Let SDK choose default persistence path.                                                                       |          |
| Resume overrides    | Keep original semantics        | Resume always uses persisted model/mode/sandbox.                                                               |          |
| Resume overrides    | Allow model override           | Allow model override, but not mode override.                                                                   |          |
| Resume overrides    | Allow model and mode override  | Explicit resume may override both model and mode.                                                              | ✓        |
| Override guardrails | Fail without downgrade         | If requested override cannot be honored, fail with diagnostic.                                                 | ✓        |
| Override guardrails | Fall back to old config        | Use persisted config if override fails.                                                                        |          |
| Override guardrails | Automatically choose available | Pick another available model/mode.                                                                             |          |

**User's choice:** Strict metadata validation, controlled store root, explicit model/mode override allowed on resume, and fail-without-downgrade guardrails for unsupported overrides.

**Notes:** This intentionally differs from the default best-practice recommendation of preserving original model/mode. The guardrail is therefore mandatory.

---

## Stream and Timeline Mapping Depth

| Question            | Option                      | Description                                                                              | Selected |
| ------------------- | --------------------------- | ---------------------------------------------------------------------------------------- | -------- |
| Mapping depth       | Robust core mapping         | Map observed core events and terminal statuses; unknown SDK events become diagnostics.   | ✓        |
| Mapping depth       | Best-effort full mapping    | Try to map every SDK event in detail.                                                    |          |
| Mapping depth       | Minimal text mapping        | Only map assistant text and completion/failure.                                          |          |
| User message policy | Immediate single row        | Emit one canonical `user_message` as soon as the prompt is accepted.                     | ✓        |
| User message policy | Wait for SDK echo           | Write user row only if SDK echoes it.                                                    |          |
| User message policy | Keep both rows              | Store both Paseo prompt row and SDK echo row.                                            |          |
| Terminal status     | Direct mapping              | `finished`→`turn_completed`, `cancelled`→`turn_canceled`, `error/unknown`→`turn_failed`. | ✓        |
| Terminal status     | Cancellation as failure     | Treat cancellation as `turn_failed`.                                                     |          |
| Terminal status     | Unknown as completion       | Treat unknown non-throwing states as success.                                            |          |
| Tool call mapping   | Conservative classification | Map reliable tools to standard `ToolCallDetail`; unknown tools stay generic/diagnostic.  | ✓        |
| Tool call mapping   | Classify everything         | Force every tool into a standard category.                                               |          |
| Tool call mapping   | Text only                   | Do not create tool timeline items.                                                       |          |

**User's choice:** Robust core mapping, immediate single canonical user row, direct terminal status mapping, and conservative tool classification.

**Notes:** Phase 1 observed SDK stream event counts for `status`, `assistant`, and `tool_call`, plus `runId`, `requestId`, and terminal status.

---

## the agent's Discretion

- Exact file names, helper boundaries, adapter class names, fixture names, and diagnostic field names.
- Exact implementation split across Phase 2 plans, provided the safety and persistence decisions are preserved.

## Deferred Ideas

- Cursor SDK cloud runtime.
- SDK `local.autoReview` as a possible future mode.
- Interactive Ask/human approval.
- Provider manifest/UI/icon/model/thinking surfacing in Phase 3.
- Broad hardening docs and tests in Phase 4.
