// Vesta Server machines known to this launcher, LAN discovery, and import jobs.
// Import jobs live here, not in the wizard, so copying keeps going (and stays visible)
// after the wizard closes. Only the job reference and its retry keys are remembered across
// restarts; codes and import confirmations never leave memory.
import { createSignal, onCleanup } from 'solid-js';
import { toServerError } from './errors';
import { importBusy, keepKey } from './host-model';
import { hostsNative, type HostDiscovery, type HostInfo, type ImportJob, type ImportPlan, type VestaHost } from './native-hosts';
import { nativeServers, type ServerCommandError } from './native';
import type { HostsApi } from './host-fixtures';

let fixtureApi: Promise<HostsApi> | undefined;
// Preview only: `localStorage['vesta.fixtures.hosts']` and `['vesta.fixtures.import']` pick a scenario (see host-fixtures.ts).
const fixtureScenario = (key: string) => globalThis.localStorage?.getItem(`vesta.fixtures.${key}`) ?? null;
const api = (): Promise<HostsApi> => (nativeServers
  ? Promise.resolve(hostsNative)
  : (fixtureApi ??= import('./host-fixtures').then((module) => module.createHostFixtures({ hosts: fixtureScenario('hosts'), found: fixtureScenario('import') }))));

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
  clearImport(hostId);
  await refreshHosts({ servers: false });
}

// ------------------------------------------------------------------ import jobs

type KeyedAction = 'plan' | 'apply' | 'cancel' | 'resume' | 'start';

export interface ImportTask {
  hostId: string;
  jobId: string | null;
  /** What the person picked: shown while the machine works. */
  name: string;
  folder: { token: string; displayPath: string };
  /** What was asked for; null lets the machine pick. */
  request: { gamePort: number | null; memoryMiB: number | null };
  /** One idempotency key per intent, kept until that intent has a definite answer. */
  keys: Partial<Record<KeyedAction, string>>;
  job: ImportJob | null;
  error: ServerCommandError | null;
  /** A command is in flight. */
  sending: KeyedAction | null;
}

const STORAGE_KEY = 'vesta.hosts.imports';
const [imports, setImportsSignal] = createSignal<Record<string, ImportTask>>({}, { name: 'vestaImports' });
// Solid batches signal writes, so store logic reads this plain object, never the signal.
let importState: Record<string, ImportTask> = {};
const setImports = (next: Record<string, ImportTask> | ((current: Record<string, ImportTask>) => Record<string, ImportTask>)) => {
  importState = typeof next === 'function' ? next(importState) : next;
  setImportsSignal(importState);
};
export const importTask = (hostId: string) => imports()[hostId];
const COPYING: readonly string[] = ['applying', 'interrupted', 'ready', 'starting'];
/** Imports past review: copying, paused, copied or starting. A restored job counts until read. */
export const activeImports = () => Object.values(imports()).filter((task) => task.jobId && COPYING.includes(task.job?.state ?? 'applying'));

function remember(next: Record<string, ImportTask>) {
  try {
    const saved = Object.values(next).filter((task) => task.jobId).map((task) => ({
      hostId: task.hostId, jobId: task.jobId, name: task.name, displayPath: task.folder.displayPath,
      keys: { apply: task.keys.apply, start: task.keys.start, resume: task.keys.resume, cancel: task.keys.cancel },
    }));
    if (saved.length) globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(saved));
    else globalThis.localStorage?.removeItem(STORAGE_KEY);
  } catch { /* Storage is a convenience: the job keeps running on the machine regardless. */ }
}

function update(hostId: string, change: (task: ImportTask) => ImportTask | null) {
  const current = importState;
  const task = current[hostId];
  if (!task) return;
  const changed = change(task);
  const next = { ...current };
  if (changed) next[hostId] = changed;
  else delete next[hostId];
  setImports(next);
  remember(next);
}

const newKey = () => globalThis.crypto.randomUUID();
const POLL_MS = 1000;
const polls = new Map<string, ReturnType<typeof setTimeout>>();

/** Follows a job about once a second while the machine is working on it. */
function poll(hostId: string, delay = POLL_MS) {
  if (polls.has(hostId)) return;
  polls.set(hostId, setTimeout(async () => {
    polls.delete(hostId);
    const task = importState[hostId];
    if (!task?.jobId) return;
    try {
      const job = await hostCommand((client) => client.importJob(hostId, task.jobId!));
      update(hostId, (current) => (current.jobId === task.jobId ? { ...current, job, error: null } : current));
      if (importBusy(job.state)) poll(hostId);
    } catch (reason) {
      const error = toServerError(reason);
      update(hostId, (current) => ({ ...current, error }));
      // A lost connection keeps following, more slowly; a missing job stops.
      if (error.code !== 'not_found' && error.code !== 'forbidden') poll(hostId, POLL_MS * 5);
    }
  }, delay));
}

