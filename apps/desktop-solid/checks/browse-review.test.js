import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isPopoverChild } from '../ui/components/overlay/popover-scope.ts';

// Test explicit ownership with an inert element Interface; no DOM or browser.
const targetIn = (owners) => ({ closest: () => owners === undefined ? null : ({
  getAttribute: () => owners,
}) });

test('popover outside exemption belongs only to its own portalled controls', () => {
  expect(isPopoverChild(targetIn('filter'), 'filter')).toBe(true);
  expect(isPopoverChild(targetIn('nested filter'), 'filter')).toBe(true);
  expect(isPopoverChild(targetIn('other'), 'filter')).toBe(false);
  expect(isPopoverChild(targetIn('filter-other'), 'filter')).toBe(false);
  // Unrelated tooltip, toast and dialog contents carry no ownership marker.
  expect(isPopoverChild(targetIn(undefined), 'filter')).toBe(false);
});

test('retained result install state uses project type while a different type loads', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vesta-browse-review-'));
  const fixtures = {
    '../../localization': 'export const t = (id) => id;',
    '../../app/router': 'export const navigate = () => {};',
    '../instances/catalog': `export const findInstance = (id) => id ? ({instance: {
      id: '7', name: 'Vanilla', minecraftVersion: '1.21.1', modloader: 'vanilla'
    }}) : undefined;`,
    './browse-api': `export const fetchCategories = async () => [], fetchInstalled = async () => [],
      installResource = async () => '', onInstallEvents = async () => {}, searchResources = async () => ({hits: [], total_hits: 0});`,
    './browse-projects': 'export const loadVersions = async () => [], seedProjects = () => {};',
  };
  try {
    const built = await Bun.build({
      entrypoints: [new URL('../src/features/browse/browse-store.ts', import.meta.url).pathname],
      target: 'bun', conditions: ['browser', 'development'],
      plugins: [{ name: 'browse-state-boundaries', setup(build) {
        build.onResolve({ filter: /^(\.\.\/\.\.\/app\/router|\.\.\/\.\.\/localization|\.\.\/instances\/catalog|\.\/browse-api|\.\/browse-projects)$/ },
          ({ path }) => ({ path, namespace: 'fixture' }));
        build.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ contents: fixtures[path], loader: 'js' }));
      } }],
    });
    if (!built.success) throw new AggregateError(built.logs, 'Browse state harness failed');
    const path = join(directory, 'store.mjs');
    await Bun.write(path, built.outputs[0]);
    const store = await import(pathToFileURL(path).href);
    expect(store.installState({ source: 'modrinth', id: 'mod', resource_type: 'mod', categories: ['fabric'] }))
      .toEqual({ kind: 'install' });
    store.setType('resourcepack');
    store.syncTarget('7');
    await Promise.resolve();
    expect(store.installState({ source: 'modrinth', id: 'mod', resource_type: 'mod', categories: ['fabric'] }))
      .toEqual({ kind: 'unavailable', reason: 'vanilla' });
    expect(store.installState({ source: 'modrinth', id: 'pack', resource_type: 'modpack', categories: [] }))
      .toEqual({ kind: 'install' });
    expect(store.installState({ source: 'modrinth', id: 'data', resource_type: 'datapack', categories: [] }))
      .toEqual({ kind: 'install' });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
