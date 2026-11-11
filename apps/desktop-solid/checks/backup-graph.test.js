import { expect, test } from 'bun:test';
import { LIVE, cleanLabel, graphRows, labelProblem, laneCount, liveIsBranch, withLineage } from '../src/features/servers/backup-graph-model.ts';

const at = (hours) => new Date(Date.UTC(2026, 10, 1) + hours * 3_600_000).toISOString();
const point = (id, hours, parentId, extra = {}) => ({ id, time: at(hours), profile: 'daily', safety: false, parentId, label: null, kept: false, ...extra });
const shape = (rows) => rows.map((row) => `${row.id}@${row.lane}${row.live ? '*' : ''}`).join(' ');

test('one line: the live world sits on the newest point, all in the accent ancestry', () => {
  const rows = graphRows({ head: 'c', points: [point('a', 1, null), point('b', 2, 'a'), point('c', 3, 'b')] });
  expect(shape(rows)).toBe('live@0* c@0* b@0* a@0*');
  expect(rows[0].below).toEqual({ lane: 0, live: true });
  expect(rows.at(-1).below).toBeNull();
  expect(laneCount(rows)).toBe(1);
});

test('restoring an old point and playing on grows a branch; the old days stay beside it', () => {
  // a ← b ← c, then restored to b (safety s kept c's world), then backed up d on top of b.
  const history = { head: 'd', points: [point('a', 1, null), point('b', 2, 'a'), point('c', 3, 'b'), point('s', 4, 'c', { safety: true, profile: null, kept: true }), point('d', 5, 'b')] };
  const rows = graphRows(history);
  expect(shape(rows)).toBe('live@0* d@0* s@1 c@1 b@0* a@0*');
  const b = rows.find((row) => row.id === 'b');
  expect(b.joins).toEqual([{ lane: 1, live: false }]);
  expect(rows.find((row) => row.id === 's').through).toEqual([{ lane: 0, live: true }]);
  expect(rows.find((row) => row.id === 's').tip).toBe(true);
  expect(laneCount(rows)).toBe(2);
});

test('right after a restore the live world is its own branch off the restored point', () => {
  const history = { head: 'b', points: [point('a', 1, null), point('b', 2, 'a'), point('c', 3, 'b')] };
  expect(liveIsBranch(history)).toBe(true);
  const rows = graphRows(history);
  expect(shape(rows)).toBe('live@0* c@1 b@0* a@0*');
  expect(rows.find((row) => row.id === 'b').joins).toEqual([{ lane: 1, live: false }]);
});

test('an older host without lineage reads as one line in time order', () => {
  const flat = withLineage({ head: null, points: [point('a', 1, null), point('c', 3, null), point('b', 2, null)] });
  expect(flat.head).toBe('c');
  expect(flat.points.map((entry) => `${entry.id}<${entry.parentId}`)).toEqual(['c<b', 'b<a', 'a<null']);
});

test('a parent retention removed ends the lane instead of dangling', () => {
  const rows = graphRows({ head: 'b', points: [point('b', 2, 'gone')] });
  expect(rows.find((row) => row.id === 'b').below).toBeNull();
});

test('names are trimmed and kept short', () => {
  expect(cleanLabel('  Before the dragon  ')).toBe('Before the dragon');
  expect(cleanLabel('   ')).toBeNull();
  expect(labelProblem('x'.repeat(61))).toBe('servers.backups.label-long');
  expect(labelProblem('ok')).toBeNull();
  expect(LIVE).toBe('live');
});
