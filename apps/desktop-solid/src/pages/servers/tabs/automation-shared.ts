// Shared state and labels for the Automation tab: who workflows run as, backup profiles,
// icons per step kind, and drafts handed to (or kept by) the editor.
import { createMemo, type Accessor } from 'solid-js';
import type { Tone } from '@vesta/ui';
import { t } from '../../../localization';
import type { MessageId } from '../../../localization/messages';
import { localOffsetMinutes, stepSummary, templateDraft, triggerSentence, type EditorDraft, type TemplateId } from '../../../features/servers/automation-model';
import { gate } from '../../../features/servers/capabilities';
import { readServerResource, useServerResource } from '../../../features/servers/resources';
import { backupsResource } from '../../../features/servers/server-resources';
import type { ConnectionId, ServerSnapshot } from '../../../features/servers/native';
import type { ActionKind, TriggerKind, WorkflowTrigger } from '../../../features/servers/native-automation';
import type { ServerUser } from '../../../features/servers/native-manage';
import { automationSelfResource, automationUsersResource } from '../automation/resources';

export interface AutomationPeople {
  /** The caller, when the agent reports it. */
  self: Accessor<{ principalId: string; rank: number } | undefined>;
  users: Accessor<ServerUser[]>;
  profiles: Accessor<string[]>;
}

/**
 * Cached reads of the caller, the people a workflow can run as and the backup profiles.
 * `users` and `profiles` are only read while `needs` asks for them; `needs.users` gets your principal id.
 */
export function useAutomationPeople(id: Accessor<ConnectionId>, snapshot: Accessor<ServerSnapshot>, needs: { users: (selfId: string | undefined) => boolean; profiles: Accessor<boolean> }): AutomationPeople {
  const self = useServerResource(id, automationSelfResource);
  const users = useServerResource(id, automationUsersResource, { enabled: () => needs.users(self.value()?.principalId) && gate(snapshot().capabilities, 'principals.view') !== 'denied' });
  const backups = useServerResource(id, backupsResource, { enabled: () => needs.profiles() && gate(snapshot().capabilities, 'backups.view') !== 'denied' });
  const profiles = createMemo(() => backups.value()?.profiles.map((profile) => profile.name) ?? [], { name: 'server-automation:profiles' });
  return { self: self.value, users: () => users.value() ?? [], profiles };
}

/** A principal's display name; yourself reads "You". */
export function principalName(people: AutomationPeople, principalId: string) {
  if (people.self()?.principalId === principalId) return t('server-automation.you');
  return people.users().find((user) => user.id === principalId)?.displayName ?? t('server-automation.someone-else');
}

/** A template as a draft for this server: you run it, at this computer's offset, with the first backup profile. */
export async function draftFromTemplate(id: ConnectionId, template: TemplateId, name: string): Promise<EditorDraft> {
  const [self, backups] = await Promise.all([
    readServerResource(id, automationSelfResource).catch(() => null),
    readServerResource(id, backupsResource).catch(() => null),
  ]);
  return templateDraft(template, { name, principalId: self?.principalId ?? '', offsetMinutes: localOffsetMinutes(), profile: backups?.profiles[0]?.name });
}

// A template or duplicate handed to the `new` editor route. Read once by the editor.
let pending: EditorDraft | null = null;
export const handOffDraft = (draft: EditorDraft) => { pending = draft; };
export const takeHandOff = () => { const draft = pending; pending = null; return draft; };

/**
 * Unsaved edits kept when the editor is left some other way than its own Back button (another
 * tab, the rail), so coming back restores them. Keyed by connection and workflow (`new` too).
 */
export interface KeptDraft { draft: EditorDraft; revision: number | null }
const kept = new Map<string, KeptDraft>();
const keptKey = (id: ConnectionId, workflowId: string) => `${id}:${workflowId}`;
export const keepDraft = (id: ConnectionId, workflowId: string, value: KeptDraft) => kept.set(keptKey(id, workflowId), value);
export const keptDraft = (id: ConnectionId, workflowId: string) => kept.get(keptKey(id, workflowId)) ?? null;
export const dropKeptDraft = (id: ConnectionId, workflowId: string) => kept.delete(keptKey(id, workflowId));

export const encodeItem = (value: string) => encodeURIComponent(value);
export function decodeItem(value: string) {
  try { return decodeURIComponent(value); } catch { return value; }
}

export const triggerLabels: Record<TriggerKind, MessageId> = {
  cron: 'server-automation.trigger-cron',
  interval: 'server-automation.trigger-interval',
  manual: 'server-automation.trigger-manual',
  agent_startup: 'server-automation.trigger-agent-startup',
  server_started: 'server-automation.trigger-server-started',
  server_stopped: 'server-automation.trigger-server-stopped',
  server_crashed: 'server-automation.trigger-server-crashed',
  player_count_zero: 'server-automation.trigger-player-count-zero',
  first_player_joined: 'server-automation.trigger-first-player-joined',
  player_first_joined: 'server-automation.trigger-player-first-joined',
  update_available: 'server-automation.trigger-update-available',
  backup_completed: 'server-automation.trigger-backup-completed',
  backup_failed: 'server-automation.trigger-backup-failed',
};

