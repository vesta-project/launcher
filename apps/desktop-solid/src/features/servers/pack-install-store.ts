// Per-server modpack install jobs, owned outside any page. Leaving the Modpack page, switching
// servers or opening another tab never stops or forgets an install: every view reads the same
// job, polling runs once per server, and the activity panel shows it everywhere.
import { createSignal, type Accessor } from 'solid-js';
import { backupJobTerminal } from './backup-jobs';
import { IntentMemo, newIntentId } from './model';
import type { LinkReviewMode } from './modpack-area-model';
import type { ConnectionId, ServerCommandError } from './native';
import type { PackInstallApply, PackInstallOutcome, PackInstallProgress, PackInstallSource, PackWorkspace } from './native-pack';
import {
  agentJobActive, agentPhase, cancellablePhase, effectivePhase, isActivePhase, jobError, progressSignature,
  type AgentInstallJob, type JobPlanShape, type JobStepId, type PackJobPhase,
} from './pack-install-job';
import type { ReviewPlan } from './pack-install-review';
import { invalidateServerResources, seedServerResource } from './resources';
import { CONTENT_RESOURCES, packWorkspaceResource } from './server-resources';
import { serverCommand } from './store';

/** A link or update review of the server's own modpack. */
export interface InstallRequestSource {
  source: PackInstallSource;
  /** What the review calls the pack. */
  name: string;
  mode: LinkReviewMode;
  /** An archive upload to cancel if the review is abandoned. */
  uploadId?: string;
}

export interface PackInstallJobState {
  /** The review the person opened; it stays open across navigation until closed or finished. */
  request: InstallRequestSource | null;
  /** A step this launcher is running, or null when only the agent's job (if any) matters. */
  local: PackJobPhase | null;
  /** The agent job accepted for this launcher's install; older jobs never end it early. */
  acceptedJobId: string | null;
  agent: AgentInstallJob | null;
  progress: PackInstallProgress | null;
  /** When visible progress last moved. */
  lastChangeAt: number;
  startedAt: number | null;
  shape: JobPlanShape;
  failedAt: JobStepId | null;
  error: ServerCommandError | null;
  /** The finished install, for the result screen. */
  outcome: PackInstallOutcome | null;
  /** A submitted apply whose fate is unknown; retrying reuses its intent. */
  uncertain: boolean;
  /** Bumped when an install changes the server, so open views reload what they show. */
  revision: number;
}

const EMPTY_SHAPE: JobPlanShape = { backup: false, softwareSwitch: false, resetWorld: false, adopted: false };
const initial = (): PackInstallJobState => ({
  request: null, local: null, acceptedJobId: null, agent: null, progress: null, lastChangeAt: 0, startedAt: null,
  shape: EMPTY_SHAPE, failedAt: null, error: null, outcome: null, uncertain: false, revision: 0,
});

/** Why a job stopped without finishing, for observers such as the activity panel. */
export type PackInstallNote = 'cancelled' | 'cancelled-backup-continues';
export type PackInstallListener = (id: ConnectionId, state: PackInstallJobState, phase: PackJobPhase | null, note?: PackInstallNote) => void;
const listeners = new Set<PackInstallListener>();
/** Observes every job change; the store itself stays free of presentation and localization. */
export function onPackInstallChange(listener: PackInstallListener) { listeners.add(listener); return () => { listeners.delete(listener); }; }

// Solid batches signal writes until the next flush, so a signal read straight after a write still
// returns the old value. The store's own logic reads this plain map (always current); the signal
// only tells views to update.
const states = new Map<ConnectionId, PackInstallJobState>();
const cells = new Map<ConnectionId, { read: Accessor<PackInstallJobState>; write: (next: PackInstallJobState) => void }>();
const cell = (id: ConnectionId) => {
  let entry = cells.get(id);
  if (!entry) {
    const [read, write] = createSignal(read_(id), { name: `packInstallJob:${id}` });
    entry = { read, write: (next) => write(() => next) };
    cells.set(id, entry);
  }
  return entry;
};
function read_(id: ConnectionId): PackInstallJobState {
  let value = states.get(id);
  if (!value) states.set(id, (value = initial()));
  return value;
}
const read = read_;
function patch(id: ConnectionId, next: Partial<PackInstallJobState>) {
  const current = read(id);
  const merged = { ...current, ...next };
  const moved = progressSignature(phaseOf(current), current.progress) !== progressSignature(phaseOf(merged), merged.progress);
  if (moved) merged.lastChangeAt = Date.now();
  states.set(id, merged);
  cell(id).write(merged);
  for (const listener of listeners) listener(id, merged, phaseOf(merged));
  ensurePolling(id);
}

const phaseOf = (state: PackInstallJobState) => effectivePhase(state.local, state.agent, state.acceptedJobId);

