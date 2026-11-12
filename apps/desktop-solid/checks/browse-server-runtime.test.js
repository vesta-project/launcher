import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

test('picker software is available from summary or software cache before live inventory settles', async () => {
  const key = `runtime${crypto.randomUUID().replaceAll('-', '')}`;
  const state = { cache: new Map(), reads: 0 };
  globalThis[key] = state;
  const built = await Bun.build({
    entrypoints: [fileURLToPath(new URL('../src/features/browse/server-install.ts', import.meta.url))],
    target: 'bun', conditions: ['browser', 'development'],
    plugins: [{ name: 'runtime-host', setup(build) {
      const stub = (filter, contents) => build.onLoad({ filter }, () => ({ loader: 'js', contents }));
      stub(/features[\\/]servers[\\/]resources\.ts$/, `
        const state = globalThis[${JSON.stringify(key)}];
        export const peekServerResource = (id, def, args) => state.cache.get(def.name + ':' + args);
        export const readServerResource = () => { state.reads++; return new Promise(() => {}); };
        export const invalidateServerResources = () => {};`);
      stub(/features[\\/]servers[\\/]server-resources\.ts$/, `export const contentResource = {name:'content'}, softwareResource = {name:'software'}, CONTENT_RESOURCES = [];`);
      stub(/features[\\/]servers[\\/]store\.ts$/, `export const serverCommand = () => { throw new Error('unexpected live command'); };`);
      stub(/features[\\/]browse[\\/]browse-api\.ts$/, `export const fetchProjects = async () => [];`);
    } }],
  });
  if (!built.success) throw new AggregateError(built.logs);
  const directory = await mkdtemp(join(tmpdir(), 'vesta-runtime-'));
  try {
    const path = join(directory, 'check.mjs');
    await Bun.write(path, built.outputs[0]);
    const api = await import(pathToFileURL(path).href);
    state.cache.set('software:undefined', {current:{software:'fabric'}});
    expect(api.cachedServerSoftware('dev-server')).toBe('fabric');
    expect(state.reads).toBe(0);
    state.cache.set('content:true', {software:'quilt'});
    expect(api.cachedServerSoftware('dev-server')).toBe('quilt');
    void api.serverSoftware('dev-server');
    expect(state.reads).toBe(1);
    expect(api.cachedServerSoftware('dev-server')).toBe('quilt');
  } finally { delete globalThis[key]; await rm(directory, {recursive:true, force:true}); }
});
