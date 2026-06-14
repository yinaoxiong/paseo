---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: Cursor SDK Provider
status: Awaiting next milestone
stopped_at: Phase 4 executed and verified
last_updated: "2026-06-14T10:26:42.643Z"
last_activity: 2026-06-14 — Milestone v1.0 completed and archived
progress:
  total_phases: 4
  completed_phases: 4
  total_plans: 11
  completed_plans: 11
  percent: 100
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-14)

**Core value:** Paseo can launch, monitor, resume, and control Cursor SDK agents as a first-class provider with clear local execution safety semantics.
**Current focus:** Awaiting next milestone definition

## Current Position

Phase: Milestone v1.0 complete
Plan: —
Status: Awaiting next milestone
Last activity: 2026-06-14 — Milestone v1.0 completed and archived

## Performance Metrics

**Velocity:**

- Total plans completed: 11
- Average duration: 16 min
- Total execution time: 175 min

**By Phase:**

| Phase | Plans | Total  | Avg/Plan |
| ----- | ----- | ------ | -------- |
| 01    | 2     | 29 min | 15 min   |
| 02    | 3     | 58 min | 19 min   |
| 03    | 4     | 61 min | 15 min   |
| 04    | 2     | 27 min | 14 min   |

**Recent Trend:**

- Last 5 plans: 03-02, 03-03, 03-04, 04-01, 04-02
- Trend: Phase 04 closed the Cursor SDK milestone with deterministic tests, docs, and final verification evidence.

