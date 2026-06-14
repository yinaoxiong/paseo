---
phase: 02-direct-provider-core
plan: 03
subsystem: provider-core
tags: [cursor-sdk, stream-mapping, timeline, diagnostics, tdd]

requires:
  - phase: 02-direct-provider-core/02-02
    provides: SDK-backed Cursor session lifecycle, persistence handles, controlled JSONL stores, and cancellation state
provides:
  - Conservative Cursor SDK stream event mapper for assistant, reasoning, tool, status, request, run, and unknown events
  - Canonical Cursor SDK Paseo timeline behavior with exactly one daemon-owned user row per accepted prompt
  - Deterministic Cursor SDK terminal status mapping for finished, cancelled, error, and unknown outcomes
affects: [02-direct-provider-core, provider-timeline, cursor-sdk-hardening]

tech-stack:
  added: []
  patterns:
    - Permissive zod guards for beta SDK stream event shapes with redacted diagnostics for unknowns
    - Provider-owned canonical user message ids emitted before SDK stream echoes
    - Pure terminal status mapper shared by session stream pump and unit tests

key-files:
  created:
    - packages/server/src/server/agent/providers/cursor-sdk/event-mapper.ts
    - packages/server/src/server/agent/providers/cursor-sdk/event-mapper.test.ts
  modified:
    - packages/server/src/server/agent/providers/cursor-sdk-agent.ts
    - packages/server/src/server/agent/providers/cursor-sdk-agent.test.ts
    - packages/server/src/server/agent/providers/cursor-sdk/diagnostics.ts

key-decisions:
  - "Cursor SDK status, request, user echo, and unknown non-terminal events produce redacted diagnostic metadata but no additional user-visible timeline rows."
  - "Cursor SDK tool calls are classified into Paseo tool details only when the name and payload shape are reliable; otherwise they remain generic unknown tool details with sanitized payload summaries."
  - "Cursor SDK terminal statuses are mapped through one pure helper: finished completes, cancelled cancels, and error or unknown statuses fail with redacted diagnostics."

patterns-established:
  - "CursorSdkAgentSession.startTurn emits one canonical `user_message` immediately after accepting the prompt, using `options.messageId` or a stable local `cursor-sdk-user-{turnId}` id."
  - "Cursor SDK stream mapping is isolated in `cursor-sdk/event-mapper.ts`; session code only pumps mapped events and terminal outcomes."
  - "Non-terminal SDK diagnostics carry operation, event type, run id, request id, status, and code without serializing raw prompts, headers, env, or large tool payloads."

requirements-completed: [PROV-03, PROV-05]

duration: 16min
completed: 2026-06-13
---

# Phase 02 Plan 03: Cursor SDK Stream Timeline Summary

**Conservative Cursor SDK stream mapping with daemon-owned canonical user rows, redacted diagnostics, and deterministic terminal lifecycle events**

## Performance

- **Duration:** 16 min
- **Started:** 2026-06-13T10:56:54Z
- **Completed:** 2026-06-13T11:12:20Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Added `mapCursorSdkStreamEvent`, `mapCursorSdkTerminalStatus`, and `mapCursorSdkToolCall` with permissive zod parsing for beta SDK message shapes.
- Mapped assistant text, thinking/reasoning, reliable tool calls, status/request/run correlation, SDK user echoes, unknown non-terminal events, and terminal outcomes into Paseo stream events or redacted diagnostics.
- Wired `CursorSdkAgentSession.startTurn()` to emit exactly one canonical `user_message` before SDK echoes, pump SDK stream events through the mapper, and finish turns through the terminal mapper.
- Expanded deterministic tests for mapper behavior, canonical user row dedupe, runProviderTurn final text, cancellation, terminal failures, and unknown-event tolerance.

## Task Commits

1. **Task 1 RED: Cursor SDK event mapper tests** - `8f19768f` (`test`)
2. **Task 1 GREEN: Cursor SDK event mapper** - `1b6e6488` (`feat`)
3. **Task 2 RED: Cursor SDK session stream tests** - `698c5d8e` (`test`)
4. **Task 2 GREEN: Cursor SDK session stream wiring** - `34ead0c2` (`feat`)

**Plan metadata:** pending final docs commit

## Files Created/Modified

- `packages/server/src/server/agent/providers/cursor-sdk/event-mapper.ts` - Pure SDK stream/terminal/tool mapping helpers with redacted diagnostics.
- `packages/server/src/server/agent/providers/cursor-sdk/event-mapper.test.ts` - Focused mapper coverage for assistant, reasoning, tool, status, user echo, malformed unknown, and terminal mappings.
- `packages/server/src/server/agent/providers/cursor-sdk-agent.ts` - `startTurn()` canonical user row ids and SDK stream/wait pump wiring.
- `packages/server/src/server/agent/providers/cursor-sdk-agent.test.ts` - Lifecycle stream coverage for canonical user rows, mapped SDK events, final run text, cancellation, and terminal failures.
- `packages/server/src/server/agent/providers/cursor-sdk/diagnostics.ts` - Added safe event type/status/code diagnostic fields.

## Decisions Made

- Kept SDK user echoes diagnostic-only; they never create `user_message` timeline rows.
- Used sanitized unknown tool details instead of guessing under-specified SDK tools into read/edit/shell/search categories.
- Stored recent non-terminal stream diagnostics in the session only as safe context; terminal failures still use deterministic terminal status diagnostics.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Split mapper tool-detail construction to satisfy lint**

