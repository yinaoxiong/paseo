---
phase: 02-direct-provider-core
plan: 02
subsystem: provider-core
tags: [cursor-sdk, lifecycle, persistence, cancellation, sandbox, yolo, tdd]

requires:
  - phase: 02-direct-provider-core/02-01
    provides: Experimental `cursor-sdk` provider boundary, diagnostics, runtime seam, Sandbox/YOLO modes, and registry wiring
provides:
  - SDK-backed `CursorSdkAgentSession` create/resume lifecycle
  - Strict secret-free Cursor SDK persistence handles
  - Provider/session-scoped JSONL store path helpers
  - SDK run cancellation and idempotent session cleanup
affects: [02-direct-provider-core, cursor-sdk-stream-mapping, provider-persistence]

tech-stack:
  added: []
  patterns:
    - Injectable Cursor SDK runtime adapter with `createJsonlStore`, `createAgent`, and `resumeAgent`
    - Strict zod resume metadata plus path containment before store construction
    - Lifecycle-only SDK stream pump with detailed event mapping deferred to 02-03

key-files:
  created:
    - packages/server/src/server/agent/providers/cursor-sdk/persistence.ts
    - packages/server/src/server/agent/providers/cursor-sdk/persistence.test.ts
  modified:
    - packages/server/src/server/agent/providers/cursor-sdk-agent.ts
    - packages/server/src/server/agent/providers/cursor-sdk-agent.test.ts
    - packages/server/src/server/agent/providers/cursor-sdk/diagnostics.ts
    - packages/server/src/server/agent/providers/cursor-sdk/sdk-runtime.ts

key-decisions:
  - "Cursor SDK persistence stores only `runtime`, `cwd`, `storePath`, `model`, `modeId`, and `sandboxEnabled`; SDK agent id stays in `nativeHandle`."
  - "Session lifecycle maps Sandbox/YOLO to `local.sandboxOptions.enabled` and rejects unsupported Sandbox before SDK resume/create."
  - "Plan 02-02 emits lifecycle terminal events only; detailed assistant/tool/reasoning SDK stream mapping remains owned by 02-03."

patterns-established:
  - "Cursor SDK store paths are derived from `$PASEO_HOME/providers/cursor-sdk/stores/{paseoSessionId}` and validated with lexical and realpath containment."
  - "Create and resume repeat readiness/key/mode preflight immediately before SDK calls."
  - 'Interrupt checks `run.supports("cancel")` before calling `run.cancel()` and reports unsupported cancel without claiming success.'

requirements-completed: [PROV-02, PROV-04, PROV-05, MODE-01, MODE-02]

duration: 24min
completed: 2026-06-13
---

# Phase 02 Plan 02: Cursor SDK Session Lifecycle Summary

**SDK-backed Cursor local sessions with strict secret-free resume handles, controlled JSONL stores, Sandbox/YOLO lifecycle options, and SDK run cancellation**

## Performance

- **Duration:** 24 min
- **Started:** 2026-06-13T10:26:00Z
- **Completed:** 2026-06-13T10:49:46Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments

- Added strict Cursor SDK persistence helpers with zod validation, secret-free metadata, `nativeHandle` SDK agent id handling, and provider/session-scoped JSONL store path containment.
- Implemented `CursorSdkAgentSession` backed by the injectable runtime for create, resume, `run()`, `startTurn()`, `describePersistence()`, `interrupt()`, and idempotent `close()`.
- Added production runtime support for `JsonlLocalAgentStore` creation under controlled store paths.
- Added focused TDD coverage for missing/tampered metadata, path traversal, symlink escapes, secret-shaped metadata, create/resume options, explicit override failure, unsupported Sandbox resume, cancellation, and cleanup.

## Task Commits

1. **Task 1 RED: Cursor SDK persistence tests** - `37bfbf53` (`test`)
2. **Task 1 GREEN: Cursor SDK persistence helpers** - `fa5a2409` (`feat`)
3. **Task 2 RED: Cursor SDK lifecycle tests** - `ee66d85d` (`test`)
4. **Task 2 GREEN: Cursor SDK session lifecycle** - `f70ad384` (`feat`)

**Plan metadata:** pending final docs commit

## Files Created/Modified

- `packages/server/src/server/agent/providers/cursor-sdk/persistence.ts` - Strict resume metadata schema, persistence handle builder/parser, and controlled store path validation.
- `packages/server/src/server/agent/providers/cursor-sdk/persistence.test.ts` - Path, metadata, secret hygiene, and sandbox/mode consistency tests.
- `packages/server/src/server/agent/providers/cursor-sdk-agent.ts` - SDK-backed client create/resume lifecycle and session implementation.
- `packages/server/src/server/agent/providers/cursor-sdk-agent.test.ts` - Lifecycle, override, cancellation, and cleanup tests.
- `packages/server/src/server/agent/providers/cursor-sdk/diagnostics.ts` - Added safe validation and cancellation diagnostic codes.
- `packages/server/src/server/agent/providers/cursor-sdk/sdk-runtime.ts` - Added production JSONL store creation.
- `packages/server/src/server/agent/providers/cursor-sdk/modes.ts` - Verified unchanged mode semantics through formatting and tests.

