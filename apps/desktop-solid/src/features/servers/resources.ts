// Per-server read cache for the server workspace. Reads are keyed by connection, resource
// name and arguments; switching tabs reuses fresh data, stale data stays on screen while it
// revalidates, identical in-flight reads are shared, and transport or capacity failures
// retry quietly with backoff while the header strip explains them once.
import { createEffect, createMemo, createSignal, onCleanup, untrack, type Accessor } from 'solid-js';
import { CacheInvalidatedError, RequestCache, type CacheSnapshot } from '../../platform/cache/request-cache';
import { toServerError } from './errors';
import { readRetryDelay } from './read-state';
import type { Pressure } from './shell-model';
import type { ConnectionId, ServerCommandError } from './native';

/** A named read against one server. `args` must be JSON-serializable; it is part of the key. */
export interface ServerResourceDef<T, A = undefined> {
  name: string;
  load: (connectionId: ConnectionId, args: A) => Promise<T>;
  staleTimeMs?: number;
}

export const serverResource = <T, A = undefined>(name: string, load: (connectionId: ConnectionId, args: A) => Promise<T>, staleTimeMs?: number): ServerResourceDef<T, A> => ({ name, load, staleTimeMs });

const STALE_MS = 30_000;
const RETAIN_MS = 10 * 60_000;

export const resourceKey = (connectionId: ConnectionId, name: string, args?: unknown) =>
  `${connectionId}:${name}:${args === undefined ? '' : JSON.stringify(args)}`;

interface ResourceEntry {
  id: ConnectionId;
  name: string;
  staleTimeMs?: number;
  load: () => Promise<unknown>;
  readers: number;
  failures: number;
  revision: number;
  retryAt: number;
  error: ServerCommandError | null;
  pressure?: Pressure;
  timer?: ReturnType<typeof setTimeout>;
}

// Metadata has exactly the same lifetime and budget as its cache entry.
const knownKeys = new Map<string, ResourceEntry>();
const MAX_ENTRIES = 256;

/** Connection signals are bounded too, including lookups before any resource is read. */
function keyedSignal<T>(name: string, initial: T) {
  const cells = new Map<ConnectionId, [Accessor<T>, (value: T) => void]>();
  const trim = () => {
    for (const id of cells.keys()) {
      if (cells.size <= MAX_ENTRIES) break;
      if (![...knownKeys.values()].some((entry) => entry.id === id && entry.readers)) cells.delete(id);
    }
  };
  const cell = (id: ConnectionId) => {
    let entry = cells.get(id);
    if (!entry) {
      const [read, write] = createSignal<T>(initial as Exclude<T, Function>, { name: `${name}:${id}` });
      entry = [read, (value: T) => write(() => value as Exclude<T, Function>)];
      cells.set(id, entry);
      trim();
    }
    return entry;
  };
  return {
    get: (id: ConnectionId) => cell(id)[0](),
    set: (id: ConnectionId, value: T) => cell(id)[1](value),
    delete: (id: ConnectionId) => { cells.get(id)?.[1](initial); cells.delete(id); },
    size: () => cells.size,
  };
}

const versions = keyedSignal<number>('server-resources:version', 0);
const pressures = keyedSignal<readonly Pressure[]>('server-resources:pressure', []);

/** A failure belongs to its resource; unrelated successful reads cannot erase it. */
export const serverPressure = (id: ConnectionId): Pressure | null => pressures.get(id)
  .filter((pressure) => pressure.untilMs > Date.now())
  .reduce<Pressure | null>((latest, pressure) => !latest || pressure.untilMs > latest.untilMs ? pressure : latest, null);

function publishPressure(id: ConnectionId) {
  pressures.set(id, [...knownKeys.values()].filter((entry) => entry.id === id && entry.pressure).map((entry) => entry.pressure!));
}

function evict(key: string) {
  const entry = knownKeys.get(key);
  if (!entry) return;
  clearTimeout(entry.timer);
  knownKeys.delete(key);
  if ([...knownKeys.values()].some((other) => other.id === entry.id)) publishPressure(entry.id);
  else { versions.delete(entry.id); pressures.delete(entry.id); }
}

function scheduleRetry(key: string, entry: ResourceEntry) {
  clearTimeout(entry.timer);
  entry.timer = undefined;
  if (!entry.readers || !entry.retryAt) return;
  entry.timer = setTimeout(() => {
    entry.timer = undefined;
    if (knownKeys.get(key) === entry && entry.readers) void readShared(key, entry).catch(() => {});
  }, Math.min(2_147_483_647, Math.max(0, entry.retryAt - Date.now())));
}