/** The job for one server; reactive. */
export const packInstallJob = (id: ConnectionId) => cell(id).read();
export const packJobPhase = (id: ConnectionId) => phaseOf(packInstallJob(id));
/** True while an install holds the server; every install entry point is disabled. */
export const packInstallBusy = (id: ConnectionId) => isActivePhase(packJobPhase(id)) || agentJobActive(packInstallJob(id).agent);
/** The current job without tracking; always up to date, even before views flush. */
export const peekPackInstallJob = (id: ConnectionId): PackInstallJobState => read(id);
const busyNow = (id: ConnectionId) => { const state = read(id); return isActivePhase(phaseOf(state)) || agentJobActive(state.agent); };
export const peekPackJobPhase = (id: ConnectionId) => phaseOf(read(id));
export const peekPackInstallBusy = busyNow;

// ---------------------------------------------------------------------------------------------
// Review requests

export function openInstallReview(id: ConnectionId, request: InstallRequestSource | null) {
  if (request && busyNow(id)) return;
  const current = read(id);
  // Opening a new review clears the previous result; closing keeps the job (if any) visible.
  patch(id, request ? { request, outcome: null, error: null, failedAt: null, uncertain: false, ...(isActivePhase(phaseOf(current)) ? {} : { local: null }) } : { request: null });
}

// ---------------------------------------------------------------------------------------------
// Preparation: the plan request downloads and checks the pack on the agent and can take minutes.
// One request per server and source; reopening the review attaches to it instead of restarting.

interface PlanRead { key: string; token: number; promise: Promise<ReviewPlan>; plan?: ReviewPlan }
const plans = new Map<ConnectionId, PlanRead>();
let tokens = 0;
const sourceKey = (source: PackInstallSource) => JSON.stringify(source);
export const PREPARATION_CANCELLED = 'pack_install_preparation_cancelled';

export function preparePlan(id: ConnectionId, source: PackInstallSource, options: { fresh?: boolean } = {}): Promise<ReviewPlan> {
  const key = sourceKey(source);
  const existing = plans.get(id);
  if (existing?.key === key && !options.fresh && (!existing.plan || existing.plan.expiresAtMs > Date.now())) return existing.promise;
  const token = ++tokens;
  const promise = serverCommand((api) => api.packInstallPlan(id, { source })).then((plan: ReviewPlan) => {
    const live = plans.get(id);
    if (live?.token !== token) throw { code: 'conflict', reason: PREPARATION_CANCELLED, retryAfterMs: null } satisfies ServerCommandError;
    live.plan = plan;
    return plan;
  }, (reason) => {
    if (plans.get(id)?.token === token) plans.delete(id);
    throw reason;
  }).finally(() => {
    if (plans.get(id)?.token === token && read(id).local === 'preparing') patch(id, { local: null, progress: null });
  });
  plans.set(id, { key, token, promise });
  const state = read(id);
  patch(id, { local: 'preparing', startedAt: state.local === 'preparing' ? state.startedAt : Date.now(), progress: null, error: null, failedAt: null, shape: EMPTY_SHAPE });
  return promise;
}

/** A finished, unexpired plan for this source, if the review already prepared it. */
export function preparedPlan(id: ConnectionId, source: PackInstallSource): ReviewPlan | undefined {
  const value = plans.get(id);
  return value?.key === sourceKey(source) && value.plan && value.plan.expiresAtMs > Date.now() ? value.plan : undefined;
}
export const preparationCancelled = (reason: unknown) => (reason as ServerCommandError | null)?.reason === PREPARATION_CANCELLED;

// ---------------------------------------------------------------------------------------------
// Install

export interface InstallRun {
  body: PackInstallApply;
  /** Back up with this profile first. */
  backupProfile: string | null;
  resetWorld: { name: string; revision: string } | null;
  softwareSwitch: boolean;
  /** An earlier, unconfirmed install result to finish (only the world reset remained). */
  installed?: PackInstallOutcome | null;
}

const applyIntents = new Map<ConnectionId, IntentMemo>();
const worldIntents = new Map<ConnectionId, IntentMemo>();
const memo = (store: Map<ConnectionId, IntentMemo>, id: ConnectionId) => { let value = store.get(id); if (!value) store.set(id, (value = new IntentMemo())); return value; };
/** Bumped by cancel; a run checks it between steps. */
const runs = new Map<ConnectionId, number>();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const lastRuns = new Map<ConnectionId, InstallRun>();

/**
 * After a failure: a failed world reset retries just that step (the pack is already installed);
 * anything else returns to the review, which re-prepares an expired plan quietly.
 */
