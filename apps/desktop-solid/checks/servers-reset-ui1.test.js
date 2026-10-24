// Pure rules behind the reset-plan UI work: the freshness rule (D9), the inline software
// change flow (D2) and the drag-and-drop upload plan (D10).
import { describe, expect, test } from 'bun:test';
import { STATUS_INTERVAL_MS, freshnessVisible, minecraftFactNow } from '../src/features/servers/model';

const status = { state: 'running', readiness: 'ready', lifecycle: 'running', playerCount: 0, playerCountKnown: true, playerCountObservedAtMs: null };
const snapshot = (phase, observedAtMs) => ({ state: { phase }, status, statusObservedAtMs: observedAtMs });

describe('[freshness] "Updated N ago" only while disrupted or stale', () => {
  test('a live, current value shows no age', () => {
    expect(freshnessVisible('online', 1_000, 1_000)).toBe(false);
    expect(freshnessVisible('online', 0, 2 * STATUS_INTERVAL_MS)).toBe(false);
  });

  test('a connected value older than twice the expected interval is stale', () => {
    expect(freshnessVisible('online', 0, 2 * STATUS_INTERVAL_MS + 1)).toBe(true);
    expect(freshnessVisible('online', 0, 5_000, 2_000)).toBe(true);
  });

  test('any disruption shows when it was last seen, however recent', () => {
    for (const phase of ['connecting', 'backoff', 'unreachable', 'disconnected']) expect(freshnessVisible(phase, 1_000, 1_000)).toBe(true);
  });

  test('nothing observed yet means nothing to date', () => {
    expect(freshnessVisible('unreachable', null, 1_000)).toBe(false);
  });

  test('the header keeps its tone while stale but connected, and drops it while disconnected', () => {
    expect(minecraftFactNow(snapshot('online', 0), 5_000).seen).toBeUndefined();
    expect(minecraftFactNow(snapshot('online', 0), 60_000)).toMatchObject({ tone: 'success', seen: { message: 'servers.age.minutes', count: 1 } });
    expect(minecraftFactNow(snapshot('backoff', 0), 5_000)).toMatchObject({ tone: 'neutral', seen: { message: 'servers.age.seconds', count: 5 } });
  });
});