/** Runs one keyed command. The key is reused on retry until the outcome is certain. */
async function send<T>(hostId: string, action: KeyedAction, run: (client: HostsApi, key: string) => Promise<T>): Promise<T | undefined> {
  const task = importState[hostId];
  if (!task || task.sending) return undefined;
  const key = task.keys[action] ?? newKey();
  update(hostId, (current) => ({ ...current, sending: action, error: null, keys: { ...current.keys, [action]: key } }));
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

/** Starts a fresh check of a folder. Any earlier plan for this machine is dropped. */
export async function planImport(hostId: string, choice: { folder: ImportTask['folder']; name: string; gamePort: number | null; memoryMiB: number | null }) {
  const previous = importState[hostId];
  const task: ImportTask = { hostId, jobId: null, name: choice.name, folder: choice.folder, request: { gamePort: choice.gamePort, memoryMiB: choice.memoryMiB }, keys: {}, job: null, error: null, sending: null };
  // A replan keeps its key only while the previous attempt's outcome is unknown.
  if (previous && !previous.jobId && previous.keys.plan) task.keys.plan = previous.keys.plan;
  setImports((current) => ({ ...current, [hostId]: task }));
  const body: ImportPlan = { folderToken: choice.folder.token, name: choice.name, gamePort: choice.gamePort, memoryMiB: choice.memoryMiB, launchChoice: null, minecraftVersion: null };
  const reply = await send(hostId, 'plan', (client, key) => client.importPlan(hostId, body, key));
  if (!reply) return;
  update(hostId, (current) => ({ ...current, jobId: reply.jobId, job: { jobId: reply.jobId, state: reply.state, phase: 'inspect', error: null, progress: { filesDone: 0, filesTotal: 0, bytesDone: 0, bytesTotal: 0 }, review: null, serverId: null } }));
  poll(hostId, 400);
}

/** Copies the reviewed folder. The confirmation comes from the review and is never stored. */
export async function applyImport(hostId: string, acknowledgedWarnings: string[]) {
  const review = importState[hostId]?.job?.review;
  if (!review?.confirmation) return;
  const reply = await send(hostId, 'apply', (client, key) => client.importApply(hostId, {
    planId: review.planId, confirmation: review.confirmation!, acknowledgedWarnings, eulaAccepted: true, sourceStoppedConfirmed: true,
  }, key));
  if (!reply) return;
  update(hostId, (current) => ({ ...current, jobId: reply.jobId, job: current.job ? { ...current.job, state: 'applying', serverId: reply.serverId } : current.job }));
  poll(hostId, 300);
}

const jobCommand = (action: 'cancel' | 'resume' | 'start') => async (hostId: string) => {
  const jobId = importState[hostId]?.jobId;
  if (!jobId) return;
  const reply = await send(hostId, action, (client, key) => (action === 'cancel'
    ? client.importCancel(hostId, jobId, key).then((result) => ({ state: result.state }))
    : action === 'resume' ? client.importResume(hostId, jobId, key) : client.importStart(hostId, jobId, key)));
  if (!reply) return;
  update(hostId, (current) => ({ ...current, job: current.job ? { ...current.job, ...reply, error: 'error' in reply ? (reply as ImportJob).error : null } : current.job }));
  poll(hostId, 300);
};
export const cancelImport = jobCommand('cancel');
export const resumeImport = jobCommand('resume');
export const startImport = jobCommand('start');

/** Forget the job here. The machine keeps whatever was already copied. */
export function clearImport(hostId: string) {
  const timer = polls.get(hostId);
  if (timer) clearTimeout(timer);
  polls.delete(hostId);
  const next = { ...importState };
  delete next[hostId];
  setImports(next);
  remember(next);
}

/** Read the job once now (after reopening the wizard, or a failed poll). */
export const recheckImport = (hostId: string) => poll(hostId, 0);

function restoreImports() {
  let saved: unknown;
  try { saved = JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) ?? '[]'); } catch { saved = []; }
  if (!Array.isArray(saved)) return;
  const restored: Record<string, ImportTask> = {};
  for (const entry of saved) {
    if (!entry || typeof entry.hostId !== 'string' || typeof entry.jobId !== 'string') continue;
    const keys = Object.fromEntries(Object.entries(entry.keys ?? {}).filter(([, value]) => typeof value === 'string')) as ImportTask['keys'];
    restored[entry.hostId] = {
      hostId: entry.hostId, jobId: entry.jobId, name: typeof entry.name === 'string' ? entry.name : '',
      folder: { token: '', displayPath: typeof entry.displayPath === 'string' ? entry.displayPath : '' }, request: { gamePort: null, memoryMiB: null }, keys, job: null, error: null, sending: null,
    };
  }
  setImports(restored);
  for (const hostId of Object.keys(restored)) poll(hostId, 0);
}

/** Loads machines once per window, refreshes them every few minutes, and resumes import jobs. */
export function useHostSync() {
  void refreshHosts();
  // Signal writes wait until the calling component has finished setting up.
  void Promise.resolve().then(restoreImports);
  const timer = setInterval(() => void refreshHosts(), 5 * 60_000);
  onCleanup(() => clearInterval(timer));
}
