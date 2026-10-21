// Server-keyed reactive state for the server UI. Each topic of each server updates
// on its own; console history lives in a bounded buffer with a version signal so a
// new batch reruns only that server's console view.
import { createEffect, createMemo, createSignal, onCleanup, untrack } from 'solid-js';
import { ConsoleBuffer } from './console-model';
import { toServerError } from './errors';
import { mergeOperations } from './operations-model';
import { serversApi, type ServersApi } from './service';
import type { ConnectionId, MetricsSample, ServerCommandError, ServerOperation, ServerSnapshot, ServerTopic } from './native';

const [snapshots, setSnapshots] = createSignal<Record<ConnectionId, ServerSnapshot>>({}, { name: 'serverSnapshots' });
const [order, setOrder] = createSignal<ConnectionId[]>([], { name: 'serverOrder' });
const [loaded, setLoaded] = createSignal(false, { name: 'serversLoaded' });
const [listError, setListError] = createSignal<ServerCommandError | null>(null, { name: 'serversListError' });
const [operationsById, setOperationsById] = createSignal<Record<ConnectionId, ServerOperation[]>>({}, { name: 'serverOperations' });
const [metricsById, setMetricsById] = createSignal<Record<ConnectionId, MetricsSample[]>>({}, { name: 'serverMetrics' });
const [consoleVersions, setConsoleVersions] = createSignal<Record<ConnectionId, number>>({}, { name: 'serverConsoleVersions' });

const consoles = new Map<ConnectionId, ConsoleBuffer>();
const METRIC_HISTORY = 90;

export const serversLoaded = loaded;
export const serversListError = listError;
export const serverSnapshots = createMemo(() => order().map((id) => snapshots()[id]).filter(Boolean), { name: 'serverList' });
export const serverSnapshot = (id: ConnectionId | undefined) => (id ? snapshots()[id] : undefined);
export const pinnedServers = createMemo(() => serverSnapshots().filter((snapshot) => snapshot.connection.pinned), { name: 'pinnedServers' });
export const serverOperations = (id: ConnectionId) => operationsById()[id] ?? [];
export const serverMetrics = (id: ConnectionId) => metricsById()[id] ?? [];
export const latestMetrics = (id: ConnectionId) => serverMetrics(id).at(-1);

/** The console buffer for a server; read `consoleVersion(id)` in a tracking scope to follow changes. */
export const consoleBuffer = (id: ConnectionId) => {
  let buffer = consoles.get(id);
  if (!buffer) { buffer = new ConsoleBuffer(); consoles.set(id, buffer); }
  return buffer;
};
export const consoleVersion = (id: ConnectionId) => consoleVersions()[id] ?? 0;
const bumpConsole = (id: ConnectionId) => setConsoleVersions((current) => ({ ...current, [id]: (current[id] ?? 0) + 1 }));

export function putSnapshot(snapshot: ServerSnapshot) {
  const id = snapshot.connection.id;
  setSnapshots((current) => ({ ...current, [id]: snapshot }));
  setOrder((current) => (current.includes(id) ? current : [...current, id]));
}

function forget(id: ConnectionId) {
  setSnapshots((current) => { const next = { ...current }; delete next[id]; return next; });
  setOrder((current) => current.filter((entry) => entry !== id));
  consoles.delete(id);
}

export function putOperations(id: ConnectionId, operations: readonly ServerOperation[]) {
  setOperationsById((current) => ({ ...current, [id]: mergeOperations(current[id] ?? [], operations) }));
}

let api: ServersApi | undefined;
const ready = () => (api ? Promise.resolve(api) : serversApi().then((resolved) => (api = resolved)));

/** Run a command, normalizing rejections into the closed error model. */
export async function serverCommand<T>(run: (api: ServersApi) => Promise<T>): Promise<T> {
  try { return await run(await ready()); }
  catch (reason) { throw toServerError(reason); }
}

export async function refreshServers() {
  try {
    const list = await serverCommand((client) => client.list());
    const next = Object.fromEntries(list.map((snapshot) => [snapshot.connection.id, snapshot]));
    setSnapshots(next);
    setOrder(list.map((snapshot) => snapshot.connection.id));
    for (const id of consoles.keys()) if (!next[id]) consoles.delete(id);
    setListError(null);
  } catch (reason) {
    setListError(toServerError(reason));
  } finally {
    setLoaded(true);
  }
}

export async function removeServer(id: ConnectionId) {
  await serverCommand((client) => client.remove(id));
  forget(id);
}

export async function updateServer(id: ConnectionId, patch: { name?: string; pinned?: boolean }) {
  putSnapshot(await serverCommand((client) => client.update(id, patch)));
}

/** Loads saved servers once per window and follows native change notifications. Call from the shell. */
export function useServerSync() {
  let stop: (() => void) | undefined;
  let closed = false;
  void refreshServers();
  void ready().then((client) => {
    if (closed) return;
    stop = client.onChanged(() => void refreshServers());
  });
  onCleanup(() => { closed = true; stop?.(); });
}

/**
 * Keeps a topic subscription open while the calling component is mounted and the id is set.
 * Native code shares the underlying stream across windows and subscribers.
 */
export function useServerTopic(id: () => ConnectionId | undefined, topic: ServerTopic) {
  createEffect(id, (connectionId) => {
    if (!connectionId) return;
    let unsubscribe: (() => void) | undefined;
    let closed = false;
    void serverCommand((client) => client.subscribe(connectionId, topic, (event) => {
      switch (event.kind) {
        case 'snapshot': putSnapshot(event.snapshot); break;
        case 'console': consoleBuffer(connectionId).append(event.lines); bumpConsole(connectionId); break;
        case 'consoleGap': consoleBuffer(connectionId).gap(event.cursor); bumpConsole(connectionId); break;
        case 'metrics':
          setMetricsById((current) => ({ ...current, [connectionId]: [...(current[connectionId] ?? []), event.sample].slice(-METRIC_HISTORY) }));
          break;
        case 'operation': putOperations(connectionId, [event.operation]); break;
        case 'resync':
          if (event.topic === 'status') void serverCommand((client) => client.snapshot(connectionId, true)).then(putSnapshot).catch(() => {});
          if (event.topic === 'operations') void loadOperations(connectionId).catch(() => {});
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

/** Fetch a bounded page of older console lines before what is shown. */
export async function loadEarlierConsole(id: ConnectionId) {
  const buffer = consoleBuffer(id);
  const first = untrack(() => buffer.entries.find((entry) => entry.kind === 'line'));
  const page = await serverCommand((client) => client.consolePage(id, first?.cursor ?? null, 200));
  const added = buffer.prepend(page.items);
  bumpConsole(id);
  return { added, more: page.nextCursor !== null };
}

/** One bounded fetch for lines skipped at a gap marker. */
export async function recoverConsoleGap(id: ConnectionId, gapKey: string) {
  const buffer = consoleBuffer(id);
  const at = buffer.entries.findIndex((entry) => entry.key === gapKey);
  const after = buffer.entries.slice(at + 1).find((entry) => entry.kind === 'line');
  const page = await serverCommand((client) => client.consolePage(id, after?.cursor ?? null, 200));
  const added = buffer.fill(gapKey, page.items);
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