_Updated after each plan completion_
| Phase 01 P01 | 18 min | 5 tasks | 17 files |
| Phase 01 P02 | 11 min | 5 tasks | 2 files |
| Phase 02 P01 | 18 min | 2 tasks | 8 files |
| Phase 02 P02 | 24 min | 2 tasks | 7 files |
| Phase 02 P03 | 16 min | 2 tasks | 5 files |
| Phase 03 P01 | 15 min | 3 tasks | 6 files |
| Phase 03 P02 | 25min | 2 tasks | 5 files |
| Phase 03 P03 | 12min | 2 tasks | 7 files |
| Phase 03 P04 | 9min | 2 tasks | 3 files |
| Phase 04 P01 | 12min | 3 tasks | 7 files |
| Phase 04 P02 | 15min | 3 tasks | 9 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Use a side-by-side experimental `cursor-sdk` provider instead of replacing Cursor ACP.
- Limit v1 modes to Sandbox and YOLO; avoid a generic Agent mode.
- Treat SDK interactive approval and local Cursor login reuse as out of scope until Cursor exposes stable support.
- `cursor-sdk` uses provider-config `CURSOR_API_KEY` before process env and never inherits `agents.providers.cursor.*`.
- Production Cursor SDK Sandbox support remains unavailable until a verified side-effect-free SDK capability probe exists; injected runtimes can report support.
- [Phase 02]: Cursor SDK persistence stores only non-secret resume metadata while SDK agent id stays in nativeHandle. — Keeps resume handles useful after daemon restart without persisting API keys, env, headers, or raw SDK configuration.
- [Phase 02]: Detailed Cursor SDK assistant, tool, and reasoning stream mapping remains in plan 02-03. — Plan 02-02 owns lifecycle placeholders and terminal events; 02-03 owns full timeline mapping.
- [Phase 02]: Cursor SDK lifecycle maps Sandbox and YOLO to local.sandboxOptions.enabled and rejects unsupported Sandbox before SDK calls. — Preserves fail-closed safety semantics and prevents silent fallback to YOLO when Sandbox is stale or unavailable.
- [Phase 02]: Cursor SDK status, request, user echo, and unknown non-terminal events produce redacted diagnostic metadata but no additional user-visible timeline rows. — Preserves one canonical user row while retaining safe SDK correlation context.
- [Phase 02]: Cursor SDK tool calls are classified only when the SDK name and payload shape are reliable. — Under-specified tools remain generic unknown details with sanitized payload summaries instead of guessed categories.
- [Phase 03]: Cursor SDK provider metadata remains side-by-side with Cursor ACP; experimental status stays in the credential-first description.
- [Phase 03]: Cursor SDK reuses the existing Cursor catalog icon through an app resolver alias instead of adding a new icon component.
- [Phase 03]: Cursor SDK creation defaults use dynamic snapshot modes: Sandbox when present, otherwise YOLO.
- [Phase 03]: Cursor SDK context variants are represented as peer model rows with structured encoded ids; no SDK context or thinking defaults are marked.
- [Phase 03]: Cursor SDK listFeatures calls model discovery directly instead of creating scratch SDK sessions.
- [Phase 03]: Running Cursor SDK model, thinking, and fast changes update local session state and apply only on the next SDK send.
- [Phase 03]: Cursor SDK empty model metadata is surfaced as selector error state, not a synthetic Default model row. — Prevents SDK discovery failures from being masked by generic provider default behavior.
- [Phase 03]: Cursor SDK thinking uses existing composer controls with a neutral Thinking trigger until explicit selection. — Avoids a Cursor SDK-specific UI surface while keeping unset reasoning visible and selectable.
- [Phase 03]: Cursor SDK model and thinking resolution clears stale or invalid selections instead of falling back to SDK defaults or first options. — Preserves explicit user-choice semantics for SDK context and reasoning metadata.
- [Phase 03]: Persisted provider feature values are replaced after metadata refresh so stale Cursor SDK fast selections cannot be replayed into later sends. — Plan 03-04 fast feature pruning
- [Phase 03]: Cursor SDK fast remains a shared AgentFeature toggle with existing composer desktop and compact surfaces; no Cursor SDK-specific feature component was added. — Plan 03-04 composer feature integration
- [Phase 03]: Fast defaults to off by preserving the provider metadata value unless the user explicitly toggles and persists fast_mode. — Plan 03-04 explicit fast toggle semantics
- [Phase 04]: Cursor SDK closeout coverage stays test-only and deterministic; no live CURSOR_API_KEY, network, MCP injection, Ask mode, or new UI surface was introduced. — Plan 04-01 added targeted deterministic tests only, preserving Phase 4 closeout scope and avoiding live provider dependencies.
- [Phase 04]: Cursor SDK app selection remains explicit while Cursor ACP keeps existing default fallback behavior. — Tests now lock Cursor SDK explicit model/thinking semantics separately from Cursor ACP default selector behavior.
- [Phase 04]: Cursor SDK documentation and verification close the milestone without expanding scope into credential storage, cloud runtime, MCP injection, Ask mode, or new UI surfaces. — Plan 04-02 completed provider docs, final focused verification, and closeout state.
- [Phase 04]: Final verification evidence records deterministic targeted tests plus format, typecheck, and lint inside the devcontainer. — Plan 04-02 verification artifact

### Pending Todos

None yet.

### Blockers/Concerns

- Cursor SDK is public beta, so the implementation must stay isolated from Cursor ACP and preserve redacted diagnostics.
- SDK authentication requires `CURSOR_API_KEY`; local Cursor app or CLI login reuse is not assumed.
- No stable SDK host approval API is known, so v1 should not promise Ask mode.
- Current devcontainer does not support Cursor SDK Sandbox; the provider must fail closed instead of downgrading Sandbox to YOLO.
- Cursor SDK model discovery depends on external Cursor API/account availability and should remain explicit UAT or real-smoke evidence, not a default deterministic test gate.

## Deferred Items

| Category | Item                                        | Status   | Deferred At  |
| -------- | ------------------------------------------- | -------- | ------------ |
| Future   | Cursor SDK cloud runtime                    | Deferred | Project init |
| Future   | SDK custom tools and richer MCP wiring      | Deferred | Project init |
| Future   | Interactive approval if SDK support appears | Deferred | Project init |

## Session Continuity

Last session: 2026-06-14T09:28:04.847Z
Stopped at: Phase 4 executed and verified
Resume file: .planning/milestones/v1.0-phases/04-hardening-tests-and-docs/04-MILESTONE-SUMMARY.md

## Operator Next Steps

- Start the next milestone with /gsd-new-milestone
