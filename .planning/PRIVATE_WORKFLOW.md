# Private Fork Workflow

This file is private workflow context for the `personal/stable` branch. It is not part of upstream Paseo process documentation and should not be copied into upstream PR branches.

## Branch Roles

- `main`: local mirror of `origin/main`; keep it clean and do not develop on it.
- `personal/stable`: private daily-use integration branch, based on the latest upstream stable tag plus private-only configuration and selected cherry-picked fixes.
- `personal/next`: optional experimental integration branch for release candidates or current `origin/main`.
- `gsd/<milestone>`: GSD milestone branch for exploratory or multi-phase private work.
- `pr/<topic>`: upstream PR branch created from `origin/main`; must contain only the minimal upstreamable change.

## Directory Roles

- `/mnt/private_yax_qy4/projects/paseo`: keep this checkout on `personal/stable` for normal private development and local use.
- `/data/home/root/.paseo/worktrees/...`: use these worktrees for upstream PR branches and parallel GSD work.
- `.planning/`: private GSD state and runbooks. Keep it out of upstream PRs unless a specific upstream-facing planning document is intentionally created.
- `.devcontainer/`: private/local container configuration. Keep it out of upstream PRs.

## Creating An Upstream PR Branch

Always start upstream PR branches from `origin/main`, never from `personal/stable`:

```bash
cd /mnt/private_yax_qy4/projects/paseo
git fetch origin --tags --prune
git worktree add /data/home/root/.paseo/worktrees/<id>/<slug> -b pr/<topic> origin/main
```

If the work already exists on a private branch, extract only the relevant patch:

```bash
git switch -c pr/<topic> origin/main
git cherry-pick <clean-commit>
# or use interactive staging / patch restore for a narrower slice
git add -p
```

Before opening an upstream PR:

```bash
git diff origin/main...HEAD
git status --short
```

The diff must not include `.planning/`, `.devcontainer/`, private provider config, private runbooks, or unrelated local workflow changes.

## Using An Upstream PR Locally

After a clean PR commit exists, cherry-pick it into `personal/stable` with provenance:

```bash
cd /mnt/private_yax_qy4/projects/paseo
git switch personal/stable
git cherry-pick -x <pr-commit>
```

Run targeted checks for the touched files, plus typecheck when code changed:

```bash
npm run format:check:files -- <files>
npm run lint -- <files>
npx vitest run <changed-test-file> --bail=1
npm run typecheck
```

If the PR later merges upstream and a future stable tag includes it, Git may detect the same patch. If a duplicate cherry-pick conflict appears during stable updates, prefer the upstream version and skip/drop the private duplicate.

## Tracking Upstream Stable Releases

Fetch upstream tags and identify the latest non-beta, non-rc tag:

```bash
git fetch origin --tags --prune
git tag --sort=-v:refname | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | head
```

Update `personal/stable` by merging the new stable tag, not by tracking `origin/main` directly:

```bash
git switch personal/stable
git merge vX.Y.Z
```

Use `merge` for the private integration branch so update points are explicit. Use `rebase` or fresh `origin/main` branches only for upstream PR work.

## Parallel GSD Milestones

Use one worktree per milestone:

```bash
git worktree add /data/home/root/.paseo/worktrees/<id>/<milestone> -b gsd/<milestone> origin/main
```

Each GSD worktree should keep its own `.planning/` state. Try to avoid overlapping files across concurrent milestones; if overlap is unavoidable, plan a later integration pass on `personal/stable`.

At the end of each GSD phase, extract upstreamable slices into `pr/<topic>` branches from `origin/main`, then cherry-pick clean PR commits back into `personal/stable` when you want to use them locally.

## Container Notes

The `paseo-dev` container may be remounted to whichever checkout needs verification. Confirm the mounted branch before running checks:

```bash
docker exec paseo-dev sh -lc 'cd /workspaces/paseo && git status --short --branch'
```

If typecheck fails because workspace declarations are stale after switching the mounted checkout, rebuild the owning stack before diagnosing type errors:

```bash
npm run build:client
npm run build:server
```

Run all private builds inside the container defined by `/mnt/private_yax_qy4/projects/paseo/.devcontainer`. This is especially important for CLI tarballs because the package includes production `node_modules` and native/runtime dependencies. Building on the host can accidentally capture a different Node/npm/native dependency environment.

## Personal CLI Tarballs

For private daily use, prefer a fully bundled CLI tarball over a desktop build when the changes are server-only. The target install shape is:

```bash
npm install -g /mnt/private_yax_qy4/projects/paseo/.local-build/getpaseo-cli-<version>.tgz
paseo --version
```

The tarball must be built from the current `personal/stable` checkout inside the devcontainer, and it must include the local workspace packages plus production runtime dependencies under the CLI package's bundled `node_modules`.

Do not create this package by unpacking or patching a previous `.local-build/*.tgz`. Build it from source each time:

1. Confirm `/workspaces/paseo` in `paseo-dev` is mounted to `/mnt/private_yax_qy4/projects/paseo` and is on `personal/stable`.
2. Run `npm run build:server` in the container to rebuild highlight, relay, protocol, client, server, and CLI.
3. Stage local `@getpaseo/*` workspace packages with a private build version such as `0.1.90+personal.1`.
4. In a clean CLI staging directory, install production dependencies using those local workspace package tarballs.
5. Add `node_modules` to the CLI package files and populate `bundledDependencies` from the installed dependency tree.
6. Run `npm pack --ignore-scripts` from the clean CLI staging directory.
7. Verify by installing the result into a temporary npm prefix and checking both `paseo --version` and bundled `@getpaseo/server/package.json`.

The CLI package's bundled server version must match the CLI version. The package should not depend on registry copies of `@getpaseo/server`, `@getpaseo/client`, `@getpaseo/protocol`, `@getpaseo/relay`, or `@getpaseo/highlight`.