- **Found during:** Task 1 GREEN commit
- **Issue:** The first implementation put all known tool classification in one function, tripping the repo complexity rule and blocking the commit.
- **Fix:** Extracted shell/read/edit/write/search/fetch detail builders and a small search tool-name normalizer.
- **Files modified:** `packages/server/src/server/agent/providers/cursor-sdk/event-mapper.ts`
- **Verification:** Mapper tests passed; pre-commit lint, format, and typecheck passed.
- **Committed in:** `1b6e6488`

**2. [Rule 1 - Test Bug] Updated cancellation assertion for generated canonical message ids**

- **Found during:** Task 2 GREEN verification
- **Issue:** A Wave 2 cancellation test expected a user timeline item without `messageId`, but 02-03 correctly adds generated canonical ids when `options.messageId` is absent.
- **Fix:** Relaxed the legacy assertion to require the user text/type while allowing the generated message id.
- **Files modified:** `packages/server/src/server/agent/providers/cursor-sdk-agent.test.ts`
- **Verification:** Session and mapper tests passed; pre-commit lint, format, and typecheck passed.
- **Committed in:** `34ead0c2`

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 test bug)
**Impact on plan:** Both fixes stayed inside the planned mapper/session behavior and did not add UI, Ask mode, autoReview, cloud runtime, or Cursor ACP fallback behavior.

## Issues Encountered

- The first Task 1 GREEN commit attempt failed on lint complexity before committing; the implementation was refactored and recommitted normally with hooks.
- A transient stale `.git/index.lock` remained after the failed commit attempt. No git process was active and the lock disappeared before retry, so no manual removal was required.

## Verification

- `devcontainer exec --workspace-folder /mnt/private_yax_qy4/projects/paseo npx vitest run packages/server/src/server/agent/providers/cursor-sdk/event-mapper.test.ts --bail=1` - passed, 7 tests.
- `devcontainer exec --workspace-folder /mnt/private_yax_qy4/projects/paseo npx vitest run packages/server/src/server/agent/providers/cursor-sdk-agent.test.ts packages/server/src/server/agent/providers/cursor-sdk/event-mapper.test.ts --bail=1` - passed, 20 tests.
- `devcontainer exec --workspace-folder /mnt/private_yax_qy4/projects/paseo npm run format:files -- packages/server/src/server/agent/providers/cursor-sdk-agent.ts packages/server/src/server/agent/providers/cursor-sdk/diagnostics.ts packages/server/src/server/agent/providers/cursor-sdk/event-mapper.ts packages/server/src/server/agent/providers/cursor-sdk/event-mapper.test.ts packages/server/src/server/agent/providers/cursor-sdk-agent.test.ts` - passed.
- `devcontainer exec --workspace-folder /mnt/private_yax_qy4/projects/paseo npm run typecheck` - passed.
- `devcontainer exec --workspace-folder /mnt/private_yax_qy4/projects/paseo npm run lint` - passed.
- `rg -n "user_message|assistant_message|reasoning|tool_call|turn_completed|turn_canceled|turn_failed|requestId|runId" packages/server/src/server/agent/providers/cursor-sdk-agent.ts packages/server/src/server/agent/providers/cursor-sdk/event-mapper.ts packages/server/src/server/agent/providers/cursor-sdk/event-mapper.test.ts` - found expected stream/timeline/diagnostic markers.
- `rg -n "raw env|Authorization|CURSOR_API_KEY|local\\.autoReview|Ask mode|ACP" packages/server/src/server/agent/providers/cursor-sdk-agent.ts packages/server/src/server/agent/providers/cursor-sdk/event-mapper.ts` - found only expected `CURSOR_API_KEY` key-resolution/error-message references in `cursor-sdk-agent.ts`; no raw env, Authorization, autoReview, Ask mode, or ACP fallback matches.

## Known Stubs

None. Stub scan over plan-created/modified files found only normal null/default initializers and test arrays, not placeholder UI/data stubs.

## Threat Flags

None - new trust-boundary surfaces were already covered by the plan threat model: SDK stream events to timeline, SDK terminal status to lifecycle, SDK tool payloads to tool details, user prompt to canonical timeline, and diagnostics to logs/snapshots.

## User Setup Required

None for deterministic tests. Live Cursor SDK sessions still require `CURSOR_API_KEY` via `agents.providers.cursor-sdk.env.CURSOR_API_KEY` in `$PASEO_HOME/config.json` or daemon process env.

## Next Phase Readiness

Phase 3 can surface the experimental provider in manifest/UI using the completed direct provider core. Phase 4 can harden docs and broader targeted coverage with the mapper/session seams established here.

## TDD Gate Compliance

- RED commits present: `8f19768f`, `698c5d8e`
- GREEN commits present after RED: `1b6e6488`, `34ead0c2`
- Refactor commits: none

## Self-Check: PASSED

- Found summary file: `.planning/phases/02-direct-provider-core/02-03-SUMMARY.md`
- Found task commits: `8f19768f`, `1b6e6488`, `698c5d8e`, `34ead0c2`
- Found created files: `packages/server/src/server/agent/providers/cursor-sdk/event-mapper.ts`, `packages/server/src/server/agent/providers/cursor-sdk/event-mapper.test.ts`
- No unexpected tracked file deletions detected in task commits.

---

_Phase: 02-direct-provider-core_
_Completed: 2026-06-13_
