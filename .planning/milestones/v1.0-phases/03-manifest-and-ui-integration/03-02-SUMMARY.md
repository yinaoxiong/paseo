---
phase: 03-manifest-and-ui-integration
plan: "02"
subsystem: provider-runtime
tags: [cursor-sdk, models, thinking, fast-mode, provider-snapshots]

requires:
  - phase: 03-manifest-and-ui-integration
    provides: Cursor SDK provider identity, icon aliasing, and dynamic Sandbox/YOLO mode defaults
provides:
  - Cursor SDK model expansion from SDK metadata into reversible Paseo model rows
  - Cursor SDK thinking/reasoning and fast feature discovery without scratch sessions
  - Next-turn SDK send parameter assembly for model, context, thinking, and fast selections
affects:
  [
    03-manifest-and-ui-integration,
    04-hardening-tests-and-docs,
    composer-controls,
    provider-snapshots,
  ]

tech-stack:
  added: []
  patterns:
    - SDK metadata is decoded through structured URL-safe model option ids and validated against current discovery results before send.
    - Cursor SDK feature discovery uses client-level listFeatures backed by Cursor.models.list, avoiding scratch agent sessions.

key-files:
  created:
    - packages/server/src/server/agent/providers/cursor-sdk/model-options.ts
    - packages/server/src/server/agent/providers/cursor-sdk/model-options.test.ts
    - .planning/phases/03-manifest-and-ui-integration/03-02-SUMMARY.md
  modified:
    - packages/server/src/server/agent/providers/cursor-sdk/sdk-runtime.ts
    - packages/server/src/server/agent/providers/cursor-sdk-agent.ts
    - packages/server/src/server/agent/providers/cursor-sdk-agent.test.ts
    - packages/server/src/server/agent/providers/cursor-sdk/model-options.ts

key-decisions:
  - "Cursor SDK context variants are represented as peer model rows with structured encoded ids; no SDK context or thinking defaults are marked."
  - "Cursor SDK listFeatures calls model discovery directly instead of creating scratch SDK sessions."
  - "Running Cursor SDK model, thinking, and fast changes update local session state and apply only on the next SDK send."

patterns-established:
  - "Provider SDK parameter helpers stay pure and SDK-import-free; runtime adapters pass discovered metadata in."
  - "Cursor SDK raw model ids remain accepted for existing simple selections, while encoded ids carry context parameter selections."

requirements-completed: [FEAT-01, FEAT-02, FEAT-03, UI-02, UI-03]

duration: 25min
completed: 2026-06-13
---

# Phase 03 Plan 02: Model and Feature Discovery Summary

**Cursor SDK models, context variants, thinking options, and fast mode now flow from SDK discovery into provider snapshots and next-turn send params**

## Performance

- **Duration:** 25 min
- **Started:** 2026-06-13T15:53:00Z
- **Completed:** 2026-06-13T16:17:49Z
- **Tasks:** 2
- **Files modified:** 5 source/test files plus this summary

## Accomplishments

- Added a pure `model-options.ts` helper that expands SDK model metadata into stable, reversible Paseo rows while preserving raw SDK parameter ids and values.
- Wired `CursorSdkAgentClient.listModels` and `listFeatures` to use `runtime.listModels({ apiKey })` and reject empty SDK discovery before registry model metadata can mask it.
- Added running-session state for model, thinking, and `fast_mode` so changes are applied to the next `sdkAgent.send` without interrupting or restarting active runs.

## Task Commits

Each task was committed atomically:

1. **Task 1 RED: Create Cursor SDK model option helper tests** - `6588b981` (test)
2. **Task 1 GREEN: Implement Cursor SDK model option helper** - `974a9efe` (feat)
3. **Task 2: Wire SDK discovery, feature discovery, and next-turn send params** - `aa3cf64a` (feat)

**Plan metadata:** recorded in the final docs commit.

## Files Created/Modified

