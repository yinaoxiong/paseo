---
phase: 03-manifest-and-ui-integration
fixed_at: 2026-06-13T17:19:51Z
review_path: .planning/phases/03-manifest-and-ui-integration/03-REVIEW.md
iteration: 1
findings_in_scope: 3
fixed: 3
skipped: 0
status: all_fixed
---

# Phase 03: Code Review Fix Report

**Fixed at:** 2026-06-13T17:19:51Z
**Source review:** .planning/phases/03-manifest-and-ui-integration/03-REVIEW.md
**Iteration:** 1

**Summary:**

- Findings in scope: 3
- Fixed: 3
- Skipped: 0

## Fixed Issues

### CR-01: BLOCKER - Cursor SDK running sessions never expose available features

**Files modified:** `packages/server/src/server/agent/providers/cursor-sdk-agent.ts`, `packages/server/src/server/agent/providers/cursor-sdk-agent.test.ts`
**Commit:** 63e6bc44
**Applied fix:** Added `CursorSdkAgentSession.features` so running sessions project `fast_mode` from Cursor SDK model metadata, with regression coverage for a Fast-capable running session.

### WR-01: WARNING - Cursor SDK setModel accepts stale encoded IDs and fails later on send

**Files modified:** `packages/server/src/server/agent/providers/cursor-sdk-agent.ts`, `packages/server/src/server/agent/providers/cursor-sdk-agent.test.ts`
**Commit:** 6f795c7f
**Applied fix:** Normalized and validated encoded Cursor SDK model IDs before mutating session state, so stale IDs reject before `AgentManager` can persist the change.

### WR-02: WARNING - Running controls can display the wrong Cursor SDK model for stale runtime IDs

**Files modified:** `packages/app/src/composer/agent-controls/utils.ts`, `packages/app/src/composer/agent-controls/utils.test.ts`
**Commit:** 901625da
**Applied fix:** Carried Cursor SDK explicit-selection behavior into running control model resolution, keeping stale runtime IDs unresolved instead of falling back to another model.

## Validation

- `npx vitest run packages/server/src/server/agent/providers/cursor-sdk-agent.test.ts --bail=1`
- `npx vitest run packages/app/src/composer/agent-controls/utils.test.ts --bail=1`
- `npm run format`
- `npm run typecheck`
- `npm run lint`

All validation commands passed inside devcontainer `79ef2ffc505c`.

## Skipped Issues

None.

---

_Fixed: 2026-06-13T17:19:51Z_
_Fixer: the agent (gsd-code-fixer)_
_Iteration: 1_
