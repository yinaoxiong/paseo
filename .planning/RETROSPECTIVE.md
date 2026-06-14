# Project Retrospective

_A living document updated after each milestone. Lessons feed forward into future planning._

## Milestone: v1.0 — Cursor SDK Provider

**Shipped:** 2026-06-14
**Phases:** 4 | **Plans:** 11 | **Tasks:** 31

### What Was Built

- Experimental `cursor-sdk` direct provider using `@cursor/sdk`.
- Local SDK create/send/stream/wait/cancel/resume lifecycle with secret-free persistence handles.
- Explicit Sandbox and YOLO modes with fail-closed unsupported Sandbox behavior.
- SDK model/context/thinking/fast metadata flowing into existing provider snapshots and composer controls.
- Deterministic server/app tests plus provider docs and UAT evidence.

### What Worked

- Starting with a spike kept beta SDK auth, sandbox, native dependency, and resume risks visible before production wiring.
- The injectable SDK runtime made most provider behavior deterministic and testable without live credentials.
- Keeping Cursor SDK side by side with Cursor ACP avoided regressions in the existing Cursor integration.
- UAT was useful for live SDK model metadata, Fast toggle behavior, and side-by-side Cursor ACP/SDK checks that unit tests cannot prove.

### What Was Inefficient

- UAT status metadata used `passed`, while the closeout audit only accepts `complete` or `resolved`; this created a stale closeout warning.
- The SDK native `sqlite3` dependency required rebuild handling after install scripts were skipped.
- Phase 1 and Phase 4 did not have Nyquist `VALIDATION.md` files, so validation coverage had to be called out in the milestone audit.

### Patterns Established

- Cursor SDK credentials prefer provider config at `.dev/paseo-home/config.json` before process env, and documentation must never record key values.
- Provider snapshots should use provider-level list APIs before scratch-session fallback.
- Cursor SDK model/context/thinking IDs stay explicit; stale selections clear instead of falling back to first/default options.
- Beta SDK stream events should map conservatively and preserve redacted diagnostics for unknown shapes.

### Key Lessons

1. Treat SDK beta behavior as integration risk until verified through both deterministic fakes and targeted live UAT.
2. Explicit safety labels matter: Sandbox and YOLO communicate real runtime state better than generic Agent labels.
3. Milestone closeout tools have strict status vocabularies; UAT files should use terminal `status: complete` when all scenarios pass.

### Cost Observations

- Model mix: not tracked.
- Sessions: one milestone branch with 117 detailed commits before squash merge.
- Notable: deterministic fake-runtime tests kept the default verification loop fast while preserving live checks as explicit UAT.

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Sessions           | Phases | Key Change                                                                                          |
| --------- | ------------------ | ------ | --------------------------------------------------------------------------------------------------- |
| v1.0      | 1 milestone branch | 4      | First Cursor SDK direct-provider milestone with phase archives and squash-to-private-main workflow. |

### Cumulative Quality

| Milestone | Tests                                     | Coverage                                | Zero-Dep Additions |
| --------- | ----------------------------------------- | --------------------------------------- | ------------------ |
| v1.0      | 194 targeted tests in final Phase 4 rerun | Targeted provider/app coverage plus UAT | Not tracked        |

### Top Lessons

1. Spike first when a provider SDK has auth, sandbox, native dependency, and event-shape uncertainty.
2. Keep existing providers side by side when replacing them would conflate validation risk with migration risk.
