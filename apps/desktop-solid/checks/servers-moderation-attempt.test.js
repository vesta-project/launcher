import { describe, expect, test } from 'bun:test';
import { afterFailure, frozen, moderationRequest, routeFor, standing } from '../src/features/servers/moderation-attempt';

const base = { action: 'ban', player: 'griefer_99', reason: ' Griefing ', durationSeconds: 3600, route: 'moderate', generation: 'g1', intentId: 'i1', uncertain: false };

describe('[players] a moderation request is frozen once it may have reached the server', () => {
  test('routes follow the server state, and whitelist edits work while stopped or starting', () => {
    expect(routeFor('whitelist_add', { state: 'stopped', generation: null })).toEqual({ route: 'offline', generation: null });
    expect(routeFor('whitelist_add', { state: 'running', generation: 'g1' })).toEqual({ route: 'desired', generation: 'g1' });
    expect(routeFor('whitelist_remove', { state: 'stopping', generation: null })).toBeNull();
    expect(routeFor('ban', { state: 'running', generation: 'g1' })).toEqual({ route: 'moderate', generation: 'g1' });
    expect(routeFor('kick', { state: 'stopped', generation: null })).toBeNull();
  });

  test('the request body carries the frozen fields only where they apply', () => {
    expect(moderationRequest(base)).toEqual({ action: 'ban', player: 'griefer_99', reason: 'Griefing', durationSeconds: 3600 });
    expect(moderationRequest({ ...base, action: 'op', reason: 'x' })).toEqual({ action: 'op', player: 'griefer_99' });
  });

  test('an uncertain send keeps the same intent, fields and run for the retry', () => {
    const after = afterFailure(base, 'network_error', 0);
    expect(after).toMatchObject({ intentId: 'i1', generation: 'g1', reason: ' Griefing ', uncertain: true });
    expect(frozen(after)).toBe(true);
    // Even after a restart (new generation), the retry targets the original run.
    expect(standing(after, 10_000_000)?.generation).toBe('g1');
  });

  test('a definite refusal releases the request', () => {
    expect(afterFailure(base, 'forbidden', 0)).toBeNull();
    expect(standing(null, 0)).toBeNull();
  });

  test('a lost confirmation stays the retry even after its countdown, and expiry from the server restarts', () => {
    const awaiting = { ...base, action: 'op', confirm: { intentId: 'i1', expiresAtMs: 1000, player: 'griefer_99', uncertain: false } };
    expect(frozen(awaiting)).toBe(true);
    // Never tried: the confirmation lapses with its countdown.
    expect(standing(awaiting, 2000)).toBeNull();
    const lost = afterFailure(awaiting, 'network_error', 500);
    expect(lost.confirm.uncertain).toBe(true);
    expect(standing(lost, 5000)?.confirm.intentId).toBe('i1');
    expect(afterFailure(lost, 'confirmation_expired', 5000)).toBeNull();
    // A definite refusal keeps the prepared request only within its countdown.
    expect(afterFailure(awaiting, 'forbidden', 500)?.confirm.intentId).toBe('i1');
    expect(afterFailure(awaiting, 'forbidden', 1500)).toBeNull();
  });
});
