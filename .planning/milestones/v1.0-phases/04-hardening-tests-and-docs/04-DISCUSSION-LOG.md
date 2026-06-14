# Phase 4: Hardening, Tests, and Docs - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md - this log preserves the alternatives considered.

**Date:** 2026-06-14
**Phase:** 4-Hardening, Tests, and Docs
**Areas discussed:** Closeout scope

---

## Closeout Scope

| Option             | Description                                                                            | Selected |
| ------------------ | -------------------------------------------------------------------------------------- | -------- |
| Lean closeout      | Targeted tests, provider docs, and final checks only; no new ACP/SDK MCP/Ask features. | yes      |
| Broader validation | Add more real SDK/browser validation on top of tests and docs.                         |          |
| Docs only          | Mainly document risks and rely on existing test evidence.                              |          |

**User's choice:** Lean closeout.
**Notes:** Phase 4 should close the Cursor SDK milestone without expanding into Cursor ACP AskQuestion bridging or Cursor SDK MCP injection. Those explorations should remain documented and deferred.

---

## the agent's Discretion

- The planner may choose the exact targeted test split and doc locations.
- The planner should keep tests deterministic and avoid live Cursor API dependencies in normal suites.

## Deferred Ideas

- Cursor ACP native AskQuestion bridge.
- Paseo MCP `ask_user` tool for Cursor ACP.
- Cursor SDK MCP/custom tool injection.
- Cursor SDK cloud runtime.
- Cursor SDK interactive approval / Ask mode.
