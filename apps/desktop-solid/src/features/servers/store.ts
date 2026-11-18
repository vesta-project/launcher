import { applyRosterDelta } from './roster-delta';
// Server-keyed reactive state for the server UI. Every server and topic has its own
// signal, so an update to one server's snapshot, console, metrics or operations
// reruns only the views reading that server and topic.
import { createEffect, createMemo, createSignal, onCleanup, untrack, type Accessor } from 'solid-js';
import { ConsoleBuffer } from './console-model';
import { toServerError } from './errors';
import { isTerminal, mergeOperations } from './operations-model';
import { applyResourceChanges, invalidateServerResources, releaseServerResources } from './resources';
import { serversApi, type ServersApi } from './service';
import { forgetServerContact, withContact } from './contact';
import { activeAccount } from '../accounts/accounts';
import type { ConnectionId, MetricsSample, ServerCommandError, ServerOperation, ServerSnapshot, ServerTopic } from './native';

/** One lazily created signal per connection id. */
function keyed<T>(name: string, initial: () => T, equals?: (a: T, b: T) => boolean) {
  const cells = new Map<ConnectionId, { read: Accessor<T>; write: (next: (current: T) => T) => void }>();
  const cell = (id: ConnectionId) => {
    let entry = cells.get(id);
    if (!entry) {
      const [read, set] = createSignal<T>(initial() as Exclude<T, Function>, { name: `${name}:${id}`, ...(equals ? { equals } : {}) });
      entry = { read, write: (next) => set((current) => next(current)) };
      cells.set(id, entry);
    }
    return entry;
  };
  return {
    get: (id: ConnectionId) => cell(id).read(),
    update: (id: ConnectionId, next: (current: T) => T) => cell(id).write(next),
    delete: (id: ConnectionId) => { cells.get(id)?.write(initial); cells.delete(id); },
  };
}

const snapshots = keyed<ServerSnapshot | undefined>('serverSnapshot', () => undefined,
  (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b));
const operations = keyed<ServerOperation[]>('serverOperations', () => []);
const metrics = keyed<MetricsSample[]>('serverMetrics', () => []);
const consoleVersions = keyed<number>('serverConsoleVersion', () => 0);
const [order, setOrder] = createSignal<ConnectionId[]>([], { name: 'serverOrder' });
const [hiddenServers, setHiddenServers] = createSignal<Set<ConnectionId>>(new Set());
const [loaded, setLoaded] = createSignal(false, { name: 'serversLoaded' });
const [listError, setListError] = createSignal<ServerCommandError | null>(null, { name: 'serversListError' });

const players = keyed<import('./native').PlayersView>('serverPlayers', () => ({ known: false }));
export const serverPlayers = (id: ConnectionId) => players.get(id);

/** Observe the native worker's single roster owner; views never issue competing list reads. */
export function useServerRoster(snapshot: () => ServerSnapshot) {
  // The workspace owns status demand. Subscribing again here would duplicate
  // channels/snapshot delivery just because the same roster is shown twice.
  return {
    value: () => {
      const current = snapshot();
      const roster = serverPlayers(current.connection.id);
      return current.state.phase === 'online' && current.state.access === 'paired'
        && current.status?.state === 'running' && roster.known && roster.generation === current.status.generation
        ? roster : { known: false } as const;
    },
    error: () => null,
    // Missing observation is unknown, not an indefinitely loading request owned by this view.
    loading: () => false,
    refresh: () => refreshServer(untrack(snapshot).connection.id),
  };
}

export function putPlayers(id: ConnectionId, view: import('./native').PlayersView) {
  const snapshot = untrack(() => snapshots.get(id));
  const status = snapshot?.status;
  players.update(id, () => view.known && (snapshot?.state.phase !== 'online' || snapshot.state.access !== 'paired'
    || status?.state !== 'running' || status.generation !== view.generation) ? { known: false } : view);
}

const consoles = new Map<ConnectionId, ConsoleBuffer>();
const refreshing = keyed<boolean>('serverRefreshing', () => false);
const refreshes = new Map<ConnectionId, Promise<void>>();
export const serverRefreshing = (id: ConnectionId) => refreshing.get(id);

