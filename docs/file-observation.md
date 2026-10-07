# File observation

Use `packages/server/src/server/file-observer` for recursive filesystem observation. Create one observer service at the owning service boundary, subscribe roots through it, and close it during owner shutdown. Keep platform watchers, directory discovery, exclusion reconciliation, event batching, failure cleanup, diagnostics, and teardown inside the module. A consumer supplies a root and excluded subtrees; it must not branch on the platform or manage child watchers.

Do not replace the Linux implementation with `fs.watch({ recursive: true })`. Node 22 implements Linux recursion in JavaScript by walking the tree and watching every file and directory. Paseo's directory-only Linux watcher already exhausted resources before ignored-tree pruning and a watcher cap were added in [#794](https://github.com/getpaseo/paseo/pull/794).

Closing an observation must remain safe after its root is renamed or removed. Workspace archive removes owned worktrees while releasing observation references, so teardown cannot assume the watched path still exists.

`unsubscribe()` is an awaited barrier. Once it resolves, no scan, reconciliation, queued event, native handle, or callback may remain. `updateIgnore()` is the equivalent barrier for excluded paths: events queued below a newly excluded root cannot be delivered after it resolves. Treat path disappearance while scanning, attaching, or receiving a watcher error as rename/archive churn. Surface permission and resource errors so WorkspaceGit can enter bounded polling.

Linux topology repair is trailing-debounced and scoped to the renamed path. A file rename needs one classification stat; a new or moved directory scans only its subtree. Full-tree scans are reserved for startup and ignore-set replacement. The initial Linux scan conservatively emits existing files discovered before their directory watcher was installed; WorkspaceGit batches these into one refresh. Benchmark this startup cost with pre-populated trees.

Windows and macOS use one native recursive watcher plus an ignored-pruned, directory-indexed inventory. Native events deliver immediately. Named events trigger serialized shallow scans of their parent directories; known directory events also reconcile that subtree. This recovers concrete create and delete paths omitted by coalescing without walking the whole root for each edit. Classification is admission-controlled to 32 concurrent `fs.stat` calls, since `fs.stat` runs on the libuv threadpool the whole daemon shares. Startup and exclusion changes use an awaited full inventory barrier. Activity arms a full safety audit 30 seconds after it settles, with a 30-second minimum interval and a five-minute starvation bound; pathless native events also trigger an immediate shallow root scan. Observation fails into polling rather than retaining more than 250,000 file and directory entries per root. A repository that large is also expensive to poll, so degraded polling doubles its gap from 5 seconds to a 60-second ceiling while the workspace snapshot comes back unchanged, and resets to 5 seconds on the first change. Explicit reads still force a refresh; the ceiling only bounds how long an edit made outside Paseo stays undiscovered.

Read aggregate health from the owning observer service. Runtime metrics include active observations, native handles, tracked native files, pending events and immediate reconciliation work, scoped and full reconciliation activity and latency, and failure counts. `nativeTrackedFileCount` and other per-file counters are native-backend diagnostics only — the Linux backend keeps no per-file inventory and reports zero — so a cross-platform assertion belongs on delivered events, not those counters. Delayed safety audits do not count as pending work. Closing the service releases every subscription and clears its diagnostics. Do not add path lists, watcher handles, or platform-specific controls to this interface.

Git owns Git-ignore evaluation. The observer accepts absolute excluded roots and applies updates without replacing the observation or exposing its watcher topology. This keeps tracked files inside otherwise ignored directories observable and keeps Git policy out of the filesystem module.

Workspace Git verifies each repository metadata subscription with a one-shot canary inside the Git directory. If the event does not round-trip through the subscription callback, treat the watcher as unavailable and enter degraded polling. Refresh working-tree Git-ignore exclusions from ignore-file events, newly observed directories, and watcher recovery, never from a healthy-watcher timer. `git ls-files` reports an ignored directory only once it exists, so new directory topology is a trigger in its own right; the refresh is edge-triggered per directory and debounced so a dependency install collapses into a couple of Git runs.

## Git activity policy

