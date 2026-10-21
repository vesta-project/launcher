import { describe, expect, test } from 'bun:test';
import { banDuration, describeOperation } from '../src/features/servers/operations-model';
import { initials, serverArt } from '../src/features/servers/art';

const op = (patch) => ({ operationId: 'o', intent: null, state: 'succeeded', progressPercent: 100, createdAtMs: 0, updatedAtMs: 0, finishedAtMs: 0, reconciling: false, ...patch });
const rae = { kind: 'principal', principalId: 'p', displayName: 'RedstoneRae', deviceName: "Rae's laptop", self: false };

describe('[activity] tasks say who did what, exactly', () => {
  test('console commands show the exact line, or say it is hidden without console access', () => {
    const shown = describeOperation(op({ actor: rae, summary: { kind: 'console.command', command: 'time set day' }, outcome: 'stdin_written' }));
    expect(shown).toMatchObject({ actor: { message: 'servers.activity.actor-person', args: { name: 'RedstoneRae' } }, device: "Rae's laptop", command: 'time set day', outcome: 'servers.outcome.delivered' });
    expect(describeOperation(op({ actor: rae, summary: { kind: 'console.command', command: null } }))).toMatchObject({ action: { message: 'servers.task.command-hidden' }, command: null });
  });
  test('moderation names the player, reason and ban length', () => {
    const ban = describeOperation(op({ actor: { ...rae, self: true }, summary: { kind: 'players.moderate', action: 'ban', player: 'griefer_99', reason: 'Griefing', durationSeconds: 3 * 86_400 } }));
    expect(ban).toMatchObject({ actor: { message: 'servers.activity.actor-you' }, action: { message: 'servers.task.ban-for', args: { name: 'griefer_99' } }, duration: { message: 'servers.age.days', count: 3 }, detail: 'Griefing' });
    expect(describeOperation(op({ summary: { kind: 'players.moderate', action: 'kick', player: 'Alex' } })).action).toEqual({ message: 'servers.task.kick', args: { name: 'Alex', value: 'kick' } });
  });
  test('automation and older agents without details still read sensibly', () => {
    expect(describeOperation(op({ actor: { kind: 'workflow', name: 'Nightly restart' }, summary: { kind: 'lifecycle', action: 'restart', targetGeneration: null, resultGeneration: null } }))).toMatchObject({ actor: { message: 'servers.activity.actor-workflow', args: { name: 'Nightly restart' } }, action: { message: 'servers.task.restart' } });
    expect(describeOperation(op({ intent: 'lifecycle.stop' }))).toMatchObject({ actor: { message: 'servers.activity.actor-unknown' }, action: { message: 'servers.intent.stop' } });
  });
  test('ban lengths use the largest whole unit', () => {
    expect(banDuration(3600)).toEqual({ message: 'servers.age.hours', count: 1 });
    expect(banDuration(90)).toEqual({ message: 'servers.age.minutes', count: 2 });
  });
});

describe('[appearance] server art matches the instance image system', () => {
  test('art is deterministic per server and differs between servers', () => {
    expect(serverArt('srv_a')).toBe(serverArt('srv_a'));
    expect(serverArt('srv_a')).not.toBe(serverArt('srv_b'));
    expect(serverArt('srv_a')).toMatch(/^data:image\/svg\+xml/);
    expect(decodeURIComponent(serverArt('srv_a', '<RS>'))).toContain('&#60;RS&#62;');
  });
  test('initials use up to two words', () => {
    expect(initials('Riverside SMP')).toBe('RS');
    expect(initials('build')).toBe('B');
    expect(initials('  ')).toBe('?');
  });
});
