// One server's modpack install, as the person sees it: what is happening now, how far along it
// is, whether it can still be stopped, and how it ended. Pure; the store feeds it agent reads.
import type { MessageId } from '../../localization/messages';
import type { PackInstallProgress } from './native-pack';

/** The agent's persisted install job (`installJob` on the pack workspace). */
export interface AgentInstallJob { id: string; state: string; error: string | null; decisions?: string[] }

/**
 * Local phases run in this launcher (the plan request, an optional backup, the world reset).
 * Agent phases come from the persisted job and survive launcher and agent restarts.
 */
export type PackJobPhase =
  | 'preparing' | 'backing-up' | 'installing' | 'switching' | 'resetting-world'
  | 'succeeded' | 'failed' | 'interrupted' | 'recovery';

export const ACTIVE_PHASES: ReadonlySet<PackJobPhase> = new Set(['preparing', 'backing-up', 'installing', 'switching', 'resetting-world']);
export const isActivePhase = (phase: PackJobPhase | null | undefined): phase is PackJobPhase => !!phase && ACTIVE_PHASES.has(phase);

/** Agent job states that still hold the server; a second install is refused (`software_busy`). */
const AGENT_ACTIVE = new Set(['queued', 'staging', 'activating']);
export const agentJobActive = (job: AgentInstallJob | null | undefined) => !!job && AGENT_ACTIVE.has(job.state);

/**
 * The agent's job state as a phase. On agent restart `queued`/`staging` become `failed` with
 * `software_staging_interrupted` (nothing was activated) and `activating` becomes
 * `recovery_required` (the switch may be half-applied).
 */
export function agentPhase(job: AgentInstallJob | null | undefined): PackJobPhase | null {
  switch (job?.state) {
    case 'queued': case 'staging': return 'installing';
    case 'activating': return 'switching';
    case 'succeeded': return 'succeeded';
    case 'recovery_required': return 'recovery';
    case 'failed': return job.error === 'software_staging_interrupted' ? 'interrupted' : 'failed';
    default: return null;
  }
}

/**
 * Which phase to show. A running local step wins (the agent job is the previous one until apply
 * is accepted); once the launcher hands over, the agent's job is the truth.
 */
export function effectivePhase(local: PackJobPhase | null, agent: AgentInstallJob | null | undefined, acceptedJobId: string | null): PackJobPhase | null {
  const remote = agentPhase(agent);
  // While installing, a stale (previous) agent job must not end the phase early.
  if (local === 'installing' && acceptedJobId && agent?.id !== acceptedJobId) return 'installing';
  if (local === 'installing' && remote) return remote;
  if (local) return local;
  return remote;
}

/** Only work this launcher still owns can stop. Once the agent writes files, it finishes. */
export const cancellablePhase = (phase: PackJobPhase | null) => phase === 'preparing' || phase === 'backing-up';

const STAGE_LABELS: Record<PackInstallProgress['stage'], MessageId> = {
  archive: 'server-pack.job-stage-archive',
  download_verify: 'server-pack.job-stage-download',
  extract_hash: 'server-pack.job-stage-extract',
  metadata: 'server-pack.job-stage-metadata',
  review: 'server-pack.job-stage-review',
  writing: 'server-pack.job-stage-writing',
};

const PHASE_LABELS: Record<PackJobPhase, MessageId> = {
  preparing: 'server-pack.job-phase-preparing',
  'backing-up': 'server-pack.job-phase-backing-up',
  installing: 'server-pack.job-phase-installing',
  switching: 'server-pack.job-phase-switching',
  'resetting-world': 'server-pack.job-phase-world',
  succeeded: 'server-pack.job-phase-succeeded',
  failed: 'server-pack.job-phase-failed',
  interrupted: 'server-pack.job-phase-interrupted',
  recovery: 'server-pack.job-phase-recovery',
};
export const phaseLabel = (phase: PackJobPhase): MessageId => PHASE_LABELS[phase];

export interface JobProgressView {
  /** What is happening right now, in words ("Downloading pack files"). */
  stage: MessageId;
  /** "12 / 340" when the agent knows a total. */
  items: { completed: number; total: number } | null;
  /** Bytes so far when downloading; the agent reports no byte total. */
  bytes: number | null;
  /** 0-100, or undefined for an honest indeterminate bar. */
  percent: number | undefined;
}