/** One explicit observation per server, even when several views request it. */
export function refreshServer(id: ConnectionId, background = false): Promise<void> {
  const pending = refreshes.get(id);
  if (pending) {
    if (!background) refreshing.update(id, () => true);
    return pending;
  }
  const previous = untrack(() => snapshots.get(id));
  const request = serverCommand((client) => client.snapshot(id, true, background))
    .then((snapshot) => {
      const current = untrack(() => snapshots.get(id));
      if (refreshes.get(id) === request && current && current === previous) putSnapshot(snapshot);
    })
    .finally(() => {
      if (refreshes.get(id) === request) {
        refreshes.delete(id);
        refreshing.update(id, () => false);
      }
    });
  refreshes.set(id, request);
  if (!background) refreshing.update(id, () => true);
  return request;
}
const METRIC_HISTORY = 90;

export const serversLoaded = loaded;
export const serversListError = listError;
const sameSnapshots = (a: readonly ServerSnapshot[], b: readonly ServerSnapshot[]) => a.length === b.length && a.every((snapshot, index) => snapshot === b[index]);
export const serverSnapshots = createMemo(
  () => order().filter(id => !hiddenServers().has(id)).map((id) => snapshots.get(id)).filter((snapshot): snapshot is ServerSnapshot => !!snapshot),
  { name: 'serverList', equals: sameSnapshots },
);
export const serverSnapshot = (id: ConnectionId | undefined) => (id ? snapshots.get(id) : undefined);
export const pinnedServers = createMemo(() => serverSnapshots().filter((snapshot) => snapshot.connection.pinned), { name: 'pinnedServers', equals: sameSnapshots });
export const serverOperations = (id: ConnectionId) => operations.get(id);
export const serverMetrics = (id: ConnectionId) => metrics.get(id);
export const latestMetrics = (id: ConnectionId) => serverMetrics(id).at(-1);

/** The console buffer for a server; read `consoleVersion(id)` in a tracking scope to follow changes. */
export const consoleBuffer = (id: ConnectionId) => {
  let buffer = consoles.get(id);
  if (!buffer) { buffer = new ConsoleBuffer(); consoles.set(id, buffer); }
  return buffer;
};
export const consoleVersion = (id: ConnectionId) => consoleVersions.get(id);
const bumpConsole = (id: ConnectionId) => consoleVersions.update(id, (current) => current + 1);

export function putSnapshot(snapshot: ServerSnapshot) {
  const id = snapshot.connection.id;
  const previous = untrack(() => snapshots.get(id));
  snapshots.update(id, () => snapshot);
  if (previous && previous.connection.authRevision !== snapshot.connection.authRevision) {
    invalidateServerResources(id, undefined, true);
    operations.update(id, () => []);
    metrics.update(id, () => []);
    consoles.delete(id);
    bumpConsole(id);
    players.update(id, () => ({ known: false }));
  }
  const roster = untrack(() => players.get(id));
  if (roster.known && (snapshot.state.phase !== 'online' || snapshot.state.access !== 'paired'
    || snapshot.status?.state !== 'running' || snapshot.status.generation !== roster.generation)) {
    players.update(id, () => ({ known: false }));
  }
  if (!untrack(order).includes(id)) setOrder((current) => [...current, id]);
}

function forget(id: ConnectionId) {
  setOrder((current) => current.filter((entry) => entry !== id));
  releaseServerResources(id);
  snapshots.delete(id);
  operations.delete(id);
  metrics.delete(id);
  consoleVersions.delete(id);
  consoles.delete(id);
  players.delete(id);
  refreshes.delete(id);
  refreshing.delete(id);
  icons.delete(id);
  iconRequests.delete(id);
  forgetServerContact(id);
}

