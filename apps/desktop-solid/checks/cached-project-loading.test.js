import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

test('overlapping page warmups await the same local metadata reply before fetching providers', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'vesta-cached-projects-'));
  const key = `projectCache${crypto.randomUUID().replaceAll('-', '')}`;
  const state = { calls: [], replies: [] }; globalThis[key] = state;
  try {
    const build = await Bun.build({ entrypoints: [fileURLToPath(new URL('../src/features/browse/cached-project-records.ts', import.meta.url))], target: 'bun',
      plugins: [{ name: 'cache-host', setup(builder) {
        builder.onLoad({ filter: /native-service\.ts$/ }, () => ({ loader: 'js', contents: 'export const nativeInstances = true;' }));
        builder.onLoad({ filter: /@tauri-apps[\\/]api[\\/]core\.(js|ts)$/ }, () => ({ loader: 'js', contents: `const state=globalThis[${JSON.stringify(key)}];export const invoke=(_command,args)=>{state.calls.push(args);return new Promise((resolve,reject)=>state.replies.push({resolve,reject}));};` }));
        builder.onResolve({ filter: /^solid-js$/ }, () => ({ path: 'solid', namespace: 'fake' }));
        builder.onLoad({ filter: /.*/, namespace: 'fake' }, () => ({ loader: 'js', contents: 'export const createSignal=initial=>{let value=initial;return [()=>value,next=>value=typeof next==="function"?next(value):next];};' }));
      } }] });
    if (!build.success) throw new AggregateError(build.logs);
    const path = join(dir, 'check.mjs'); await Bun.write(path, build.outputs[0]);
    const api = await import(pathToFileURL(path).href);
    const wanted = new Map([['modrinth', ['one', 'two']]]);
    const first = api.loadCachedProjects(wanted);
    let resolved = false;
    const second = api.loadCachedProjects(wanted).then(() => { resolved = true; });
    await Promise.resolve(); expect(resolved).toBe(false); expect(state.calls).toHaveLength(1);
    state.replies.shift().resolve([{ id: 'one', source: 'modrinth', name: 'Cached project', icon_url: 'https://example.test/icon.png' }]);
    await Promise.all([first, second]);
    expect(api.peekCachedProject('modrinth', 'one').name).toBe('Cached project');
    await api.loadCachedProjects(wanted); expect(state.calls).toHaveLength(1);
    const retry = new Map([['modrinth', ['retry']]]);
    const failed = api.loadCachedProjects(retry); await Promise.resolve(); state.replies.shift().reject(Error('busy')); await failed;
    const again = api.loadCachedProjects(retry); await Promise.resolve(); expect(state.calls).toHaveLength(3);
    state.replies.shift().resolve([]); await again;
  } finally { delete globalThis[key]; await rm(dir, { recursive: true, force: true }); }
});
