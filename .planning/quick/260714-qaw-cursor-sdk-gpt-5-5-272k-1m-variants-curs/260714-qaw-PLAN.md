---
phase: quick
plan: "260714-qaw"
type: execute
wave: 1
depends_on: []
files_modified:
  - packages/server/src/server/agent/providers/cursor-sdk/model-options.ts
  - packages/server/src/server/agent/providers/cursor-sdk/model-options.test.ts
  - packages/server/package.json
  - package-lock.json
  - docs/providers.md
autonomous: true
requirements: []
must_haves:
  truths:
    - "Cursor SDK GPT-5.5 context rows have distinct visible labels, GPT-5.5 - 272K and GPT-5.5 - 1M, even when every upstream variant is named GPT-5.5 and each variant also carries reasoning and fast parameters."
    - "Each expanded row still decodes and sends the intended context-only selection; label repair does not invent reasoning or fast values."
    - "The server dependency and lockfile resolve @cursor/sdk 1.0.23, and the durable upstream-metadata labeling constraint is documented."
    - "The changed targeted test, repository format, lint, and typecheck gates pass inside the task worktree's devcontainer without running a broader test suite."
  artifacts:
    - path: "packages/server/src/server/agent/providers/cursor-sdk/model-options.ts"
      provides: "Context-row labeling that only uses a variant label when the variant parameter set exactly matches the projected selection, otherwise using the context value display name"
    - path: "packages/server/src/server/agent/providers/cursor-sdk/model-options.test.ts"
      provides: "Regression coverage using live-shaped GPT-5.5 metadata with context, reasoning, and fast parameters on identically named variants"
    - path: "packages/server/package.json"
      provides: "@cursor/sdk 1.0.23 dependency baseline"
    - path: "package-lock.json"
      provides: "Exact @cursor/sdk 1.0.23 package and optional platform package resolutions"
    - path: "docs/providers.md"
      provides: "Durable rule for deriving projected model-row labels from parameter values rather than non-unique composite variant display names"
  key_links:
    - from: "packages/server/src/server/agent/providers/cursor-sdk/model-options.test.ts"
      to: "packages/server/src/server/agent/providers/cursor-sdk/model-options.ts"
      via: "expandCursorSdkModels and decodeCursorSdkModelOptionId regression assertions"
      pattern: "expandCursorSdkModels|decodeCursorSdkModelOptionId"
    - from: "packages/server/src/server/agent/providers/cursor-sdk/model-options.ts"
      to: "packages/server/src/server/agent/providers/cursor-sdk/sdk-runtime.ts"
      via: "model parameters and variants returned by Cursor.models.list"
      pattern: "parameters|variants"
    - from: "packages/server/package.json"
      to: "package-lock.json"
      via: "npm workspace dependency update performed inside the devcontainer"
      pattern: "@cursor/sdk"
---

<objective>
Repair Cursor SDK context-variant labels and align the checked-in SDK baseline.

Purpose: Cursor's current GPT-5.5 metadata describes composite context/reasoning/fast variants with the same display name, so Paseo's partial variant match produces two indistinguishable model-picker rows. Preserve parameterized selection identity while making the projected context dimension visible and stable.

Output: Correct model-label projection, a live-metadata-shaped regression test, @cursor/sdk 1.0.23 package metadata, and provider documentation for the metadata constraint.
</objective>

<execution_context>
@/mnt/private_yax_qy4/projects/paseo/.codex/gsd-core/workflows/execute-plan.md
@/mnt/private_yax_qy4/projects/paseo/.codex/gsd-core/templates/summary.md
</execution_context>

<context>
@AGENTS.md
@docs/providers.md
@docs/testing.md
@docs/development.md
@packages/server/src/server/agent/providers/cursor-sdk/model-options.ts
@packages/server/src/server/agent/providers/cursor-sdk/model-options.test.ts
@packages/server/src/server/agent/providers/cursor-sdk/sdk-runtime.ts
@packages/server/package.json
@package-lock.json
</context>

<tasks>