export function putOperations(id: ConnectionId, incoming: readonly ServerOperation[]) {
  const current = untrack(() => operations.get(id));
  const next = mergeOperations(current, incoming);
  const completed = next.some((operation) => {
    if (operation.kind !== 'players.moderate' && operation.intent !== 'players.moderate') return false;
    if (!isTerminal(operation) || operation.reconciling) return false;
    const previous = current.find((entry) => entry.operationId === operation.operationId);
    return !previous || !isTerminal(previous) || previous.reconciling;
  });
  operations.update(id, () => next);
  // Failed/recovery operations can have partial effects too. Duplicate or older
  // observations do not repeatedly invalidate the resource and create read bursts.
  if (completed) invalidateServerResources(id, ['players', 'whitelist', 'operators', 'bans']);
}

let api: ServersApi | undefined;
const knownServer = (id: string) => untrack(order).includes(id);
const ready = () => (api ? Promise.resolve(api) : serversApi().then((resolved) => (api = withContact(resolved, knownServer))));

/** Run a command, normalizing rejections into the closed error model. */
export async function serverCommand<T>(run: (api: ServersApi) => Promise<T>): Promise<T> {
  const account = untrack(activeAccount)?.uuid;
  try {
    const client = await ready();
    if (untrack(activeAccount)?.uuid !== account) throw { code: 'credentials_rejected' };
    const result = await run(client);
    if (untrack(activeAccount)?.uuid !== account) {
      // A subscription may finish opening after the account was changed.
      if (typeof result === 'function') (result as () => void)();
      throw { code: 'credentials_rejected' };
    }
    return result;
  }
  catch (reason) { throw toServerError(reason); }
}

let listSequence = 0;
/** Re-read saved connections. Only the newest response applies, so a slow reply can't restore removed servers. */
export async function refreshServers() {
  const sequence = ++listSequence;
  const before = untrack(() => new Map(order().map((id) => [id, snapshots.get(id)])));
  try {
    const list = await serverCommand((client) => client.list());
    if (sequence !== listSequence) return;
    const incoming = new Set(list.map((snapshot) => snapshot.connection.id));
    const ids: ConnectionId[] = [];
    for (const snapshot of list) {
      const id = snapshot.connection.id;
      const current = untrack(() => snapshots.get(id));
      // A status event, explicit refresh or removal can beat this cached reply.
      if (current === before.get(id)) putSnapshot(snapshot);
      if (current || !before.has(id)) ids.push(id);
    }
    for (const id of untrack(order)) {
      if (incoming.has(id)) continue;
      if (before.has(id)) forget(id);
      else ids.push(id);
    }
    setOrder(ids);
    setListError(null);
  } catch (reason) {
    if (sequence === listSequence) setListError(toServerError(reason));
  } finally {
    if (sequence === listSequence) setLoaded(true);
  }
}

const CARD_STATUS_INTERVAL_MS = 10_000;
const CARD_STATUS_CONCURRENCY = 4;
const sameIds = (a: readonly ConnectionId[], b: readonly ConnectionId[]) => a.length === b.length && a.every((id, index) => id === b[index]);

/** Keep card and rail snapshots current using bounded reads. An open workspace owns the live stream. */
export function useServerStatusSync(showList: () => boolean, workspace: () => ConnectionId | undefined) {
  const demand = createMemo(() => {
    const selected = workspace();
    return (showList() ? serverSnapshots() : pinnedServers())
      .map((snapshot) => snapshot.connection.id)
      .filter((id) => id !== selected);
  }, { name: 'server-card-status:demand', equals: sameIds });
  const nextReads = new Map<ConnectionId, number>();
  let inFlight = 0;
  let closed = false;
  function poll(ids: readonly ConnectionId[]) {
    if (closed || inFlight >= CARD_STATUS_CONCURRENCY) return;
    const now = Date.now();
    const queued = [...ids].sort((a, b) => (nextReads.get(a) ?? 0) - (nextReads.get(b) ?? 0));
    for (const id of queued) {
      if (inFlight >= CARD_STATUS_CONCURRENCY) break;
      if (refreshes.has(id) || (nextReads.get(id) ?? 0) > now) continue;
      const snapshot = untrack(() => snapshots.get(id));
      if (!snapshot || snapshot.state.access === 'fingerprint_changed' || snapshot.state.access === 'credentials_rejected') continue;
      const { rateLimitedUntilMs, retryAtMs } = snapshot.state;
      if (Math.max(rateLimitedUntilMs ?? 0, retryAtMs ?? 0) > now) continue;
      const next = now + CARD_STATUS_INTERVAL_MS;
      nextReads.set(id, next);
      inFlight++;
      void refreshServer(id, true).catch((error: ServerCommandError) => {
        if (nextReads.get(id) === next && error.retryAfterMs) {
          nextReads.set(id, Math.max(next, Date.now() + error.retryAfterMs));
        }
      }).finally(() => {
        inFlight--;
        poll(untrack(demand));
      });
    }
  }
  createEffect(demand, (ids) => {
    for (const id of nextReads.keys()) if (!ids.includes(id)) nextReads.delete(id);
    poll(ids);
    if (ids.length === 0) return;
    const timer = setInterval(() => poll(untrack(demand)), 1000);
    return () => clearInterval(timer);
  }, { name: 'server-card-status:poll' });
  onCleanup(() => { closed = true; nextReads.clear(); });
}

