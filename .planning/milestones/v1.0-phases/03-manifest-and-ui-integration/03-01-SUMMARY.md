---
phase: 03-manifest-and-ui-integration
plan: "01"
subsystem: provider-ui
tags: [cursor-sdk, provider-manifest, provider-icons, modes, expo, server]

requires:
  - phase: 02-direct-provider-core
    provides: Cursor SDK direct provider runtime, Sandbox/YOLO modes, registry factory, diagnostics
provides:
  - Cursor SDK built-in provider metadata with locked label and credential-first copy
  - Cursor SDK icon alias to the existing Cursor catalog icon
  - Dynamic Cursor SDK create-mode defaults from provider snapshot modes
affects:
  [
    03-manifest-and-ui-integration,
    04-hardening-tests-and-docs,
    provider-selection,
    composer-controls,
  ]

tech-stack:
  added: []
  patterns:
    - Static manifest metadata carries provider copy and mode visuals; dynamic snapshots own availability.
    - App provider icon aliases can route side-by-side providers to existing catalog icons.
    - Cursor SDK creation defaults prefer Sandbox only when snapshot modes expose it.

key-files:
  created:
    - .planning/phases/03-manifest-and-ui-integration/03-01-SUMMARY.md
  modified:
    - packages/protocol/src/provider-manifest.ts
    - packages/app/src/components/provider-icon-name.ts
    - packages/app/src/components/provider-icon-name.test.ts
    - packages/server/src/server/agent/providers/cursor-sdk-agent.ts
    - packages/server/src/server/agent/providers/cursor-sdk-agent.test.ts
    - packages/server/src/server/agent/provider-registry.test.ts

key-decisions:
  - "Cursor SDK provider metadata remains side-by-side with Cursor ACP; experimental status stays in the credential-first description."
  - "Cursor SDK reuses the existing Cursor catalog icon through an app resolver alias instead of adding a new icon component."
  - "Cursor SDK creation defaults use dynamic snapshot modes: Sandbox when present, otherwise YOLO."

patterns-established:
  - "Provider identity tests assert the existing Cursor ACP entry and the new Cursor SDK entry together to prevent accidental collapse."
  - "Mode default logic is scoped to the no-request/no-parent creation path; explicit mode ids still validate through the provider allowlist."

requirements-completed: [MODE-03, UI-01, UI-02, UI-03]

duration: 15min
completed: 2026-06-13
---

# Phase 03 Plan 01: Manifest and UI Integration Summary

**Cursor SDK provider identity, Cursor icon aliasing, and dynamic Sandbox/YOLO creation defaults without changing Cursor ACP behavior**

## Performance

- **Duration:** 15 min
- **Started:** 2026-06-13T15:36:43Z
- **Completed:** 2026-06-13T15:51:04Z
- **Tasks:** 3
- **Files modified:** 6 source/test files plus this summary

## Accomplishments

- Locked `cursor-sdk` provider metadata to label `Cursor SDK` and description `Requires CURSOR_API_KEY. Experimental direct Cursor SDK provider for local agents.`
- Added explicit app icon resolver alias so `cursor-sdk` uses the Cursor catalog icon and does not fall back to `Bot`.
- Updated Cursor SDK create-config defaults to choose `Sandbox` when dynamic snapshot modes include it and `YOLO` when it is the only available mode.
- Added focused regression coverage proving Cursor ACP remains separate and unchanged.

## Task Commits

Each task was committed atomically:

1. **Task 1: Lock provider manifest identity and copy** - `f2b36095` (feat)
2. **Task 2: Alias Cursor SDK to the Cursor brand icon** - `7b0b7e55` (feat)
3. **Task 3: Use dynamic Cursor SDK modes for creation defaults** - `d37c5a7f` (feat)

**Plan metadata:** recorded in the final docs commit.

## Files Created/Modified

- `packages/protocol/src/provider-manifest.ts` - Updated Cursor SDK provider description while preserving separate Cursor ACP metadata and Sandbox/YOLO mode visuals.
- `packages/server/src/server/agent/provider-registry.test.ts` - Added side-by-side Cursor ACP/Cursor SDK metadata assertions.
- `packages/app/src/components/provider-icon-name.ts` - Added `cursor-sdk` alias to the Cursor catalog icon id.
- `packages/app/src/components/provider-icon-name.test.ts` - Covered Cursor catalog behavior, Cursor SDK aliasing, and unknown-provider Bot fallback.
- `packages/server/src/server/agent/providers/cursor-sdk-agent.ts` - Changed Cursor SDK create-config default mode selection to use dynamic snapshot modes.
- `packages/server/src/server/agent/providers/cursor-sdk-agent.test.ts` - Covered YOLO-only runtime defaults, Sandbox-capable defaults, explicit YOLO, and Agent/Ask rejection.

