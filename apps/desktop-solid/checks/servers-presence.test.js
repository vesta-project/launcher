import { describe, expect, test } from 'bun:test';
import { fillPlaceholders, motdProblems, parseMotd } from '../src/features/servers/motd-model';
import { createFixtureServers } from '../src/features/servers/fixtures';

describe('[motd] server-list text renders like Minecraft', () => {
  test('colour codes reset styles; style codes stack; §r resets', () => {
    const segments = parseMotd('§a§lGreen bold§r plain §cred');
    expect(segments.map((segment) => [segment.text, segment.color, segment.bold])).toEqual([
      ['Green bold', '#55FF55', true], [' plain ', null, false], ['red', '#FF5555', false],
    ]);
  });
  test('two lines at most, with escaped newlines supported', () => {
    expect(parseMotd('one\ntwo\nthree').map((segment) => segment.line)).toEqual([0, 1]);
    expect(motdProblems('a\nb\nc')).toContain('too-many-lines');
  });
  test('placeholders are filled for previews and unknown ones are reported', () => {
    expect(fillPlaceholders('{server_name} {online_players}/{max_players}', { server_name: 'SMP', online_players: '0', max_players: '20' })).toBe('SMP 0/20');
    expect(motdProblems('{server_name}')).toEqual([]);
    expect(motdProblems('{whoami}')).toContain('unknown-placeholder');
    expect(motdProblems('{server_name')).toContain('unclosed-placeholder');
    expect(motdProblems('x'.repeat(1025))).toContain('too-long');
  });
});

describe('[sleep] policy follows the agent bounds and revisions', () => {
  test('out-of-range values and stale revisions are refused', async () => {
    const servers = createFixtureServers({ latencyMs: 0 });
    const { policy, revision } = await servers.sleepPolicy('fixture-survival');
    expect((await servers.sleepPolicy('fixture-survival')).sleepBlocker).toEqual({ reason: 'disabled' });
    await expect(servers.updateSleepPolicy('fixture-survival', { ...policy, enabled: true, idleSeconds: 30 }, revision, 's1')).rejects.toMatchObject({ code: 'invalid_input' });
    const saved = await servers.updateSleepPolicy('fixture-survival', { ...policy, enabled: true, offlineStatus: true, wakeOnJoin: true }, revision, 's2');
    expect(saved.revision).toBe(revision + 1);
    expect(saved.sleepBlocker).toEqual({ reason: 'players_online' });
    await expect(servers.updateSleepPolicy('fixture-survival', policy, revision, 's3')).rejects.toMatchObject({ code: 'stale_target' });
    await expect(servers.updateSleepPolicy('fixture-creative', policy, 0, 's4')).rejects.toMatchObject({ code: 'forbidden' });
  });
  test('the server preview renders the draft and invalid templates are refused', async () => {
    const servers = createFixtureServers({ latencyMs: 0 });
    const { document } = await servers.motdPolicy('fixture-survival');
    const preview = await servers.motdPreview('fixture-survival', 'sleeping', document);
    expect(preview.lines[0]).toContain('Riverside SMP');
    const broken = { ...document, states: { ...document.states, sleeping: { ...document.states.sleeping, template: '{nope}' } } };
    await expect(servers.motdPreview('fixture-survival', 'sleeping', broken)).rejects.toMatchObject({ code: 'invalid_input' });
  });
});