/** Hide a connection during the shared undo window without releasing its state. */
export function hideServer(id: ConnectionId) {
  setHiddenServers(current => new Set(current).add(id));
  return () => setHiddenServers(current => { const next = new Set(current); next.delete(id); return next; });
}

export async function removeServer(id: ConnectionId) {
  await serverCommand((client) => client.remove(id));
  forget(id);
  setHiddenServers(current => { const next = new Set(current); next.delete(id); return next; });
}

/** Custom server icons as PNG data URLs: undefined until loaded, null when unset or unreadable. */
const icons = keyed<string | null | undefined>('serverIcon', () => undefined);
const iconRequests = new Set<ConnectionId>();
const ICON_RETRY_MS = 60_000;

/** The server-owned icon, fetched once per connection; callers fall back to generated art. */
export function serverIcon(id: ConnectionId): string | null {
  const value = icons.get(id);
  if (value === undefined && !iconRequests.has(id)) {
    iconRequests.add(id);
    serverCommand((client) => client.icon(id)).then(
      (png) => setServerIcon(id, png),
      () => { setServerIcon(id, null); setTimeout(() => iconRequests.delete(id), ICON_RETRY_MS); },
    );
  }
  return value ?? null;
}

export function setServerIcon(id: ConnectionId, pngBase64: string | null) {
  icons.update(id, () => (pngBase64 ? `data:image/png;base64,${pngBase64}` : null));
}

export async function updateServer(id: ConnectionId, patch: { name?: string; pinned?: boolean }) {
  putSnapshot(await serverCommand((client) => client.update(id, patch)));
}

const LIST_REFRESH_COALESCE_MS = 250;

/** Loads saved servers once per window and follows native change notifications. Call from the shell. */
export function useServerSync() {
  let stop: (() => void) | undefined;
  let closed = false;
  let pending: ReturnType<typeof setTimeout> | undefined;
  createEffect(() => activeAccount()?.uuid, () => {
    // Drop privileged content immediately, before the new account's list arrives.
    ++listSequence;
    for (const id of untrack(order)) forget(id);
    refreshes.clear();
    consoleLoads.clear();
    consoleRecoveryAt.clear();
    setLoaded(false);
    setListError(null);
    void refreshServers();
  }, { name: 'servers:account-access' });
  void ready().then((client) => {
    if (closed) return;
    // Bursts of change notifications collapse into one list read.
    stop = client.onChanged(() => {
      if (pending) return;
      pending = setTimeout(() => { pending = undefined; void refreshServers(); }, LIST_REFRESH_COALESCE_MS);
    });
  });
  onCleanup(() => { closed = true; stop?.(); if (pending) clearTimeout(pending); });
}

/**
 * Keeps a topic subscription open while the calling component is mounted and the id is set.
 * Native code shares the underlying stream across windows and subscribers.
 */
