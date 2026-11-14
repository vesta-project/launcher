// Vesta Server machines known to this launcher, LAN discovery, and the jobs that add servers.
// Jobs live here, not in the wizard, so creating or copying keeps going (and stays visible)
// after the wizard closes. Only the job reference and its retry keys are remembered across
// restarts. Codes and review confirmations never leave memory.
import { createSignal, onCleanup } from 'solid-js';
import { toServerError } from './errors';
import type { AddMode } from './host-add-model';
import { importBusy, keepKey } from './host-model';
import {
  hostsNative, type CreateJob, type CreatePlan, type HostDiscovery, type HostInfo, type HostServer, type ImportJob, type ImportPlan, type VestaHost,
} from './native-hosts';
import { nativeServers, type ServerCommandError } from './native';
import type { HostsApi } from './host-fixtures';

let fixtureApi: Promise<HostsApi> | undefined;
// Preview only: `localStorage['vesta.fixtures.hosts']`, `['vesta.fixtures.import']`, `['vesta.fixtures.signin']` and
// `['vesta.fixtures.create']` pick a scenario (see host-fixtures.ts).
const fixtureScenario = (key: string) => globalThis.localStorage?.getItem(`vesta.fixtures.${key}`) ?? null;
const api = (): Promise<HostsApi> => (nativeServers
  ? Promise.resolve(hostsNative)
  : (fixtureApi ??= import('./host-fixtures').then((module) => module.createHostFixtures({
    hosts: fixtureScenario('hosts'), found: fixtureScenario('import'), signin: fixtureScenario('signin'), create: fixtureScenario('create'),
  }))));

/** Run a host command, normalizing rejections into the closed error model. */
export async function hostCommand<T>(run: (client: HostsApi) => Promise<T>): Promise<T> {
  try { return await run(await api()); }
  catch (reason) { throw toServerError(reason); }
}

const [hosts, setHosts] = createSignal<VestaHost[]>([], { name: 'vestaHosts' });
const [hostsLoaded, setHostsLoaded] = createSignal(false, { name: 'vestaHostsLoaded' });
const [hostInfos, setHostInfos] = createSignal<Record<string, HostInfo>>({}, { name: 'vestaHostInfos' });
const [hostProblems, setHostProblems] = createSignal<Record<string, ServerCommandError>>({}, { name: 'vestaHostProblems' });
const [hostAnswers, setHostAnswers] = createSignal<Record<string, boolean>>({}, { name: 'vestaHostAnswers' });
const [discovered, setDiscovered] = createSignal<HostDiscovery[]>([], { name: 'vestaDiscovered' });
const [discovering, setDiscovering] = createSignal(false, { name: 'vestaDiscovering' });

export { hosts, hostsLoaded, discovered, discovering };
export const vestaHost = (id: string | undefined) => (id ? hosts().find((host) => host.id === id) : undefined);
export const hostInfo = (id: string) => hostInfos()[id];
export const hostProblem = (id: string) => hostProblems()[id];
/** Whether the machine answered its last servers read. */
export const hostReach = (id: string): 'checking' | 'online' | 'offline' => {
  const answered = hostAnswers()[id];
  return answered === undefined ? 'checking' : answered ? 'online' : 'offline';
};
const NO_ANSWER = ['unreachable', 'timeout', 'tls_failed', 'fingerprint_mismatch'];
const [hostServerLists, setHostServerLists] = createSignal<Record<string, HostServer[]>>({}, { name: 'vestaHostServerLists' });
const NO_SERVERS: HostServer[] = [];
/** What the machine last said about its servers (software, version, icon); empty until it answers. */
export const hostServers = (id: string): HostServer[] => hostServerLists()[id] ?? NO_SERVERS;

const patch = <T>(set: (next: (current: Record<string, T>) => Record<string, T>) => void, id: string, value: T | undefined) =>
  set((current) => {
    const next = { ...current };
    if (value === undefined) delete next[id];
    else next[id] = value;
    return next;
  });

/** Ask the machine for its servers; native code turns each into a normal server card. */
export async function loadHostServers(hostId: string) {
  try {
    const reply = await hostCommand((client) => client.servers(hostId));
    patch(setHostProblems, hostId, undefined);
    patch(setHostAnswers, hostId, true);
    patch(setHostServerLists, hostId, reply.servers);
    return reply.servers;
  } catch (reason) {
    const error = toServerError(reason);
    patch(setHostProblems, hostId, error);
    patch(setHostAnswers, hostId, !NO_ANSWER.includes(error.code));
    throw reason;
  }
}