## Decisions Made

- Cursor SDK remains an independent built-in provider with experimental status expressed only in description copy.
- Cursor SDK icon identity is an app resolver alias to `cursor`, not a new protocol icon id or new SVG component.
- Dynamic snapshot modes are the source of truth for Cursor SDK mode defaults; static manifest modes remain visual metadata.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Rebuilt protocol/client output before registry test**

- **Found during:** Task 1 (Lock provider manifest identity and copy)
- **Issue:** The server registry test imports `@getpaseo/protocol` through package exports, so the first run saw stale built output and failed on the old Cursor SDK description.
- **Fix:** Ran `npm run build:client` in the devcontainer before rerunning the targeted registry test.
- **Files modified:** None beyond planned Task 1 files.
- **Verification:** `npx vitest run packages/server/src/server/agent/provider-registry.test.ts --bail=1` passed after rebuild.
- **Committed in:** `f2b36095`

**2. [Rule 1 - Bug] Fixed optional dynamic modes type error**

- **Found during:** Task 3 (Use dynamic Cursor SDK modes for creation defaults)
- **Issue:** Commit-hook typecheck caught that `ResolveAgentCreateConfigInput.availableModes` can be undefined.
- **Fix:** Switched the Sandbox availability check to optional chaining so undefined dynamic modes safely default to YOLO.
- **Files modified:** `packages/server/src/server/agent/providers/cursor-sdk-agent.ts`
- **Verification:** `npx vitest run packages/server/src/server/agent/providers/cursor-sdk-agent.test.ts --bail=1` and commit-hook typecheck passed.
- **Committed in:** `d37c5a7f`

---

**Total deviations:** 2 auto-fixed (1 Rule 3, 1 Rule 1)
**Impact on plan:** Both fixes were required to complete planned verification and preserve type correctness. No scope expansion.

## Issues Encountered

- Initial Task 1 targeted test used stale built protocol output; rebuilding the client/protocol stack resolved it.
- Task 3 commit hook caught an optional property type error before the commit landed; the fix was applied and verified.

## Authentication Gates

None.

## Known Stubs

None. Stub scan found only pre-existing test fixtures/null state and the existing protocol TODO about static modes, which this plan did not introduce.

## User Setup Required

None - no external service configuration required.

## Validation

- `devcontainer exec --workspace-folder /mnt/private_yax_qy4/projects/paseo npx vitest run packages/server/src/server/agent/provider-registry.test.ts packages/app/src/components/provider-icon-name.test.ts packages/server/src/server/agent/providers/cursor-sdk-agent.test.ts --bail=1` - passed (3 files, 65 tests)
- `devcontainer exec --workspace-folder /mnt/private_yax_qy4/projects/paseo npm run build:client` - passed
- `devcontainer exec --workspace-folder /mnt/private_yax_qy4/projects/paseo npm run build:server` - passed
- `devcontainer exec --workspace-folder /mnt/private_yax_qy4/projects/paseo npm run format` - passed
- `devcontainer exec --workspace-folder /mnt/private_yax_qy4/projects/paseo npm run typecheck` - passed
- `devcontainer exec --workspace-folder /mnt/private_yax_qy4/projects/paseo npm run lint` - passed

## Next Phase Readiness

Plan 03-02 can build on stable provider identity, icon resolution, and dynamic mode defaults. Cursor SDK model/thinking discovery can assume the app receives a distinct `cursor-sdk` provider and that mode controls are driven by snapshot modes.

## Self-Check: PASSED

- Verified key modified files exist.
- Verified task commits `f2b36095`, `7b0b7e55`, and `d37c5a7f` exist in git history.
- Verified no accidental tracked file deletions occurred in task commits.
- Verified final targeted tests, builds, format, typecheck, and lint passed in the devcontainer.

---

_Phase: 03-manifest-and-ui-integration_
_Completed: 2026-06-13_
