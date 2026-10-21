import { describe, expect, test } from 'bun:test';
import { filterLog, levelCounts, lineTotal, logText } from '../src/components/log-view/log-model';
import { ConsoleBuffer } from '../src/features/servers/console-model';
import { toLogEntries } from '../src/features/servers/console-view';
import { parseLog } from '../src/features/instances/interaction-utils';

const gapCopy = { label: 'Lines skipped', detail: 'See latest.log' };
const lines = (from, count, text = (n) => `[12:00:0${n % 10}] [Server thread/INFO]: line ${n}`) =>
  Array.from({ length: count }, (_, index) => ({ cursor: String(from + index), text: text(from + index), truncated: false }));

describe('[log view] server console entries', () => {
  test('ids increase down the buffer, including a merged tail placed on top', () => {
    const buffer = new ConsoleBuffer();
    buffer.append(lines(100, 2));
    buffer.gap('c');
    buffer.append(lines(200, 1));
    buffer.merge(lines(0, 2));
    const ids = buffer.entries.map((entry) => entry.id);
    expect(buffer.entries.map((entry) => entry.kind === 'gap' ? 'gap' : entry.cursor)).toEqual(['0', '1', 'gap', '100', '101', 'gap', '200']);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort((a, b) => a - b)).toEqual(ids);
  });

  test('maps lines through the log parser, keeps truncation, and labels gaps', () => {
    const buffer = new ConsoleBuffer();
    buffer.append([{ cursor: '1', text: '[18:42:12] [Server thread/WARN]: Can\'t keep up!', truncated: true }]);
    buffer.gap('x');
    buffer.append([{ cursor: '2', text: 'plain output', truncated: false }]);
    const [warn, gap, plain] = toLogEntries(buffer.entries, gapCopy, new WeakMap());
    expect(warn).toMatchObject({ kind: 'line', id: 0, level: 'WARN', thread: 'Server thread', timestamp: '18:42:12', truncated: true });
    expect(gap).toEqual({ kind: 'gap', id: 1, label: 'Lines skipped', detail: 'See latest.log' });
    expect(plain).toMatchObject({ kind: 'line', id: 2, level: 'UNKNOWN', message: 'plain output', truncated: false });
  });

  test('parses each buffer entry once', () => {
    const buffer = new ConsoleBuffer();
    buffer.append(lines(0, 3));
    const cache = new WeakMap();
    const first = toLogEntries(buffer.entries, gapCopy, cache);
    buffer.append(lines(3, 1));
    const second = toLogEntries(buffer.entries, gapCopy, cache);
    expect(second.slice(0, 3)).toEqual(first);
    expect(second[0]).toBe(first[0]);
    expect(second).toHaveLength(4);
  });
});

describe('[log view] filters and counts', () => {
  const entries = [
    parseLog('[10:00:00] [main/INFO]: starting', 0),
    parseLog('[10:00:01] [main/WARN]: slow', 1),
    { kind: 'gap', id: 2, label: 'Lines skipped' },
    parseLog('[10:00:02] [main/FATAL]: crashed', 3),
    parseLog('unparsed text', 4),
  ];

  test('level counts exclude gap markers and fold FATAL into ERROR', () => {
    expect(levelCounts(entries)).toEqual({ INFO: 1, WARN: 1, ERROR: 1, UNKNOWN: 1 });
    expect(lineTotal(entries)).toBe(4);
  });

  test('gaps pass level and text filters but respect the cleared-display boundary', () => {
    expect(filterLog(entries, 0, ['ERROR'], '').map((entry) => entry.id)).toEqual([2, 3, 4]);
    expect(filterLog(entries, 0, ['INFO', 'WARN', 'ERROR', 'DEBUG'], 'slow').map((entry) => entry.id)).toEqual([1, 2]);
    expect(filterLog(entries, 3, ['INFO', 'WARN', 'ERROR', 'DEBUG'], '').map((entry) => entry.id)).toEqual([3, 4]);
    expect(filterLog(entries, -Infinity, [], 'zzz').map((entry) => entry.id)).toEqual([2]);
  });

  test('copied text keeps gaps visible', () => {
    expect(logText(entries.slice(1, 4))).toBe('[10:00:01] [main/WARN]: slow\n--- Lines skipped ---\n[10:00:02] [main/FATAL]: crashed');
  });
});
