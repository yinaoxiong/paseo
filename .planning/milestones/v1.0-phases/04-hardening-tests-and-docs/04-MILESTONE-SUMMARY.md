---
phase: 04-hardening-tests-and-docs
milestone: "Paseo Native Cursor SDK Provider"
completed: 2026-06-14T09:03:25Z
status: complete
requirements:
  - MODE-04
  - UI-03
  - QUAL-01
  - QUAL-02
  - QUAL-03
---

# Phase 4 Milestone Summary: Cursor SDK Provider Closeout

Phase 4 closed the experimental Cursor SDK provider milestone with deterministic tests, provider documentation, and final verification evidence. It did not add new runtime features; Phase 4 work was tests, docs, and planning-state closeout only.

## What Is Complete

- Cursor SDK remains a side-by-side direct provider with id `cursor-sdk`; Cursor ACP remains available separately as `cursor`.
- Default Cursor SDK tests are deterministic fake-runtime tests and do not require live `CURSOR_API_KEY`, network access, Cursor credits, or live SDK model metadata.
- Provider docs now cover `CURSOR_API_KEY`, local runtime scope, Sandbox vs YOLO semantics, omitted Ask/Agent modes, Cursor ACP separation, no Cursor SDK MCP injection, and SDK beta limits.
- Final verification passed targeted Phase 4 Vitest, `npm run format:check`, `npm run typecheck`, and `npm run lint` inside the devcontainer.

## Requirement Closeout

| Requirement | Status   | Closeout Evidence                                                                                                          |
| ----------- | -------- | -------------------------------------------------------------------------------------------------------------------------- |
| MODE-04     | Complete | Docs and tests state missing SDK interactive approval is not exposed as Ask mode.                                          |
| UI-03       | Complete | 04-01 regression tests and Phase 3 UAT preserve Cursor ACP side-by-side behavior.                                          |
| QUAL-01     | Complete | 04-01 targeted tests cover registration, modes, lifecycle mapping, persistence, event mapping, and app selection behavior. |
| QUAL-02     | Complete | 04-02 provider docs explain auth, Sandbox/YOLO, omitted Ask/Agent, no SDK MCP injection, and beta limits.                  |
| QUAL-03     | Complete | 04-02 verification records passing format, typecheck, and lint commands.                                                   |

## Remaining Risks

- **SDK beta risk:** `@cursor/sdk` remains public beta, so API shape and runtime behavior may change. Keep the provider isolated from Cursor ACP and preserve redacted diagnostics.
- **Linux Sandbox unavailability:** Phase 1 evidence showed local SDK Sandbox fails in this Linux devcontainer. Sandbox must remain capability-gated and must not silently downgrade to YOLO.
- **External auth/model discovery dependency:** Cursor SDK auth requires `CURSOR_API_KEY`; model discovery depends on the external Cursor API and current account/service availability.
- **Native SDK dependency risk:** Phase 1 import evidence required a `sqlite3` native rebuild after an install with lifecycle scripts disabled. Keep dependency-backed verification in the devcontainer.

## Deferred Follow-Ups

- **Cloud runtime:** Evaluate Cursor SDK cloud runtime only after local lifecycle and persistence remain stable.
- **Custom tools/MCP:** Revisit Cursor SDK custom tools or MCP wiring only if the SDK exposes a stable supported path. Current provider behavior is no SDK MCP injection.
- **Interactive approval:** Revisit Ask/approval mode only if Cursor SDK exposes a stable host approval response API.

## Verification References

- `.planning/phases/04-hardening-tests-and-docs/04-01-SUMMARY.md` - deterministic test hardening results.
- `.planning/phases/04-hardening-tests-and-docs/04-VERIFICATION.md` - final Phase 4 command evidence and requirement mapping.
- `.planning/phases/03-manifest-and-ui-integration/03-UAT.md` - side-by-side live UI/runtime evidence carried forward for UI-03.

## Milestone Closeout

The v1 Cursor SDK provider milestone is complete at the planned boundary: experimental local Cursor SDK support is implemented, tested, documented, and verified without adding credential storage, cloud runtime, Cursor ACP AskQuestion bridging, Cursor SDK MCP injection, live default tests, or new Cursor SDK-specific UI surfaces.