/** Fresh host info: name, role and revision. Also renews the machine's sign in. */
export async function loadHostInfo(hostId: string) {
  const info = await hostCommand((client) => client.info(hostId));
  patch(setHostInfos, hostId, info);
  return info;
}

let listSequence = 0;
/** Re-read known machines, then their servers. Only the newest read applies. */
export async function refreshHosts(options: { servers?: boolean } = {}) {
  const sequence = ++listSequence;
  try {
    const list = await hostCommand((client) => client.list());
    if (sequence !== listSequence) return;
    setHosts(list);
    if (options.servers !== false) await Promise.allSettled(list.map((host) => loadHostServers(host.id)));
  } catch {
    // The list read only fails when local storage is unreadable; the Servers list shows that.
  } finally {
    if (sequence === listSequence) setHostsLoaded(true);
  }
}

let discovery: Promise<void> | undefined;
/** One bounded LAN browse at a time; results replace the previous list. */
export function discoverHosts(): Promise<void> {
  discovery ??= (async () => {
    await Promise.resolve();
    setDiscovering(true);
    try { setDiscovered(await hostCommand((client) => client.discover())); }
    catch { /* Discovery is only a hint; typing an address still works. */ }
    finally { setDiscovering(false); discovery = undefined; }
  })();
  return discovery;
}

export async function forgetHost(hostId: string) {
  await hostCommand((client) => client.remove(hostId));
  patch(setHostInfos, hostId, undefined);
  patch(setHostProblems, hostId, undefined);
  patch(setHostAnswers, hostId, undefined);
  patch(setHostServerLists, hostId, undefined);
  clearAdd(hostId);
  await refreshHosts({ servers: false });
}


// ------------------------------------------------------------------ adding a server: one job per machine

type KeyedAction = 'plan' | 'apply' | 'cancel' | 'resume' | 'start';
export type AddJob = ImportJob | CreateJob;
/** What was asked of the machine: copy a folder, or create a server (new, from a pack or a backup). */
export type AddRequest =
  | { mode: 'import'; body: ImportPlan; folder: { token: string; displayPath: string } }
  | { mode: Exclude<AddMode, 'import'>; body: CreatePlan };

export interface AddTask {
  hostId: string;
  mode: AddMode;
  jobId: string | null;
  /** The server's name: shown while the machine works. */
  name: string;
  /** Import only: where the original lives. */
  sourcePath: string | null;
  /** The last plan sent, so "Check again" and "Try again" ask the same thing. Null after a restart. */
  request: AddRequest | null;
  /**
   * One idempotency key per intent. A retry of the same request reuses its key until the
   * outcome is certain; a different request (another port, another plan) gets a new one.
   */
  keys: Partial<Record<KeyedAction, { key: string; intent: string }>>;
  job: AddJob | null;
  error: ServerCommandError | null;
  /** A command is in flight. */
  sending: KeyedAction | null;
}

const STORAGE_KEY = 'vesta.hosts.adds';
const LEGACY_STORAGE_KEY = 'vesta.hosts.imports';
const [adds, setAddsSignal] = createSignal<Record<string, AddTask>>({}, { name: 'vestaAdds' });
// Solid batches signal writes, so store logic reads this plain object, never the signal.
let addState: Record<string, AddTask> = {};
const setAdds = (next: Record<string, AddTask>) => {
  addState = next;
  setAddsSignal(next);
};
export const addTask = (hostId: string): AddTask | undefined => adds()[hostId];
const PAST_REVIEW: readonly string[] = ['applying', 'interrupted', 'ready', 'starting'];
/** Servers being made: downloading, copying, paused, made or starting. A restored job counts until read. */
export const activeAdds = () => Object.values(adds()).filter((task) => task.jobId && task.error?.code !== 'not_found' && PAST_REVIEW.includes(task.job?.state ?? 'applying'));

function remember(next: Record<string, AddTask>) {
  try {
    const saved = Object.values(next).filter((task) => task.jobId).map((task) => ({
      hostId: task.hostId, mode: task.mode, jobId: task.jobId, name: task.name, sourcePath: task.sourcePath,
      keys: { apply: task.keys.apply, start: task.keys.start, resume: task.keys.resume, cancel: task.keys.cancel },
    }));
    globalThis.localStorage?.removeItem(LEGACY_STORAGE_KEY);
    if (saved.length) globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(saved));
    else globalThis.localStorage?.removeItem(STORAGE_KEY);
  } catch { /* Storage is a convenience: the job keeps running on the machine regardless. */ }
}

function update(hostId: string, change: (task: AddTask) => AddTask | null) {
  const task = addState[hostId];
  if (!task) return;
  const changed = change(task);
  const next = { ...addState };
  if (changed) next[hostId] = changed;
  else delete next[hostId];
  setAdds(next);
  remember(next);
}

