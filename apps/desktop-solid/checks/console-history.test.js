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
