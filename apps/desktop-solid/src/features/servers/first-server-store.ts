// First-server setup per connection, owned outside any page: leaving the setup screen or the
// launcher mid-install and coming back shows the same job. One poll loop per connection while
// the host is working.
import { createSignal, type Accessor } from 'solid-js';
import { activeStep, jobDone, planRequest, stepFor, type SetupChoice, type SetupStep } from './first-server-model';
import { IntentMemo, newIntentId } from './model';
import type { ConnectionId, ServerCommandError, ServerSnapshot } from './native';
import { serversSetupNative, type SetupJob, type SetupStatus } from './native-setup';
import { usingFixtures } from './service';
import { putSnapshot, serverCommand, serverSnapshot } from './store';

export interface FirstServerState {
  step: SetupStep;
  choice: SetupChoice | null;
  job: SetupJob | null;
  error: ServerCommandError | null;
  /** The step that failed, for the step row and for what Try again does. */
  failedAt: 'prepare' | 'install' | null;
  startedAt: number | null;
  /** The managed server after handoff. */
  server: ServerSnapshot | null;
}

const initial = (): FirstServerState => ({ step: 'choose', choice: null, job: null, error: null, failedAt: null, startedAt: null, server: null });

// The plain map is the source of truth (signal writes are batched until flush); signals notify.
const states = new Map<ConnectionId, FirstServerState>();
const cells = new Map<ConnectionId, { read: Accessor<FirstServerState>; write: (next: FirstServerState) => void }>();
const read = (id: ConnectionId) => { let value = states.get(id); if (!value) states.set(id, (value = initial())); return value; };
const cell = (id: ConnectionId) => {
  let entry = cells.get(id);
  if (!entry) {
    const [get, set] = createSignal(read(id), { name: `firstServer:${id}` });
    entry = { read: get, write: (next) => set(() => next) };
    cells.set(id, entry);
  }
  return entry;
};
function patch(id: ConnectionId, next: Partial<FirstServerState>) {
  const merged = { ...read(id), ...next };
  states.set(id, merged);
  cell(id).write(merged);
}

export const firstServer = (id: ConnectionId) => cell(id).read();
export const peekFirstServer = (id: ConnectionId) => read(id);

type SetupApi = Omit<typeof serversSetupNative, 'readiness'>;
let api: SetupApi = serversSetupNative;
/** Browser previews and tests swap in a host that behaves like the real one. */
export function configureSetupApi(next: SetupApi) { api = next; }

const call = <T>(work: (setup: SetupApi) => Promise<T>) => serverCommand(() => work(api));
const plans = new Map<ConnectionId, IntentMemo>();
const applies = new Map<ConnectionId, IntentMemo>();
const memo = (store: Map<ConnectionId, IntentMemo>, id: ConnectionId) => { let value = store.get(id); if (!value) store.set(id, (value = new IntentMemo())); return value; };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const polling = new Set<ConnectionId>();

/** Whether this connection is a host still waiting for its first server; false when managed. */
export async function awaitingFirstServer(id: ConnectionId): Promise<boolean> {
  try { await call((setup) => setup.status(id)); return true; }
  catch { return false; }
}

/** Claims the host for the signed-in account. Idempotent for the same first owner. */
export async function claimFirstServer(id: ConnectionId): Promise<SetupStatus> {
  return call((setup) => setup.claim(id, newIntentId()));
}

/** Records a job the host returned; a failed one names the step and its reason. */
function landed(id: ConnectionId, job: SetupJob, at: 'prepare' | 'install') {
  if (job.state === 'failed' || job.state === 'interrupted') {
    patch(id, { job, step: 'failed', failedAt: at, error: { code: 'conflict', reason: job.error ?? job.state, retryAfterMs: null } });
    return false;
  }
  patch(id, { job, step: stepFor(job.state) });
  return true;
}

/** Plans the install; the host prepares it for review. */
export async function prepareFirstServer(id: ConnectionId, choice: SetupChoice) {
  if (activeStep(read(id).step)) return;
  patch(id, { step: 'preparing', choice, error: null, failedAt: null, job: null, startedAt: Date.now() });
  try {
    await claimFirstServer(id);
    // A plan is never replayed: a new choice or a retry is a new intent.
    plans.set(id, new IntentMemo());
    const request = planRequest(choice);
    const job = await call((setup) => setup.plan(id, request, memo(plans, id).idFor({ id, request, at: Date.now() })));
    if (landed(id, job, 'prepare')) void follow(id);
  } catch (reason) {
    patch(id, { step: 'failed', failedAt: 'prepare', error: reason as ServerCommandError });
  }
}

/** Applies the reviewed job. Retrying an unknown outcome reuses its intent. */
export async function installFirstServer(id: ConnectionId, acknowledgeWarnings: boolean) {
  const job = read(id).job;
  if (!job || job.state !== 'review') return;
  patch(id, { step: 'installing', error: null, failedAt: null });
  const intents = memo(applies, id);
  const body = { jobId: job.id, acknowledgeWarnings };
  try {
    const next = await call((setup) => setup.apply(id, job.id, acknowledgeWarnings, false, intents.idFor(body)));
    intents.settle();
    if (landed(id, next, 'install')) void follow(id);
  } catch (reason) {
    intents.settle(reason as ServerCommandError);
    patch(id, { step: 'failed', failedAt: 'install', error: reason as ServerCommandError });
  }
}

