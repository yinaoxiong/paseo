---
phase: 03-manifest-and-ui-integration
plan: "04"
subsystem: provider-ui
tags: [cursor-sdk, feature-preferences, composer-controls, fast-mode]

requires:
  - phase: 03-manifest-and-ui-integration
    provides: Cursor SDK provider metadata, model/thinking discovery, explicit selection semantics, and provider feature metadata from plans 03-02 and 03-03
provides:
  - Provider feature preference pruning that removes stale unavailable feature ids from draft and persisted preferences
  - Cursor SDK fast-mode behavior that defaults off and only appears when selected model metadata exposes `fast_mode`
  - Verification that Cursor SDK fast continues through the existing composer feature controls and shared yellow Zap treatment
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
    - Provider feature values are resolved only from currently available feature metadata and stale persisted ids are replaced, not merely ignored.
    - Cursor SDK fast uses the shared AgentFeature toggle path and existing composer controls rather than a provider-specific UI surface.

key-files:
  created:
    - .planning/phases/03-manifest-and-ui-integration/03-04-SUMMARY.md
  modified:
    - packages/app/src/hooks/feature-preferences.ts
    - packages/app/src/hooks/feature-preferences.test.ts
    - packages/app/src/hooks/use-draft-agent-features.ts

key-decisions:
  - "Persisted provider feature values are replaced after metadata refresh so stale Cursor SDK fast selections cannot be replayed into later sends."
  - "Cursor SDK fast remains a shared AgentFeature toggle with existing composer desktop and compact surfaces; no Cursor SDK-specific feature component was added."
  - "Fast defaults to off by preserving the provider metadata value unless the user explicitly toggles and persists `fast_mode`."

patterns-established:
  - "Use `pruneFeatureValues` before applying or persisting draft feature preferences so unavailable ids are removed at the metadata boundary."
  - "Use replacement semantics for stored feature preferences when pruning; merge semantics are only for explicit user feature updates."

requirements-completed: [FEAT-02, FEAT-03, UI-02, UI-03]

duration: 9min
completed: 2026-06-13
---

# Phase 03 Plan 04: Fast Feature Preference Summary

**Cursor SDK fast mode is pruned from stale draft and persisted preferences, defaults off when available, and stays on the shared composer feature controls**

## Performance

- **Duration:** 9 min
- **Started:** 2026-06-13T16:44:09Z
- **Completed:** 2026-06-13T16:52:27Z
- **Tasks:** 2
- **Files modified:** 3 source/test files plus this summary

## Accomplishments

- Added provider feature-value replacement support so unavailable feature ids can be removed from stored provider preferences instead of only being hidden at render time.
- Wired draft feature metadata refreshes to prune both local draft values and persisted provider feature preferences before stale `fast_mode` can reach a later send.
- Added focused tests proving stale Cursor SDK `fast_mode` is removed, replacement does not merge it back, other provider preferences are preserved, and newly available fast stays off without an explicit user value.
- Verified Cursor SDK fast continues through existing desktop feature buttons, compact feature sheet rows, `listProviderFeatures`, `setAgentFeature`, and the shared yellow `fast_mode` highlight utility.

## Task Commits

Each task was committed atomically:

1. **Task 1: Prune invalid Cursor SDK fast preferences** - `6edf8e0d` (feat)
2. **Task 2: Keep fast on existing composer feature controls** - `cc970943` (chore, empty verification commit)

**Plan metadata:** recorded in the final docs commit.

## Files Created/Modified

- `packages/app/src/hooks/feature-preferences.ts` - Added `replaceProviderFeatureValues` alongside existing prune/resolve/apply helpers.
- `packages/app/src/hooks/feature-preferences.test.ts` - Covered stale fast pruning, replacement semantics, provider preservation, and default-off behavior.
- `packages/app/src/hooks/use-draft-agent-features.ts` - Prunes persisted feature preferences after provider feature metadata loads.
- `packages/app/src/composer/agent-controls/index.tsx` - Audited only; no source change required because shared desktop/compact feature controls already render `AgentFeature` entries.

## Decisions Made

- Used a provider-neutral stored-feature replacement helper instead of adding Cursor SDK-specific persistence code.
- Kept explicit user toggles on the existing merge path; only metadata-driven pruning uses replacement semantics.
- Kept Task 2 as a verification-only empty commit because the existing composer controls already satisfied the shared fast-mode UI contract after Task 1's hook integration.

## Deviations from Plan

None - plan executed as written. Task 2 required no additional source edit because the existing shared composer feature controls already satisfied the UI contract.

## Issues Encountered

- A first host-side Task 1 commit attempt failed because git hooks tried to run dependency-backed tools outside the devcontainer (`oxlint`, `oxfmt`, `tsgo` were intentionally unavailable on the host). The same staged commit was rerun inside the devcontainer, where hooks passed. Subsequent commits were made from inside the devcontainer.

## Authentication Gates

None.

## Known Stubs

None. Stub scan found only normal empty-record construction, nullable defaults, and existing optional defaults in touched/audited files.

## User Setup Required

None - no external service configuration required.

## Validation

- `devcontainer exec --workspace-folder /mnt/private_yax_qy4/projects/paseo npx vitest run packages/app/src/hooks/feature-preferences.test.ts --bail=1` - passed (6 tests).
- `devcontainer exec --workspace-folder /mnt/private_yax_qy4/projects/paseo npx vitest run packages/app/src/hooks/feature-preferences.test.ts packages/app/src/composer/agent-controls/utils.test.ts --bail=1` - passed (24 tests).
- `devcontainer exec --workspace-folder /mnt/private_yax_qy4/projects/paseo npm run build:client` - passed.
- `devcontainer exec --workspace-folder /mnt/private_yax_qy4/projects/paseo npm run format` - passed.
- `devcontainer exec --workspace-folder /mnt/private_yax_qy4/projects/paseo npm run typecheck` - passed.
- `devcontainer exec --workspace-folder /mnt/private_yax_qy4/projects/paseo npm run lint` - passed.
- `rg -n "fast_mode|Cursor SDK|cursor-sdk" packages/app/src/composer/agent-controls/index.tsx packages/app/src/composer/agent-controls/utils.ts packages/app/src/hooks/use-draft-agent-features.ts` - confirmed no Cursor SDK-specific feature component or visual treatment was introduced.
- `rg -n "listProviderFeatures|createSession|setAgentFeature" packages/app/src/hooks/use-draft-agent-features.ts packages/app/src/composer/agent-controls/index.tsx packages/server/src/server/agent/agent-manager.ts` - confirmed draft discovery uses `listProviderFeatures` and running changes use existing `setAgentFeature`.

## Next Phase Readiness

Phase 03 is ready to close: Cursor SDK provider identity, metadata discovery, explicit model/thinking selection, and fast feature controls are integrated without changing Cursor ACP behavior. Phase 04 can focus on hardening tests and docs.

## Self-Check: PASSED

- Verified key modified files exist.
- Verified task commits `6edf8e0d` and `cc970943` exist in git history.
- Verified no accidental tracked file deletions occurred in task commits.
- Verified final targeted tests, `build:client`, format, typecheck, and lint passed in the devcontainer.

---

_Phase: 03-manifest-and-ui-integration_
_Completed: 2026-06-13_