/** Exposed for checks; views use the helpers below. */
export const serverResourceCache = new RequestCache<unknown>({
  maxEntries: MAX_ENTRIES, staleTimeMs: STALE_MS, retentionMs: RETAIN_MS, onEvict: evict,
  onSettled: (key, snapshot) => {
    const entry = knownKeys.get(key);
    if (!entry || snapshot.error) return;
    entry.error = null;
    entry.failures = 0;
    entry.retryAt = 0;
    entry.pressure = undefined;
    publishPressure(entry.id);
    scheduleRetry(key, entry);
  },
});

function track<T, A>(id: ConnectionId, def: ServerResourceDef<T, A>, args?: A) {
  const key = resourceKey(id, def.name, args);
  let entry = knownKeys.get(key);
  if (!entry) {
    const next: ResourceEntry = { id, name: def.name, staleTimeMs: def.staleTimeMs, load: async () => {
      // RequestCache may queue a replacement behind invalidated IPC. Check guidance
      // here too, because the retired request can fail after that replacement queued.
      if (next.error && next.retryAt > Date.now()) throw next.error;
      const revision = next.revision;
      try { return await def.load(id, args as A); }
      catch (reason) {
        // Count the actual request once, even if invalidation retires its response.
        if (knownKeys.get(key) === next && next.revision === revision && !(reason instanceof CacheInvalidatedError)) {
          next.error = toServerError(reason);
          const delay = readRetryDelay(next.error, ++next.failures);
          const guidance = next.error.retryAfterMs ?? 0;
          const wait = delay ?? (Number.isFinite(guidance) && guidance > 0 ? guidance : 0);
          next.retryAt = wait ? Date.now() + wait : 0;
          if (next.error.code === 'server_busy' || next.error.code === 'rate_limited') {
            next.pressure = { code: next.error.code, untilMs: next.retryAt || Date.now() + STALE_MS };
          }
          publishPressure(id);
          scheduleRetry(key, next);
        }
        throw reason;
      }
    }, readers: 0, failures: 0, revision: 0, retryAt: 0, error: null };
    entry = next;
    knownKeys.set(key, entry);
  }
  return { key, entry };
}

function readShared(key: string, entry: ResourceEntry): Promise<unknown> {
  // Neither explicit refresh, a version bump, prefetch nor a remount can shorten guidance.
  if (entry.error && entry.retryAt > Date.now()) {
    scheduleRetry(key, entry);
    return Promise.reject(entry.error);
  }
  try { return serverResourceCache.read(key, entry.load, entry.staleTimeMs); }
  catch (reason) {
    // A budget failure must not leave an orphan metadata entry.
    if (!serverResourceCache.peek(key)) evict(key);
    return Promise.reject(reason);
  }
}

/** Marks data stale without resetting request-owned retry history. */
export function invalidateServerResources(id: ConnectionId, names?: readonly string[], forget = false) {
  for (const [key, entry] of knownKeys) {
    if (entry.id === id && (!names || names.includes(entry.name))) serverResourceCache.invalidate(key, forget);
  }
  versions.set(id, untrack(() => versions.get(id)) + 1);
}

/** Called by the store for removed connections, including list reconciliation. */
export function releaseServerResources(id: ConnectionId) {
  editors.delete(id);
  for (const [key, entry] of knownKeys) if (entry.id === id) serverResourceCache.delete(key);
  versions.delete(id);
  pressures.delete(id);
}

/** Cache ownership counts for bounded-lifetime checks. */
export const serverResourceMetadata = () => ({ keys: knownKeys.size, versions: versions.size(), pressures: pressures.size() });

/** Cached value without reading or subscribing. */
export function peekServerResource<T, A>(id: ConnectionId, def: ServerResourceDef<T, A>, args?: A): T | undefined {
  const snapshot = serverResourceCache.peek(resourceKey(id, def.name, args));
  return snapshot?.hasData ? (snapshot.data as T) : undefined;
}

/** Shared read: fresh data is returned from the cache, concurrent reads share one request. */
export function readServerResource<T, A>(id: ConnectionId, def: ServerResourceDef<T, A>, args?: A): Promise<T> {
  const { key, entry } = track(id, def, args);
  return readShared(key, entry) as Promise<T>;
}

/** Warm a resource ahead of navigation. Failures are left for the view to show. */
export function prefetchServerResource<T, A>(id: ConnectionId, def: ServerResourceDef<T, A>, args?: A) {
  void readServerResource(id, def, args).catch(() => {});
}

/** Put a known value in the cache, e.g. the result of a mutation. */
export function seedServerResource<T, A>(id: ConnectionId, def: ServerResourceDef<T, A>, value: T, args?: A) {
  const { key, entry } = track(id, def, args);
  entry.revision++;
  entry.failures = 0;
  entry.retryAt = 0;
  entry.error = null;
  entry.pressure = undefined;
  clearTimeout(entry.timer);
  try { serverResourceCache.seed(key, value); }
  catch (reason) { if (!serverResourceCache.peek(key)) evict(key); throw reason; }
  publishPressure(id);
}

