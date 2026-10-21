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

/** An intent whose operation is not finished (or still being reconciled) cannot be submitted again. */
export function busyIntent(operations: readonly ServerOperation[], intent: string) {
  return operations.some((operation) => operation.intent === intent && (!isTerminal(operation) || operation.reconciling));
}
