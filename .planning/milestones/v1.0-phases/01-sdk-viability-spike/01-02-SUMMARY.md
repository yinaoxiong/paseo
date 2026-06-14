---
phase: 01-sdk-viability-spike
plan: 01-02
subsystem: provider-spike
tags: [cursor-sdk, provider, persistence, diagnostics, modes]

requires:
  - phase: 01-01
    provides: [Cursor SDK dependency/import evidence, redacted lifecycle probe results]
provides:
  - Evidence-backed Cursor SDK spike recommendation
  - Phase 2 provider persistence, state, diagnostics, mode, cancellation, resume, and disposal guidance
  - Scope fences preserving Cursor ACP and production provider files
affects: [phase-02-direct-provider-core, phase-03-manifest-and-ui-integration, cursor-sdk-provider]

tech-stack:
  added: []
  patterns:
    - "Translate blocked credential-dependent SDK probes into adjusted-scope provider guidance."
    - "Keep provider resume metadata secret-free and provider-scoped under PASEO_HOME."

key-files:
  created:
    - .planning/phases/01-sdk-viability-spike/01-02-SUMMARY.md
  modified:
    - .planning/phases/01-sdk-viability-spike/01-SPIKE-RESULTS.md

key-decisions:
  - "Recommendation is Adjust scope because live lifecycle evidence is blocked by missing Cursor API key."
  - "SDK agentId belongs in AgentPersistenceHandle.nativeHandle; metadata carries only non-secret resume context."
  - "Sandbox and YOLO are the only v1 modes; local.autoReview is not a mode or security boundary."

patterns-established:
  - "Spike conclusions distinguish startup/config/auth SDK throws from in-run terminal statuses."
  - "Model discovery guidance uses Cursor.models.list() and avoids empty local SDK sessions."
  - "Phase 1 design artifacts explicitly fence off provider registry, manifest, provider implementation, UI, and secret storage edits."

requirements-completed: [SDK-02, SDK-03]

duration: 11 min
completed: 2026-06-13
---

# Phase 01 Plan 01-02: Design Provider State, Persistence, Error Mapping, and Mode Mapping Summary

**Cursor SDK provider handoff with Adjust scope recommendation due credential-blocked live lifecycle evidence**

## Performance

- **Duration:** 11 min
- **Started:** 2026-06-13T07:49:00Z
- **Completed:** 2026-06-13T07:59:56Z
- **Tasks:** 5 completed
- **Files modified:** 2

## Accomplishments

- Created `01-SPIKE-RESULTS.md` with exact `Adjust scope` recommendation and evidence matrix referencing every 01-01 result JSON.
- Documented Phase 2 persistence handle shape, SDK store convention, future client/session responsibilities, error mapping, availability, model discovery, mode mapping, cancellation, resume, disposal, and scope fences.
- Preserved the key spike boundary: missing `CURSOR_API_KEY` blocks live lifecycle evidence and must not be overstated as SDK viability.
- Ran final format, typecheck, lint, coverage, secret-scan, and production-provider diff checks.

## Task Commits

Each task was committed atomically:

1. **T1: Aggregate redacted evidence into the spike conclusion** - `c165d9c8`
2. **T2: Document persistence handle and provider state guidance for Phase 2** - `478f68b3`
3. **T3: Document SDK error mapping, availability, and model discovery guidance** - `f137f45e`
4. **T4: Document mode mapping, cancellation/resume/disposal, and Phase 2 scope fences** - `04bd39c6`
5. **T5: Run final documentation and coverage verification** - `67aa5710`

**Plan metadata:** this SUMMARY commit

## Files Created/Modified

- `.planning/phases/01-sdk-viability-spike/01-SPIKE-RESULTS.md` - Human-readable spike conclusion and Phase 2 provider design handoff.
- `.planning/phases/01-sdk-viability-spike/01-02-SUMMARY.md` - This plan close-out summary.

## Decisions Made

- `Adjust scope` is the final recommendation: dependency/import and auth/config evidence are useful, but create/send/stream/wait/cancel/resume remain blocked by missing credentials.
- Phase 2 should store SDK `agentId` in `AgentPersistenceHandle.nativeHandle`; metadata is limited to `runtime`, `cwd`, `storePath`, `model`, `modeId`, and `sandboxEnabled`.
- Production store convention is `${PASEO_HOME}/providers/cursor-sdk/stores/{paseoSessionId}`.
- `local.autoReview` is not a v1 mode and not a security boundary; v1 exposes only Sandbox and YOLO.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- An initial host-side `git commit` attempt for T1 failed because pre-commit hooks could not find devcontainer-only tools (`oxfmt` and `tsgo`). The commit was retried normally inside the devcontainer with hooks enabled and passed.
- Final coverage verification initially showed the document covered D-01 through D-20 but did not include literal `SDK-02` and `SDK-03` strings. T5 added a verification section and reran checks successfully.

## User Setup Required

None - no external service configuration was changed. Live SDK lifecycle validation still requires a future credentialed run with Cursor API key availability.

## Verification

- `npm run format:files -- .planning/phases/01-sdk-viability-spike/01-SPIKE-RESULTS.md` inside devcontainer: passed.
- `npm run typecheck` inside devcontainer: passed.
- `npm run lint` inside devcontainer: passed.
- Coverage `rg` for `SDK-02`, `SDK-03`, and D-01 through D-20: passed after T5 update.
- Secret scan for raw key assignments/token-shaped values in `01-SPIKE-RESULTS.md`: no matches.
- `git diff -- packages/server/src/server/agent/provider-registry.ts packages/protocol/src/provider-manifest.ts packages/server/src/server/agent/providers`: no diff.
- Full test suite: not run, per docs/design plan constraints.

## Next Phase Readiness

Ready for Phase 2 planning with a narrower implementation stance: build the experimental local provider around documented persistence and diagnostics, but keep live lifecycle success criteria gated until a credentialed SDK run proves create/send/stream/wait/cancel/resume.

## Self-Check: PASSED

- All five 01-02 tasks completed and committed.
- `01-SPIKE-RESULTS.md` includes `## SPIKE RESULTS COMPLETE`.
- Final recommendation is exactly `Adjust scope`.
- Production provider registry, manifest, provider files, app UI, and secret storage remain unmodified by this plan.

---

_Phase: 01-sdk-viability-spike_
_Completed: 2026-06-13_
