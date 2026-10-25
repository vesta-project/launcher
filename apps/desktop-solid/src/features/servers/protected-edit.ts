// Raw editing of Minecraft's own admission documents (D4): server.properties, whitelist.json,
// ops.json and banned-*.json. Owners and admins may edit them in the Files editor, but each
// save is a two-step write: the agent validates and returns a short-lived token, the user
// confirms the risk, and the same intent is repeated with the token. A changed file never
// gets overwritten silently; it opens a compare first and needs a fresh confirmation.
import type { MessageId } from '../../localization/messages';
import { baseName } from './files-model';
export { protectedAccess, type ProtectedAccess } from './files-model';
import type { PropertiesUpdateResult, ServerCommandError, TextFile } from './native';

/** Where the structured editor for this document lives. */
export const protectedSection = (path: string): 'game' | 'players' => (baseName(path).toLowerCase() === 'server.properties' ? 'game' : 'players');

export const protectedNotice = (path: string): MessageId =>
  protectedSection(path) === 'game' ? 'server-files.raw-notice-game' : 'server-files.raw-notice-players';

// ------------------------------------------------------------------ state machine

export type ProtectedEdit =
  | { step: 'idle' }
  /** First write without a token: the agent validates and answers with a confirmation token. */
  | { step: 'preparing'; text: string; expected: string }
  /** Waiting for the user to confirm the risk before the token expires. */
  | { step: 'confirm'; text: string; expected: string; token: string; expiresAtMs: number }
  /** Second write with the token. */
  | { step: 'applying'; text: string; expected: string; token: string }
  /** The file changed on the server; `server` is the current copy. */
  | { step: 'conflict'; text: string; server: TextFile }
  /** The file was deleted on the server meanwhile. */
  | { step: 'gone' };

export type ProtectedEditEvent =
  | { type: 'save'; text: string; expected: string }
  | { type: 'prepared'; token: string; expiresAtMs: number }
  | { type: 'confirm'; nowMs: number }
  | { type: 'cancel' }
  | { type: 'applied' }
  | { type: 'stale'; server: TextFile }
  | { type: 'gone' }
  | { type: 'expired' }
  | { type: 'failed' }
  /** From a conflict: write mine over the server's copy, which needs a fresh confirmation. */
  | { type: 'overwrite' }
  /** From a conflict: take the server's copy. */
  | { type: 'reload' };

export const IDLE: ProtectedEdit = { step: 'idle' };

/** Pure transitions. Events that don't apply to the current step leave it unchanged. */
export function protectedEditReducer(state: ProtectedEdit, event: ProtectedEditEvent): ProtectedEdit {
  switch (state.step) {
    case 'idle':
      return event.type === 'save' ? { step: 'preparing', text: event.text, expected: event.expected } : state;
    case 'preparing':
      if (event.type === 'prepared') return { step: 'confirm', text: state.text, expected: state.expected, token: event.token, expiresAtMs: event.expiresAtMs };
      if (event.type === 'stale') return { step: 'conflict', text: state.text, server: event.server };
      if (event.type === 'gone') return { step: 'gone' };
      if (event.type === 'failed' || event.type === 'cancel') return IDLE;
      return state;
    case 'confirm':
      if (event.type === 'confirm') {
        // A token past its expiry is asked for again rather than sent and refused.
        return event.nowMs < state.expiresAtMs
          ? { step: 'applying', text: state.text, expected: state.expected, token: state.token }
          : { step: 'preparing', text: state.text, expected: state.expected };
      }
      if (event.type === 'expired') return { step: 'preparing', text: state.text, expected: state.expected };
      return event.type === 'cancel' ? IDLE : state;
    case 'applying':
      if (event.type === 'applied' || event.type === 'failed') return IDLE;
      if (event.type === 'expired') return { step: 'preparing', text: state.text, expected: state.expected };
      if (event.type === 'stale') return { step: 'conflict', text: state.text, server: event.server };
      if (event.type === 'gone') return { step: 'gone' };
      return state;
    case 'conflict':
      if (event.type === 'overwrite') {
        // Without the server's validator there's nothing to overwrite against.
        return state.server.sha256 ? { step: 'preparing', text: state.text, expected: state.server.sha256 } : state;
      }
      return event.type === 'reload' || event.type === 'cancel' ? IDLE : state;
    case 'gone':
      return event.type === 'cancel' || event.type === 'reload' ? IDLE : state;
  }
}

/** Steps that send a request; the driver runs one for each. */
export const protectedEditSends = (state: ProtectedEdit) => state.step === 'preparing' || state.step === 'applying';

/** The event a write result maps to. */
export function protectedResultEvent(result: PropertiesUpdateResult): ProtectedEditEvent {
  return result.kind === 'applied' ? { type: 'applied' } : { type: 'prepared', token: result.confirmationToken, expiresAtMs: result.expiresAtMs };
}

/** The event a rejected write maps to, or null when the caller must read the server copy first (stale). */
export function protectedErrorEvent(error: Pick<ServerCommandError, 'code'>): ProtectedEditEvent | null {
  if (error.code === 'stale_target') return null;
  if (error.code === 'not_found') return { type: 'gone' };
  if (error.code === 'confirmation_expired') return { type: 'expired' };
  return { type: 'failed' };
}

/** Copy for a refused raw write: invalid syntax reads differently from a permission problem. */
export function protectedErrorMessage(error: Pick<ServerCommandError, 'code'>, path: string): MessageId | null {
  if (error.code === 'invalid_input') return baseName(path).toLowerCase().endsWith('.json') ? 'server-files.raw-invalid-json' : 'server-files.raw-invalid-properties';
  if (error.code === 'forbidden') return 'server-files.raw-forbidden';
  return null;
}

/** Resume a deferred navigation only after the confirmed write actually applied. */
export function protectedLeaveDestination(destination: string | null, event: ProtectedEditEvent): string | null {
  return event.type === 'applied' ? destination : null;
}
