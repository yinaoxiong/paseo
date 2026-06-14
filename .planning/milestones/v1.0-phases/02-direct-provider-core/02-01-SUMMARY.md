---
phase: 02-direct-provider-core
plan: 01
subsystem: provider-core
tags: [cursor-sdk, providers, diagnostics, modes, registry, tdd]

requires:
  - phase: 01-sdk-viability-spike
    provides: Cursor SDK viability evidence, unsupported Sandbox finding, and YOLO lifecycle proof
provides:
  - Experimental `cursor-sdk` direct provider boundary
  - Redacted Cursor SDK diagnostics and API-key source handling
  - Sandbox/YOLO runtime mode helpers and manifest metadata
  - Registry wiring for side-by-side Cursor ACP and Cursor SDK providers
affects: [02-direct-provider-core, provider-snapshots, cursor-sdk-lifecycle]

tech-stack:
  added: []
  patterns:
    - Injectable SDK runtime port for deterministic provider tests
    - Side-effect-free provider availability and mode discovery
    - Structured diagnostic redaction before provider snapshot serialization

key-files:
  created:
    - packages/server/src/server/agent/providers/cursor-sdk-agent.ts
    - packages/server/src/server/agent/providers/cursor-sdk/diagnostics.ts
    - packages/server/src/server/agent/providers/cursor-sdk/modes.ts
    - packages/server/src/server/agent/providers/cursor-sdk/sdk-runtime.ts
    - packages/server/src/server/agent/providers/cursor-sdk-agent.test.ts
  modified:
    - packages/server/src/server/agent/provider-registry.ts
    - packages/server/src/server/agent/provider-registry.test.ts
    - packages/protocol/src/provider-manifest.ts

key-decisions:
  - "Registered `cursor-sdk` as a side-by-side experimental direct provider and kept Cursor ACP on its own factory/config path."
  - "Production Sandbox support reports unavailable until a verified side-effect-free SDK capability probe exists; injected runtimes can report support for tests and future platforms."

patterns-established:
  - "Cursor SDK provider metadata checks use the `CursorSdkRuntime` port and never create scratch SDK agents."
  - "Cursor SDK diagnostics carry safe operation/key-source/sandbox/model context while redacting key values and key-shaped strings."

requirements-completed: [PROV-01, PROV-02, MODE-01, MODE-02]

duration: 18min
completed: 2026-06-13
---

# Phase 02 Plan 01: Cursor SDK Provider Boundary Summary

**Experimental `cursor-sdk` direct provider boundary with redacted availability diagnostics, side-effect-free mode metadata, and registry isolation from Cursor ACP**

## Performance

- **Duration:** 18 min
- **Started:** 2026-06-13T10:06:00Z
- **Completed:** 2026-06-13T10:24:11Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments

- Added `CursorSdkAgentClient` with lightweight SDK readiness checks, provider-config-first `CURSOR_API_KEY` resolution, model listing through `Cursor.models.list`, and create/resume preflight hooks for the dependent lifecycle plan.
- Added `CursorSdkRuntime` and `ProductionCursorSdkRuntime` so tests can prove no `createAgent`/`resumeAgent` calls happen during availability or mode discovery.
- Added structured Cursor SDK diagnostics with key-source context and redaction for API keys, auth headers, raw env/header shapes, and key-shaped strings.
- Added Sandbox/YOLO mode helpers and manifest metadata; YOLO is marked `isUnattended: true` and dangerous.
- Registered `cursor-sdk` alongside the existing Cursor ACP provider path and added tests proving runtime settings do not bleed between `cursor` and `cursor-sdk`.

## Task Commits

1. **Task 1 RED: Cursor SDK provider boundary tests** - `817acb72` (`test`)
2. **Task 1 GREEN: Cursor SDK provider boundary** - `0ce54c8b` (`feat`)
3. **Task 2 RED: Cursor SDK registry tests** - `1d838afd` (`test`)
4. **Task 2 GREEN: Cursor SDK registry wiring** - `df5a0c85` (`feat`)

**Plan metadata:** pending final docs commit

## Files Created/Modified

- `packages/server/src/server/agent/providers/cursor-sdk-agent.ts` - Direct provider boundary, key resolution, preflight, availability, diagnostics, model and mode listing.
- `packages/server/src/server/agent/providers/cursor-sdk/diagnostics.ts` - Structured diagnostic conversion and redaction helpers.
- `packages/server/src/server/agent/providers/cursor-sdk/modes.ts` - Sandbox/YOLO mode definitions and fail-closed mode resolution.
- `packages/server/src/server/agent/providers/cursor-sdk/sdk-runtime.ts` - Injectable Cursor SDK runtime port and production dynamic-import adapter.
- `packages/server/src/server/agent/providers/cursor-sdk-agent.test.ts` - Focused provider boundary tests for availability, diagnostics, key precedence, and side-effect-free modes.
- `packages/server/src/server/agent/provider-registry.ts` - Built-in `cursor-sdk` factory registration.
- `packages/server/src/server/agent/provider-registry.test.ts` - Registry coexistence, env isolation, and manifest safety metadata tests.
- `packages/protocol/src/provider-manifest.ts` - Static Cursor ACP and experimental Cursor SDK provider definitions.

