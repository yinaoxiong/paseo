# Milestones

## v1.0 Cursor SDK Provider (Shipped: 2026-06-14)

**Delivered:** Experimental native Cursor SDK provider support for local agents, shipped side by side with Cursor ACP and documented as beta-scoped.

**Phases completed:** 1-4 (11 plans, 31 tasks)

**Key accomplishments:**

- Added a side-by-side direct provider with id `cursor-sdk`, backed by `@cursor/sdk` and isolated from Cursor ACP.
- Implemented local SDK session lifecycle, canonical user timeline rows, conservative SDK stream mapping, interruption, and strict secret-free resume handles.
- Exposed explicit Sandbox and YOLO modes with fail-closed Sandbox behavior and dangerous/unattended YOLO metadata.
- Wired Cursor SDK models, context variants, thinking options, and fast mode into existing provider snapshot and composer controls without scratch discovery sessions.
- Preserved Cursor ACP behavior with targeted registry, app selection, icon, and composer regression coverage.
- Closed the milestone with deterministic tests, provider docs, UAT evidence, typecheck, lint, and a milestone audit.

**Stats:**

- 122 files changed relative to `personal/stable` before closeout archival
- 21,670 inserted / 60 deleted lines relative to `personal/stable` before closeout archival
- 4 phases, 11 plans, 31 tasks
- 117 detailed commits on `gsd/v1.0-milestone` before squash merge

**Archives:**

- [v1.0-ROADMAP.md](milestones/v1.0-ROADMAP.md)
- [v1.0-REQUIREMENTS.md](milestones/v1.0-REQUIREMENTS.md)
- [v1.0-MILESTONE-AUDIT.md](milestones/v1.0-MILESTONE-AUDIT.md)
- [v1.0-phases/](milestones/v1.0-phases/)

**Detailed history branch:** `gsd/v1.0-milestone`

**Known deferred items:** Cursor SDK cloud runtime, custom tools/MCP wiring, and interactive approval remain deferred future work.

**What's next:** Start a fresh milestone with `$gsd-new-milestone`.

---
