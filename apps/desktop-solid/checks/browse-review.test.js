import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
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

// A fresh copy of the Browse store per test, with search answered by the test itself.
async function mountStore(run) {
  const directory = await mkdtemp(join(tmpdir(), 'vesta-browse-review-'));
  const fixtures = {
    '../../localization': 'export const t = (id) => id;',
    '../../app/router': 'export const navigate = () => {};',
    '../instances/catalog': `export const findInstance = (id) => id ? ({instance: {
      id: '7', name: 'Vanilla', minecraftVersion: '1.21.1', modloader: 'vanilla'
    }}) : undefined;`,
    // Search is answered by whatever the test put on globalThis, so each test controls its own responses.
    './browse-api': `export const searchResources = (source, query) => globalThis.__browseSearch(source, query);
      export const fetchCategories = async () => [], fetchInstalled = async () => [],
        installResource = async () => '', onInstallEvents = async () => {};`,
    './browse-projects': 'export const loadVersions = async () => [], seedProjects = () => {};',
  };
  try {
    const built = await Bun.build({
      entrypoints: [fileURLToPath(new URL('../src/features/browse/browse-store.ts', import.meta.url))],
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
    globalThis.__browseSearch = async () => ({ hits: [], total_hits: 0 });
    await run(await import(pathToFileURL(path).href));
  } finally {
    delete globalThis.__browseSearch;
    await rm(directory, { recursive: true, force: true });
  }
}

const page = (name) => ({ hits: [{ source: 'modrinth', id: name, resource_type: 'mod', categories: [] }], total_hits: 1 });

test('retained result install state uses project type while a different type loads', () => mountStore(async (store) => {
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
  store.replaceText('sodium');
  await Promise.resolve();
  expect(store.query().text).toBe('sodium');
  store.replaceText('');
  await Promise.resolve();
  expect(store.query().text).toBe('');
}));

// Store writes land on the next turn of the event loop, so each step waits one before it reads.
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test('a cold query drops to loading at once; a cached one comes back without it', () => mountStore(async (store) => {
  let answer;
  globalThis.__browseSearch = () => new Promise((resolve) => { answer = resolve; });

  const first = store.loadResults(store.query());
  await tick();
  expect(store.pending()).toBe(true);
  answer(page('warm'));
  await first;
  await tick();
  expect(store.visibleBrowseResults().hits[0].id).toBe('warm');
  expect(store.pending()).toBe(false);

  // Changing the query is enough: the old page stops being the shown one before any request.
  store.replaceText('cold');
  await tick();
  expect(store.visibleBrowseResults()).toBeUndefined();
  const second = store.loadResults(store.query());
  await tick();
  expect(store.pending()).toBe(true);
  expect(store.visibleBrowseResults()).toBeUndefined();
  answer(page('cold'));
  await second;
  await tick();
  expect(store.visibleBrowseResults().hits[0].id).toBe('cold');

  // Returning to a query already answered shows it immediately and asks for no loading state.
  store.replaceText('');
  await tick();
  expect(store.visibleBrowseResults().hits[0].id).toBe('warm');
  const third = store.loadResults(store.query());
  await tick();
  expect(store.pending()).toBe(false);
  await third;
  await tick();
  expect(store.visibleBrowseResults().hits[0].id).toBe('warm');
}));

test('hovering a type tab warms the page that selecting it will show', () => mountStore(async (store) => {
  const asked = [];
  globalThis.__browseSearch = (_source, query) => { asked.push(query); return Promise.resolve(page(`for-${asked.length}`)); };
  await store.loadResults(store.query());
  const before = asked.length;

  store.prefetchBrowseType('shader');
  await tick();
  expect(asked.length).toBe(before + 1);

  // Selecting the warmed tab has its page already, so nothing drops to loading.
  store.setType('shader');
  await tick();
  expect(store.visibleBrowseResults()).toBeDefined();
  await store.loadResults(store.query());
  await tick();
  expect(store.pending()).toBe(false);
  // The warmed request is reused rather than repeated.
  expect(asked.length).toBe(before + 1);

  // The tab already shown is never warmed again.
  store.prefetchBrowseType('shader');
  await tick();
  expect(asked.length).toBe(before + 1);
}));
