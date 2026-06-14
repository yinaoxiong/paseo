---
status: complete
phase: 03-manifest-and-ui-integration
source: [03-VERIFICATION.md]
started: 2026-06-13T17:36:48Z
updated: 2026-06-14T02:34:00Z
---

## Current Test

number: 3
name: Side-by-Side Runtime Check
expected: Cursor SDK changes apply on the next turn without session restart; Cursor ACP behavior and defaults are unchanged.
awaiting: none

## Tests

### 1. Provider Selector Visual/UX Check

test: Open the create-agent provider/model selector with a daemon whose provider snapshot includes Cursor SDK and Cursor ACP.
expected: Cursor SDK appears as a separate experimental provider with Cursor branding; Cursor ACP remains present as Cursor.
why_human: Actual visual rendering and end-to-end selector UX require running the app against a live daemon.
result: passed
evidence:

- 2026-06-14 automated browser check against temporary dev daemon on 0.0.0.0:6769 and Expo web on 8081.
- Host Providers UI showed both "Cursor provider details" and "Cursor SDK provider details" as separate rows.
- After provider refresh, Cursor remained present as "Cursor" and Cursor SDK was "Available" with 39 models.
- Screenshot: /tmp/paseo-phase3-providers.png

### 2. Live SDK Metadata Check

test: With a real Cursor SDK API key, refresh provider metadata and inspect model/context/thinking/fast controls for a Cursor SDK model that exposes those SDK parameters.
expected: Only SDK-discovered model rows/options appear; thinking is unset until selected; fast is off by default and only appears for models exposing fast.
why_human: Live SDK metadata availability and user-facing control behavior depend on external Cursor SDK/API responses.
result: passed
evidence:

- 2026-06-14 automated browser/API check against temporary dev daemon on 0.0.0.0:6769 and Expo web on 8081.
- API snapshot with appVersion 0.1.96 returned Cursor SDK as ready with 39 live SDK-discovered models.
- Cursor SDK model selector showed 39 model rows, including context-parameterized rows such as Fable 5 300k/1m and GPT-5.5 272k/1m.
- Before model selection, the draft showed no concrete thinking value. After selecting Fable 5, the thinking control appeared with the placeholder "Thinking".
- Thinking options matched live SDK metadata: Thinking Off, Thinking On, Low, Medium, High, Extra high, Max. Selecting Low updated the control to "Low".
- The first selected model, Fable 5, did not expose a Cursor SDK `fast` parameter, so no Fast control appeared for that model.
- Follow-up browser check against temporary dev daemon on 0.0.0.0:6769 and Expo web on 8091 selected Cursor SDK -> Composer 2.5, which exposed the Fast toggle in the composer toolbar as `agent-feature-fast_mode`.
- Fast off state persisted `featureValues.fast_mode=false` and rendered the Fast icon with muted stroke `rgb(113, 113, 122)`.
- Fast on state persisted `featureValues.fast_mode=true` and rendered the Fast icon with highlighted stroke `rgb(251, 191, 36)`.
- Server-side Cursor SDK feature listing for Composer 2.5 returned `fast_mode` with `value=false` for off and `value=true` for on.
- Screenshot: /tmp/paseo-phase3-test2-cursor-sdk-thinking.png
- Screenshot: /tmp/paseo-phase3-test2-composer-fast-on.png

### 3. Side-by-Side Runtime Check

test: Create or resume Cursor ACP and Cursor SDK agents side by side and change Cursor SDK model/thinking/fast controls during a session.
expected: Cursor SDK changes apply on the next turn without session restart; Cursor ACP behavior and defaults are unchanged.
why_human: Side-by-side live runtime behavior and absence of user-visible regressions cannot be fully proven by static code inspection.
result: passed
evidence:

- 2026-06-14 live runtime check used a temporary daemon on 0.0.0.0:6770 with a temporary container HOME copied from host `/root/.cursor` and the host Cursor Agent version copied into `/tmp/paseo-cursor-agent-version`.
- The temporary Cursor HOME symlinked `projects`, `chats`, and `skills` directories were replaced with real temporary directories so `cursor-agent acp` could create workspace state inside the devcontainer.
- Cursor ACP `listProviderModels` succeeded with 33 models. It included fast model rows such as `composer-2.5[fast=true]` / "Composer 2.5 Fast" and GPT-5.5 fast rows.
- Cursor SDK `listProviderModels` succeeded with 39 SDK-discovered model rows.
- Created Cursor ACP and Cursor SDK agents side by side in the temporary daemon. Cursor ACP persisted with provider `cursor` and model `composer-2.5[fast=true]`; Cursor SDK persisted with provider `cursor-sdk`, default SDK mode `yolo`, and `fast_mode=false`.
- Updated the live Cursor SDK agent to GPT-5.5 1m context via `set_agent_model_request`; the persisted SDK config changed to the encoded GPT-5.5 model id while the paired Cursor ACP record stayed on `composer-2.5[fast=true]`.
- Updated the same Cursor SDK agent to High thinking via `set_agent_thinking_request`; daemon logs recorded success and the persisted SDK config stored the encoded High reasoning option.
- Updated the same Cursor SDK agent to Fast on via `set_agent_feature_request`; daemon logs recorded success and the persisted SDK config stored `featureValues.fast_mode=true` with UI feature value `true`.
- No live prompt was sent during this check; the next-turn send-param behavior is covered by the targeted Cursor SDK runtime test below.
- Targeted registry test passed: `provider-registry.test.ts` with `registers cursor-sdk side by side with Cursor ACP` and `keeps cursor-sdk provider config isolated from Cursor ACP config`.
- Targeted Cursor SDK runtime test passed: `cursor-sdk-agent.test.ts` with `model, thinking, and fast changes apply through next-turn SDK send params without restarting`.
- The targeted SDK runtime test verifies the next send params include context, updated reasoning, and `{ id: "fast", value: "true" }`, while `createAgent` remains 1, `resumeAgent` remains 0, and the SDK agent is not closed or canceled.

## Summary

total: 3
passed: 3
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

- None.