<task type="auto">
  <name>Task 1: Reproduce and fix composite Cursor variant labels</name>
  <files>packages/server/src/server/agent/providers/cursor-sdk/model-options.ts, packages/server/src/server/agent/providers/cursor-sdk/model-options.test.ts</files>
  <action>Add a deterministic regression case that mirrors the current Cursor.models.list shape for GPT-5.5: context values 272k and 1m, separate reasoning and fast parameters, and variants whose params contain all three dimensions while every variant displayName is GPT-5.5. Assert the expanded labels are exactly `GPT-5.5 - 272K` and `GPT-5.5 - 1M`, remain unique, and decode to distinct context-only SDK selections without reasoning or fast defaults. Then tighten variant matching so a variant contributes its display name only when its parameter set exactly equals the projected selection (same parameter count and id/value pairs, independent of order); a composite variant must fall back to the selected context value's displayName. Preserve the existing encoded-ID and selection-validation behavior. Run the repository formatting script for these two files inside the already-created devcontainer before verification.</action>
  <verify>From the worktree's devcontainer, run only `npx vitest run packages/server/src/server/agent/providers/cursor-sdk/model-options.test.ts --bail=1` after `npm run format:files -- packages/server/src/server/agent/providers/cursor-sdk/model-options.ts packages/server/src/server/agent/providers/cursor-sdk/model-options.test.ts`.</verify>
  <done>The live-shaped regression fails on the old partial-match behavior, passes after the exact-match repair, shows unique 272K/1M labels, and proves the encoded selections remain context-only and distinct.</done>
</task>

<task type="auto">
  <name>Task 2: Upgrade the SDK lock and document the metadata invariant</name>
  <files>packages/server/package.json, package-lock.json, docs/providers.md</files>
  <action>Inside the already-created devcontainer for `/data/home/root/.paseo/worktrees/cursor-sdk-model-label-fix` (repo path `/workspaces/paseo`), run `npm install @cursor/sdk@1.0.23 --workspace=@getpaseo/server`; do not run npm on the host and do not hand-edit the lockfile. Confirm the manifest range advances to 1.0.23 and the lockfile resolves the core package plus its optional platform packages at 1.0.23 without unrelated dependency churn. In the Cursor SDK section of `docs/providers.md`, record that upstream variant display names are not unique identifiers and may describe composite parameter tuples; context-projected picker rows must derive their suffix from `parameters[].values[].displayName` unless a variant exactly matches the row's complete parameter set, while encoded model identity remains model id plus params. Format the manifest/doc files through the repository npm formatting script inside the devcontainer.</action>
  <verify>Inspect the focused diff and use `rg -n '"@cursor/sdk"|"version": "1\.0\.23"|sdk-(darwin|linux|win32).*-1\.0\.23|variant display|parameter' packages/server/package.json package-lock.json docs/providers.md` to confirm the dependency and documentation changes; do not run another test suite.</verify>
  <done>The package manifest and generated lockfile consistently target @cursor/sdk 1.0.23 with no unrelated dependency edits, and provider docs make the non-unique/composite variant-label rule explicit.</done>
</task>

<task type="auto">
  <name>Task 3: Run repository quality gates in the devcontainer</name>
  <files>packages/server/src/server/agent/providers/cursor-sdk/model-options.ts, packages/server/src/server/agent/providers/cursor-sdk/model-options.test.ts, packages/server/package.json, package-lock.json, docs/providers.md</files>
  <action>Run `npm run format`, `npm run lint`, and `npm run typecheck` from `/workspaces/paseo` inside the worktree's already-created devcontainer. Do not run the full test suite or re-run the Task 1 targeted test after it has passed. If typecheck reports cross-workspace errors attributable to stale generated declarations, run `npm run build:server` inside the same devcontainer before diagnosing or patching anything, then retry `npm run typecheck` once. Review the final diff after formatting and ensure only the five planned files plus GSD artifacts changed.</action>
  <verify>`npm run format`, `npm run lint`, and `npm run typecheck` exit successfully inside the devcontainer; `git diff --check` is clean and `git status --short` contains no unplanned implementation or dependency files.</verify>
  <done>The focused regression and all required repository quality gates are green in the devcontainer, with no broad test run and no unrelated source or lockfile churn.</done>
</task>

</tasks>

<verification>
All dependency, formatting, test, build, lint, and typecheck commands run inside the already-created devcontainer for `/data/home/root/.paseo/worktrees/cursor-sdk-model-label-fix`. The only Vitest invocation is the changed `model-options.test.ts` file with `--bail=1`; do not run a workspace or repository test suite.
</verification>

<success_criteria>

- GPT-5.5 context rows display distinct 272K and 1M labels for composite, identically named upstream variants.
- Encoded and decoded selections preserve the correct context value and add no reasoning or fast default.
- @cursor/sdk and all locked optional platform packages resolve to 1.0.23.
- Provider docs preserve the model-metadata labeling rule for future SDK changes.
- Targeted test, repository format, lint, and typecheck all pass inside the devcontainer.
  </success_criteria>
