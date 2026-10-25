import { expect, test } from 'bun:test';
import { activityPageRows } from '../src/features/servers/operations-model';
import { compareGameVersions } from '../src/features/browse/browse-model';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const operation = (id, createdAtMs, updatedAtMs = createdAtMs, state = 'running') => ({ operationId: id, createdAtMs, updatedAtMs, state });

test('activity keeps page boundaries, shows newly accepted tasks, and updates terminal outcomes', () => {
  const page = [operation('a', 30), operation('b', 20)];
  const live = [operation('new', 40), operation('a', 30, 50, 'failed'), operation('older', 10)];
  const rows = activityPageRows(page, live, true);
  expect(rows.map(row => row.operationId)).toEqual(['new', 'a', 'b']);
  expect(rows[1].state).toBe('failed');
  expect(activityPageRows(page, live, false).map(row => row.operationId)).toEqual(['a', 'b']);
  expect(activityPageRows([], live, true)).toHaveLength(3);
  expect(activityPageRows([], live, false)).toEqual([]);
  expect(activityPageRows([operation('a', 30, 60, 'succeeded')], live, false)[0].state).toBe('succeeded');
});

test('Minecraft releases sort newest first across multi-digit components and year-based versions', () => {
  expect(['1.19.4', '1.20.6', '1.21.8', '1.21.11', '26.1.2', '26.3', '26.2']
    .sort((a, b) => compareGameVersions(b, a)))
    .toEqual(['26.3', '26.2', '26.1.2', '1.21.11', '1.21.8', '1.20.6', '1.19.4']);
});

test('English UI copy contains no em dashes', () => {
  const directory = fileURLToPath(new URL('../src/localization/locales/en/', import.meta.url));
  for (const file of readdirSync(directory).filter(file => file.endsWith('.ftl'))) {
    expect(readFileSync(directory + '/' + file, 'utf8').includes('\u2014')).toBe(false);
  }
});
