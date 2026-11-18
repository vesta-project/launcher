// Removing a server from a Vesta Server machine, from the launcher. Owners only. The machine
// stops the server first and keeps it for 7 days, so it can be brought back there. Pure rules
// here: who sees it, whether the typed name matches, and a short line for each refusal.
import type { MessageId } from '../../localization/messages';
import { roleKey } from './capabilities';
import { toServerError } from './errors';

/** Machine owners (the first owner is `primary_owner`) can remove a machine's servers. */
export const canRemoveFromMachine = (role: string | null | undefined) => roleKey(role) === 'owner';

/** The name must match the server's current name exactly, case and spaces included. */
export const nameMatches = (typed: string, name: string) => typed.length > 0 && typed === name;

export type RemoveProblem = 'name' | 'busy' | 'forbidden' | 'gone' | 'older' | 'other';

/** Why the machine said no, in one word the dialog turns into a line. */
export function removeProblem(reason: unknown): RemoveProblem {
  const error = toServerError(reason);
  const code = error.reason ?? '';
  if (code === 'confirm_name_mismatch') return 'name';
  if (code === 'server_busy' || error.code === 'server_busy') return 'busy';
  if (code === 'forbidden' || error.code === 'forbidden') return 'forbidden';
  // Remove is only offered when the machine lists it, so not found means the server is already gone.
  if (error.code === 'not_found' || code === 'not_found') return 'gone';
  if (error.code === 'unsupported') return 'older';
  return 'other';
}

export const removeProblemLines: Record<RemoveProblem, MessageId> = {
  name: 'servers.host-remove.error-name',
  busy: 'servers.host-remove.error-busy',
  forbidden: 'servers.host-remove.error-forbidden',
  // Never shown: the dialog finishes as removed.
  gone: 'servers.host-remove.error-other',
  older: 'servers.host-remove.error-older',
  other: 'servers.host-remove.error-other',
};

/**
 * One idempotency key per attempt: pressing Remove again after a failure that may not have
 * reached the machine reuses it, so the machine answers with the same receipt. Changing the
 * typed name starts a new attempt.
 */
export function attemptKeys(make: () => string = () => crypto.randomUUID()) {
  let current: { name: string; key: string } | null = null;
  return {
    for(name: string) {
      if (!current || current.name !== name) current = { name, key: make() };
      return current.key;
    },
    reset() { current = null; },
  };
}
