---
phase: 01-sdk-viability-spike
plan: 01-01
subsystem: provider-spike
tags: [cursor-sdk, sdk, provider, lifecycle, auth]

requires: []
provides:
  - Cursor SDK server dependency and import evidence
  - Phase-local SDK lifecycle probe scripts
  - Redacted auth/config, lifecycle, cancellation, resume, and verification result JSON
affects: [01-02, phase-02-direct-provider-core, cursor-sdk-provider]

tech-stack:
  added: ["@cursor/sdk@1.0.18"]
  patterns:
    - "Phase-local spike scripts write redacted JSON evidence under results/"
    - "Live SDK calls are confined to disposable scratch git repositories"

key-files:
  created:
    - .planning/phases/01-sdk-viability-spike/scripts/cursor-sdk-spike-utils.ts
    - .planning/phases/01-sdk-viability-spike/scripts/check-import.ts
    - .planning/phases/01-sdk-viability-spike/scripts/probe-sdk-errors.ts
    - .planning/phases/01-sdk-viability-spike/scripts/lifecycle-create-send-wait.ts
    - .planning/phases/01-sdk-viability-spike/scripts/lifecycle-cancel.ts
    - .planning/phases/01-sdk-viability-spike/scripts/lifecycle-resume-create.ts
    - .planning/phases/01-sdk-viability-spike/scripts/lifecycle-resume-followup.ts
    - .planning/phases/01-sdk-viability-spike/results/*.json
  modified:
    - packages/server/package.json
    - package-lock.json

key-decisions:
  - "Keep this plan as a spike only; no production cursor-sdk provider files were modified."
  - "Record missing CURSOR_API_KEY as blocked evidence instead of asking for credentials."
  - "Treat @cursor/sdk import/native dependency behavior as a Phase 1 finding for 01-02."

patterns-established:
  - "SDK probe results include providerImpact so 01-02 can translate evidence into proceed/adjust/stop guidance."
  - "Provider-config API key lookup checks $PASEO_HOME/config.json before process.env."

requirements-completed: [SDK-01, SDK-02, SDK-03]

duration: 18 min
completed: 2026-06-13
---

# Phase 01 Plan 01-01: Run and Document SDK Local Lifecycle Experiments Summary

**Cursor SDK installed in the server workspace with redacted spike harness evidence and blocked live lifecycle results due absent credentials**

## Performance

- **Duration:** 18 min
- **Started:** 2026-06-13T07:27:00Z
- **Completed:** 2026-06-13T07:45:23Z
- **Tasks:** 5 completed
- **Files modified:** 17

## Accomplishments

- Added `@cursor/sdk@1.0.18` to `@getpaseo/server` via npm inside the devcontainer.
- Created phase-local TypeScript probes for import, auth/config errors, create/send/stream/wait, cancellation, and cross-process resume.
- Captured redacted JSON evidence for every planned experiment. Live lifecycle probes were explicitly recorded as `blocked` because `CURSOR_API_KEY` was absent.
- Ran final formatting, typecheck, lint, and secret scans. No raw API key values were found in scripts/results.

## Task Commits

Each task was committed atomically:

1. **T1: Add Cursor SDK dependency** - `e0e87edf`
2. **T2: Create shared utilities, import probe, and error probe** - `d2c7a62c`
3. **T3: Probe create/send/stream/wait and Sandbox/YOLO mappings** - `fee2d0f4`
4. **T4: Probe cancellation and cross-process resume** - `18e3bd08`
5. **T5: Run bounded verification and preserve evidence** - `9d8898a4`

**Plan metadata:** this SUMMARY commit

## Files Created/Modified

- `packages/server/package.json` - Added `@cursor/sdk` under server dependencies.
- `package-lock.json` - npm-generated SDK dependency graph.
- `.planning/phases/01-sdk-viability-spike/scripts/*.ts` - Reusable spike harness and lifecycle probes.
- `.planning/phases/01-sdk-viability-spike/results/*.json` - Redacted machine-readable evidence for 01-02.

## Decisions Made

- The installed SDK imports only after native `sqlite3` bindings exist. The initial `--ignore-scripts` install left the binding missing; `npm rebuild sqlite3` repaired the import path. This is recorded in `results/import.json`.
- Missing `CURSOR_API_KEY` is not an execution failure for this autonomous plan. Every affected live probe writes `status: "blocked"` plus `providerImpact`.
- The spike did not modify `packages/server/src/server/agent/provider-registry.ts`, `packages/protocol/src/provider-manifest.ts`, or any production provider implementation.

## Deviations from Plan

None - plan executed within the documented auth/dependency fallback boundaries.

## Issues Encountered

- `check-import.ts` initially failed because `@cursor/sdk` loaded `sqlite3` and the native binding was absent after `npm install --ignore-scripts`. Fixed by running `npm rebuild sqlite3` inside the devcontainer and recording the lifecycle-script risk.
- `CURSOR_API_KEY` was absent. Live create/send/stream/wait, cancellation, resume-create, resume-followup, and invalid-model probes are blocked with redacted evidence.
- The full phase secret scan matches regex examples embedded in the PLAN files. Scripts/results scan cleanly, and `results/verification.json` records those plan-file matches as false positives only.

## User Setup Required

None - no external service configuration was changed. Live SDK validation still requires a future run with `CURSOR_API_KEY` available.

## Next Phase Readiness

Ready for `01-02`: it can consume the result JSON to decide whether to proceed, adjust, or stop. Key facts for 01-02:

- Install/import viability is positive after native binding rebuild.
- Auth/config surfaces are observable: missing key returns `ConfigurationError`; invalid key returns `AuthenticationError` with HTTP 401.
- Local lifecycle, cancel, and resume behavior remain live-blocked until credentials are present.

## Self-Check: PASSED

- All five tasks executed or wrote explicit blocked evidence.
- Each task has an atomic commit.
- Production provider files were not modified.
- Formatting, typecheck, lint, and scripts/results secret scan passed.

---

_Phase: 01-sdk-viability-spike_
_Completed: 2026-06-13_