export interface ServerResourceState<T> {
  /** Latest data, kept while revalidating or after a failed refresh. */
  value: Accessor<T | undefined>;
  /** Last failure, cleared by the next success. Quiet failures retry by themselves. */
  error: Accessor<ServerCommandError | null>;
  /** True only while there is no data yet and a read is in flight. */
  loading: Accessor<boolean>;
  refreshing: Accessor<boolean>;
  /** Reads again now, even if the cached data is fresh. */
  refresh: () => Promise<void>;
}

/**
 * Reads a server resource for a mounted view. The cached value is available synchronously,
 * so remounting a tab shows data immediately; it refetches only when stale, when
 * `version` changes, or when the connection's resources are invalidated.
 *
 *   const players = useServerResource(id, onlinePlayers, { args: () => generation(), enabled: online });
 */
export function useServerResource<T, A = undefined>(
  id: Accessor<ConnectionId>,
  def: ServerResourceDef<T, A>,
  options: { args?: Accessor<A>; enabled?: Accessor<boolean>; version?: Accessor<unknown> } = {},
): ServerResourceState<T> {
  const key = createMemo(() => resourceKey(id(), def.name, options.args?.()), { name: `server-resource:${def.name}:key` });
  const enabled = createMemo(() => options.enabled?.() ?? true, { name: `server-resource:${def.name}:enabled` });
  const initial = untrack(() => serverResourceCache.peek(key()));
  const [snapshot, setSnapshot] = createSignal<CacheSnapshot<unknown> | undefined>(initial, { name: `server-resource:${def.name}:snapshot` });
  const error = () => snapshot()?.error ? toServerError(snapshot()!.error) : null;
  let disposed = false;
  onCleanup(() => { disposed = true; });

  const run = (requestKey: string, force: boolean): Promise<void> => {
    if (force) serverResourceCache.invalidate(requestKey);
    const connectionId = untrack(id);
    const args = untrack(() => options.args?.()) as A;
    const current = () => !disposed && requestKey === untrack(key) && untrack(enabled);
    return readServerResource(connectionId, def, args).then(() => {}, (reason: unknown) => {
      // Invalidation retires old responses; the still-mounted owner reads the new version.
      if (reason instanceof CacheInvalidatedError && current()) return run(requestKey, false);
    });
  };
  createEffect(
    () => ({ key: key(), enabled: enabled(), version: versions.get(id()) }),
    (current) => {
      const tracked = track(untrack(id), def, untrack(() => options.args?.()));
      const entry = tracked.entry;
      if (current.enabled) entry.readers++;
      let stop: () => void;
      try {
        stop = serverResourceCache.subscribe(current.key, (next) => {
          if (!disposed) setSnapshot({ ...next, error: entry.error ?? next.error });
        });
      } catch (reason) {
        if (current.enabled) entry.readers--;
        if (!serverResourceCache.peek(current.key)) evict(current.key);
        throw reason;
      }
      if (current.enabled) void run(current.key, false);
      return () => {
        stop();
        if (current.enabled) entry.readers--;
        if (!entry.readers) { clearTimeout(entry.timer); entry.timer = undefined; }
      };
    },
    { name: `server-resource:${def.name}:read` },
  );

  if (options.version) {
    let first = true;
    createEffect(options.version, () => {
      if (first) { first = false; return; }
      if (untrack(enabled)) void run(untrack(key), true);
    }, { name: `server-resource:${def.name}:version` });
  }

  return {
    value: () => { const current = snapshot(); return current?.hasData ? (current.data as T) : undefined; },
    error,
    loading: () => { const current = snapshot(); return !current?.hasData && (current?.refreshing ?? enabled()); },
    refreshing: () => !!snapshot()?.refreshing,
    refresh: () => run(untrack(key), true),
  };
}

export interface ResourceEditor { display_name: string; at_ms: number; revision: string }
const editors = keyedSignal<Record<string, ResourceEditor>>('server-resources:editors', {});
export const resourceEditor = (id: ConnectionId, name: string) => editors.get(id)[name];
/** Replay/reconnect hints are compared per resource; no invalidation for duplicates. */
export function applyResourceChanges(id: ConnectionId, changes: Record<string, ResourceEditor>) {
  const previous = untrack(() => editors.get(id));
  const names = Object.keys(changes).filter(name => changes[name].revision !== previous[name]?.revision);
  editors.set(id, { ...previous, ...changes });
  if (names.length) invalidateServerResources(id, names);
}
