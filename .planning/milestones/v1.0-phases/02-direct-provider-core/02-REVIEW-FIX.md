---
phase: 02-direct-provider-core
fixed_at: 2026-06-13T11:41:19Z
review_path: .planning/phases/02-direct-provider-core/02-REVIEW.md
iteration: 1
findings_in_scope: 4
fixed: 4
skipped: 0
status: all_fixed
---

# Phase 02: Code Review Fix Report

**Fixed at:** 2026-06-13T11:41:19Z
**Source review:** `.planning/phases/02-direct-provider-core/02-REVIEW.md`
**Iteration:** 1

**Summary:**

- Findings in scope: 4
- Fixed: 4
- Skipped: 0

## Fixed Issues

### CR-01: BLOCKER - Resume store containment trusts an unvalidated session id

**Status:** fixed
**Files modified:** `packages/server/src/server/agent/providers/cursor-sdk/persistence.ts`, `packages/server/src/server/agent/providers/cursor-sdk/persistence.test.ts`
**Commit:** 5f0151fd
**Applied fix:** Added safe Cursor SDK session-id validation, required store paths to stay inside both the provider store root and session store root, and added traversal/session-id regression coverage.

### CR-02: BLOCKER - Raw SDK errors bypass redaction into logs and system timeline messages

**Status:** fixed
**Files modified:** `packages/server/src/server/agent/providers/cursor-sdk-agent.ts`, `packages/server/src/server/agent/providers/cursor-sdk-agent.test.ts`
**Commit:** 07aac9dc
**Applied fix:** Routed public turn-failure and SDK operation error messages through Cursor SDK diagnostic redaction, preserved original errors as causes, and added send/create/resume/list-model redaction tests.

### CR-03: BLOCKER - Failed tool-call errors are stored without sanitization

**Status:** fixed
**Files modified:** `packages/server/src/server/agent/providers/cursor-sdk/event-mapper.ts`, `packages/server/src/server/agent/providers/cursor-sdk/event-mapper.test.ts`
**Commit:** 7b7199b4
**Applied fix:** Sanitized failed tool-call error payloads before timeline storage and added regression coverage for secret-shaped tool error objects.

### WR-01: WARNING - `setMode("yolo")` changes only Paseo metadata, not the SDK agent sandbox

**Status:** fixed: requires human verification
**Files modified:** `packages/server/src/server/agent/providers/cursor-sdk-agent.ts`, `packages/server/src/server/agent/providers/cursor-sdk-agent.test.ts`
**Commit:** d9bcf589
**Applied fix:** Rejected live Cursor SDK mode changes when they would alter sandbox-enabled SDK local options, while keeping same-mode updates harmless; added regression coverage for sandbox-to-YOLO and YOLO-to-sandbox rejection.

---

_Fixed: 2026-06-13T11:41:19Z_
_Fixer: the agent (gsd-code-fixer)_
_Iteration: 1_
