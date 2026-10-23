// Per-server read cache for the server workspace. Reads are keyed by connection, resource
// name and arguments; switching tabs reuses fresh data, stale data stays on screen while it
// revalidates, identical in-flight reads are shared, and transport or capacity failures
// retry quietly with backoff while the header strip explains them once.
import { createEffect, createMemo, createSignal, onCleanup, untrack, type Accessor } from 'solid-js';
import { CacheInvalidatedError, RequestCache, type CacheSnapshot } from '../../platform/cache/request-cache';
import { toServerError } from './errors';
import { readRetryDelay } from './read-state';
import { isQuietError, type Pressure } from './shell-model';
import type { ConnectionId, ServerCommandError } from './native';

/** A named read against one server. `args` must be JSON-serializable; it is part of the key. */
export interface ServerResourceDef<T, A = undefined> {
  name: string;
  load: (connectionId: ConnectionId, args: A) => Promise<T>;
}

export const serverResource = <T, A = undefined>(name: string, load: (connectionId: ConnectionId, args: A) => Promise<T>): ServerResourceDef<T, A> => ({ name, load });

const STALE_MS = 30_000;
const RETAIN_MS = 10 * 60_000;

export const resourceKey = (connectionId: ConnectionId, name: string, args?: unknown) =>
  `${connectionId}:${name}:${args === undefined ? '' : JSON.stringify(args)}`;

/** Keys handed to the cache, so a connection's entries can be invalidated together. */
const knownKeys = new Set<string>();
const track = (key: string) => { knownKeys.add(key); return key; };

/** Exposed for checks; views use the helpers below. */
export const serverResourceCache = new RequestCache<unknown>({ maxEntries: 256, staleTimeMs: STALE_MS, retentionMs: RETAIN_MS });

/** One small per-connection signal, created on first use. */
function keyedSignal<T>(name: string, initial: T) {
  const cells = new Map<ConnectionId, [Accessor<T>, (value: T) => void]>();
  const cell = (id: ConnectionId) => {
    let entry = cells.get(id);
    if (!entry) {
      const [read, write] = createSignal<T>(initial as Exclude<T, Function>, { name: `${name}:${id}` });
      entry = [read, (value: T) => write(() => value as Exclude<T, Function>)];
      cells.set(id, entry);
    }
    return entry;
  };
  return { get: (id: ConnectionId) => cell(id)[0](), set: (id: ConnectionId, value: T) => cell(id)[1](value) };
}

/** Bumped when a connection's resources are invalidated, so mounted readers revalidate. */
const versions = keyedSignal<number>('server-resources:version', 0);
const pressures = keyedSignal<Pressure | null>('server-resources:pressure', null);

/** The server asked us to slow down; the header says so while it lasts. */
export const serverPressure = (id: ConnectionId) => pressures.get(id);

function reportPressure(id: ConnectionId, error: ServerCommandError, delayMs: number) {
  if (error.code !== 'server_busy' && error.code !== 'rate_limited') return;
  const untilMs = Date.now() + Math.max(delayMs, error.retryAfterMs ?? 0);
  const current = untrack(() => pressures.get(id));
  if (!current || current.untilMs < untilMs) pressures.set(id, { code: error.code, untilMs });
}

function clearPressure(id: ConnectionId) {
  if (untrack(() => pressures.get(id))) pressures.set(id, null);
}

const keysFor = (id: ConnectionId, names?: readonly string[]) => {
  const prefix = `${id}:`;
  return [...knownKeys]
    .filter((key) => key.startsWith(prefix) && (!names || names.includes(key.slice(prefix.length).split(':', 1)[0]!)));
};

/**
 * Marks a connection's resources stale (all, or only `names`). Shown data stays; mounted
 * readers refetch. Pass `forget` when the data must not be shown again (e.g. removal).
 */
export function invalidateServerResources(id: ConnectionId, names?: readonly string[], forget = false) {
  for (const key of keysFor(id, names)) serverResourceCache.invalidate(key, forget);
  versions.set(id, untrack(() => versions.get(id)) + 1);
}

/** Cached value without reading or subscribing. */
export function peekServerResource<T, A>(id: ConnectionId, def: ServerResourceDef<T, A>, args?: A): T | undefined {
  const snapshot = serverResourceCache.peek(resourceKey(id, def.name, args));
  return snapshot?.hasData ? (snapshot.data as T) : undefined;
}

/** Shared read: fresh data is returned from the cache, concurrent reads share one request. */
export function readServerResource<T, A>(id: ConnectionId, def: ServerResourceDef<T, A>, args?: A): Promise<T> {
  return serverResourceCache.read(track(resourceKey(id, def.name, args)), () => def.load(id, args as A)) as Promise<T>;
}

/** Warm a resource ahead of navigation. Failures are left for the view to show. */
export function prefetchServerResource<T, A>(id: ConnectionId, def: ServerResourceDef<T, A>, args?: A) {
  void readServerResource(id, def, args).catch(() => {});
}

/** Put a known value in the cache, e.g. the result of a mutation. */
export function seedServerResource<T, A>(id: ConnectionId, def: ServerResourceDef<T, A>, value: T, args?: A) {
  serverResourceCache.seed(track(resourceKey(id, def.name, args)), value);
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
  const key = createMemo(() => track(resourceKey(id(), def.name, options.args?.())), { name: `server-resource:${def.name}:key` });
  const enabled = createMemo(() => options.enabled?.() ?? true, { name: `server-resource:${def.name}:enabled` });
  const initial = untrack(() => serverResourceCache.peek(key()));
  const [snapshot, setSnapshot] = createSignal<CacheSnapshot<unknown> | undefined>(initial, { name: `server-resource:${def.name}:snapshot` });
  const [error, setError] = createSignal<ServerCommandError | null>(null, { name: `server-resource:${def.name}:error` });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let failures = 0;
  let disposed = false;
  onCleanup(() => { disposed = true; clearTimeout(timer); });

  const run = (requestKey: string, force: boolean): Promise<void> => {
    clearTimeout(timer);
    if (force) serverResourceCache.invalidate(requestKey);
    const connectionId = untrack(id);
    const args = untrack(() => options.args?.()) as A;
    const current = () => !disposed && requestKey === untrack(key) && untrack(enabled);
    return serverResourceCache.read(requestKey, () => def.load(connectionId, args)).then(
      () => {
        if (!current()) return;
        failures = 0;
        setError(null);
        clearPressure(connectionId);
      },
      (reason: unknown) => {
        if (reason instanceof CacheInvalidatedError || !current()) return;
        const failure = toServerError(reason);
        setError(failure);
        if (!isQuietError(failure.code)) return;
        const delay = readRetryDelay(failure, ++failures);
        if (delay === null) return;
        reportPressure(connectionId, failure, delay);
        timer = setTimeout(() => { if (current()) void run(requestKey, false); }, delay);
      },
    );
  };

  createEffect(
    () => ({ key: key(), enabled: enabled(), version: versions.get(id()) }),
    (current) => {
      setSnapshot(serverResourceCache.peek(current.key));
      const stop = serverResourceCache.subscribe(current.key, (next) => { if (!disposed) setSnapshot(next); });
      failures = 0;
      if (current.enabled) void run(current.key, false);
      return () => { stop(); clearTimeout(timer); };
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
