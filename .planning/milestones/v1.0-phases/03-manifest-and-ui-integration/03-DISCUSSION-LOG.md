# Phase 3: Manifest and UI Integration - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md - this log preserves the alternatives considered.

**Date:** 2026-06-13
**Phase:** 3-Manifest and UI Integration
**Areas discussed:** Provider identity/copy/icon, Mode visibility and Sandbox behavior, Model discovery and fallback behavior, Model parameters/thinking/fast controls

---

## Provider Identity, Copy, and Icon

| Decision                        | Options considered                                                          | Selected                     |
| ------------------------------- | --------------------------------------------------------------------------- | ---------------------------- |
| Provider UI positioning         | Independent SDK provider; Cursor beta variant; Minimal copy                 | Independent SDK provider     |
| Provider icon treatment         | Reuse Cursor icon; Create separate SDK icon; Keep generic Bot fallback      | Reuse Cursor icon            |
| Experimental state placement    | Description copy only; Prominent badge; Docs only                           | Description copy only        |
| Unavailable provider visibility | Visible but not selectable; Completely hidden; Still selectable             | Visible but not selectable   |
| Provider label                  | Cursor SDK; Cursor SDK Beta; Cursor Direct                                  | Cursor SDK                   |
| Description emphasis            | Experimental direct local agent; API key requirement; Sandbox/YOLO safety   | API key requirement          |
| Description specificity         | Requirement plus positioning; Only key requirement; Full config path        | Requirement plus positioning |
| Existing Cursor ACP copy        | Keep unchanged; Rename to Cursor ACP; Add ACP detail without changing label | Keep unchanged               |

**User's choice:** `cursor-sdk` is a separate provider labeled `Cursor SDK`, with Cursor brand icon, experimental/API-key description copy, and no changes to existing Cursor ACP copy.

**Notes:** Unavailable `cursor-sdk` should remain visible in diagnostics/settings but not selectable for new agent creation.

---

## Mode Visibility and Sandbox Behavior

| Decision                                   | Options considered                                         | Selected               |
| ------------------------------------------ | ---------------------------------------------------------- | ---------------------- |
| Mode list when Sandbox unsupported         | Show only YOLO; Show disabled Sandbox; Show both then fail | Show only YOLO         |
| Default mode if Sandbox is supported later | Default Sandbox; Default YOLO; Remember previous selection | Default Sandbox        |
| Mode labels                                | Sandbox / YOLO; Sandbox / Full Access; Safe / YOLO         | Sandbox / YOLO         |
| Sandbox unsupported explanation            | Provider diagnostic; Mode picker hint; Docs only           | Provider diagnostic    |
| Generic Agent/Ask mode                     | Add Agent/Ask; Keep only Sandbox/YOLO                      | Keep only Sandbox/YOLO |

**User's choice:** Show only modes the runtime can currently support. If Sandbox becomes safely detectable later, default to Sandbox. No generic Agent/Ask mode in v1.

**Notes:** The discussion initially treated context length/thinking support as uncertain. We paused to probe `Cursor.models.list` before deciding the model parameter mapping.

---

## Model Discovery and Fallback Behavior

| Decision                                 | Options considered                                                         | Selected                |
| ---------------------------------------- | -------------------------------------------------------------------------- | ----------------------- |
| Model list source                        | SDK plus config merge; SDK only; Hardcoded common models                   | SDK plus config merge   |
| Ready provider with empty SDK model list | Default model row; Treat as error; Hide model control                      | Treat as error          |
| Config model fallback                    | Allow config fallback; Do not allow fallback; Fallback only for empty list | Do not allow fallback   |
| Model discovery failure behavior         | Provider not selectable; Selectable with no models; Show stale cache       | Provider not selectable |
| Model refresh timing                     | Use snapshot refresh; Force refresh on every open; Only settings refresh   | Use snapshot refresh    |

**User's choice:** SDK discovery is authoritative. Config metadata can enrich only successful SDK results, never turn a failed or empty SDK discovery into a ready provider.

**Notes:** App behavior must not show the existing synthetic `Default` model row for `cursor-sdk` when SDK discovery returns an empty model list.

---

## Model Parameters, Thinking, and Fast Controls

| Decision                    | Options considered                                                               | Selected                     |
| --------------------------- | -------------------------------------------------------------------------------- | ---------------------------- |
| Context representation      | Model/context variants; Separate context dropdown; Hide context                  | Model/context variants       |
| Context defaults            | Follow SDK default; No default/preferred variant; Bare base model row            | No default/preferred variant |
| Thinking/reasoning values   | Use SDK raw values; Normalize across providers; Hide until generic UI exists     | Use SDK raw values           |
| Boolean thinking label      | Thinking On/Off; Raw true/false labels; Hide boolean thinking                    | Thinking On/Off              |
| Thinking/reasoning defaults | Follow SDK default; No default/preferred option                                  | No default/preferred option  |
| Fast representation         | Existing feature toggle; Model variant; Hide fast                                | Existing feature toggle      |
| Fast default                | Follow SDK default; Always false/off                                             | Always false/off             |
| Running-agent changes       | Next-turn per-send params; Interrupt current turn; Require new session           | Next-turn per-send params    |
| Removed SDK option          | Clear invalid selection; Fall back to SDK default; Keep stale until send failure | Clear invalid selection      |

**User's choice:** Context becomes model variants, thinking/reasoning uses existing thinking UI with SDK raw values, and fast uses an existing feature toggle. Fast defaults to false/off regardless of SDK metadata.

**Notes:** After an initial inclination to follow the SDK fast default, the user clarified that Paseo should default `fast` to false. This final clarification overrides the earlier option.

---

## the agent's Discretion

- The exact reversible id encoding for combined model/context options is left to implementation.
- Diagnostic wording can follow existing provider snapshot/status language.
- Test boundaries can be refined during planning, with Phase 4 owning final hardening and documentation.

## Deferred Ideas

None.
