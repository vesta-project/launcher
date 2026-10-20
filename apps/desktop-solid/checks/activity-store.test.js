import { expect, test } from 'bun:test';
import { ActivityLedger, backgroundList, readyList, selectPill, visibleTaskList, weightedProgress } from '../src/features/activity/activity-model';
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
  ledger.upsert(task('install', { action: 'open', target: { instanceId: '42' } }), 0);
  ledger.upsert({ id: 'install', state: 'done' }, 1000);
  expect(selectPill(ledger.rows, 6999)).toMatchObject({ state: 'success', activity: { action: 'open', target: { instanceId: '42' } } });
  expect(selectPill(ledger.rows, 7000).state).toBe('idle');
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

const install = (ledger, id, instanceId, finishedAt) => {
  ledger.upsert(task(id, { action: 'play', target: { instanceId } }), finishedAt - 500);
  ledger.upsert({ id, state: 'done' }, finishedAt);
};
const readyIds = (state) => state.state === 'ready' ? state.activities.map((a) => a.id) : [];

test('finished play installs stay ready past the success window, newest first with stacked older', () => {
  const ledger = new ActivityLedger();
  install(ledger, 'a', '1', 1000);
  install(ledger, 'b', '2', 2000);
  install(ledger, 'c', '3', 3000);
  install(ledger, 'd', '4', 4000);
  const pill = selectPill(ledger.rows, 1e9);
  expect(pill).toMatchObject({ state: 'ready', extraCount: 1 });
  expect(readyIds(pill)).toEqual(['d', 'c', 'b', 'a']);
  expect(pill.icons.map((a) => a.id)).toEqual(['c', 'b']);
});
test('playing the front install reveals the next; dismissal also ends the wait', () => {
  const ledger = new ActivityLedger();
  install(ledger, 'a', '1', 1000);
  install(ledger, 'b', '2', 2000);
  ledger.markPlayed(['2']);
  expect(readyIds(selectPill(ledger.rows, 1e9))).toEqual(['a']);
  // A play within the success window does not flash a stale success moment.
  expect(selectPill(ledger.rows, 2001).state).toBe('ready');
  ledger.dismiss('a');
  expect(selectPill(ledger.rows, 1e9).state).toBe('idle');
  expect(ledger.rows).toHaveLength(2);
});
test('an unsuccessful launch leaves the install ready; unrelated instances do not clear it', () => {
  const ledger = new ActivityLedger();
  install(ledger, 'a', '1', 1000);
  ledger.markPlayed([]);
  ledger.markPlayed(['9']);
  expect(readyIds(selectPill(ledger.rows, 1e9))).toEqual(['a']);
});
test('running work preempts ready installs, which return afterwards', () => {
  const ledger = new ActivityLedger();
  install(ledger, 'a', '1', 1000);
  ledger.upsert(task('work', { progress: 0.5 }), 2000);
  expect(selectPill(ledger.rows, 1e9).state).toBe('running');
  ledger.upsert({ id: 'work', state: 'done' }, 3000);
  expect(selectPill(ledger.rows, 3001)).toMatchObject({ state: 'success', activity: { id: 'work' } });
  expect(readyIds(selectPill(ledger.rows, 9000))).toEqual(['a']);
  ledger.upsert(task('broken'), 10_000);
  ledger.upsert({ id: 'broken', state: 'failed' }, 11_000);
  expect(selectPill(ledger.rows, 1e9).state).toBe('failed');
  ledger.markSeen();
  expect(readyIds(selectPill(ledger.rows, 1e9))).toEqual(['a']);
});
test('ready installs hide while their instance is missing and keep one entry per instance', () => {
  const ledger = new ActivityLedger();
  install(ledger, 'a', '1', 1000);
  install(ledger, 'b', '2', 2000);
  install(ledger, 'a2', '1', 3000);
  expect(readyList(ledger.rows).map((a) => a.id)).toEqual(['a2', 'b']);
  const live = (id) => id !== '1';
  expect(readyIds(selectPill(ledger.rows, 1e9, live))).toEqual(['b']);
  expect(visibleTaskList(ledger.rows, 1e9, live).map((a) => a.id)).toEqual(['b']);
  expect(selectPill(ledger.rows, 1e9, () => false).state).toBe('idle');
  // The instance coming back (e.g. after a catalog reload) restores the wait.
  expect(readyIds(selectPill(ledger.rows, 1e9))).toEqual(['a2', 'b']);
});
test('unplayed installs survive history eviction; installs without a target only flash success', () => {
  const ledger = new ActivityLedger();
  install(ledger, 'keep', '1', 0);
  for (let i = 0; i < 80; i++) ledger.upsert(task(String(i), { state: 'done' }), i + 1);
  expect(ledger.rows.some((a) => a.id === 'keep')).toBe(true);
  const loose = new ActivityLedger();
  loose.upsert(task('x', { action: 'play' }), 0);
  loose.upsert({ id: 'x', state: 'done' }, 0);
  expect(selectPill(loose.rows, 1).state).toBe('success');
  expect(selectPill(loose.rows, 6000).state).toBe('idle');
});
test('a retried install that finishes again waits again', () => {
  const ledger = new ActivityLedger();
  install(ledger, 'a', '1', 1000);
  ledger.markPlayed(['1']);
  ledger.upsert({ id: 'a', state: 'running', action: 'play', target: { instanceId: '1' } }, 2000);
  expect(ledger.rows[0].played).toBeUndefined();
  ledger.upsert({ id: 'a', state: 'done' }, 3000);
  expect(readyIds(selectPill(ledger.rows, 1e9))).toEqual(['a']);
});
