/**
 * Lexical path matching for workspace Git observation.
 *
 * Watcher events are matched against roots whose aliases were resolved
 * asynchronously while observation was being set up, so event delivery never
 * touches the filesystem: a deleted path, a temporary `packed-refs.new` and a
 * symlinked root are all decidable from strings alone.
 *
 * Alias resolution runs once per root on the libuv pool. Its *wait* is bounded:
 * when the deadline passes, the resolver returns the root alone and observation
 * proceeds with lexical-only matching. The deadline does not cancel the
 * underlying realpath — Node cannot abort an in-flight `fs/promises` request —
 * so a stalled mount leaves one pooled operation behind that may resolve later
 * and is simply discarded. The guarantee this module makes is that the daemon's
 * main thread and event delivery never block on it, not that the OS work stops.
 */
import { isAbsolute, join, relative } from "node:path";
import { realpath as realpathAsync } from "node:fs/promises";
import { createPathEquivalenceMatcher, isPathInsideRoot } from "../utils/path.js";
import { withTimeout } from "../utils/promise-timeout.js";

export const OBSERVATION_ROOT_ALIAS_TIMEOUT_MS = 2_000;
const OBSERVATION_ROOT_ALIAS_CACHE_MAX = 512;

export interface ObservationPathRoot {
  /** The spelling callers know the root by (usually what Git or the watcher reported). */
  readonly root: string;
  /** Every spelling of the root, including `root` itself. */
  readonly aliases: readonly string[];
  /** True when the candidate is the same path as any root spelling. */
  matches(candidate: string): boolean;
  /** True when the candidate is the root spelling itself or lives underneath it. */
  contains(candidate: string): boolean;
  /** The candidate's suffix below the first root spelling that contains it. */
  relativePath(candidate: string): string | null;
  /** The same path expressed through the other root spellings. */
  rebase(path: string): string[];
  withAlias(alias: string): ObservationPathRoot;
}

export function createObservationPathRoot(
  root: string,
  aliases: readonly string[] = [],
): ObservationPathRoot {
  return new ObservationPathRootImpl(root, aliases);
}

class ObservationPathRootImpl implements ObservationPathRoot {
  private readonly spellings: string[];
  private matchers: Array<(candidate: string) => boolean>;

  constructor(
    readonly root: string,
    aliases: readonly string[],
  ) {
    this.spellings = dedupe([root, ...aliases]);
    this.matchers = this.spellings.map((spelling) => createPathEquivalenceMatcher(spelling));
  }

  get aliases(): readonly string[] {
    return this.spellings;
  }

  matches(candidate: string): boolean {
    return this.matchers.some((matches) => matches(candidate));
  }

  contains(candidate: string): boolean {
    return this.spellings.some((spelling) => isPathInsideRoot(spelling, candidate));
  }

  relativePath(candidate: string): string | null {
    for (const spelling of this.spellings) {
      const relativePath = getLexicalRelativePath(spelling, candidate);
      if (relativePath !== null) return relativePath;
    }
    return null;
  }

  rebase(path: string): string[] {
    const relativePath = this.relativePath(path);
    if (relativePath === null) return [path];
    return this.spellings.map((spelling) =>
      relativePath === "" ? spelling : join(spelling, relativePath),
    );
  }

  withAlias(alias: string): ObservationPathRoot {
    if (this.spellings.includes(alias)) return this;
    return new ObservationPathRootImpl(this.root, [...this.spellings, alias]);
  }
}

/**
 * Resolves a root's realpath aliases once per root, off the main thread.
 *
 * The returned promise settles within `timeoutMs` with the root alone when the
 * read is slow, errored or unsupported. Settling is not the same as cancelling:
 * the abandoned realpath keeps running in the libuv pool and its result is
 * ignored, so a hung mount costs one stray operation, never a blocked daemon.
 */
export type ResolveObservationRootAliases = (root: string) => Promise<readonly string[]>;

export function createObservationRootAliasResolver(
  options: {
    timeoutMs?: number;
    resolveRealpath?: (root: string) => Promise<string>;
  } = {},
): ResolveObservationRootAliases {
  const timeoutMs = options.timeoutMs ?? OBSERVATION_ROOT_ALIAS_TIMEOUT_MS;
  const resolveRealpath = options.resolveRealpath ?? realpathAsync;
  const pending = new Map<string, Promise<readonly string[]>>();

  return (root) => {
    const cached = pending.get(root);
    if (cached) return cached;

    const resolution = withTimeout(
      resolveRealpath(root),
      timeoutMs,
      `Timed out resolving observation root aliases for ${root} after ${timeoutMs}ms`,
    )
      .then((resolved): readonly string[] => (resolved === root ? [root] : [root, resolved]))
      .catch((): readonly string[] => [root]);

    pending.set(root, resolution);
    if (pending.size > OBSERVATION_ROOT_ALIAS_CACHE_MAX) {
      const oldest = pending.keys().next().value;
      if (oldest !== undefined) pending.delete(oldest);
    }
    return resolution;
  };
}

const sharedObservationRootAliases = createObservationRootAliasResolver();

export const defaultResolveObservationRootAliases: ResolveObservationRootAliases = (root) =>
  sharedObservationRootAliases(root);

/**
 * Re-expresses a root through the aliases of the root it lives under, so paths
 * derived from one spelling (ignored directories, `.git`, pruned metadata dirs)
 * stay matchable when events arrive through another.
 */
export function createRebasedRoot(root: string, base: ObservationPathRoot): ObservationPathRoot {
  return createObservationPathRoot(root, base.rebase(root));
}

export function isInsideRoot(root: string, candidate: string): boolean {
  return isPathInsideRoot(root, candidate);
}

function getLexicalRelativePath(root: string, candidate: string): string | null {
  if (!isPathInsideRoot(root, candidate)) return null;
  const relativePath = relative(root, candidate);
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) return null;
  return relativePath;
}

function dedupe(values: readonly string[]): string[] {
  return Array.from(new Set(values));
}
