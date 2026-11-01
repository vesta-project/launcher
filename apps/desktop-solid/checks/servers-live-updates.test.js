import { expect, test } from 'bun:test';
import { EditRevision, refreshUnedited } from '../src/features/servers/edit-revision';
import { applyRosterDelta } from '../src/features/servers/roster-delta';
test('live drafts require explicit review before rebasing', () => {
  const guard = new EditRevision();
  expect(guard.conflicts('1')).toBe(false);
  guard.begin('1'); guard.begin('2');
  expect(guard.conflicts('2')).toBe(true);
  guard.review('2'); expect(guard.conflicts('2')).toBe(false);
  expect(guard.conflicts('3')).toBe(true);
  guard.reset(); expect(guard.conflicts('3')).toBe(false);
});
test('roster deltas preserve input, apply equal-count replacements and reject gaps atomically', () => {
  const current = { known: true, generation: 'g', revision: '1', names: ['Alex', 'Sam'], playerCount: 2 };
  const delta = { generation: 'g', base_revision: '1', revision: '3', changes: [{ name: 'Alex', kind: 'leave' }, { name: 'NewGuest', kind: 'join' }] };
  const next = applyRosterDelta(current, delta);
  expect(next).toEqual({ ...current, revision: '3', names: ['Sam', 'NewGuest'] });
  expect(applyRosterDelta(next, delta)).toBeNull();
  expect(applyRosterDelta(current, { ...delta, generation: 'other' })).toBeNull();
  expect(applyRosterDelta(current, { ...delta, changes: [...delta.changes, { name: 'bad name', kind: 'join' }] })).toBeNull();
  expect(current.names).toEqual(['Alex', 'Sam']);
});

test('nested untouched policy fields refresh while explicit edits and list choices remain', () => {
  const base = { enabled: false, states: { sleeping: { template: 'old', maximum: 20 } }, include: ['world'] };
  const draft = { ...base, states: { sleeping: { ...base.states.sleeping, template: 'my draft' } } };
  const latest = { enabled: true, states: { sleeping: { template: 'remote', maximum: 50 } }, include: ['world', 'config'] };
  expect(refreshUnedited(base, draft, latest)).toEqual({ ...latest, states: { sleeping: { template: 'my draft', maximum: 50 } } });
  expect(refreshUnedited(base, { ...draft, include: [] }, latest).include).toEqual([]);
});