const newKey = () => globalThis.crypto.randomUUID();
/** Never ask the machine about a job more often than this. */
export const POLL_MS = 2000;
const polls = new Map<string, ReturnType<typeof setTimeout>>();
const lastRead = new Map<string, number>();

const readJob = (client: HostsApi, task: AddTask): Promise<AddJob> =>
  (task.mode === 'import' ? client.importJob(task.hostId, task.jobId!) : client.createJob(task.hostId, task.jobId!));

function stopPolling(hostId: string) {
  const timer = polls.get(hostId);
  if (timer) clearTimeout(timer);
  polls.delete(hostId);
}

/**
 * Follows a job while the machine works on it, at most every two seconds. It stops by itself
 * once the job waits for the person (review) or ends, and starts again when the wizard reopens.
 */
function poll(hostId: string, delay = POLL_MS) {
  if (polls.has(hostId)) return;
  const since = Date.now() - (lastRead.get(hostId) ?? 0);
  polls.set(hostId, setTimeout(async () => {
    polls.delete(hostId);
    const task = addState[hostId];
    if (!task?.jobId) return;
    lastRead.set(hostId, Date.now());
    try {
      const job = await hostCommand((client) => readJob(client, task));
      update(hostId, (current) => (current.jobId === task.jobId ? { ...current, job, error: null } : current));
      if (importBusy(job.state) && addState[hostId]?.jobId === task.jobId) poll(hostId);
    } catch (reason) {
      const error = toServerError(reason);
      update(hostId, (current) => (current.jobId === task.jobId ? { ...current, error } : current));
      // A lost connection keeps following, more slowly; a missing job stops.
      if (error.code !== 'not_found' && error.code !== 'forbidden') poll(hostId, POLL_MS * 5);
    }
  }, Math.max(delay, POLL_MS - since)));
}

/** Runs one keyed command. The key is reused for the same intent until the outcome is certain. */
async function send<T>(hostId: string, action: KeyedAction, intent: string, run: (client: HostsApi, key: string) => Promise<T>): Promise<T | undefined> {
  const task = addState[hostId];
  if (!task || task.sending) return undefined;
  const kept = task.keys[action];
  const key = kept && kept.intent === intent ? kept.key : newKey();
  update(hostId, (current) => ({ ...current, sending: action, error: null, keys: { ...current.keys, [action]: { key, intent } } }));
  try {
    const result = await hostCommand((client) => run(client, key));
    update(hostId, (current) => {
      const keys = { ...current.keys };
      delete keys[action];
      return { ...current, sending: null, keys };
    });
    return result;
  } catch (reason) {
    const error = toServerError(reason);
    update(hostId, (current) => {
      const keys = { ...current.keys };
      if (!keepKey(error)) delete keys[action];
      return { ...current, sending: null, error, keys };
    });
    return undefined;
  }
}

const NO_PROGRESS = { filesDone: 0, filesTotal: 0, bytesDone: 0, bytesTotal: 0 };

/**
 * Asks the machine to check a plan. Any earlier plan for this machine is dropped, but a job
 * that is already making a server is never replaced.
 */
export async function planAdd(hostId: string, request: AddRequest, name: string) {
  const previous = addState[hostId];
  if (previous?.jobId && PAST_REVIEW.includes(previous.job?.state ?? '')) return;
  stopPolling(hostId);
  const task: AddTask = {
    hostId, mode: request.mode, jobId: null, name, sourcePath: request.mode === 'import' ? request.folder.displayPath : null, request,
    keys: previous?.keys.plan ? { plan: previous.keys.plan } : {}, job: null, error: null, sending: null,
  };
  const next = { ...addState, [hostId]: task };
  setAdds(next);
  remember(next);
  const reply = await send(hostId, 'plan', JSON.stringify(request.body), (client, key) => (request.mode === 'import'
    ? client.importPlan(hostId, request.body, key)
    : client.createPlan(hostId, request.body, key)));
  if (!reply) return;
  const phase = request.mode === 'import' ? 'inspect' : 'resolving';
  update(hostId, (current) => ({ ...current, jobId: reply.jobId, job: { jobId: reply.jobId, state: reply.state, phase, error: null, progress: NO_PROGRESS, review: null, serverId: null } }));
  poll(hostId);
}

/** Plan the same thing again: after a fix on the machine, an expired review or a failed job. */
export async function replanAdd(hostId: string) {
  const task = addState[hostId];
  if (task?.request) await planAdd(hostId, task.request, task.name);
}

