import { describe, expect, test } from 'bun:test';
import { ConsoleBuffer, clearConsoleDisplay, consoleDisplayBoundary } from '../src/features/servers/console-model';
import { toLogEntries } from '../src/features/servers/console-view';

const lines = (start, count, scope = 'run.console.') => Array.from({ length: count }, (_, i) => ({
  cursor: `${scope}${start + i}`, text: `line ${start + i}`, truncated: false,
}));
const cursors = (buffer) => buffer.entries.filter((entry) => entry.kind === 'line').map((entry) => entry.cursor);

describe('console recovery at the retention bound', () => {
  test('an older page cannot displace a full live tail', () => {
    const buffer = new ConsoleBuffer(5);
    buffer.append(lines(100, 5));
    buffer.merge(lines(98, 4));
    expect(cursors(buffer)).toEqual(lines(100, 5).map((line) => line.cursor));
    expect(buffer.entries).toHaveLength(5);
  });

  test('a recovery page spanning both sides retains the newest lines after ordering', () => {
    const buffer = new ConsoleBuffer(5);
    buffer.append(lines(100, 5));
    buffer.merge(lines(98, 9));
    expect(cursors(buffer)).toEqual(lines(102, 5).map((line) => line.cursor));
    expect(buffer.entries).toHaveLength(5);
    expect(new Set(buffer.entries.map((entry) => entry.id)).size).toBe(5);
  });

  test('duplicate cursors within a recovery page are retained once', () => {
    const buffer = new ConsoleBuffer(8);
    buffer.append(lines(100, 2));
    const page = lines(98, 5);
    buffer.merge([page[0], page[0], ...page.slice(1), page[4]]);
    expect(cursors(buffer)).toEqual(lines(98, 5).map((line) => line.cursor));
    expect(buffer.append(lines(102, 1))).toBe(0);
  });

  test('a genuine gap still consumes capacity and keeps monotonically ordered ids', () => {
    const buffer = new ConsoleBuffer(5);
    buffer.append(lines(100, 3));
    buffer.gap('later');
    buffer.append(lines(110, 1));
    buffer.merge(lines(99, 3));
    expect(buffer.entries.map((entry) => entry.kind === 'gap' ? 'gap' : entry.cursor))
      .toEqual(['run.console.100', 'run.console.101', 'run.console.102', 'gap', 'run.console.110']);
    const ids = buffer.entries.map((entry) => entry.id);
    expect([...ids].sort((a, b) => a - b)).toEqual(ids);
  });

  test('reordered entries leave cached objects immutable and parsed ids agree with buffer ids', () => {
    const buffer = new ConsoleBuffer(8);
    buffer.append(lines(100, 2));
    const cache = new WeakMap();
    const copy = { label: 'gap' };
    const oldEntries = buffer.entries.slice();
    const oldRows = toLogEntries(buffer.entries, copy, cache);
    buffer.merge(lines(98, 5));
    const rows = toLogEntries(buffer.entries, copy, cache);
    expect(rows.map((row) => row.id)).toEqual(buffer.entries.map((entry) => entry.id));
    expect(oldEntries.map((entry) => entry.id)).toEqual(oldRows.map((row) => row.id));
  });

  test('clear stays cleared through recovery; only subsequent output is visible', () => {
    const buffer = new ConsoleBuffer(8);
    buffer.append(lines(100, 2));
    buffer.gap('tail');
    const boundary = clearConsoleDisplay(buffer.entries);
    buffer.merge(lines(98, 4));
    expect(buffer.entries.filter((entry) => entry.id >= consoleDisplayBoundary(buffer.entries, boundary))).toEqual([]);
    buffer.append(lines(102, 2));
    expect(buffer.entries.filter((entry) => entry.id >= consoleDisplayBoundary(buffer.entries, boundary)).map((entry) => entry.cursor))
      .toEqual(['run.console.102', 'run.console.103']);
    buffer.append(lines(0, 2, 'next.console.'));
    expect(buffer.entries.filter((entry) => entry.id >= consoleDisplayBoundary(buffer.entries, boundary)).map((entry) => entry.cursor))
      .toEqual(['run.console.102', 'run.console.103', 'next.console.0', 'next.console.1']);
  });

  test('clear handles an evicted boundary and leaves a new generation visible', () => {
    const buffer = new ConsoleBuffer(3);
    buffer.append(lines(100, 3));
    const boundary = clearConsoleDisplay(buffer.entries);
    buffer.merge(lines(101, 5));
    expect(buffer.entries.filter((entry) => entry.id >= consoleDisplayBoundary(buffer.entries, boundary))).toEqual(buffer.entries);
    buffer.append(lines(0, 3, 'next.console.'));
    expect(buffer.entries.filter((entry) => entry.id >= consoleDisplayBoundary(buffer.entries, boundary))).toEqual(buffer.entries);
  });

  test('u64 cursors above the safe integer boundary stay distinct and ordered', () => {
    const buffer = new ConsoleBuffer(8);
    const start = 18_446_744_073_709_551_610n;
    const page = Array.from({ length: 5 }, (_, i) => ({ cursor: `run.console.${start + BigInt(i)}`, text: String(i), truncated: false }));
    buffer.append(page.slice(2));
    const boundary = clearConsoleDisplay(buffer.entries);
    buffer.merge(page);
    expect(cursors(buffer)).toEqual(page.map((line) => line.cursor));
    expect(consoleDisplayBoundary(buffer.entries, boundary)).toBe(Infinity);
  });

  test('opaque recovery pages also deduplicate within the page and retain their gap', () => {
    const buffer = new ConsoleBuffer(8);
    buffer.append([{ cursor: 'live', text: 'live', truncated: false }]);
    const older = { cursor: 'older', text: 'older', truncated: false };
    expect(buffer.merge([older, older])).toBe(1);
    expect(buffer.entries.map((entry) => entry.kind === 'gap' ? 'gap' : entry.cursor)).toEqual(['older', 'gap', 'live']);
  });

  test('an older or duplicate page cannot erase an unresolved trailing discontinuity', () => {
    const buffer = new ConsoleBuffer(8);
    buffer.append(lines(100, 2));
    buffer.gap('resync:lost');
    buffer.merge(lines(100, 2));
    expect(buffer.entries.at(-1).kind).toBe('gap');
    buffer.merge(lines(98, 4));
    expect(buffer.entries.at(-1).kind).toBe('gap');
    buffer.merge(lines(100, 3));
    expect(buffer.entries.map((entry) => entry.kind)).toEqual(Array(5).fill('line'));
  });
});
