import { resolve } from "node:path";
import type { Logger } from "pino";
import {
  type GitActivityEffectiveMode,
  type GitActivityPolicy,
  type GitActivityReason,
  normalizeGitActivityPolicy,
} from "@getpaseo/protocol/messages";
import {
  FILESYSTEM_CACHE_MAX_ENTRIES,
  FILESYSTEM_CACHE_TTL_MS,
  type FilesystemClassifier,
  type WorkspaceFilesystemClass,
  type WorkspaceFilesystemVerdict,
} from "./filesystem.js";

/**
 * Storage classes that are never automatic. `unknown` covers an unreadable or
 * unusable mount table, a cwd on a mount the classifier does not recognize, and a
 * platform that is not Linux: all of them are treated exactly like network
 * storage.
 */
const STORAGE_CLASS_REASONS: Record<WorkspaceFilesystemClass, GitActivityReason> = {
  local: "storage_local",
  network: "storage_network",
  unknown: "storage_unknown",
};

export interface GitActivityState {
  /** The host setting. Never derived from a workspace. */
  configuredPolicy: GitActivityPolicy;
  /**
   * What this workspace actually gets. Only `automatic` permits background work;
   * `manual` and `unknown` both mean explicit user actions only.
   */
  effectiveMode: GitActivityEffectiveMode;
  /** Why the mode resolved this way. Open on the wire; fall back to the mode. */
  reason?: string;
  /** Last completed classification; null when never checked. */
  lastCheckedAt: string | null;
}

export interface GitActivityPolicyServiceOptions {
  classifier: FilesystemClassifier;
  logger: Logger;
  /** Reads the host setting. Called on every decision, so it is never stale. */
  getPolicy: () => GitActivityPolicy;
  /** Supplies the verdict when none is cached. Defaults to the classifier. */
  classify?: (cwd: string) => Promise<WorkspaceFilesystemVerdict>;
  now?: () => number;
  /** How long a stored verdict may be served before it must be re-checked. */
  cacheTtlMs?: number;
  /** Bounded cache: the oldest entry is evicted past this many workspaces. */
  maxEntries?: number;
}

/**
 * The single host-global decision owner for automatic Git activity.
 *
 * Every automatic Git source asks this service instead of classifying the
 * filesystem itself: `workspace-git-service` (watchers, fetch, polls, canary),
 * `workspace-reconciliation-service` (root discovery and placement), `session`
 * (projection Git data, reconnect and descriptor enrichment),
 * `CheckoutDiffManager` (subscriptions and refreshes), checkout and Git mutation
 * guards, and the auto-archive path.
 *
 * `isAutomatic()` is synchronous and never touches the filesystem, so a caller on
 * an event-delivery or request path can gate work without awaiting a
 * classification that may involve a stalled mount. A workspace that has not been
 * classified yet — or whose verdict has aged out — reads as `unknown`, which is
 * manual. Stale permission is never granted.
 */
export interface GitActivityPolicyService {
  /** True only for a workspace with a fresh verified-local (or enabled) verdict. */
  isAutomatic(cwd: string): boolean;
  /** The projection payload for one workspace, without awaiting classification. */
  peek(cwd: string): GitActivityState;
  /** Classifies under `auto` (re-classifying when stale), then returns state. */
  resolve(cwd: string): Promise<GitActivityState>;
  /**
   * Classify `cwd` if its verdict is missing or stale, and report which
   * workspaces the outcome newly admits.
   *
   * `peek()` is synchronous and must never touch a possibly-stalled mount, so
   * an unclassified workspace reads `unknown` -- and without a caller that
   * later asks for the real answer, `auto` would leave every workspace manual
   * forever. This is the one place that converges: it awaits the classification
   * off the request path and returns the paths whose effective mode became
   * `automatic` as a result, so the caller can start observation exactly once
   * and broadcast the projection.
   */
  ensureClassification(cwd: string): Promise<{ cwd: string; automatic: boolean }>;
  /** Re-reads the host setting. Workspace verdicts are kept. */
  refreshPolicy(): void;
  invalidate(cwd?: string): void;
  /** Mount topology changed: every verdict and the mount table are stale. */
  invalidateMountTable(): void;
  dispose(): void;
}

interface VerdictEntry {
  verdict: WorkspaceFilesystemVerdict;
  /** Wall-clock time the verdict was stored, for bounded freshness. */
  storedAt: number;
}

interface InFlightEntry {
  promise: Promise<void>;
  /** Unique id for this attempt. Probes are admitted by identity, not by number. */
  attempt: number;
  /** Invalidation generation this classification started under. */
  version: number;
  /** Policy generation this classification started under. */
  policyGeneration: number;
  /** Global invalidation epoch this classification started under. */
  epoch: number;
}

