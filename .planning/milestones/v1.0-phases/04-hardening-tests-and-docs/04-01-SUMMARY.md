---
phase: 04-hardening-tests-and-docs
plan: "01"
subsystem: testing
tags: [cursor-sdk, vitest, provider-registry, event-mapper, app-selection]
requires:
  - phase: 01-sdk-viability-spike
    provides: Cursor SDK local lifecycle, auth, resume, and sandbox-support findings.
  - phase: 03-manifest-and-ui-integration
    provides: Cursor SDK manifest, model/thinking/fast, and app selection integration.
provides:
  - Deterministic Cursor SDK provider lifecycle, mode, MCP-boundary, and persistence tests.
  - Deterministic Cursor SDK event-mapping and model-option transform tests.
  - Side-by-side Cursor ACP and Cursor SDK registry, selector, composer, and icon regression tests.
affects: [cursor-sdk, cursor-acp, provider-tests, app-provider-selection]
tech-stack:
  added: []
  patterns:
    - Injected Cursor SDK runtime fakes for default tests.
    - Explicit Cursor SDK model/thinking selection semantics in app tests.
key-files:
  created:
    - .planning/phases/04-hardening-tests-and-docs/04-01-SUMMARY.md
  modified:
    - packages/server/src/server/agent/providers/cursor-sdk-agent.test.ts
    - packages/server/src/server/agent/providers/cursor-sdk/event-mapper.test.ts
    - packages/server/src/server/agent/providers/cursor-sdk/model-options.test.ts
    - packages/server/src/server/agent/provider-registry.test.ts
    - packages/app/src/provider-selection/resolve-agent-form.test.ts
    - packages/app/src/components/provider-icon-name.test.ts
key-decisions:
  - "Cursor SDK closeout coverage stays test-only and deterministic; no live CURSOR_API_KEY, network, MCP injection, Ask mode, or new UI surface was introduced."
  - "Cursor SDK app selection remains explicit while Cursor ACP keeps existing default fallback behavior."
patterns-established:
  - "Credential and secret-shaped fixtures are asserted through redaction boundaries instead of live provider auth."
  - "Cursor SDK stale model/thinking metadata clears rather than falling back to SDK defaults."
requirements-completed: [MODE-04, UI-03, QUAL-01]
duration: 12min
completed: 2026-06-14
---

# Phase 04 Plan 01: Targeted Cursor SDK Test Hardening Summary

**Deterministic Cursor SDK closeout tests covering lifecycle, persistence, event mapping, model transforms, registry isolation, and app selection behavior without live provider dependencies.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-06-14T08:39:00Z
- **Completed:** 2026-06-14T08:51:04Z
- **Tasks:** 3
- **Files modified:** 6 source test files, 1 summary file

## Accomplishments

- Added provider lifecycle tests proving missing credentials and invalid Ask/Agent modes fail before SDK store, create, or resume calls.
- Added event and model transform tests proving redacted diagnostics-only correlation events, explicit fast behavior, and stale/tampered SDK selections.
- Added registry and app tests proving Cursor SDK remains side by side with Cursor ACP, keeps MCP unsupported, preserves Cursor ACP defaults, and aliases the Cursor icon without changing Cursor ACP.

## Task Commits

1. **Task 1: Harden provider lifecycle, mode, and persistence tests** - `a316ee82` (test)
2. **Task 2: Harden event-mapper and model-option tests** - `a9b4b1d0` (test)
3. **Task 3: Harden registry, manifest, and app isolation tests** - `49b7bb99` (test)

## Files Created/Modified

- `packages/server/src/server/agent/providers/cursor-sdk-agent.test.ts` - Added missing-credential create/resume and invalid Ask/Agent session-entry coverage.
- `packages/server/src/server/agent/providers/cursor-sdk/event-mapper.test.ts` - Added SDK envelope/correlation diagnostic-only redaction and unsupported terminal status redaction coverage.
- `packages/server/src/server/agent/providers/cursor-sdk/model-options.test.ts` - Added explicit fast=false send behavior and stale context/model metadata rejection coverage.
- `packages/server/src/server/agent/provider-registry.test.ts` - Added Cursor SDK MCP boundary and exact Sandbox/YOLO mode-id assertions alongside Cursor ACP.
- `packages/app/src/provider-selection/resolve-agent-form.test.ts` - Added user-provider-selection tests preserving Cursor SDK explicitness and Cursor ACP defaults.
- `packages/app/src/components/provider-icon-name.test.ts` - Added Cursor ACP non-regression assertion next to Cursor SDK icon alias coverage.
- `.planning/phases/04-hardening-tests-and-docs/04-01-SUMMARY.md` - Plan execution summary.

## Verification

- `devcontainer exec --workspace-folder /mnt/private_yax_qy4/projects/paseo npm run format:files -- ...8 target files...` - passed.
- `devcontainer exec --workspace-folder /mnt/private_yax_qy4/projects/paseo npx vitest run ...8 target files... --bail=1` - passed, 8 files and 194 tests.
- `rg -n "cursor/ask_question|mcpServers|supportsMcpServers|Invalid Cursor SDK mode|CURSOR_API_KEY|cursor-sdk|Cursor SDK" ...8 target files...` - passed with expected coverage matches.
- Per-commit hooks also ran targeted format/lint and workspace typecheck inside the devcontainer for each task commit.

## Decisions Made

- No production code was changed; the existing implementation already supported the targeted behaviors.
- Test hardening remained deterministic through injected fakes and pure helper fixtures, not live Cursor API calls.
- Cursor SDK mode and model behavior remains explicit: no Ask/Agent mode, no MCP support, no SDK model/thinking fallback invented for users.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- A transient `.git/index.lock` blocked the first Task 2 commit attempt. No active git hook or commit process remained and the lock had cleared by the time it was inspected; the same staged commit was retried successfully.

## Known Stubs

None found in files created or modified by this plan.

## Threat Flags

None - this plan added tests only and introduced no new network endpoints, auth paths, file access patterns, schema changes, or trust-boundary production code.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 04-02 can update provider docs and run final closeout verification with targeted test evidence already in place. Remaining Phase 4 work is documentation and final type/lint verification, not feature implementation.

## Self-Check: PASSED

- Summary file exists at `.planning/phases/04-hardening-tests-and-docs/04-01-SUMMARY.md`.
- Modified test files exist in the working tree.
- Task commits `a316ee82`, `a9b4b1d0`, and `49b7bb99` are present in git history.

---

_Phase: 04-hardening-tests-and-docs_
_Completed: 2026-06-14_
