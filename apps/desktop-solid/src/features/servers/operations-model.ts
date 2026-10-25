// Remote operations: "accepted" is not "completed", and an uncertain submission is
// shown as being checked rather than as failed or done.
import type { MessageId } from '../../localization/messages';
import type { OperationState, ServerOperation } from './native';

export const TERMINAL: ReadonlySet<OperationState> = new Set(['succeeded', 'failed', 'cancelled', 'recovery_required']);
export const isTerminal = (operation: Pick<ServerOperation, 'state'>) => TERMINAL.has(operation.state);

export function operationStateMessage(operation: ServerOperation): MessageId {
  if (operation.reconciling) return 'servers.operation.checking';
  switch (operation.state) {
    case 'queued':
    case 'validating': return 'servers.operation.accepted';
    case 'awaiting_confirmation': return 'servers.operation.awaiting-confirmation';
    case 'running': return 'servers.operation.running';
    case 'cancelling': return 'servers.operation.cancelling';
    case 'succeeded': return 'servers.operation.succeeded';
    case 'failed': return 'servers.operation.failed';
    case 'cancelled': return 'servers.operation.cancelled';
    case 'recovery_required': return 'servers.operation.recovery-required';
  }
}

const intents: Record<string, MessageId> = {
  'lifecycle.start': 'servers.intent.start',
  'lifecycle.stop': 'servers.intent.stop',
  'lifecycle.restart': 'servers.intent.restart',
  'lifecycle.kill': 'servers.intent.kill',
  'console.command': 'servers.intent.command',
  'players.moderate': 'servers.intent.moderate',
};

export const operationTitle = (operation: ServerOperation): MessageId =>
  (operation.intent && intents[operation.intent]) || 'servers.intent.other';

/** Merge by id, keeping the most recently updated record, newest first. */
export function mergeOperations(current: readonly ServerOperation[], incoming: readonly ServerOperation[], limit = 100) {
  const byId = new Map(current.map((operation) => [operation.operationId, operation]));
  for (const operation of incoming) {
    const previous = byId.get(operation.operationId);
    if (!previous || operation.updatedAtMs >= previous.updatedAtMs) {
      byId.set(operation.operationId, { ...operation, intent: operation.intent ?? previous?.intent ?? null });
    }
  }
  return [...byId.values()].sort((a, b) => b.createdAtMs - a.createdAtMs).slice(0, limit);
}

/** Preserve a history page's boundaries while updating rows and showing new work on page one. */
export function activityPageRows(page: readonly ServerOperation[], live: readonly ServerOperation[], firstPage: boolean) {
  const oldest = page.reduce((time, operation) => Math.min(time, operation.createdAtMs), Infinity);
  const rows = firstPage ? mergeOperations(page, live.filter((operation) => !page.length || operation.createdAtMs >= oldest), page.length + 100) : page;
  return rows.map((operation) => live.find((candidate) => candidate.operationId === operation.operationId && candidate.updatedAtMs >= operation.updatedAtMs) ?? operation);
}

/** An intent whose operation is not finished (or still being reconciled) cannot be submitted again. */
export function busyIntent(operations: readonly ServerOperation[], intent: string) {
  return operations.some((operation) => operation.intent === intent && (!isTerminal(operation) || operation.reconciling));
}

export interface OperationDescription {
  /** Who: `you`, a person's name, or the agent/automation. */
  actor: { message: MessageId; args?: Record<string, string> };
  /** Device the request came from, when the agent reports it. */
  device: string | null;
  /** What happened, as a sentence. */
  action: { message: MessageId; args?: Record<string, string | number> };
  /** The exact console command, shown verbatim in monospace. */
  command: string | null;
  /** Extra detail, e.g. a ban reason. */
  detail: string | null;
  outcome: MessageId | null;
  /** Ban length, localized by the caller as the action's `time` argument. */
  duration?: { message: MessageId; count: number };
}

const moderationMessages: Record<string, MessageId> = {
  kick: 'servers.task.kick',
  ban: 'servers.task.ban',
  pardon: 'servers.task.pardon',
  whitelist_add: 'servers.task.whitelist-add',
  whitelist_remove: 'servers.task.whitelist-remove',
  op: 'servers.task.op',
  deop: 'servers.task.deop',
  kill: 'servers.task.kill-player',
  lightning: 'servers.task.lightning',
};

const lifecycleMessages: Record<string, MessageId> = {
  start: 'servers.task.start',
  stop: 'servers.task.stop',
  restart: 'servers.task.restart',
  kill: 'servers.task.force-kill',
};

const outcomeMessages: Record<string, MessageId> = {
  stdin_written: 'servers.outcome.delivered',
  process_exited: 'servers.outcome.exited',
  stale_generation: 'servers.outcome.stale',
  write_failed: 'servers.outcome.write-failed',
  timeout: 'servers.outcome.timeout',
  recovery_required: 'servers.outcome.recovery',
};

/** Ban length in the largest whole unit, e.g. `3 days`. */
export function banDuration(seconds: number): { message: MessageId; count: number } {
  if (seconds % 86_400 === 0) return { message: 'servers.age.days', count: seconds / 86_400 };
  if (seconds % 3600 === 0) return { message: 'servers.age.hours', count: seconds / 3600 };
  return { message: 'servers.age.minutes', count: Math.max(1, Math.round(seconds / 60)) };
}

/** A readable account of an operation: who did what, exactly, and how it ended. */
export function describeOperation(operation: ServerOperation): OperationDescription {
  const actor: OperationDescription['actor'] = !operation.actor
    ? { message: 'servers.activity.actor-unknown' }
    : operation.actor.kind === 'principal'
      ? operation.actor.self ? { message: 'servers.activity.actor-you' } : { message: 'servers.activity.actor-person', args: { name: operation.actor.displayName } }
      : { message: operation.actor.kind === 'workflow' ? 'servers.activity.actor-workflow' : 'servers.activity.actor-system', args: { name: operation.actor.name } };
  const device = operation.actor?.kind === 'principal' ? operation.actor.deviceName : null;
  const outcome = operation.outcome ? outcomeMessages[operation.outcome] ?? null : null;
  const summary = operation.summary;
  const base = { actor, device, command: null, detail: null, outcome };

  switch (summary?.kind) {
    case 'console.command':
      return summary.command === null
        ? { ...base, action: { message: 'servers.task.command-hidden' } }
        : { ...base, action: { message: 'servers.task.command' }, command: summary.command };
    case 'players.moderate': {
      const message = moderationMessages[summary.action] ?? 'servers.task.moderate';
      if (summary.action === 'ban' && summary.durationSeconds) {
        const span = banDuration(summary.durationSeconds);
        return { ...base, action: { message: 'servers.task.ban-for', args: { name: summary.player } }, duration: span, detail: summary.reason ?? null };
      }
      return { ...base, action: { message, args: { name: summary.player, value: summary.action } }, detail: summary.reason ?? null };
    }
    case 'lifecycle':
      return { ...base, action: { message: lifecycleMessages[summary.action] ?? 'servers.intent.other' } };
    case 'backup':
      return { ...base, action: { message: 'servers.task.backup', args: { value: summary.action, name: summary.profile } } };
    case 'file':
      return { ...base, action: { message: 'servers.task.file', args: { value: summary.action, path: summary.to ? `${summary.path} → ${summary.to}` : summary.path } } };
    case 'purged':
      return { ...base, action: { message: operationTitle(operation) }, detail: null, outcome: outcome ?? null };
    default:
      return { ...base, action: { message: operationTitle(operation) } };
  }
}