## Decisions Made

- Kept `cursor-sdk` independent from `cursor` ACP command/env/login behavior; SDK credentials flow only through `agents.providers.cursor-sdk.env.CURSOR_API_KEY` or process env.
- Did not expose Ask, generic Agent, auto-review, cloud runtime, or credential storage in the Cursor SDK boundary.
- Left local SDK lifecycle methods as preflight-only pending plan 02-02, matching the plan boundary.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added static Cursor ACP provider definition**

- **Found during:** Task 2 (registry coexistence RED test)
- **Issue:** The codebase had a `CursorACPAgentClient` factory but no built-in `cursor` provider manifest entry, so `buildProviderRegistry()` omitted `cursor`.
- **Fix:** Added the minimal Cursor ACP manifest definition needed for side-by-side built-in registration without changing `getCursorACPCommand()` or the ACP factory.
- **Files modified:** `packages/protocol/src/provider-manifest.ts`
- **Verification:** Registry tests now prove both `cursor` and `cursor-sdk` are present and isolated.
- **Committed in:** `df5a0c85`

---

**Total deviations:** 1 auto-fixed (Rule 2)
**Impact on plan:** Required to satisfy the plan’s side-by-side Cursor ACP/SDK acceptance criteria; no Cursor ACP runtime behavior was changed.

## Issues Encountered

- Host-side `git commit` hooks failed because container-only tools (`oxfmt`, `oxlint`, `tsgo`) are not installed on the host. Subsequent commits were run through `devcontainer exec`, as required by project instructions.
- Registry tests initially read stale protocol package output after `provider-manifest.ts` changed. `npm run build:client` refreshed protocol/client build artifacts before rerunning targeted tests.

## Verification

- `devcontainer exec --workspace-folder /mnt/private_yax_qy4/projects/paseo npx vitest run packages/server/src/server/agent/provider-registry.test.ts packages/server/src/server/agent/providers/cursor-sdk-agent.test.ts --bail=1` - passed, 39 tests.
- `devcontainer exec --workspace-folder /mnt/private_yax_qy4/projects/paseo npm run format:files -- packages/server/src/server/agent/provider-registry.ts packages/server/src/server/agent/provider-registry.test.ts packages/protocol/src/provider-manifest.ts packages/server/src/server/agent/providers/cursor-sdk-agent.ts packages/server/src/server/agent/providers/cursor-sdk/diagnostics.ts packages/server/src/server/agent/providers/cursor-sdk/modes.ts packages/server/src/server/agent/providers/cursor-sdk/sdk-runtime.ts packages/server/src/server/agent/providers/cursor-sdk-agent.test.ts` - passed.
- `devcontainer exec --workspace-folder /mnt/private_yax_qy4/projects/paseo npm run typecheck` - passed.
- `devcontainer exec --workspace-folder /mnt/private_yax_qy4/projects/paseo npm run lint` - passed.
- `rg -n "cursor-sdk|CursorSdkAgentClient|CURSOR_API_KEY|isUnattended" ...` - found expected wiring.
- `rg -n "local\\.autoReview|Ask mode|generic Agent|agents\\.providers\\.cursor\\." ...` - no matches.

## Known Stubs

- `packages/server/src/server/agent/providers/cursor-sdk-agent.ts` contains `CursorSdkPendingSession`, whose lifecycle methods intentionally throw. This is the planned boundary for 02-01; plan 02-02 owns actual create/resume/run/cancel lifecycle wiring.

## Threat Flags

None - new trust-boundary surfaces were already covered by the plan threat model: `CURSOR_API_KEY` config/env handling, provider snapshot diagnostics, registry isolation, and mode safety metadata.

## User Setup Required

For live Cursor SDK availability outside deterministic tests, configure `CURSOR_API_KEY` at `$PASEO_HOME/config.json` under `agents.providers.cursor-sdk.env.CURSOR_API_KEY`, or set it in the daemon process environment.

## Next Phase Readiness

Plan 02-02 can build on `CursorSdkRuntime.createAgent`/`resumeAgent`, the preflight helper, and the mode definitions to implement local store paths, persistence handles, resume validation, and cancellation.

## Self-Check: PASSED

- Found summary file: `.planning/phases/02-direct-provider-core/02-01-SUMMARY.md`
- Found task commits: `817acb72`, `0ce54c8b`, `1d838afd`, `df5a0c85`
- No unexpected tracked file deletions detected in task commits.

---

_Phase: 02-direct-provider-core_
_Completed: 2026-06-13_
