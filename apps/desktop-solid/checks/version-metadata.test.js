import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { indexMetadata } from '../src/features/instances/metadata-index';
import { boundOptions } from '../ui/components/combobox/options';

const game = (id, stable, loaders = {}) => ({ id, stable, version_type: stable ? 'release' : 'snapshot',
  loaders: Object.fromEntries(Object.entries(loaders).map(([key, values]) => [key, values.map(version => ({version, stable: true}))])) });
const payload = { game_versions: [game('snapshot', false, {fabric: ['f2', 'f1']}), game('release', true, {fabric: ['f2'], forge: ['g2', 'g1']}), game('legacy', true)],
  latest: {release: 'release', snapshot: 'snapshot'} };

test('metadata indexes compatibility once and preserves order and array identity', () => {
  const indexed = indexMetadata(payload);
  expect(indexed.loaderVersions('release', 'forge')).toEqual(['g2', 'g1']);
  expect(indexed.loaderVersions('release', 'forge')).toBe(indexed.loaderVersions('release', 'forge'));
  expect(indexed.loaderVersions('missing', 'fabric')).toEqual([]);
  expect(indexed.loaderVersions('release', 'neoforge')).toEqual([]);
  expect(indexed.gameVersions('fabric', false).map(game => game.id)).toEqual(['release']);
  expect(indexed.gameVersions('fabric', true).map(game => game.id)).toEqual(['snapshot', 'release']);
  expect(indexed.gameVersions('vanilla', false).map(game => game.id)).toEqual(['release', 'legacy']);
  expect(indexed.gameVersions('vanilla', true)).toBe(payload.game_versions);
  expect(indexed.gameVersions('forge', false)).toBe(indexed.gameVersions('forge', false));
  expect(indexed.gameVersions('missing', true)).toEqual([]);
});

test('bounded pickers search beyond the first page and retain the selected label', () => {
  const options = Array.from({length: 3000}, (_, value) => ({value: String(value)}));
  expect(boundOptions(options, () => true, options[2999], 80)).toEqual([...options.slice(0, 80), options[2999]]);
  expect(boundOptions(options, option => option.value === '2500', options[2999], 80)).toEqual([options[2500], options[2999]]);
  expect(boundOptions(options, () => false, undefined, 80)).toEqual([]);
  expect(boundOptions(options, () => true, options[0], 80)).toHaveLength(80);
  expect(boundOptions(options, () => true, undefined, undefined)).toBe(options);
});

// Real metadata service and RequestCache; inert host only, no browser or rendering.
async function metadataHarness() {
  const file = new URL('../src/features/instances/metadata.ts', import.meta.url).pathname;
  const built = await Bun.build({entrypoints: [file], target: 'bun', conditions: ['browser', 'development'], plugins: [{
    name: 'metadata-host', setup(build) {
      build.onResolve({filter: /^\.\.\/\.\.\/localization$/}, () => ({path: 'localization', namespace: 'fixture'}));
      build.onResolve({filter: /^\.\/native-service$/}, () => ({path: 'native', namespace: 'fixture'}));
      build.onResolve({filter: /^@tauri-apps\/api\/core$/}, () => ({path: 'core', namespace: 'fixture'}));
      build.onLoad({filter: /.*/, namespace: 'fixture'}, ({path}) => ({loader: 'js', contents: path === 'localization' ? 'export const t = id => id;' : path === 'native'
        ? 'export const nativeInstances = true;'
        : 'let handler; export const setInvoke = next => handler = next; export const invoke = (...args) => handler(...args);'}));
      build.onLoad({filter: /instances\/metadata\.ts$/}, async ({path}) => ({loader: 'ts', contents: await Bun.file(path).text() +
        '\nexport {cache}; export {flush} from "solid-js"; export {setInvoke} from "@tauri-apps/api/core";'}));
    }
  }]});
  if (!built.success) throw new AggregateError(built.logs);
  const directory = await mkdtemp(join(tmpdir(), 'vesta-metadata-'));
  try {
    const file = join(directory, 'metadata.mjs');
    await Bun.write(file, built.outputs[0]);
    return await import(pathToFileURL(file).href);
  } finally {await rm(directory, {recursive: true, force: true});}
}

test('screens share one indexed request and retain stale data through refresh failures', async () => {
  const service = await metadataHarness();
  let calls = 0, complete;
  service.setInvoke(command => {
    expect(command).toBe('get_minecraft_versions'); calls++;
    return new Promise(resolve => {complete = resolve;});
  });
  const first = service.loadMetadata(), second = service.loadMetadata();
  await Promise.resolve();
  expect(calls).toBe(1);
  complete(payload);
  await Promise.all([first, second]); service.flush();
  const list = service.loaderVersions('release', 'fabric');
  await service.loadMetadata(); service.flush();
  expect(calls).toBe(1);
  expect(service.loaderVersions('release', 'fabric')).toBe(list);
  service.cache.invalidate('minecraft');
  const refresh = service.loadMetadata(); await Promise.resolve();
  expect(service.metadata()).toBe(payload);
  expect(service.loaderVersions('release', 'fabric')).toBe(list);
  complete({...payload, latest: {release: 'new', snapshot: 'snapshot'}});
  await refresh; service.flush();
  expect(service.metadata().latest.release).toBe('new');
  service.cache.invalidate('minecraft');
  service.setInvoke(() => Promise.reject(new Error('offline')));
  await service.loadMetadata(); service.flush();
  expect(service.metadata().latest.release).toBe('new');
  expect(service.metadataError()).toContain('offline');
});