- `packages/server/src/server/agent/providers/cursor-sdk/model-options.ts` - Pure helper for model/context expansion, structured id decode, thinking options, fast features, and SDK `ModelSelection` assembly.
- `packages/server/src/server/agent/providers/cursor-sdk/model-options.test.ts` - TDD coverage for context rows, ordering, reversible ids, raw values, no defaults, fast behavior, and stale/tampered rejection.
- `packages/server/src/server/agent/providers/cursor-sdk/sdk-runtime.ts` - Widened runtime model metadata to preserve SDK `aliases`, `parameters`, and `variants`.
- `packages/server/src/server/agent/providers/cursor-sdk-agent.ts` - Wired SDK metadata discovery, empty-list errors, client-level feature discovery, create/resume/send decoded model params, and live next-turn state updates.
- `packages/server/src/server/agent/providers/cursor-sdk-agent.test.ts` - Covered SDK discovery API-key use, no scratch feature discovery, empty discovery errors, and next-turn send params without restart/interrupt.

## Decisions Made

- Used structured URL-safe JSON payloads for Cursor SDK model and thinking option ids instead of delimiter-based ids.
- Accepted exact raw SDK model ids for existing/simple selections, while requiring discovered SDK metadata for encoded context, thinking, and fast selections.
- Kept `fast_mode` off by default and sent `fast=true` only when the selected SDK model exposes that raw SDK parameter value.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed decoded SDK model selection double-wrapping**

- **Found during:** Task 2 (Wire SDK discovery, feature discovery, and next-turn send params)
- **Issue:** The first integration pass wrapped a decoded SDK `ModelSelection` as `{ id: selection }`, producing an invalid SDK model option.
- **Fix:** Passed the decoded `ModelSelection` directly into `AgentOptions.model`.
- **Files modified:** `packages/server/src/server/agent/providers/cursor-sdk-agent.ts`
- **Verification:** Targeted Cursor SDK provider tests passed.
- **Committed in:** `aa3cf64a`

---

**Total deviations:** 1 auto-fixed (1 Rule 1)
**Impact on plan:** The fix was required for correct SDK send/create params and did not expand scope.

## Issues Encountered

- The first host-side RED commit attempt ran hooks outside the devcontainer and failed because host dependencies are intentionally absent. Commits were rerun inside container `79ef2ffc505c`, where hooks passed.
- Commit hooks caught formatting/type/lint issues in the new helper and integration code before commits landed; each was fixed and revalidated.

## Authentication Gates

None.

## Known Stubs

None. Stub scan found only test fixtures, empty arrays in fakes, and normal nullable runtime state.

## User Setup Required

None - no external service configuration required.

## Validation

- `docker exec 79ef2ffc505c bash -lc 'cd /workspaces/paseo && npx vitest run packages/server/src/server/agent/providers/cursor-sdk/model-options.test.ts --bail=1'` - passed during Task 1 GREEN.
- `docker exec 79ef2ffc505c bash -lc 'cd /workspaces/paseo && npx vitest run packages/server/src/server/agent/providers/cursor-sdk/model-options.test.ts packages/server/src/server/agent/providers/cursor-sdk-agent.test.ts --bail=1'` - passed (2 files, 34 tests).
- `docker exec 79ef2ffc505c bash -lc 'cd /workspaces/paseo && npm run build:server'` - passed.
- `docker exec 79ef2ffc505c bash -lc 'cd /workspaces/paseo && npm run format'` - passed.
- `docker exec 79ef2ffc505c bash -lc 'cd /workspaces/paseo && npm run typecheck'` - passed.
- `docker exec 79ef2ffc505c bash -lc 'cd /workspaces/paseo && npm run lint'` - passed.

## TDD Gate Compliance

- RED gate commit present: `6588b981`
- GREEN gate commit present after RED: `974a9efe`
- Refactor gate: not needed; no separate cleanup commit was required after GREEN.

## Next Phase Readiness

Plan 03-03 can consume Cursor SDK snapshot rows as distinct model/context options with thinking metadata attached. The server now exposes fast metadata through existing feature plumbing, but app-side preference pruning and composer integration remain for Plan 03-04 as planned.

## Self-Check: PASSED

- Verified key created and modified files exist.
- Verified task commits `6588b981`, `974a9efe`, and `aa3cf64a` exist in git history.
- Verified no accidental tracked file deletions occurred in task commits.
- Verified final targeted tests, `build:server`, format, typecheck, and lint passed in the devcontainer.

---

_Phase: 03-manifest-and-ui-integration_
_Completed: 2026-06-13_