export function retryInstall(id: ConnectionId) {
  const state = read(id);
  const run = lastRuns.get(id);
  if (state.failedAt === 'world' && state.outcome && run) { void runInstall(id, { ...run, installed: state.outcome }); return; }
  patch(id, { local: null, error: null, failedAt: null, agent: agentJobActive(state.agent) ? state.agent : null });
}

export async function runInstall(id: ConnectionId, run: InstallRun): Promise<void> {
  if (busyNow(id)) return;
  lastRuns.set(id, run);
  const ticket = (runs.get(id) ?? 0) + 1;
  runs.set(id, ticket);
  const live = () => runs.get(id) === ticket;
  const shape: JobPlanShape = { backup: !!run.backupProfile, softwareSwitch: run.softwareSwitch, resetWorld: !!run.resetWorld, adopted: false };
  patch(id, { shape, startedAt: Date.now(), error: null, failedAt: null, outcome: null, progress: null, uncertain: false });
  let step: JobStepId = 'install';
  try {
    let installed = run.installed ?? null;
    if (!installed) {
      if (run.backupProfile) {
        step = 'backup';
        patch(id, { local: 'backing-up' });
        if (!await backUp(id, run.backupProfile, live)) {
          if (live()) patch(id, { local: 'failed', failedAt: 'backup', error: { code: 'conflict', reason: 'pack_install_backup_failed', retryAfterMs: null } });
          return;
        }
        if (!live()) return;
      }
      step = 'install';
      patch(id, { local: 'installing', acceptedJobId: null });
      const intents = memo(applyIntents, id);
      const result: PackInstallOutcome = await serverCommand((api) => api.packInstallApply(id, run.body, intents.idFor(run.body)));
      intents.settle();
      if (!live()) return;
      if (result.softwareJobId) {
        patch(id, { acceptedJobId: result.softwareJobId });
        const job = await waitForAgentJob(id, result.softwareJobId, live);
        if (!live()) return;
        if (job.state !== 'succeeded') {
          const phase = agentPhase(job);
          patch(id, { local: phase === 'recovery' || phase === 'interrupted' ? phase : 'failed', failedAt: phase === 'recovery' ? 'switch' : 'install', error: jobError(job) });
          return;
        }
      }
      const finalWorkspace = result.softwareJobId ? await serverCommand((api) => api.packDraft(id)).catch(() => null) : null;
      if (finalWorkspace) seedServerResource(id, packWorkspaceResource, finalWorkspace);
      installed = { ...result, softwareJobId: null, decisions: finalWorkspace?.installJob?.decisions ?? result.decisions };
      patch(id, { outcome: installed });
    }
    if (run.resetWorld) {
      step = 'world';
      patch(id, { local: 'resetting-world' });
      const intents = memo(worldIntents, id);
      const reset = run.resetWorld;
      try {
        await serverCommand((api) => api.newWorld(id, reset.revision, reset.name, intents.idFor(reset)));
        intents.settle();
      } catch (reason) { intents.settle(reason as ServerCommandError); invalidateServerResources(id, ['world']); throw reason; }
    }
    if (!live()) return;
    invalidateServerResources(id, [...CONTENT_RESOURCES, 'world', 'software', 'software-jobs', 'pack-workspace']);
    patch(id, { local: 'succeeded', outcome: installed, revision: read(id).revision + 1 });
  } catch (reason) {
    if (!live()) return;
    const intents = memo(applyIntents, id);
    if (step === 'install') intents.settle(reason as ServerCommandError);
    patch(id, { local: 'failed', failedAt: step, error: reason as ServerCommandError, uncertain: step === 'install' && intents.uncertain });
  }
}

async function backUp(id: ConnectionId, profile: string, live: () => boolean): Promise<boolean> {
  let job = await serverCommand((api) => api.backupRun(id, profile, newIntentId()));
  for (let poll = 0; !backupJobTerminal(job) && poll < 900; poll++) {
    await sleep(2000);
    if (!live()) return false;
    const overview = await serverCommand((api) => api.backups(id, null));
    job = overview.jobs.find((entry) => entry.id === job.id) ?? job;
  }
  invalidateServerResources(id, ['backups', 'backup-storage', 'backup-snapshots']);
  return job.state === 'succeeded';
}

/** The polling loop records the agent job; this waits for the accepted one to finish. */
async function waitForAgentJob(id: ConnectionId, jobId: string, live: () => boolean): Promise<AgentInstallJob> {
  for (;;) {
    if (!live()) return { id: jobId, state: 'failed', error: null };
    const agent = read(id).agent;
    if (agent?.id === jobId && !agentJobActive(agent)) return agent;
    // The workspace only names the latest pack install; fall back to the job list.
    if (agent?.id !== jobId) {
      const jobs = await serverCommand((api) => api.softwareJobs(id)).catch(() => null);
      const job = jobs?.find((entry) => entry.id === jobId);
      if (job && !agentJobActive(job)) return { id: job.id, state: job.state, error: job.error ?? null };
    }
    await sleep(1000);
  }
}

