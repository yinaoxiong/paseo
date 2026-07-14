---
phase: quick
plan: "260714-qaw"
status: complete
subsystem: cursor-sdk
tags: [cursor-sdk, model-catalog, variants, regression-test]
requires: []
provides:
  - Exact parameter-set matching for Cursor SDK variant labels
  - Distinct GPT-5.5 272K and 1M context picker rows for composite upstream variants
  - Cursor SDK 1.0.23 dependency baseline
affects: [cursor-sdk-model-discovery, provider-model-picker]
tech-stack:
  added: []
  patterns:
    - Projected model rows use parameter value labels unless a variant exactly matches the complete projected selection
key-files:
  created: []
  modified:
    - packages/server/src/server/agent/providers/cursor-sdk/model-options.ts
    - packages/server/src/server/agent/providers/cursor-sdk/model-options.test.ts
    - packages/server/package.json
    - package-lock.json
    - docs/providers.md
key-decisions:
  - "Treat Cursor SDK variant display names as non-unique presentation metadata, not model identity."
  - "Preserve encoded model identity as the SDK model id plus the explicitly selected parameter values."
requirements-completed: []
duration: 5min
completed: 2026-07-14
---

# Quick 260714-qaw: Cursor SDK GPT-5.5 Context Variant Labels Summary

**Cursor SDK context rows now display `GPT-5.5 - 272K` and `GPT-5.5 - 1M` while preserving context-only encoded selections, with the checked-in SDK baseline advanced to 1.0.23.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-07-14T11:04:11Z
- **Completed:** 2026-07-14T11:08:54Z
- **Tasks:** 3
- **Files modified:** 5

## Accomplishments

- Tightened variant-label matching to require the same parameter count and the same id/value pairs, independent of order.
- Replaced the synthetic context-only GPT-5.5 fixture with live-shaped composite context/reasoning/fast variants that all share the `GPT-5.5` display name.
- Proved both expanded rows have unique visible labels and decode to distinct context-only SDK selections without reasoning or fast defaults.
- Updated `@cursor/sdk` and all optional platform package resolutions to 1.0.23.
- Documented that Cursor variant display names are not stable identifiers for projected picker rows.

## Commit

- `efca3edb9` — `fix(cursor-sdk): distinguish context model variants`

## Files Modified

- `packages/server/src/server/agent/providers/cursor-sdk/model-options.ts` — Requires complete parameter-set equality before using a variant display name.
- `packages/server/src/server/agent/providers/cursor-sdk/model-options.test.ts` — Covers identically named composite GPT-5.5 variants and context-only decoding.
- `packages/server/package.json` — Advances the Cursor SDK dependency range to `^1.0.23`.
- `package-lock.json` — Resolves the core and optional platform Cursor SDK packages at 1.0.23.
- `docs/providers.md` — Records the projected-row labeling and encoded-identity invariant.

## Verification

All dependency-backed commands ran inside the worktree devcontainer.

- `npm run format:files -- packages/server/src/server/agent/providers/cursor-sdk/model-options.ts packages/server/src/server/agent/providers/cursor-sdk/model-options.test.ts` — passed; 2 files formatted.
- `npx vitest run packages/server/src/server/agent/providers/cursor-sdk/model-options.test.ts --bail=1` — passed on its only invocation; 1 file and 6 tests passed.
- `npm install @cursor/sdk@1.0.23 --workspace=@getpaseo/server` — passed; dependency and lockfile updated.
- Focused dependency/documentation diff and `rg` checks — passed; core and five optional platform packages resolve to 1.0.23 with no unrelated dependency changes.
- `npm run format` — passed; 2,796 files checked/formatted.
- `npm run lint` — passed; 0 warnings and 0 errors across 2,525 files.
- Initial `npm run typecheck` — failed because compiled cross-workspace protocol/client declarations were absent or stale.
- `npm run build:server` — passed and rebuilt the owning workspace stack as required by repository instructions.
- Retried `npm run typecheck` once — passed for all workspaces.
- `git diff --check` — passed before commit.
- Final implementation status — clean at `efca3edb9`; only uncommitted GSD quick artifacts remain by design.

## Decisions Made

- A variant label is eligible only when the variant's entire parameter set exactly equals the projected row selection.
- Composite variants fall back to the projected context value's `displayName`, while encoded identity continues to use model id plus explicit params.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- The first repository typecheck exposed stale cross-workspace declarations. The planned recovery path (`npm run build:server`, then one typecheck retry) resolved it without source changes.

## Known Stubs

None.

## Threat Flags

None - the change adds no network, authentication, file-access, protocol, or other trust-boundary surface.

## Self-Check: PASSED

- All five planned implementation files are present in commit `efca3edb9`.
- The commit contains no file deletions and no `.planning/` artifacts.
- Every plan success criterion is satisfied.
