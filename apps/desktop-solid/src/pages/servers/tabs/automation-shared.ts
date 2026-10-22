// Shared state and labels for the Automation tab: who can run workflows, backup profiles,
// paging, and the hand-off of a template or duplicate into the editor.
import { createSignal, type Accessor } from 'solid-js';
import type { Tone } from '@vesta/ui';
import { t } from '../../../localization';
import type { MessageId } from '../../../localization/messages';
import type { EditorDraft } from '../../../features/servers/automation-model';
import { serverCommand } from '../../../features/servers/store';
import type { ConnectionId } from '../../../features/servers/native';
import type { ActionKind, Paged, TriggerKind } from '../../../features/servers/native-automation';
import type { ServerUser } from '../../../features/servers/native-manage';

/** Reads every page of an ascending, cursor-paged list (bounded). */
export async function collectPages<T>(fetch: (after: string | null) => Promise<Paged<T>>, maxPages = 25): Promise<T[]> {
  const items: T[] = [];
  let after: string | null = null;
  for (let index = 0; index < maxPages; index++) {
    const page: Paged<T> = await fetch(after);
    items.push(...page.items);
    if (!page.nextAfter) break;
    after = page.nextAfter;
  }
  return items;
}

export interface AutomationRefs {
  /** The caller, when the agent reports it. */
  self: Accessor<{ principalId: string; rank: number } | null>;
  users: Accessor<ServerUser[]>;
  profiles: Accessor<string[]>;
  /** Resolves once the reads above have settled (each may have failed quietly). */
  ready: Promise<void>;
}

/** One read of the principals and backup profiles the editor offers. Failures leave the lists empty. */
export function createAutomationRefs(id: ConnectionId): AutomationRefs {
  const [self, setSelf] = createSignal<{ principalId: string; rank: number } | null>(null, { name: 'server-automation:self' });
  const [users, setUsers] = createSignal<ServerUser[]>([], { name: 'server-automation:users' });
  const [profiles, setProfiles] = createSignal<string[]>([], { name: 'server-automation:profiles' });
  const loadUsers = async () => {
    const all: ServerUser[] = [];
    let offset: number | null = 0;
    for (let index = 0; offset !== null && index < 10; index++) {
      const page: { users: ServerUser[]; nextOffset: number | null } = await serverCommand((client) => client.users(id, offset!));
      all.push(...page.users);
      offset = page.nextOffset;
    }
    return all;
  };
  const ready = Promise.allSettled([
    serverCommand((client) => client.automationSelf(id)).then(setSelf),
    loadUsers().then(setUsers),
    serverCommand((client) => client.backups(id, null)).then((overview) => setProfiles(overview.profiles.map((profile) => profile.name))),
  ]).then(() => undefined);
  return { self, users, profiles, ready };
}

/** A principal's display name; yourself reads "You". */
export function principalName(refs: AutomationRefs, principalId: string) {
  if (refs.self()?.principalId === principalId) return t('server-automation.you');
  return refs.users().find((user) => user.id === principalId)?.displayName ?? t('server-automation.someone-else');
}

// A template or duplicate handed to the `new` editor route. Read once by the editor.
let pending: EditorDraft | null = null;
export const handOffDraft = (draft: EditorDraft) => { pending = draft; };
export const takeHandOff = () => { const draft = pending; pending = null; return draft; };

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
  update_available: 'server-automation.trigger-update-available',
  backup_completed: 'server-automation.trigger-backup-completed',
  backup_failed: 'server-automation.trigger-backup-failed',
};

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
