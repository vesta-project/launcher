// One player-moderation request as it was first submitted. Once a request may have reached
// the server (an uncertain outcome) or is waiting for operator confirmation, every field,
// the route and the run it targets are frozen: a retry repeats exactly that request with
// the same intent ID, so the server can recognise it rather than run something new.
// Pure, so the retry rules can be checked without a dialog or a server.
import type { ModerationAction, ServerErrorCode } from './native';
import { outcomeUncertain } from './model';

export type Action = ModerationAction['action'];

/**
 * Where the request goes: `offline` edits whitelist.json while Minecraft is stopped,
 * `desired` queues whitelist membership for a run that exists, `moderate` is a command
 * for the running server.
 */
export type Route = 'offline' | 'desired' | 'moderate';

export interface AttemptFields {
  action: Action;
  player: string;
  reason: string;
  /** Ban length in seconds; null is permanent. */
  durationSeconds: number | null;
}

export interface Attempt extends AttemptFields {
  route: Route;
  /** The run this targets (desired/moderate). A restart never retargets a retry. */
  generation: string | null;
  intentId: string;
  /** The whitelist.json revision an offline edit expects; read once, before the first send. */
  expected?: string | null;
  /** Set once the server asks for operator confirmation of this exact request. */
  confirm?: { intentId: string; expiresAtMs: number; player: string; uncertain: boolean };
  /** The last send may have reached the server. */
  uncertain: boolean;
}

export interface RouteContext {
  state: 'stopped' | 'running' | 'stopping' | 'draining' | undefined;
  generation: string | null | undefined;
}

export const isWhitelist = (action: Action) => action === 'whitelist_add' || action === 'whitelist_remove';

/** The route a fresh request takes now, or null when the server can't take it in this state. */
export function routeFor(action: Action, context: RouteContext): { route: Route; generation: string | null } | null {
  if (isWhitelist(action)) {
    if (context.generation) return { route: 'desired', generation: context.generation };
    if (context.state === 'stopped') return { route: 'offline', generation: null };
    return null;
  }
  return context.state === 'running' && context.generation ? { route: 'moderate', generation: context.generation } : null;
}

/** The request body for the `moderate` route, from the frozen fields. */
export function moderationRequest(attempt: AttemptFields): ModerationAction {
  const reason = attempt.reason.trim();
  return {
    action: attempt.action,
    player: attempt.player,
    ...((attempt.action === 'kick' || attempt.action === 'ban') && reason ? { reason } : {}),
    ...(attempt.action === 'ban' && attempt.durationSeconds ? { durationSeconds: attempt.durationSeconds } : {}),
  } as ModerationAction;
}

/** True while the dialog must not let the request change. */
export const frozen = (attempt: Attempt | null) => !!attempt && (attempt.uncertain || !!attempt.confirm);

/**
 * The attempt a submit should send: the frozen one when it still stands, otherwise null
 * (build a fresh one). A confirmation the server issued but we never tried to use lapses
 * with its countdown; one whose answer was lost stands, because it may have been applied.
 */
export function standing(attempt: Attempt | null, nowMs: number): Attempt | null {
  if (!attempt) return null;
  if (attempt.confirm && !attempt.confirm.uncertain && !attempt.uncertain && attempt.confirm.expiresAtMs <= nowMs) return null;
  return frozen(attempt) ? attempt : null;
}

/**
 * What remains of the attempt after a failed send. A refusal of a retry says nothing about
 * an earlier send whose answer was lost, so uncertainty, once set, stays until the dialog
 * closes; only a first send that is definitely refused releases the request.
 */
export function afterFailure(attempt: Attempt, code: ServerErrorCode, nowMs: number): Attempt | null {
  const uncertain = outcomeUncertain(code);
  if (attempt.confirm) {
    if (attempt.confirm.uncertain || uncertain) return { ...attempt, confirm: { ...attempt.confirm, uncertain: true } };
    // Never sent before, and refused: the server said the confirmation is gone, or it lapses with its countdown.
    if (code === 'confirmation_expired') return null;
    return attempt.confirm.expiresAtMs > nowMs ? attempt : null;
  }
  return attempt.uncertain || uncertain ? { ...attempt, uncertain: true } : null;
}