## Decisions Made

- Kept detailed SDK assistant/tool/reasoning stream mapping out of this plan; `startTurn()` emits canonical user rows and terminal lifecycle events only.
- Used `launchContext.agentId` as the Paseo session id for controlled store paths, falling back to a generated UUID when absent.
- On resume, explicit model/mode overrides are passed directly to SDK resume options; SDK failures are surfaced without fallback to persisted mode, YOLO, or default model.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed symlink containment validation**

- **Found during:** Task 1 (persistence GREEN)
- **Issue:** The first realpath implementation canonicalized the expected session path through a symlink, allowing a symlinked session store root to appear valid.
- **Fix:** Kept the controlled session root as a lexical boundary and also compared real candidate paths against it.
- **Files modified:** `packages/server/src/server/agent/providers/cursor-sdk/persistence.ts`
- **Verification:** `persistence.test.ts` symlink escape test passed.
- **Committed in:** `fa5a2409`

**2. [Rule 1 - Bug] Fixed type narrowing caught by commit hooks**

- **Found during:** Task 1 GREEN commit
- **Issue:** `isMissingPathError()` used `Boolean(error)`, which did not narrow `unknown` away from `null` under `tsgo`.
- **Fix:** Replaced the check with `error !== null`.
- **Files modified:** `packages/server/src/server/agent/providers/cursor-sdk/persistence.ts`
- **Verification:** Pre-commit typecheck passed.
- **Committed in:** `fa5a2409`

---

**Total deviations:** 2 auto-fixed (Rule 1)
**Impact on plan:** Both fixes were correctness hardening inside planned persistence behavior; no scope expansion.

## Issues Encountered

- Task 2 RED commit initially failed lint because the fake store test harness used a type alias where repo rules require interfaces. Converted it to an interface before committing.
- Task 2 implementation initially probed Sandbox support twice in create/resume paths. Reused the cached support result so preflight remains one operation-scoped check.

## Verification

- `devcontainer exec --workspace-folder /mnt/private_yax_qy4/projects/paseo npx vitest run packages/server/src/server/agent/providers/cursor-sdk-agent.test.ts packages/server/src/server/agent/providers/cursor-sdk/persistence.test.ts --bail=1` - passed, 24 tests.
- `devcontainer exec --workspace-folder /mnt/private_yax_qy4/projects/paseo npm run format:files -- packages/server/src/server/agent/providers/cursor-sdk-agent.ts packages/server/src/server/agent/providers/cursor-sdk/diagnostics.ts packages/server/src/server/agent/providers/cursor-sdk/modes.ts packages/server/src/server/agent/providers/cursor-sdk/persistence.ts packages/server/src/server/agent/providers/cursor-sdk/persistence.test.ts packages/server/src/server/agent/providers/cursor-sdk/sdk-runtime.ts packages/server/src/server/agent/providers/cursor-sdk-agent.test.ts` - passed.
- `devcontainer exec --workspace-folder /mnt/private_yax_qy4/projects/paseo npm run typecheck` - passed.
- `devcontainer exec --workspace-folder /mnt/private_yax_qy4/projects/paseo npm run lint` - passed.
- `rg -n "nativeHandle|storePath|sandboxEnabled|JsonlLocalAgentStore|supports\\(\"cancel\"\\)|CURSOR_API_KEY" packages/server/src/server/agent/providers/cursor-sdk-agent.ts packages/server/src/server/agent/providers/cursor-sdk` - found expected lifecycle/persistence markers.
- `rg -n "agents\\.providers\\.cursor\\.|local\\.autoReview|cloud|Ask mode" packages/server/src/server/agent/providers/cursor-sdk-agent.ts packages/server/src/server/agent/providers/cursor-sdk` - no matches.

## Known Stubs

None. Detailed SDK assistant/tool/reasoning stream mapping is intentionally deferred to plan 02-03 and does not block this plan's lifecycle/persistence goal.

## Threat Flags

None - new trust-boundary surfaces were already covered by the plan threat model: persistence handle parsing, local store path validation, config/env API key use, model/mode overrides, SDK run cancellation, and cleanup.

## User Setup Required

None for deterministic tests. Live Cursor SDK sessions still require `CURSOR_API_KEY` via `agents.providers.cursor-sdk.env.CURSOR_API_KEY` in `$PASEO_HOME/config.json` or daemon process env.

## Next Phase Readiness

Plan 02-03 can build on `CursorSdkAgentSession.startTurn()` and the active SDK `Run` pump to map assistant, reasoning, tool, usage, and richer terminal events into Paseo timeline rows.

## TDD Gate Compliance

- RED commits present: `37bfbf53`, `ee66d85d`
- GREEN commits present after RED: `fa5a2409`, `f70ad384`
- Refactor commits: none

## Self-Check: PASSED

- Found summary file: `.planning/phases/02-direct-provider-core/02-02-SUMMARY.md`
- Found task commits: `37bfbf53`, `fa5a2409`, `ee66d85d`, `f70ad384`
- No unexpected tracked file deletions detected in task commits.

---

_Phase: 02-direct-provider-core_
_Completed: 2026-06-13_
