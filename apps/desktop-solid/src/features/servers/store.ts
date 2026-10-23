// Server-keyed reactive state for the server UI. Every server and topic has its own
// signal, so an update to one server's snapshot, console, metrics or operations
// reruns only the views reading that server and topic.
import { createEffect, createMemo, createSignal, onCleanup, untrack, type Accessor } from 'solid-js';
import { ConsoleBuffer } from './console-model';
import { toServerError } from './errors';
import { mergeOperations } from './operations-model';
import { releaseServerResources } from './resources';
import { serversApi, type ServersApi } from './service';
import type { ConnectionId, MetricsSample, ServerCommandError, ServerOperation, ServerSnapshot, ServerTopic } from './native';

/** One lazily created signal per connection id. */
function keyed<T>(name: string, initial: () => T) {
  const cells = new Map<ConnectionId, { read: Accessor<T>; write: (next: (current: T) => T) => void }>();
  const cell = (id: ConnectionId) => {
    let entry = cells.get(id);
    if (!entry) {
      const [read, set] = createSignal<T>(initial() as Exclude<T, Function>, { name: `${name}:${id}` });
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

const snapshots = keyed<ServerSnapshot | undefined>('serverSnapshot', () => undefined);
const operations = keyed<ServerOperation[]>('serverOperations', () => []);
const metrics = keyed<MetricsSample[]>('serverMetrics', () => []);
const consoleVersions = keyed<number>('serverConsoleVersion', () => 0);
const [order, setOrder] = createSignal<ConnectionId[]>([], { name: 'serverOrder' });
const [loaded, setLoaded] = createSignal(false, { name: 'serversLoaded' });
const [listError, setListError] = createSignal<ServerCommandError | null>(null, { name: 'serversListError' });

const players = keyed<import('./native').PlayersView>('serverPlayers', () => ({ known: false }));
export const serverPlayers = (id: ConnectionId) => players.get(id);

const consoles = new Map<ConnectionId, ConsoleBuffer>();
const refreshing = keyed<boolean>('serverRefreshing', () => false);
const refreshes = new Map<ConnectionId, Promise<void>>();
export const serverRefreshing = (id: ConnectionId) => refreshing.get(id);

/** One explicit observation per server, even when several views request it. */
export function refreshServer(id: ConnectionId): Promise<void> {
  const pending = refreshes.get(id);
  if (pending) return pending;
  const request = serverCommand((client) => client.snapshot(id, true))
    .then((snapshot) => { if (untrack(() => snapshots.get(id))) putSnapshot(snapshot); })
    .finally(() => { refreshes.delete(id); refreshing.update(id, () => false); });
  refreshes.set(id, request);
  refreshing.update(id, () => true);
  return request;
}
const METRIC_HISTORY = 90;

export const serversLoaded = loaded;
export const serversListError = listError;
export const serverSnapshots = createMemo(
  () => order().map((id) => snapshots.get(id)).filter((snapshot): snapshot is ServerSnapshot => !!snapshot),
  { name: 'serverList' },
);
export const serverSnapshot = (id: ConnectionId | undefined) => (id ? snapshots.get(id) : undefined);
export const pinnedServers = createMemo(() => serverSnapshots().filter((snapshot) => snapshot.connection.pinned), { name: 'pinnedServers' });
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
  snapshots.update(id, () => snapshot);
  const roster = untrack(() => players.get(id));
  if (roster.known && (snapshot.status?.state !== 'running' || snapshot.status.generation !== roster.generation)) {
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
  icons.delete(id);
  iconRequests.delete(id);
}

export function putOperations(id: ConnectionId, incoming: readonly ServerOperation[]) {
  operations.update(id, (current) => mergeOperations(current, incoming));
}

let api: ServersApi | undefined;
const ready = () => (api ? Promise.resolve(api) : serversApi().then((resolved) => (api = resolved)));

/** Run a command, normalizing rejections into the closed error model. */
export async function serverCommand<T>(run: (api: ServersApi) => Promise<T>): Promise<T> {
  try { return await run(await ready()); }
  catch (reason) { throw toServerError(reason); }
}

let listSequence = 0;
/** Re-read saved connections. Only the newest response applies, so a slow reply can't restore removed servers. */
export async function refreshServers() {
  const sequence = ++listSequence;
  try {
    const list = await serverCommand((client) => client.list());
    if (sequence !== listSequence) return;
    const ids = list.map((snapshot) => snapshot.connection.id);
    for (const id of untrack(order)) if (!ids.includes(id)) forget(id);
    for (const snapshot of list) {
      // Unchanged snapshots keep their identity so readers don't rerun.
      const current = untrack(() => snapshots.get(snapshot.connection.id));
      if (!current || JSON.stringify(current) !== JSON.stringify(snapshot)) snapshots.update(snapshot.connection.id, () => snapshot);
    }
    setOrder(ids);
    setListError(null);
  } catch (reason) {
    if (sequence === listSequence) setListError(toServerError(reason));
  } finally {
    if (sequence === listSequence) setLoaded(true);
  }
}

export async function removeServer(id: ConnectionId) {
  await serverCommand((client) => client.remove(id));
  forget(id);
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
  void refreshServers();
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
  const connection = createMemo(id, { name: `server-topic:${topic}:connection-id` });
  createEffect(connection, (connectionId) => {
    if (!connectionId) return;
    let unsubscribe: (() => void) | undefined;
    let closed = false;
    void serverCommand((client) => client.subscribe(connectionId, topic, (event) => {
      if (closed) return;
      switch (event.kind) {
        case 'snapshot': putSnapshot(event.snapshot); break;
        case 'players': {
          const status = untrack(() => snapshots.get(connectionId)?.status);
          players.update(connectionId, () => event.players.known && (status?.state !== 'running' || status.generation !== event.players.generation) ? { known: false } : event.players);
          break;
        }
        case 'console': consoleBuffer(connectionId).append(event.lines); bumpConsole(connectionId); break;
        case 'consoleHistory': consoleBuffer(connectionId).merge(event.lines); bumpConsole(connectionId); break;
        case 'consoleGap': consoleBuffer(connectionId).gap(event.cursor); bumpConsole(connectionId); void recoverConsoleTail(connectionId); break;
        case 'metrics': metrics.update(connectionId, (current) => [...current, event.sample].slice(-METRIC_HISTORY)); break;
        case 'operation': putOperations(connectionId, [event.operation]); break;
        case 'resync':
          if (event.topic === 'status') void serverCommand((client) => client.snapshot(connectionId, true)).then(putSnapshot).catch(() => {});
          if (event.topic === 'operations') void loadOperations(connectionId).catch(() => {});
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