/** Polls the job until it stops; a completed job hands off to the managed server. */
async function follow(id: ConnectionId) {
  if (polling.has(id)) return;
  polling.add(id);
  try {
    for (;;) {
      const job = read(id).job;
      if (!job) return;
      if (job.state === 'complete') { await handoff(id); return; }
      if (jobDone(job)) return;
      await sleep(1500);
      try {
        const next = await call((setup) => setup.job(id, job.id));
        // Which step failed is the one running before this read, so decide it before patching.
        const running = read(id).step;
        if (next.state === 'failed' || next.state === 'interrupted') {
          patch(id, { job: next, step: 'failed', failedAt: running === 'preparing' ? 'prepare' : 'install', error: { code: 'conflict', reason: next.error ?? next.state, retryAfterMs: null } });
          return;
        }
        patch(id, { job: next, step: stepFor(next.state) });
      } catch { /* A dropped read retries on the next tick. */ }
    }
  } finally { polling.delete(id); }
}

/** Retries the managed handoff until the host answers as the same managed server. */
async function handoff(id: ConnectionId) {
  patch(id, { step: 'finishing' });
  let lastError: ServerCommandError | null = null;
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const server = await call((setup) => setup.handoff(id));
      putSnapshot(server);
      patch(id, { step: 'ready', server, error: null });
      return;
    } catch (reason) {
      lastError = reason as ServerCommandError;
      // The pending host closes connections while it hands over; wait and retry.
      await sleep(Math.min(1000 + attempt * 500, 4000));
    }
  }
  patch(id, { step: 'failed', failedAt: 'install', error: lastError });
}

/** After a failure: return to the choice (plans are never replayed), or retry the handoff. */
export function retryFirstServer(id: ConnectionId) {
  const state = read(id);
  if (state.job?.state === 'complete') { void handoff(id); return; }
  patch(id, { step: 'choose', job: null, error: null, failedAt: null });
}

/** Reopening the screen picks the job back up. */
export function resumeFirstServer(id: ConnectionId) {
  const state = read(id);
  if (state.job && !jobDone(state.job)) void follow(id);
  else if (state.job?.state === 'complete' && state.step !== 'ready') void handoff(id);
}

export const knownServerName = (id: ConnectionId) => serverSnapshot(id)?.connection.name;

// ---------------------------------------------------------------------------------------------
// Browser preview: a pending host that plans, reviews and installs on a timer, like the real one.

if (usingFixtures) configureSetupApi(createSetupFixtures());

export function createSetupFixtures(timing = { plan: 3500, apply: 5000 }): SetupApi {
  const jobs = new Map<string, { job: SetupJob; at: number; phase: 'plan' | 'apply' }>();
  const advance = (entry: { job: SetupJob; at: number; phase: 'plan' | 'apply' }) => {
    const elapsed = Date.now() - entry.at;
    if (entry.phase === 'plan') {
      entry.job = elapsed < timing.plan
        ? { ...entry.job, state: 'planning', phase: elapsed < timing.plan / 2 ? 'metadata' : 'downloading' }
        : { ...entry.job, state: 'review', phase: 'review' };
    } else {
      entry.job = elapsed < timing.apply
        ? { ...entry.job, state: 'applying', phase: elapsed < timing.apply / 2 ? 'installing' : 'publishing' }
        : { ...entry.job, state: 'complete', phase: 'complete' };
    }
    return entry.job;
  };
  return {
    claim: async (id) => ({ installationId: `install-${id}`, serverId: `srv_${id}`, claimed: true }),
    status: async (id) => ({ installationId: `install-${id}`, serverId: `srv_${id}`, claimed: false }),
    plan: async (_id, request) => {
      if (request.kind !== 'install') throw { code: 'invalid_input' };
      const job: SetupJob = {
        id: crypto.randomUUID(), state: 'planning', phase: 'metadata', error: null,
        review: { name: request.name, minecraftVersion: request.version, software: request.software, loaderVersion: request.software === 'vanilla' ? null : 'latest', files: 38, bytes: String(61 * 1048576), warnings: request.software === 'forge' ? ['legacy_installer'] : [] },
      };
      const entry = { job, at: Date.now(), phase: 'plan' as const };
      jobs.set(job.id, entry);
      return advance(entry);
    },
    apply: async (_id, jobId) => {
      const entry = jobs.get(jobId) ?? (() => { throw { code: 'not_found' }; })();
      if (advance(entry).state !== 'review') throw { code: 'conflict', reason: 'setup_review_changed' };
      entry.phase = 'apply'; entry.at = Date.now();
      return advance(entry);
    },
    job: async (_id, jobId) => { const entry = jobs.get(jobId); if (!entry) throw { code: 'not_found' }; return advance(entry); },
    handoff: async (id) => {
      const current = serverSnapshot(id);
      if (!current) throw { code: 'not_found' };
      return current;
    },
  };
}