/** Icon for what starts a workflow. */
export function triggerIcon(trigger: WorkflowTrigger | null | undefined) {
  switch (trigger?.kind) {
    case 'cron': case 'interval': return 'icons/content/timer';
    case 'manual': return 'icons/actions/play';
    case 'backup_completed': case 'backup_failed': return 'icons/content/storage';
    case 'first_player_joined': case 'player_first_joined': case 'player_count_zero': return 'icons/content/chat';
    case undefined: return 'icons/content/timer';
    default: return 'icons/status/live';
  }
}

export const ACTION_ORDER: ActionKind[] = ['console_command', 'notify', 'delay', 'backup', 'verify_backup', 'restart', 'start', 'stop', 'clean_trash', 'script_preset'];

export const actionLabels: Record<ActionKind, MessageId> = {
  console_command: 'server-automation.action-console',
  notify: 'server-automation.action-notify',
  delay: 'server-automation.action-delay',
  backup: 'server-automation.action-backup',
  verify_backup: 'server-automation.action-verify',
  restart: 'server-automation.action-restart',
  start: 'server-automation.action-start',
  stop: 'server-automation.action-stop',
  clean_trash: 'server-automation.action-clean-trash',
  script_preset: 'server-automation.action-script',
};

/** One icon per step kind, used on step cards, run results and template previews. */
export const actionIcons: Record<ActionKind, string> = {
  console_command: 'icons/content/terminal',
  notify: 'icons/status/bell',
  delay: 'icons/content/timer',
  backup: 'icons/content/storage',
  verify_backup: 'icons/security/shield-check',
  restart: 'icons/actions/reload',
  start: 'icons/actions/play',
  stop: 'icons/actions/stop',
  clean_trash: 'icons/actions/delete',
  script_preset: 'icons/content/code',
};

const runStates: Record<string, { message: MessageId; tone: Tone }> = {
  queued: { message: 'server-automation.run-queued', tone: 'neutral' },
  running: { message: 'server-automation.run-running', tone: 'accent' },
  suspended: { message: 'server-automation.run-suspended', tone: 'warning' },
  succeeded: { message: 'server-automation.run-succeeded', tone: 'success' },
  failed: { message: 'server-automation.run-failed', tone: 'danger' },
};
export const runState = (state: string) => runStates[state] ?? { message: 'server-automation.run-unknown' as MessageId, tone: 'neutral' as Tone };

const stepStates: Record<string, { message: MessageId; tone: Tone }> = {
  waiting: { message: 'server-automation.step-state-waiting', tone: 'accent' },
  submitting: { message: 'server-automation.step-state-submitting', tone: 'accent' },
  submitted: { message: 'server-automation.step-state-submitted', tone: 'accent' },
  succeeded: { message: 'server-automation.step-state-succeeded', tone: 'success' },
  failed: { message: 'server-automation.step-state-failed', tone: 'danger' },
  timed_out: { message: 'server-automation.step-state-timed-out', tone: 'danger' },
  skipped: { message: 'server-automation.step-state-skipped', tone: 'neutral' },
  pending: { message: 'server-automation.step-state-pending', tone: 'neutral' },
};
export const stepState = (state: string) => stepStates[state] ?? { message: 'server-automation.run-unknown' as MessageId, tone: 'neutral' as Tone };

const outcomes: Record<string, MessageId> = {
  completed: 'server-automation.outcome-completed',
  timed_out: 'server-automation.outcome-timed-out',
  uncertain: 'server-automation.outcome-uncertain',
  discarded: 'server-automation.outcome-discarded',
  workflow_deleted: 'server-automation.outcome-workflow-deleted',
  authority_revoked: 'server-automation.outcome-authority-revoked',
  forbidden: 'server-automation.outcome-forbidden',
  backup_disk_space_low: 'servers.backups.error-disk',
  backup_requires_stopped_server: 'servers.backups.error-stopped',
  backup_storage_limit_reached: 'servers.backups.error-storage',
  backup_snapshot_limit_reached: 'servers.backups.error-count',
};
/** A fixed safe code as words, or the code itself when it is new to this launcher. */
export const outcomeText = (code: string) => (outcomes[code] ? t(outcomes[code]) : code);

/** Short weekday names in the user's locale, Sunday = 0. */
const weekdayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short', timeZone: 'UTC' });
export const weekdayName = (day: number) => weekdayFormat.format(Date.UTC(2024, 0, 7 + day));

export const formatDateTime = (ms: number) => new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** A step's one-line summary, e.g. `Wait 1 minute`. */
export function stepText(action: Parameters<typeof stepSummary>[0]) {
  const summary = stepSummary(action);
  return t(summary.message, { ...summary.args, ...(summary.duration ? { time: t(summary.duration.message, { count: summary.duration.count }) } : {}) });
}

/** A trigger as words, e.g. `Every day at 04:00 (UTC+10:00)`. */
export function triggerText(trigger: WorkflowTrigger) {
  const sentence = triggerSentence(trigger, weekdayName);
  return t(sentence.message, sentence.args);
}
