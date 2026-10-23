import { describe, expect, test } from 'bun:test';
import {
  MOTD_KEY, diffChanges, groupRows, groupSummary, matchedByKey, matchesSearch, parseProperties, propertyDef, propertyGroups,
  propertySchema, propertySearchText, unreportedKeys,
} from '../src/features/servers/properties-model';
import { activeCodesAt, applyMotdFormat, motdTokens, parseMotd, serializeMotd, stripMotdCodes } from '../src/features/servers/motd-model';
import { banExpiry, filterCounts, filterPlayers, mergePlayers, playerChips, shortUuid } from '../src/features/servers/player-manager';

describe('[game settings] grouping, essentials, search and change detection', () => {
  test('essentials lead with what most owners change; every key has one group and a help line', () => {
    const essentials = groupRows('essentials', { typed: {} }).map((def) => def.key);
    expect(essentials.slice(0, 4)).toEqual(['difficulty', 'gamemode', 'pvp', 'max-players']);
    expect(essentials).toContain('white-list');
    expect(essentials.length).toBeLessThanOrEqual(10);
    expect(propertyGroups[0].collapsible).toBe(false);
    expect(propertyGroups.slice(1).every((group) => group.collapsible)).toBe(true);
    for (const def of propertySchema) {
      expect(propertyGroups.some((group) => group.id === def.group)).toBe(true);
      expect(def.help).toBe(`server-settings.help.${def.key.replace(/\./g, '-')}`);
      if (def.parent) expect(propertyDef(def.parent)?.type).toBe('boolean');
    }
  });

  test('the MOTD has its own panel and unreported read-only keys become one quiet line', () => {
    const all = propertyGroups.flatMap((group) => groupRows(group.id, { typed: {} }).map((def) => def.key));
    expect(all).not.toContain(MOTD_KEY);
    expect(all).not.toContain('level-type');
    expect(unreportedKeys({ typed: {} })).toEqual(['level-type']);
    expect(groupRows('world', { typed: { 'level-type': 'minecraft:flat' } }).map((def) => def.key)).toContain('level-type');
    expect(unreportedKeys({ typed: { 'level-type': 'minecraft:flat' } })).toEqual([]);
  });

  test('search matches label, help and the raw key, and says when only the key matched', () => {
    const def = propertyDef('view-distance');
    const text = propertySearchText(def, 'View distance', 'How far players can see');
    expect(matchesSearch(text, 'distance')).toBe(true);
    expect(matchesSearch(text, 'far see')).toBe(true);
    expect(matchesSearch(text, 'view-distance')).toBe(true);
    expect(matchesSearch(text, 'rcon')).toBe(false);
    const rcon = propertyDef('rcon.port');
    expect(matchesSearch(propertySearchText(rcon, 'Remote console port', ''), 'rcon port')).toBe(true);
    expect(matchedByKey(rcon, 'Remote console port', '', 'rcon.port')).toBe(true);
    expect(matchedByKey(rcon, 'Remote console port', '', 'console')).toBe(false);
    expect(matchedByKey(rcon, 'Remote console port', '', '')).toBe(false);
  });

  test('group summaries count unsaved edits and values away from the default', () => {
    const parsed = parseProperties({ difficulty: 'hard', pvp: true, 'max-players': 20, 'rcon.password': '[redacted]' });
    const defs = groupRows('essentials', parsed);
    expect(groupSummary(defs, parsed.typed, {})).toEqual({ count: defs.length, edited: 0, customized: 1 });
    const changes = diffChanges(parsed.typed, { difficulty: 'easy', 'max-players': 20 });
    expect(changes).toEqual({ difficulty: 'easy' });
    expect(groupSummary(defs, parsed.typed, changes)).toEqual({ count: defs.length, edited: 1, customized: 0 });
    const advanced = groupRows('advanced', parsed);
    expect(groupSummary(advanced, parsed.typed, {}).customized).toBe(0);
  });
});

