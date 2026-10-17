import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

async function harness(run) {
  const directory = await mkdtemp(join(tmpdir(), 'vesta-linked-pack-'));
  const key = `linkedPack${crypto.randomUUID().replaceAll('-', '')}`;
  const c = { calls: [], cleanups: [], record: { id: 7, name: 'Old instance', minecraftVersion: '1.21.1',
    modloader: 'fabric', modpackId: 'project', modpackVersionId: 'uQxD0ENB', modpackPlatform: 'modrinth' },
    versions: [{ id: 'uQxD0ENB', version_number: 'Pack 2.0', game_versions: ['1.21.1'], loaders: ['mrpack', 'fabric'], release_type: 'release' },
      { id: 'next', version_number: 'Pack 3.0', game_versions: ['1.21.1'], loaders: ['fabric'], release_type: 'release' }] };
  globalThis[key] = c;
  const fixtures = {
    '@tauri-apps/api/core': `export const invoke = async (command, args) => {
      c.calls.push({ command, args });
      if (command === 'get_resource_versions') return c.versions;
      if (command === 'get_resource_project') { if (!args.id) throw Error('missing id'); if(c.failProject) throw Error('offline'); return {name: 'Provider pack'}; }
    };`,
    '@tauri-apps/api/event': 'export const listen = async () => () => {};',
    'solid-js': `export const onSettled = fn => c.cleanups.push(fn());
      export const createSignal = initial => { let value = initial; return [() => value, next => value = typeof next === 'function' ? next(value) : next]; };`,
    './native-service': `export const nativeInstances = true, nativeRecord = () => c.record,
      displayImage = () => '', performNative = () => {}, reportInstanceError = () => {}, changeNativeEngine = () => {};`,
    './metadata': 'export const metadata = () => undefined, minecraftVersionIds = () => [], loaderVersions = () => [];',
    './details': 'export const unlinkBundledResources = () => {};',
    './catalog': `export const findInstance = () => ({instance: c.record}), editInstance = () => {}, retryInstance = () => {};`,
  };
  try {
    const built = await Bun.build({ entrypoints: [new URL('../src/features/instances/versions.ts', import.meta.url).pathname], target: 'bun',
      plugins: [{name: 'native-pack-boundaries', setup(build) {
        build.onResolve({ filter: /.*/ }, ({path}) => path in fixtures ? {path, namespace: 'fixture'} : undefined);
        build.onLoad({filter: /.*/, namespace: 'fixture'}, ({path}) => ({loader: 'js', contents: `const c = globalThis[${JSON.stringify(key)}];` + fixtures[path]}));
      }}] });
    if (!built.success) throw new AggregateError(built.logs, 'Linked pack harness failed');
    const output = join(directory, 'fixture.mjs'); await Bun.write(output, built.outputs[0]);
    await run(await import(pathToFileURL(output).href), c);
  } finally {
    for (const cleanup of c.cleanups) cleanup?.();
    delete globalThis[key]; await rm(directory, {recursive: true, force: true});
  }
}
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

test('existing linked packs load all releases and resolve installed names using the host id argument', () => harness(async (api, c) => {
  api.useNativePack('7'); await settle();
  expect(c.calls.find(call => call.command === 'get_resource_project').args).toEqual({platform: 'modrinth', id: 'project'});
  expect(api.versionStore('7').state().pack).toMatchObject({ name: 'Provider pack', installedLabel: 'Pack 2.0', releases: [{label: 'Pack 2.0'}, {label: 'Pack 3.0'}] });
}));
test('failed project enrichment retains releases and uses the instance name', () => harness(async (api, c) => {
  c.failProject = true; api.useNativePack('7'); await settle();
  expect(api.versionStore('7').state().pack).toMatchObject({ name: 'Old instance', installedLabel: 'Pack 2.0' });
  expect(api.versionStore('7').state().pack.releases).toHaveLength(2);
}));
test('malformed old links do not invoke remote commands without a project id', () => harness(async (api, c) => {
  c.record.modpackId = undefined; api.useNativePack('7'); await settle();
  expect(api.versionStore('7').state().pack).toBeUndefined();
  await api.releaseChangelog('Modrinth', undefined, 'uQxD0ENB');
  expect(c.calls).toEqual([]);
}));
