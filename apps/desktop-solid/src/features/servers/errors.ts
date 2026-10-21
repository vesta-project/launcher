// One localized message and one recovery action for every closed client error code.
import type { MessageId } from '../../localization/messages';
import { isServerCommandError, type ServerCommandError, type ServerErrorCode } from './native';

export type RecoveryAction = 'retry' | 'wait' | 'refresh' | 'pair_again' | 'verify' | 'new_code' | 'fix_input' | 'none';

export const errorPresentation: Record<ServerErrorCode, { message: MessageId; action: RecoveryAction }> = {
  invalid_address: { message: 'servers.error.invalid-address', action: 'fix_input' },
  unreachable: { message: 'servers.error.unreachable', action: 'retry' },
  timeout: { message: 'servers.error.timeout', action: 'retry' },
  tls_failed: { message: 'servers.error.tls-failed', action: 'retry' },
  fingerprint_mismatch: { message: 'servers.error.fingerprint-mismatch', action: 'verify' },
  pair_code_invalid: { message: 'servers.error.pair-code-invalid', action: 'new_code' },
  pair_outcome_unknown: { message: 'servers.error.pair-outcome-unknown', action: 'new_code' },
  credentials_rejected: { message: 'servers.error.credentials-rejected', action: 'pair_again' },
  credentials_unavailable: { message: 'servers.error.credentials-unavailable', action: 'none' },
  no_management_access: { message: 'servers.error.no-management-access', action: 'none' },
  forbidden: { message: 'servers.error.forbidden', action: 'none' },
  not_found: { message: 'servers.error.not-found', action: 'refresh' },
  stale_target: { message: 'servers.error.stale-target', action: 'refresh' },
  confirmation_expired: { message: 'servers.error.confirmation-expired', action: 'retry' },
  conflict: { message: 'servers.error.conflict', action: 'refresh' },
  rate_limited: { message: 'servers.error.rate-limited', action: 'wait' },
  server_busy: { message: 'servers.error.server-busy', action: 'wait' },
  unsupported: { message: 'servers.error.unsupported', action: 'none' },
  outcome_unknown: { message: 'servers.error.outcome-unknown', action: 'refresh' },
  invalid_input: { message: 'servers.error.invalid-input', action: 'fix_input' },
  internal: { message: 'servers.error.internal', action: 'retry' },
};

/** Normalizes anything a command rejected with into the closed model. */
export function toServerError(reason: unknown): ServerCommandError {
  if (isServerCommandError(reason) && reason.code in errorPresentation) return reason;
  return { code: 'internal' };
}

export const errorMessage = (reason: unknown): MessageId => errorPresentation[toServerError(reason).code].message;
