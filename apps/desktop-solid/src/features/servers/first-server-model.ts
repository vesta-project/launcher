// First-server setup on a freshly installed Vesta Host: choose what to run, then follow the
// host's persisted job (planning -> review -> applying -> ready -> complete) to a managed server.
// Pure; the store runs the calls and the page renders it.
import type { MessageId } from '../../localization/messages';
import type { SoftwareId } from './hosting-native';
import type { SetupJob, SetupJobState, SetupPlanRequest } from './native-setup';

export interface SoftwareChoice { id: SoftwareId; label: MessageId; help: MessageId; more?: boolean }

/** In plain words: what a player wants, not a loader catalogue. Less common ones sit under More. */
export const SETUP_SOFTWARE: readonly SoftwareChoice[] = [
  { id: 'vanilla', label: 'servers.first.software-vanilla', help: 'servers.first.software-vanilla-help' },
  { id: 'paper', label: 'servers.first.software-paper', help: 'servers.first.software-paper-help' },
  { id: 'fabric', label: 'servers.first.software-fabric', help: 'servers.first.software-fabric-help' },
  { id: 'neoforge', label: 'servers.first.software-neoforge', help: 'servers.first.software-neoforge-help' },
  { id: 'forge', label: 'servers.first.software-forge', help: 'servers.first.software-forge-help' },
  { id: 'purpur', label: 'servers.first.software-purpur', help: 'servers.first.software-purpur-help', more: true },
  { id: 'quilt', label: 'servers.first.software-quilt', help: 'servers.first.software-quilt-help', more: true },
  { id: 'folia', label: 'servers.first.software-folia', help: 'servers.first.software-folia-help', more: true },
];

export const DEFAULT_SOFTWARE: SoftwareId = 'vanilla';
export const NAME_LIMIT = 64;

const experimental = (version: string) => /\d+w\d+|-(pre|rc)|snapshot/i.test(version);

/** Full releases only, newest first as the catalogue lists them; the first is the default. */
export function releaseVersions(versions: readonly string[]): string[] {
  return versions.filter((version) => !experimental(version));
}

export interface SetupChoice { name: string; software: SoftwareId; version: string }

export function choiceProblem(choice: SetupChoice): MessageId | null {
  const name = choice.name.trim();
  if (!name) return 'servers.first.name-empty';
  if (name.length > NAME_LIMIT) return 'servers.first.name-long';
  if (!choice.version) return 'servers.first.version-empty';
  return null;
}

/** The host picks the newest build and loader for that version when they are left empty. */
export function planRequest(choice: SetupChoice): SetupPlanRequest {
  return { kind: 'install', name: choice.name.trim(), software: choice.software, version: choice.version, build: null, loaderVersion: null, experimental: false };
}

/** Where the setup is: what the page shows and whether the host is working. */
export type SetupStep = 'choose' | 'preparing' | 'review' | 'installing' | 'finishing' | 'ready' | 'failed';

export function stepFor(state: SetupJobState): SetupStep {
  switch (state) {
    case 'planning': return 'preparing';
    case 'review': return 'review';
    case 'applying': case 'ready': return 'installing';
    case 'complete': return 'finishing';
    case 'failed': case 'interrupted': return 'failed';
  }
}

export const activeStep = (step: SetupStep) => step === 'preparing' || step === 'installing' || step === 'finishing';
export const jobDone = (job: Pick<SetupJob, 'state'>) => ['review', 'complete', 'failed', 'interrupted'].includes(job.state);

export interface SetupRowStep { id: 'choose' | 'prepare' | 'install' | 'ready'; label: MessageId; state: 'done' | 'current' | 'upcoming' | 'failed' }

const ORDER: SetupRowStep['id'][] = ['choose', 'prepare', 'install', 'ready'];
const ROW_LABELS: Record<SetupRowStep['id'], MessageId> = {
  choose: 'servers.first.step-choose', prepare: 'servers.first.step-prepare', install: 'servers.first.step-install', ready: 'servers.first.step-ready',
};
const AT: Record<SetupStep, SetupRowStep['id']> = {
  choose: 'choose', preparing: 'prepare', review: 'prepare', installing: 'install', finishing: 'install', ready: 'ready', failed: 'install',
};

/** The step row. A failure marks the step that was running when it failed. */
export function setupRow(step: SetupStep, failedAt: SetupRowStep['id'] = 'install'): SetupRowStep[] {
  const current = step === 'failed' ? failedAt : AT[step];
  const index = ORDER.indexOf(current);
  return ORDER.map((id, at) => ({
    id, label: ROW_LABELS[id],
    state: step === 'ready' ? 'done' : at < index ? 'done' : at === index ? (step === 'failed' ? 'failed' : 'current') : 'upcoming',
  }));
}

/** The host's detailed phase in words; unknown phases fall back to the step. */
const PHASES: Record<string, MessageId> = {
  metadata: 'servers.first.phase-metadata',
  resolving: 'servers.first.phase-metadata',
  downloading: 'servers.first.phase-downloading',
  download: 'servers.first.phase-downloading',
  verifying: 'servers.first.phase-verifying',
  preparing: 'servers.first.phase-preparing',
  installing: 'servers.first.phase-installing',
  writing: 'servers.first.phase-installing',
  publishing: 'servers.first.phase-publishing',
  activating: 'servers.first.phase-publishing',
};
const STEP_TEXT: Partial<Record<SetupStep, MessageId>> = {
  preparing: 'servers.first.phase-preparing',
  installing: 'servers.first.phase-installing',
  finishing: 'servers.first.phase-finishing',
};
export function phaseText(step: SetupStep, phase: string | null | undefined): MessageId {
  const key = (phase ?? '').toLowerCase();
  return (Object.hasOwn(PHASES, key) ? PHASES[key] : undefined) ?? STEP_TEXT[step] ?? 'servers.first.phase-preparing';
}

/** The host reports sizes as decimal strings; show them like the rest of the app. */
export function reviewSize(bytes: string): string {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return '';
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1048576).toFixed(value < 10 * 1048576 ? 1 : 0)} MB`;
  return `${(value / 1073741824).toFixed(2)} GB`;
}

/** Job and request reasons the person can act on, in plain words. */
const REASONS: Record<string, MessageId> = {
  setup_authority_revoked: 'servers.first.error-revoked',
  setup_review_changed: 'servers.first.error-review-changed',
  setup_provisioning_failed: 'servers.first.error-failed',
  setup_interrupted_replan_required: 'servers.first.error-interrupted',
  setup_local_configuration_required: 'servers.first.error-local-config',
  setup_access_refused: 'servers.first.error-refused',
  confirmation_expired: 'servers.first.error-review-changed',
};
export function setupReason(reason: string | null | undefined): MessageId | null {
  return reason && Object.hasOwn(REASONS, reason) ? REASONS[reason]! : null;
}
/** Failures that need a new plan rather than a retry of the same step. */
export const needsReplan = (reason: string | null | undefined) =>
  reason === 'setup_review_changed' || reason === 'setup_interrupted_replan_required' || reason === 'confirmation_expired';
