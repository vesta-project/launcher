import { describe, expect, test } from 'bun:test';
import { filterLog, groupLogEntries, levelCounts, lineTotal, logText } from '../src/components/log-view/log-model';
import { ConsoleBuffer } from '../src/features/servers/console-model';
import { toLogEntries } from '../src/features/servers/console-view';
import { parseLog } from '../src/features/instances/interaction-utils';

const gapCopy = { label: 'Lines skipped', detail: 'See latest.log' };
const lines = (from, count, text = (n) => `[12:00:0${n % 10}] [Server thread/INFO]: line ${n}`) =>
  Array.from({ length: count }, (_, index) => ({ cursor: String(from + index), text: text(from + index), truncated: false }));

describe('[log view] multiline grouping', () => {
  test('all unprefixed lines inherit the entry level before filtering and counting', () => {
    const raw = [
      'standalone output',
      '[10:00:00] [main/ERROR]: java.lang.OutOfMemoryError: Java heap space',
      '\tat net.minecraft.Main.run(Main.java:42)',
      'at launcher.Main.main(Main.java:1)',
      'Caused by: java.lang.IllegalStateException',
      '... 3 more',
      'additional diagnostic detail',
      '',
      '[10:00:01] [main/WARN]: recovering',
      '  recovery detail',
      '[10:00:02] [main/INFO]: ready',
      'ready detail',
    ];
    const source = raw.map(parseLog);
    const grouped = groupLogEntries(source);
    expect(grouped.map((entry) => entry.level)).toEqual([
      'UNKNOWN', 'ERROR', 'ERROR', 'ERROR', 'ERROR', 'ERROR', 'ERROR', 'ERROR',
      'WARN', 'WARN', 'INFO', 'INFO',
    ]);
    expect(filterLog(grouped, 0, ['ERROR'], '').map((entry) => entry.id)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(levelCounts(grouped)).toEqual({ UNKNOWN: 1, ERROR: 7, WARN: 2, INFO: 2 });
    expect(logText(grouped)).toBe(raw.join('\n'));
    expect(source[2].level).toBe('UNKNOWN');
  });

  test('gaps and parsed headers stop inheritance, including unknown levels', () => {
    const grouped = groupLogEntries([
      parseLog('[10:00:00] [main/FATAL]: failed', 0),
      parseLog('  detail', 1),
      { kind: 'gap', id: 2, label: 'Skipped' },
      parseLog('  after gap', 3),
      parseLog('[10:00:01] [main/TRACE]: tracing', 4),
      parseLog('  trace detail', 5),
    ]);
    expect(grouped.map((entry) => entry.level)).toEqual(['FATAL', 'FATAL', undefined, 'UNKNOWN', 'UNKNOWN', 'UNKNOWN']);
    expect(levelCounts(grouped)).toEqual({ ERROR: 2, UNKNOWN: 3 });
  });

  test('new output reuses existing continuation rows and a trimmed header resets inheritance', () => {
    const header = parseLog('[10:00:00] [main/ERROR]: failed', 0);
    const trace = parseLog('  stack frame', 1);
    const next = parseLog('[10:00:01] [main/INFO]: ready', 2);
    const cache = new WeakMap();
    const before = groupLogEntries([header, trace], cache);
    const after = groupLogEntries([header, trace, next], cache);
    expect(after[1]).toBe(before[1]);
    expect(groupLogEntries([trace, next], cache)[0]).toBe(trace);
    expect(filterLog(after, 0, ['INFO', 'WARN', 'ERROR', 'DEBUG'], '')).toBe(after);
  });
});

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