Automatic Git observation is gated by one host-global setting, `daemon.git.policy` — see
[data-model.md](./data-model.md#automatic-git-activity). There is no project-level control. The
decision owner is `git-activity/policy.ts`; every automatic Git source asks it instead of
inspecting the filesystem itself.

Manual mode still permits the Changes panel's Refresh action. Keep that action visible before
the first snapshot: a paused response's `isGit: false` is an error-envelope placeholder, not
evidence that the directory is not a repository. The action reads status and the selected diff
once; opening the panel or reconnecting does not authorize a read. An uncached comparison asks
for another refresh. Explicit diff reads bypass the cache because no watcher invalidates it in
manual mode. Desktop users need the private app as well as the private daemon for this UI flow;
updating a CLI tarball does not replace the desktop's bundled frontend.
The app gates this flow on `gitManualRefresh`; older private hosts get an update message rather
than an unsupported diff request.

`isAutomatic()` is synchronous and never touches the disk, because callers sit on request and
event-delivery paths that must not wait on a possibly-stalled mount. That has one consequence you
have to design around: a workspace that has not been classified yet reads `unknown`, which is
manual. Classification is therefore asynchronous, and the observer registers a workspace only
after its verdict lands. A workspace is normally refused on first sight and then converges on the
next classification.

Do not "fix" that first-sight refusal by classifying inline. It would put the classification on
the caller's critical path, which is the freeze this policy exists to prevent. Do not cache a
verdict past its TTL either: an expired verdict reads `unknown` until it is re-checked, so stale
permission is never granted.

Classification never touches the workspace to decide it. It reads the daemon's own
`/proc/self/mountinfo` (cheap, in-memory behind a 30-second cache) and resolves the longest
matching mount point for the cwd: a known network FUSE type is refused, a local type is accepted,
and anything unrecognized is `unknown`. Neither a `stat` on the workspace nor a child process ever
runs, because a `stat` on a stalled FUSE mount cannot be interrupted and would block the daemon's
libuv pool. Every path is classified from the same mount table, so there is no slot to contend for
and no path is denied because another one was being classified.

That decision assumes the Git metadata a workspace reads lives on the same mount as the workspace
itself. A `.git` symlinked or `gitdir:`-linked onto a different mount is classified by the
workspace's own mount and is therefore not detected. Do not reintroduce a workspace probe to
catch it: verifying each metadata path means touching the stalled tree this policy refuses to
read. The classification is a heuristic about where the tree lives, and `unknown` is the honest
answer whenever the mount table cannot say.

Linux is the only platform that classifies. Everywhere else returns `unknown`, which is manual —
correct but conservative. `unknown` means "could not determine", so it must never be presented as
a detected network filesystem; `reason` carries the distinction and is open-ended by design.
Mobile is a client: it reads the daemon's verdict and never inspects host paths.

### Mount table invalidation is TTL-only

`invalidateMountTable()` exists on the classifier and the policy service but has **no production
caller**. Mount topology is refreshed by the classifier's own 30-second mount-table TTL, which
`loadMountTable` consults on every classification. Nothing in the daemon currently watches for
mount changes.

**There is no wall-clock SLA for detecting a mount change.** Classification only runs when
something asks: a workspace registration, an explicit refresh, or a verdict read that has aged
past its TTL. The 60-second verdict TTL is a bound on how long a granted permission stays valid,
not a promise that the mount is re-inspected every 60 seconds: an expired verdict simply stops
being served and the next read re-classifies. A workspace nobody touches still keeps its verdict
indefinitely, because nothing re-classifies it in the background — the TTL only ever cuts
permission short, it never renews it.

Do not treat that as a guarantee that a mount change is seen within 30 seconds. If you need
prompt detection, wire `invalidateMountTable()` (or `invalidate(cwd)`) to the mount event; neither
is called today.

### Verdict and generation bookkeeping is bounded

The verdict cache is capped (512 entries by default, oldest evicted), and the per-workspace
invalidation-generation map is capped at the same bound.

A classification is admitted by a **unique per-attempt id** plus a process-wide invalidation
epoch, not by comparing version numbers. Numbers are vulnerable to ABA here: a classification
captures version 0, invalidation drops the in-flight slot and the version entry, the key is
re-registered at 0, and the old classification then matches and lands a stale verdict. The epoch
exists because per-key generation only covers keys that already have a verdict, so a global
invalidate would otherwise leave in-flight classifications for never-classified keys admissible.
Evicting bookkeeping cannot grant stale permission: the superseded attempt's id is no longer the
live one. In-flight classifications are tracked per path, so one path being classified never
blocks or denies another.

Residual risk, stated plainly: this reduces Paseo's own automatic Git work. Native `fs.watch`
registration, synchronous I/O owned by other features, and FUSE itself are still outside it, so
the daemon is not universally safe on a stalled mount. The identity and recovery paths in
`project-key.ts`, `workspace-registry-bootstrap-legacy.ts`, `workspace-recovery-service.ts` and
`import-sessions.ts` keep their existing synchronous path handling and remain an open item.

The real-filesystem contracts and daemon auto-archive lifecycle run in the normal server test suite. Use the scripts only for manual performance and soak work: `npm run measure:file-observer --workspace=@getpaseo/server` measures burst and sustained-create behavior, and `npm run repro:file-observer-teardown --workspace=@getpaseo/server` runs the teardown soak.