export function createGitActivityPolicyService(
  options: GitActivityPolicyServiceOptions,
): GitActivityPolicyService {
  const logger = options.logger.child({ module: "git-activity-policy" });
  const classify = options.classify ?? ((cwd: string) => options.classifier.classify(cwd));
  const normalizeCwd = (cwd: string): string => resolve(cwd);
  const now = options.now ?? (() => Date.now());
  const ttlMs = options.cacheTtlMs ?? FILESYSTEM_CACHE_TTL_MS;
  const maxEntries = options.maxEntries ?? FILESYSTEM_CACHE_MAX_ENTRIES;

  let policy: GitActivityPolicy = normalizeGitActivityPolicy(options.getPolicy());
  /**
   * Bumped on every real policy change. Comparing the generation rather than the
   * value is what makes an auto -> manual -> auto switch safe: the value ends up
   * equal, but a classification launched before the switch is still stale.
   */
  let policyGeneration = 0;
  /**
   * Bumped by every global invalidation (`invalidate()`, `invalidateMountTable()`).
   *
   * Per-key generation alone cannot reject a classification for a key that has no recorded
   * version: `invalidate()` only bumps keys that already have a verdict, so an
   * in-flight classification for a never-classified key kept its generation and could land
   * a verdict after the caller asked for everything to be dropped. The epoch
   * covers every key, including those with no state.
   */
  let globalEpoch = 0;
  /**
   * Monotonic, never-reused attempt id.
   *
   * A per-key *number* is vulnerable to ABA: an old classification captures 0,
   * `invalidate` clears the in-flight slot and drops the version entry, the key is
   * re-registered and gets 0 again, and the old classification now passes its own check and
   * lands a stale verdict. Ids are unique, so a late classification can never be mistaken
   * for the current attempt.
   */
  let nextAttempt = 1;
  /** Live attempt ids by key; a classification is admitted only while its id is current. */
  const liveAttempts = new Map<string, number>();
  /**
   * Per-workspace invalidation generation. Bumped by `invalidate(cwd)` so a
   * classification already in flight for that path cannot refill the cache after
   * the caller asked for it to be dropped.
   */
  const versions = new Map<string, number>();
  const verdicts = new Map<string, VerdictEntry>();
  const inFlight = new Map<string, InFlightEntry>();
  /**
   * Pending `ensureClassification` transitions, keyed by workspace. Concurrent
   * callers collapse onto one so a burst of registrations yields a single
   * "start observation" decision, not one per caller.
   */
  const admissionClaims = new Map<string, Promise<boolean>>();
  let disposed = false;

  function stateFor(
    configured: GitActivityPolicy,
    verdict: WorkspaceFilesystemVerdict | null,
  ): GitActivityState {
    if (configured === "manual") {
      // Manual never calls the classifier: deciding "do not inspect storage"
      // must not be the thing that inspects storage.
      return {
        configuredPolicy: configured,
        effectiveMode: "manual",
        reason: "policy_manual",
        lastCheckedAt: null,
      };
    }
    if (configured === "enabled") {
      // Enabled skips classification entirely; unknown storage is accepted.
      return {
        configuredPolicy: configured,
        effectiveMode: "automatic",
        reason: "policy_enabled",
        lastCheckedAt: null,
      };
    }
    if (!verdict) {
      return {
        configuredPolicy: configured,
        effectiveMode: "unknown",
        reason: "classification_pending",
        lastCheckedAt: null,
      };
    }
    return {
      configuredPolicy: configured,
      effectiveMode: verdict.class === "local" ? "automatic" : "manual",
      reason: STORAGE_CLASS_REASONS[verdict.class],
      lastCheckedAt: new Date(verdict.checkedAt).toISOString(),
    };
  }

  function freshVerdict(key: string): WorkspaceFilesystemVerdict | null {
    const entry = verdicts.get(key);
    if (!entry) {
      return null;
    }
    // An aged-out verdict is not evidence of anything. Callers must re-check
    // rather than keep the permission it granted.
    if (now() - entry.storedAt >= ttlMs) {
      return null;
    }
    return entry.verdict;
  }

  function bumpVersion(key: string): void {
    versions.set(key, (versions.get(key) ?? 0) + 1);
    trimVersions();
  }

  /**
   * Keep the invalidation-generation map bounded.
   *
   * `verdicts` is capped at `maxEntries`; without trimming here too, every path
   * ever seen would keep a generation entry forever on a long-lived daemon.
   *
   * Trimming is safe because admission no longer rests on this number alone: a
   * classification is admitted by its unique attempt id (see `liveAttempts`) plus the
   * global epoch, so a dropped-and-reused version value cannot let a late classification
   * land a stale verdict.
   */
  function trimVersions(): void {
    while (versions.size > maxEntries) {
      const oldest = versions.keys().next();
      if (oldest.done) {
        return;
      }
      versions.delete(oldest.value);
    }
  }

  function storeVerdict(
    key: string,
    verdict: WorkspaceFilesystemVerdict,
    attempt: number,
    version: number,
    capturedPolicyGeneration: number,
    capturedEpoch: number,
  ): void {
    if (disposed) {
      return;
    }
    // Admission is by attempt identity, not by comparing numbers: identity is
    // immune to the ABA reuse above, where an evicted version entry comes back
    // with the same value the old classification captured.
    if (liveAttempts.get(key) !== attempt) {
      // Superseded, invalidated, or its slot was dropped while in flight.
      return;
    }
    if (versions.get(key) !== version) {
      // Invalidated while this classification was in flight.
      return;
    }
    if (capturedEpoch !== globalEpoch) {
      // A global invalidation happened after this classification started.
      return;
    }
    if (capturedPolicyGeneration !== policyGeneration) {
      // The policy changed (including auto -> manual -> auto) mid-classification.
      return;
    }
    verdicts.set(key, { verdict, storedAt: now() });
    if (verdicts.size > maxEntries) {
      const oldest = verdicts.keys().next();
      if (!oldest.done) {
        verdicts.delete(oldest.value);
        // The generation goes with the verdict so the map cannot outgrow the
        // verdict cache. This is bookkeeping only — a classification still in flight for
        // this key is rejected by its attempt id, not by this number.
        versions.delete(oldest.value);
      }
    }
    if (verdict.class !== "local") {
      logger.info(
        { cwd: key, class: verdict.class, reason: verdict.reason },
        "Automatic git activity withheld for workspace",
      );
    }
  }

  /**
   * Starts one classification for `key` unless one is already in flight. The
   * in-flight slot is what keeps this bounded: repeated callers collapse onto a
   * single classification instead of each starting their own.
   */
  function startClassification(key: string): Promise<void> {
    const existing = inFlight.get(key);
    if (existing) {
      return existing.promise;
    }

    // Register the version this classification started under. Without this, a key that was
    // never explicitly invalidated has no version recorded and every fresh
    // classification would look invalidated and be discarded.
    const version = versions.get(key) ?? 0;
    versions.set(key, version);
    trimVersions();
    const capturedPolicyGeneration = policyGeneration;
    const capturedEpoch = globalEpoch;
    const attempt = nextAttempt;
    nextAttempt += 1;
    liveAttempts.set(key, attempt);
    const promise: Promise<void> = classify(key)
      .then((verdict): undefined => {
        storeVerdict(key, verdict, attempt, version, capturedPolicyGeneration, capturedEpoch);
        return undefined;
      })
      .catch((error: unknown) => {
        // An unclassified workspace stays unclassified: failure is never
        // permission to observe.
        if (!disposed) {
          logger.warn(
            { cwd: key, err: error instanceof Error ? error.message : String(error) },
            "Filesystem classification failed; workspace stays manual",
          );
        }
      })
      .finally(() => {
        // Only clear our own ownership, so a newer classification started after an
        // invalidation is not removed by this one finishing late.
        if (inFlight.get(key)?.promise === promise) {
          inFlight.delete(key);
        }
        if (liveAttempts.get(key) === attempt) {
          liveAttempts.delete(key);
        }
      });
    inFlight.set(key, {
      promise,
      attempt,
      version,
      policyGeneration: capturedPolicyGeneration,
      epoch: capturedEpoch,
    });
    return promise;
  }

  function peek(cwd: string): GitActivityState {
    if (disposed) {
      return {
        configuredPolicy: policy,
        effectiveMode: "manual",
        reason: "policy_disposed",
        lastCheckedAt: null,
      };
    }
    const key = normalizeCwd(cwd);
    if (policy !== "auto") {
      return stateFor(policy, null);
    }

    const cached = verdicts.get(key);
    const fresh = freshVerdict(key);
    if (!fresh) {
      if (cached) {
        // Aged out. Read conservatively, and let the next resolve (or the
        // bounded re-arm below) refresh it. Peeking is synchronous, so this arms
        // at most one classification per workspace — never one per caller.
        void startClassification(key);
      }
      return {
        configuredPolicy: policy,
        effectiveMode: "unknown",
        reason: cached ? "classification_expired" : "classification_pending",
        lastCheckedAt: cached ? new Date(cached.verdict.checkedAt).toISOString() : null,
      };
    }
    return stateFor(policy, fresh);
  }

  async function classifyAndResolve(cwd: string): Promise<GitActivityState> {
    const key = normalizeCwd(cwd);
    if (disposed) {
      return {
        configuredPolicy: policy,
        effectiveMode: "manual",
        reason: "policy_disposed",
        lastCheckedAt: null,
      };
    }
    if (policy !== "auto") {
      return stateFor(policy, null);
    }

    const fresh = freshVerdict(key);
    if (fresh) {
      return stateFor(policy, fresh);
    }

    await startClassification(key);
    if (disposed) {
      return {
        configuredPolicy: policy,
        effectiveMode: "manual",
        reason: "policy_disposed",
        lastCheckedAt: null,
      };
    }
    return stateFor(policy, freshVerdict(key));
  }

  /**
   * Classify when the cached verdict cannot answer, then report whether this
   * caller is the one that should start observation.
   *
   * `automatic` is claimed exactly once per admission. Every caller observes the
   * same settled verdict, so without a claim a burst of concurrent
   * registrations would each see `unknown -> automatic` and each start its own
   * watcher set, fetch and poll -- the storm this policy exists to prevent.
   */
  async function ensureClassification(cwd: string): Promise<{ cwd: string; automatic: boolean }> {
    const key = normalizeCwd(cwd);

    // Fast path: already admitted and fresh, so nothing was newly granted.
    const fresh = freshVerdict(key);
    if (fresh && stateFor(policy, fresh).effectiveMode === "automatic") {
      return { cwd: key, automatic: false };
    }

    const claim = admissionClaims.get(key);
    if (claim) {
      // Another caller already owns the transition for this workspace.
      await claim;
      return { cwd: key, automatic: false };
    }

    const before = peek(key).effectiveMode;
    if (before === "automatic") {
      return { cwd: key, automatic: false };
    }

    const pending = (async () => {
      const state = await classifyAndResolve(key);
      return state.effectiveMode === "automatic";
    })();
    admissionClaims.set(key, pending);
    try {
      const automatic = await pending;
      return { cwd: key, automatic };
    } finally {
      if (admissionClaims.get(key) === pending) {
        admissionClaims.delete(key);
      }
    }
  }

  return {
    isAutomatic(cwd: string): boolean {
      return peek(cwd).effectiveMode === "automatic";
    },

    peek,

    resolve: classifyAndResolve,

    ensureClassification,

    refreshPolicy(): void {
      const next = normalizeGitActivityPolicy(options.getPolicy());
      if (next === policy) {
        return;
      }
      const previous = policy;
      policy = next;
      // Invalidate every in-flight classification: a verdict computed under the
      // old policy must never be admitted, whatever the new value is.
      policyGeneration += 1;
      logger.info({ from: previous, to: next }, "Git activity policy changed");
    },

    invalidate(cwd?: string): void {
      if (cwd === undefined) {
        // Bump the epoch first: it covers every key, including ones with no
        // recorded version. Bumping only verdict keys would let an in-flight
        // classification for a never-classified key land its verdict after the caller
        // asked for everything to be dropped.
        globalEpoch += 1;
        for (const key of verdicts.keys()) {
          bumpVersion(key);
        }
        verdicts.clear();
        inFlight.clear();
        liveAttempts.clear();
        admissionClaims.clear();
        options.classifier.invalidate();
        return;
      }
      const key = normalizeCwd(cwd);
      // Bump first: the in-flight classification for this path may still be running, and
      // its completion must not put the stale verdict back.
      bumpVersion(key);
      // Dropping the live attempt is what actually rejects it: its identity is no
      // longer current, so `storeVerdict` refuses even though the version number
      // could be reused later.
      liveAttempts.delete(key);
      verdicts.delete(key);
      inFlight.delete(key);
      // A re-classification is again allowed to grant admission.
      admissionClaims.delete(key);
      options.classifier.invalidate(key);
    },

    invalidateMountTable(): void {
      globalEpoch += 1;
      for (const key of verdicts.keys()) {
        bumpVersion(key);
      }
      verdicts.clear();
      inFlight.clear();
      liveAttempts.clear();
      admissionClaims.clear();
      options.classifier.invalidateMountTable();
    },

    dispose(): void {
      if (disposed) {
        return;
      }
      disposed = true;
      policyGeneration += 1;
      globalEpoch += 1;
      verdicts.clear();
      inFlight.clear();
      liveAttempts.clear();
      admissionClaims.clear();
      versions.clear();
      options.classifier.dispose();
    },
  };
}

export type GitActivityPolicyServiceInstance = ReturnType<typeof createGitActivityPolicyService>;