// ---------------------------------------------------------------------------------------------
// Cancel, dismiss and adoption

/** Stops work this launcher owns. Agent-side writes cannot be stopped and are left to finish. */
export function cancelInstall(id: ConnectionId) {
  const state = read(id);
  const phase = phaseOf(state);
  if (!cancellablePhase(phase)) return;
  runs.set(id, (runs.get(id) ?? 0) + 1);
  if (phase === 'preparing') plans.delete(id);
  const uploadId = state.request?.uploadId;
  if (uploadId) void serverCommand((api) => api.packUploadCancel(id, uploadId, newIntentId())).catch(() => {});
  for (const listener of listeners) listener(id, state, phase, phase === 'backing-up' ? 'cancelled-backup-continues' : 'cancelled');
  patch(id, { local: null, request: null, progress: null, error: null, startedAt: null });
}

const DISMISSED_KEY = 'vesta.pack-install.dismissed';
function dismissed(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '{}') as Record<string, string>; } catch { return {}; }
}
/** Hides a finished job's result. A failed agent job stays hidden after restarts too. */
export function dismissInstallResult(id: ConnectionId) {
  const state = read(id);
  if (isActivePhase(phaseOf(state))) return;
  if (state.agent && !agentJobActive(state.agent)) {
    try { localStorage.setItem(DISMISSED_KEY, JSON.stringify({ ...dismissed(), [id]: state.agent.id })); } catch { /* Per-viewer only. */ }
  }
  patch(id, { local: null, outcome: null, error: null, failedAt: null, request: null, startedAt: null, progress: null, agent: null, acceptedJobId: null });
}

/**
 * A workspace read from anywhere: picks up an install that is running on the agent (started
 * elsewhere, or before the launcher restarted) and a recent unseen failure or interruption.
 */
export function observeWorkspace(id: ConnectionId, workspace: PackWorkspace | undefined) {
  if (!workspace) return;
  const job = (workspace.installJob ?? null) as AgentInstallJob | null;
  const state = read(id);
  if (state.local !== null && state.local !== 'installing') return;
  if (!job) return;
  const phase = agentPhase(job);
  const known = state.agent?.id === job.id;
  if (agentJobActive(job)) {
    patch(id, { agent: job, progress: workspace.installProgress ?? null, ...(known || state.local ? {} : { shape: { ...EMPTY_SHAPE, adopted: true }, startedAt: Date.now() }) });
    return;
  }
  if (known) { patch(id, { agent: job }); return; }
  // A finished job nobody here watched: only surface problems, and only once.
  if ((phase === 'failed' || phase === 'interrupted' || phase === 'recovery') && dismissed()[id] !== job.id && !state.request) {
    patch(id, { agent: job, shape: { ...EMPTY_SHAPE, adopted: true }, error: jobError(job), failedAt: phase === 'recovery' ? 'switch' : 'install' });
  }
}

// ---------------------------------------------------------------------------------------------
// One polling loop per server, only while there is something to follow.

const pollers = new Map<ConnectionId, ReturnType<typeof setTimeout>>();
function ensurePolling(id: ConnectionId) {
  const state = read(id);
  const following = state.local === 'preparing' || state.local === 'installing' || agentJobActive(state.agent);
  if (!following) { const timer = pollers.get(id); if (timer) { clearTimeout(timer); pollers.delete(id); } return; }
  if (pollers.has(id)) return;
  const tick = async () => {
    try {
      const workspace = await serverCommand((api) => api.packDraft(id));
      seedServerResource(id, packWorkspaceResource, workspace);
      const current = read(id);
      const job = (workspace.installJob ?? null) as AgentInstallJob | null;
      const before = current.agent;
      patch(id, { agent: job, progress: workspace.installProgress ?? null });
      // An adopted job (no local run) that just finished: refresh what the pages show.
      if (!current.local && agentJobActive(before) && job?.id === before?.id && !agentJobActive(job)) {
        invalidateServerResources(id, [...CONTENT_RESOURCES, 'world', 'software', 'software-jobs']);
        const ended = agentPhase(job);
        patch(id, { revision: read(id).revision + 1, ...(ended === 'succeeded' ? {} : { error: jobError(job), failedAt: ended === 'recovery' ? 'switch' : 'install' }) });
      }
    } catch { /* A dropped read retries on the next tick without changing the job. */ }
    pollers.delete(id);
    ensurePolling(id);
  };
  pollers.set(id, setTimeout(() => void tick(), read(id).local === 'preparing' ? 1000 : 1500));
}