export function useServerTopic(id: () => ConnectionId | undefined, topic: ServerTopic) {
  const connection = createMemo(() => ({ id: id(), account: activeAccount()?.uuid }), {
    name: `server-topic:${topic}:connection-id`,
    equals: (previous, next) => previous.id === next.id && previous.account === next.account,
  });
  createEffect(connection, ({ id: connectionId, account }) => {
    if (!connectionId) return;
    let unsubscribe: (() => void) | undefined;
    let closed = false;
    void serverCommand((client) => client.subscribe(connectionId, topic, (event) => {
      if (closed || untrack(activeAccount)?.uuid !== account) return;
      switch (event.kind) {
        case 'snapshot': putSnapshot(event.snapshot); break;
        case 'players': putPlayers(connectionId, event.players); break;
        case 'resourcesChanged': applyResourceChanges(connectionId, event.resources); break;
        case 'playersDelta': players.update(connectionId, current => applyRosterDelta(current, event.delta) ?? { known: false }); break;
        case 'console': consoleBuffer(connectionId).append(event.lines); bumpConsole(connectionId); break;
        case 'consoleHistory': consoleBuffer(connectionId).merge(event.lines); bumpConsole(connectionId); break;
        case 'consoleGap': consoleBuffer(connectionId).gap(event.cursor); bumpConsole(connectionId); void recoverConsoleTail(connectionId); break;
        case 'metrics': metrics.update(connectionId, (current) => [...current, event.sample].slice(-METRIC_HISTORY)); break;
        case 'operation': putOperations(connectionId, [event.operation]); break;
        case 'playerListsChanged': invalidateServerResources(connectionId, ['whitelist']); break;
        case 'resync':
          if (event.topic === 'status') { invalidateServerResources(connectionId); }
          if (event.topic === 'status') void serverCommand((client) => client.snapshot(connectionId, true)).then(putSnapshot).catch(() => {});
          if (event.topic === 'operations') { invalidateServerResources(connectionId, ['whitelist']); void loadOperations(connectionId).catch(() => {}); }
          if (event.topic === 'console') { consoleBuffer(connectionId).gap(`resync:${Date.now()}`); bumpConsole(connectionId); void recoverConsoleTail(connectionId); }
          break;
      }
    })).then((close) => {
      if (closed) close();
      else unsubscribe = close;
    }).catch(() => {});
    return () => { closed = true; unsubscribe?.(); };
  }, { name: `server-topic:${topic}` });
}

export async function loadOperations(id: ConnectionId) {
  const page = await serverCommand((client) => client.operations(id, null));
  putOperations(id, page.items);
  return page;
}

/**
 * One bounded read of the server's retained console tail (the agent pages forward only,
 * and lines evicted at a gap are gone). Lines already shown are merged by cursor.
 */
const consoleRecoveryAt = new Map<ConnectionId, number>();
async function recoverConsoleTail(id: ConnectionId) {
  if (Date.now() - (consoleRecoveryAt.get(id) ?? 0) < 10_000) return;
  consoleRecoveryAt.set(id, Date.now());
  await loadConsoleTail(id).catch(() => {});
}
const consoleLoads = new Map<ConnectionId, Promise<number>>();
export function loadConsoleTail(id: ConnectionId): Promise<number> {
  const pending = consoleLoads.get(id);
  if (pending) return pending;
  const request = readConsoleTail(id).finally(() => consoleLoads.delete(id));
  consoleLoads.set(id, request);
  return request;
}
async function readConsoleTail(id: ConnectionId) {
  const page = await serverCommand((client) => client.consolePage(id, null, 200));
  const added = consoleBuffer(id).merge(page.items);
  bumpConsole(id);
  return added;
}

const [now, setNow] = createSignal(Date.now(), { name: 'serversClock' });
let clockUsers = 0;
let clock: ReturnType<typeof setInterval> | undefined;

/** A shared one-second clock for "seen … ago" and countdown copy, running only while used. */
export function useServersClock() {
  clockUsers++;
  if (!clock) clock = setInterval(() => setNow(Date.now()), 1000);
  onCleanup(() => {
    clockUsers--;
    if (clockUsers === 0 && clock) { clearInterval(clock); clock = undefined; }
  });
  return now;
}
