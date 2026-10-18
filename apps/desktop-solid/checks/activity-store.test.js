import { expect, test } from 'bun:test';
import { ActivityLedger, backgroundList, selectPill, visibleTaskList, weightedProgress } from '../src/features/activity/activity-model';
const task = (id, patch = {}) => ({ id, kind: 'task', title: id, state: 'running', startedAt: 0, cancellable: true, ...patch });

test('aggregate weights progress by remaining work and propagates unknown work', () => {
  const rows = [task('large', { progress: 0.2, weight: 900 }), task('small', { progress: 0.9, weight: 100 })];
  expect(weightedProgress(rows)).toBeCloseTo(0.27);
  expect(weightedProgress([...rows, task('unknown')])).toBeUndefined();
  expect(weightedProgress([task('done', { state: 'done', progress: 1 }), ...rows])).toBeCloseTo(0.27);
  expect(weightedProgress([])).toBeUndefined();
});
test('quiet work appears after 1.5 seconds running, excluding queued and finished work', () => {
  const ledger = new ActivityLedger();
  ledger.upsert(task('quiet', { kind: 'background', state: 'queued' }), 0);
  expect(backgroundList(ledger.rows, 20_000)).toEqual([]);
  ledger.upsert({ id: 'quiet', state: 'running' }, 20_000);
  expect(backgroundList(ledger.rows, 21_499)).toEqual([]);
  expect(selectPill(ledger.rows, 21_500).state).toBe('quiet');
  ledger.upsert({ id: 'quiet', state: 'done' }, 22_000);
  expect(selectPill(ledger.rows, 22_001).state).toBe('idle');
});
test('success expires after six seconds in pill while retained in panel history', () => {
  const ledger = new ActivityLedger();
  ledger.upsert(task('install', { action: 'play', target: { instanceId: '42' } }), 0);
  ledger.upsert({ id: 'install', state: 'done' }, 1000);
  expect(selectPill(ledger.rows, 6999)).toMatchObject({ state: 'success', activity: { action: 'play', target: { instanceId: '42' } } });
  expect(visibleTaskList(ledger.rows, 7000)).toEqual([]);
  expect(ledger.rows).toHaveLength(1);
  expect(ledger.rows[0].cancellable).toBe(false);
  ledger.clearFinished();
  expect(ledger.rows).toEqual([]);
});
test('failure persists until seen, including failures of short quiet work', () => {
  const ledger = new ActivityLedger();
  ledger.upsert(task('fail', { kind: 'background' }), 0);
  ledger.upsert({ id: 'fail', state: 'failed', error: 'offline' }, 100);
  expect(selectPill(ledger.rows, 1e12).state).toBe('failed');
  ledger.markSeen(['unrelated']);
  expect(selectPill(ledger.rows, 1e12).state).toBe('failed');
  ledger.markSeen(['fail']);
  expect(selectPill(ledger.rows, 1e12).state).toBe('idle');
  expect(ledger.rows).toHaveLength(1);
});
test('running pill limits icons to three and takes precedence over previous failure', () => {
  const rows = Array.from({ length: 5 }, (_, i) => task(String(i), { progress: 0.4 }));
  expect(selectPill([task('failure', { state: 'failed' }), ...rows], 0)).toMatchObject({ state: 'running', count: 5, extraCount: 2 });
  expect(selectPill(rows, 0).icons).toHaveLength(3);
});
test('history retains fifty finished tasks plus active work and unseen failures', () => {
  const ledger = new ActivityLedger();
  ledger.upsert(task('active'), 0);
  ledger.upsert(task('failure', { state: 'failed' }), 0);
  for (let i = 0; i < 80; i++) ledger.upsert(task(String(i), { state: 'done' }), i);
  expect(ledger.rows).toHaveLength(52);
  expect(ledger.rows.some((a) => a.id === 'failure')).toBe(true);
  expect(ledger.rows.some((a) => a.id === 'active')).toBe(true);
});
test('retry of same host id resets dismissal and finish time; cancellation never shows success', () => {
  const ledger = new ActivityLedger();
  ledger.upsert(task('retry', { state: 'failed' }), 0);
  ledger.dismiss('retry');
  ledger.upsert({ id: 'retry', state: 'queued', title: 'Retry', cancellable: true }, 100);
  expect(ledger.rows[0]).toMatchObject({ startedAt: 100, state: 'queued' });
  expect(ledger.rows[0].finishedAt).toBeUndefined();
  expect(ledger.rows[0].pillDismissed).toBeUndefined();
  ledger.upsert({ id: 'retry', state: 'cancelled' }, 200);
  expect(selectPill(ledger.rows, 201).state).toBe('idle');
});