describe('[motd editor] toolbar transforms and source round-trips', () => {
  test('tokens keep every character and know what is a code, text or placeholder', () => {
    const source = '§b{server_name}§l is up\\n§7Join §zus';
    const tokens = motdTokens(source);
    expect(tokens.map((token) => token.text).join('')).toBe(source);
    expect(tokens.filter((token) => token.kind === 'code').map((token) => token.text)).toEqual(['§b', '§l', '§7']);
    expect(tokens.find((token) => token.kind === 'placeholder')).toMatchObject({ text: '{server_name}', style: { color: '#55FFFF' } });
    expect(tokens.find((token) => token.text === ' is up')).toMatchObject({ style: { color: '#55FFFF', bold: true } });
    expect(tokens.some((token) => token.kind === 'newline')).toBe(true);
    // Unknown codes stay as text, like Minecraft.
    expect(tokens.at(-1)).toMatchObject({ kind: 'text', text: 'Join §zus' });
  });

  test('a code with no selection is inserted at the cursor', () => {
    expect(applyMotdFormat('Hello', 0, 0, 'a')).toEqual({ template: '§aHello', start: 2, end: 2 });
  });

  test('formatting a selection wraps it and restores the following style', () => {
    const result = applyMotdFormat('§bHello world', 2, 7, 'l');
    expect(result.template).toBe('§b§lHello§r§b world');
    expect(result.template.slice(result.start, result.end)).toBe('Hello');
    expect(parseMotd(result.template).map((segment) => [segment.text, segment.color, segment.bold])).toEqual([
      ['Hello', '#55FFFF', true], [' world', '#55FFFF', false],
    ]);
    // At the end of a line nothing needs restoring.
    expect(applyMotdFormat('Hello', 0, 5, 'c').template).toBe('§cHello');
  });

  test('clear formatting strips codes from the selection only', () => {
    expect(applyMotdFormat('§aOne §lTwo§r three', 2, 11, 'r').template).toBe('§a§rOne Two§r§a§l§r three');
    expect(stripMotdCodes('§aOne §lTwo {server_name}')).toBe('One Two {server_name}');
    expect(activeCodesAt('§a§lHi there', 6)).toBe('§a§l');
    expect(activeCodesAt('§a§lHi\nthere', 9)).toBe('');
  });

  test('rendered segments serialize back to source that renders the same', () => {
    for (const source of ['§a§lGreen bold§r plain §cred', 'plain\n§7second §ountil§r end', '§l§nboth§r §mstruck', '', 'no codes']) {
      const segments = parseMotd(source);
      expect(parseMotd(serializeMotd(segments))).toEqual(segments);
    }
    expect(serializeMotd(parseMotd('§a§a§lHi'))).toBe('§a§lHi');
  });
});

describe('[players] one manager over whitelist, operators, bans and the live roster', () => {
  const sources = {
    whitelist: [{ name: 'Alex', uuid: '853c80ef-3c37-49fd-aa49-938b674adae6' }, { name: 'Steve', uuid: 'aaaa1111-0000-0000-0000-000000000000' }],
    ops: [{ name: 'alex', uuid: '853c80ef-3c37-49fd-aa49-938b674adae6', level: 4, bypassesPlayerLimit: false }],
    bans: [
      { name: 'griefer_99', uuid: 'bbbb2222-0000-0000-0000-000000000000', reason: 'Griefing', created: '2026-10-02 18:12:44 +0000', expires: 'forever', source: 'Server' },
      { name: 'Temp', uuid: 'cccc3333-0000-0000-0000-000000000000', reason: 'Spam', created: '2026-10-02 18:12:44 +0000', expires: '2026-11-01 10:00:00 +0000', source: 'Alex' },
    ],
    roster: { known: true, generation: 'g1', playerCount: 2, names: ['Steve', 'Visitor'] },
  };

  test('names merge case-insensitively and online players sort first', () => {
    const players = mergePlayers(sources);
    expect(players.map((player) => player.name)).toEqual(['Steve', 'Visitor', 'Alex', 'griefer_99', 'Temp']);
    const alex = players.find((player) => player.key === 'alex');
    expect(alex).toMatchObject({ whitelisted: true, operator: { level: 4 }, online: false, uuid: '853c80ef-3c37-49fd-aa49-938b674adae6' });
    expect(players.find((player) => player.name === 'Visitor')).toMatchObject({ online: true, uuid: null, whitelisted: false });
  });

  test('an unknown roster adds nobody online', () => {
    expect(mergePlayers({ ...sources, roster: { known: false } }).some((player) => player.online)).toBe(false);
  });

  test('filters, counts and search by name or UUID', () => {
    const players = mergePlayers(sources);
    expect(filterCounts(players)).toEqual({ all: 5, online: 2, whitelisted: 2, operators: 1, banned: 2 });
    expect(filterPlayers(players, 'operators').map((player) => player.name)).toEqual(['Alex']);
    expect(filterPlayers(players, 'all', 'GRIEF').map((player) => player.name)).toEqual(['griefer_99']);
    expect(filterPlayers(players, 'all', '853c80').map((player) => player.name)).toEqual(['Alex']);
    expect(filterPlayers(players, 'banned', 'steve')).toEqual([]);
  });

  test('status chips: online, ban with its end, operator level, whitelisted', () => {
    const players = mergePlayers(sources);
    const date = (ms) => new Date(ms).toISOString().slice(0, 10);
    const chips = (name) => playerChips(players.find((player) => player.name === name), date).map((chip) => [chip.message, chip.args]);
    expect(chips('Alex')).toEqual([['servers.people.operator', { count: 4 }], ['servers.people.whitelisted', undefined]]);
    expect(chips('Steve')).toEqual([['servers.people.online', undefined], ['servers.people.whitelisted', undefined]]);
    expect(chips('griefer_99')).toEqual([['servers.people.banned', undefined]]);
    expect(chips('Temp')).toEqual([['servers.people.banned-until', { time: '2026-11-01' }]]);
  });

  test('ban expiry reads vanilla dates and permanent bans', () => {
    expect(banExpiry('forever')).toEqual({ permanent: true });
    expect(banExpiry('2026-11-01 10:00:00 +0000')).toEqual({ permanent: false, atMs: Date.UTC(2026, 10, 1, 10) });
    expect(banExpiry('2026-11-01T10:00:00.000Z')).toEqual({ permanent: false, atMs: Date.UTC(2026, 10, 1, 10) });
    expect(banExpiry('soon')).toBeNull();
    expect(shortUuid('853c80ef-3c37-49fd-aa49-938b674adae6')).toBe('853c80ef');
  });
});