/**
 * Progress as words and numbers. Stages without a total (resolving the pack, streaming the
 * download) stay indeterminate rather than sitting at 0%.
 */
export function progressView(phase: PackJobPhase, progress: PackInstallProgress | null | undefined): JobProgressView {
  const stageless = phase === 'backing-up' || phase === 'switching' || phase === 'resetting-world';
  const usable = !stageless && progress && Object.hasOwn(STAGE_LABELS, progress.stage) ? progress : null;
  const total = usable && usable.total > 0 ? usable.total : 0;
  const completed = usable ? Math.min(usable.completed, total || usable.completed) : 0;
  return {
    stage: usable ? STAGE_LABELS[usable.stage] : PHASE_LABELS[phase],
    items: total ? { completed, total } : null,
    bytes: usable?.bytesCompleted ? usable.bytesCompleted : null,
    percent: total ? Math.round(completed / total * 100) : undefined,
  };
}

/** A progress identity: unchanged for a while means "still working", not "stuck at 0". */
export const progressSignature = (phase: PackJobPhase | null, progress: PackInstallProgress | null | undefined) =>
  `${phase}:${progress?.stage ?? ''}:${progress?.completed ?? 0}:${progress?.total ?? 0}:${progress?.bytesCompleted ?? 0}`;

/** After this long without visible movement the panel explains that big packs are slow. */
export const QUIET_AFTER_MS = 12_000;
export const isQuiet = (phase: PackJobPhase | null, lastChangeAt: number, now: number) =>
  isActivePhase(phase) && now - lastChangeAt >= QUIET_AFTER_MS;

/** "4.2 MB", "312 KB": download sizes without false precision. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1048576).toFixed(bytes < 10 * 1048576 ? 1 : 0)} MB`;
  return `${(bytes / 1073741824).toFixed(2)} GB`;
}

/** "0:42", "3:05", "1:02:09". */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600), m = Math.floor(total / 60) % 60, s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export type JobStepId = 'prepare' | 'backup' | 'install' | 'switch' | 'world';
export type JobStepState = 'done' | 'current' | 'upcoming' | 'failed';
export interface JobStep { id: JobStepId; label: MessageId; state: JobStepState }

export interface JobPlanShape { backup: boolean; softwareSwitch: boolean; resetWorld: boolean; adopted: boolean }

const STEP_LABELS: Record<JobStepId, MessageId> = {
  prepare: 'server-pack.job-step-prepare',
  backup: 'server-pack.job-step-backup',
  install: 'server-pack.job-step-install',
  switch: 'server-pack.job-step-switch',
  world: 'server-pack.job-step-world',
};
const PHASE_STEP: Partial<Record<PackJobPhase, JobStepId>> = {
  preparing: 'prepare', 'backing-up': 'backup', installing: 'install', switching: 'switch', 'resetting-world': 'world',
};

/**
 * The steps this install will take, in order, with where it is now. An install picked up after a
 * restart only knows its agent steps; the launcher-side steps are not invented.
 */
export function jobSteps(shape: JobPlanShape, phase: PackJobPhase | null, failedAt: JobStepId | null = null): JobStep[] {
  const ids: JobStepId[] = [
    ...(shape.adopted ? [] : ['prepare' as const]),
    ...(shape.backup ? ['backup' as const] : []),
    'install',
    ...(shape.softwareSwitch || phase === 'switching' ? ['switch' as const] : []),
    ...(shape.resetWorld ? ['world' as const] : []),
  ];
  const finished = phase === 'succeeded';
  const failing = phase === 'failed' || phase === 'interrupted' || phase === 'recovery';
  const current = phase ? PHASE_STEP[phase] : undefined;
  const stop = failing ? (failedAt && ids.includes(failedAt) ? failedAt : phase === 'recovery' && ids.includes('switch') ? 'switch' : 'install') : current;
  const at = stop ? ids.indexOf(stop) : -1;
  return ids.map((id, index) => ({
    id, label: STEP_LABELS[id],
    state: finished ? 'done' : index < at ? 'done' : index === at ? (failing ? 'failed' : 'current') : 'upcoming',
  }));
}

/** The error a finished agent job carries, in the shape the shared error note understands. */
export const jobError = (job: AgentInstallJob | null | undefined) =>
  job?.error ? { code: 'conflict' as const, reason: job.error, retryAfterMs: null } : null;
