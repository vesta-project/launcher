import { expect, test } from 'bun:test';
import { ConsoleBuffer } from '../src/features/servers/console-model';

const line = (cursor, text = cursor) => ({ cursor, text, truncated: false });

test('older history goes on top, keeps ids increasing and skips lines already shown', () => {
  const buffer = new ConsoleBuffer(3);
  buffer.append([line('s.console.10'), line('s.console.11')]);
  expect(buffer.prepend([line('disk.1'), line('disk.2'), line('s.console.10')])).toBe(2);
  expect(buffer.entries.map((entry) => entry.cursor)).toEqual(['disk.1', 'disk.2', 's.console.10', 's.console.11']);
  const ids = buffer.entries.map((entry) => entry.id);
  expect([...ids].sort((a, b) => a - b)).toEqual(ids);
  expect(new Set(ids).size).toBe(ids.length);
});

test('scrolled-in history sits above the live limit until live output pushes it out', () => {
  const buffer = new ConsoleBuffer(2);
  buffer.append([line('s.console.1'), line('s.console.2')]);
  buffer.prepend([line('disk.1'), line('disk.2')]);
  expect(buffer.entries.length).toBe(4);
  buffer.append([line('s.console.3')]);
  expect(buffer.entries.map((entry) => entry.cursor)).toEqual(['disk.2', 's.console.1', 's.console.2', 's.console.3']);
  buffer.clear();
  expect(buffer.older).toBeUndefined();
});

test('a gap at the end goes once the newest line is shown; interior gaps report where they end', () => {
  const buffer = new ConsoleBuffer(50);
  buffer.append([line('s.console.1'), line('s.console.2')]);
  buffer.gap('resync');
  expect(buffer.settleTail('s.console.5')).toBe(false);
  expect(buffer.settleTail('s.console.2')).toBe(true);
  expect(buffer.entries.at(-1).kind).toBe('line');
  buffer.gap('s.console.9');
  buffer.append([line('s.console.9')]);
  expect(buffer.gapEnd()).toBe('s.console.9');
  // The missing lines come back from history and the marker closes.
  buffer.merge([line('s.console.3'), line('s.console.4'), line('s.console.5'), line('s.console.6'), line('s.console.7'), line('s.console.8')]);
  expect(buffer.entries.some((entry) => entry.kind === 'gap')).toBe(false);
  expect(buffer.gapEnd()).toBeUndefined();
});