/** Go ahead with the reviewed plan. The confirmation comes from the review and is never stored. */
export async function applyAdd(hostId: string, acknowledgedWarnings: string[]) {
  const task = addState[hostId];
  const review = task?.job?.review;
  if (!task || !review?.confirmation) return;
  const body = { planId: review.planId, confirmation: review.confirmation, acknowledgedWarnings, eulaAccepted: true as const };
  const mode = task.mode;
  const reply = await send(hostId, 'apply', JSON.stringify(body), (client, key) => (mode === 'import'
    ? client.importApply(hostId, { ...body, sourceStoppedConfirmed: true }, key)
    : client.createApply(hostId, body, key)));
  if (!reply) return;
  const phase = mode === 'import' ? 'snapshot' : 'resolving';
  update(hostId, (current) => ({
    ...current, jobId: reply.jobId,
    job: current.job ? { ...current.job, jobId: reply.jobId, state: 'applying', phase, error: null, progress: NO_PROGRESS, serverId: reply.serverId } : current.job,
  }));
  poll(hostId);
}

const jobCommand = (action: 'cancel' | 'resume' | 'start') => async (hostId: string) => {
  const task = addState[hostId];
  if (!task?.jobId) return;
  const { jobId, mode } = task;
  const reply = await send(hostId, action, `${action}:${jobId}`, (client, key): Promise<Partial<AddJob>> => {
    if (action === 'cancel') {
      return (mode === 'import' ? client.importCancel(hostId, jobId, key) : client.createCancel(hostId, jobId, key)).then((result) => ({ state: result.state }));
    }
    if (action === 'resume') return mode === 'import' ? client.importResume(hostId, jobId, key) : client.createResume(hostId, jobId, key);
    return mode === 'import' ? client.importStart(hostId, jobId, key) : client.createStart(hostId, jobId, key);
  });
  if (!reply) return;
  update(hostId, (current) => ({ ...current, job: current.job ? { ...current.job, ...reply, error: reply.error ?? null } as AddJob : current.job }));
  poll(hostId);
};
export const cancelAdd = jobCommand('cancel');
export const resumeAdd = jobCommand('resume');
export const startAdd = jobCommand('start');

/** Forget the job here. The machine keeps whatever it already made or copied. */
export function clearAdd(hostId: string) {
  stopPolling(hostId);
  const next = { ...addState };
  delete next[hostId];
  setAdds(next);
  remember(next);
}

/** Read the job now (after reopening the wizard, or a failed poll), never sooner than two seconds after the last read. */
export const recheckAdd = (hostId: string) => poll(hostId, 0);

const MODES: readonly AddMode[] = ['new', 'modpack', 'restore', 'import'];
function readSaved(key: string): unknown[] {
  try {
    const saved = JSON.parse(globalThis.localStorage?.getItem(key) ?? '[]');
    return Array.isArray(saved) ? saved : [];
  } catch { return []; }
}

function restoreAdds() {
  const restored: Record<string, AddTask> = {};
  for (const entry of [...readSaved(LEGACY_STORAGE_KEY), ...readSaved(STORAGE_KEY)] as Record<string, unknown>[]) {
    if (!entry || typeof entry.hostId !== 'string' || typeof entry.jobId !== 'string') continue;
    // Only keys that remember their intent can be reused safely.
    const keys = Object.fromEntries(Object.entries((entry.keys ?? {}) as Record<string, unknown>).filter(([, value]) => {
      const kept = value as { key?: unknown; intent?: unknown } | null;
      return !!kept && typeof kept.key === 'string' && typeof kept.intent === 'string';
    })) as AddTask['keys'];
    const mode = MODES.includes(entry.mode as AddMode) ? entry.mode as AddMode : 'import';
    const sourcePath = typeof entry.sourcePath === 'string' ? entry.sourcePath : typeof entry.displayPath === 'string' ? entry.displayPath : null;
    restored[entry.hostId] = {
      hostId: entry.hostId, mode, jobId: entry.jobId, name: typeof entry.name === 'string' ? entry.name : '', sourcePath,
      request: null, keys, job: null, error: null, sending: null,
    };
  }
  setAdds(restored);
  remember(restored);
  for (const hostId of Object.keys(restored)) poll(hostId, 0);
}

/** Loads machines once per window, refreshes them every few minutes, and picks up jobs left running. */
export function useHostSync() {
  void refreshHosts();
  // Signal writes wait until the calling component has finished setting up.
  void Promise.resolve().then(restoreAdds);
  const timer = setInterval(() => void refreshHosts(), 5 * 60_000);
  onCleanup(() => clearInterval(timer));
}
