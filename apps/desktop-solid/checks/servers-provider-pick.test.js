import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Exercise the dialog's real setup and effects without its DOM-only presentation.
async function harness(run) {
  const directory = await mkdtemp(join(tmpdir(), 'vesta-provider-pick-'));
  if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith('vesta-provider-pick-')) throw Error('Unexpected temporary directory');
  const key = `providerPick${crypto.randomUUID().replaceAll('-', '')}`;
  const calls = { loads: [], reviews: [], closes: [], opens: 0, imports: [] };
  globalThis[key] = calls;
  try {
    const original = await readFile(new URL('../src/pages/servers/pack/provider-pick.tsx', import.meta.url), 'utf8');
    const setup = original.slice(0, original.lastIndexOf('  return (')).replace(/^import .*;\r?\n/gm, '');
    const contents = `
      import { createRoot, createSignal, createMemo, createEffect, onCleanup, untrack, flush } from 'solid-js';
      export { captureArtifact, expectNoDiagnostics } from '@solidjs/diagnostics';
      export { createRoot, untrack, flush };
      const calls = globalThis[${JSON.stringify(key)}];
      class IntentMemo { idFor() { return 'intent'; } settle() {} }
      const [versions, setVersions] = createSignal([], { name: 'provider-pick-test:versions' });
      const loadVersions = () => new Promise((resolve, reject) => calls.loads.push({ resolve: rows => { setVersions(rows); resolve(); }, reject }));
      const peekVersions = () => versions();
      const pickProviderVersion = rows => rows[0];
      const linkProvider = () => null;
      const serverCommand = run => run({ packImport: async (...args) => { calls.imports.push(args); return {revision:'8',manifest:{}}; } });
      const clearModpackPick = id => calls.closes.push(id);
      const useModpackArea = () => ({
        id: () => 'server',
        workspace: () => ({ serverMinecraftVersion: '1.21.1', draft: { revision: '7', manifest: {} } }),
        applyDraft: () => {}, open: () => {},
        link: () => ({ phase: 'unlinked', canChange: true }),
        gates: () => ({ installOnServer: true, edit: true }),
        openServer: () => { calls.opens++; },
        startInstall: review => calls.reviews.push(review),
      });
      ${setup}
        return { loading, failed, chosen, load, go };
      }
    `;
    const build = await Bun.build({ entrypoints: ['provider-pick-check'], target: 'bun', conditions: ['browser', 'development'], plugins: [{ name: 'provider-pick-check', setup(build) {
      build.onResolve({ filter: /^provider-pick-check$/ }, () => ({ path: 'check', namespace: 'provider-check' }));
      build.onLoad({ filter: /.*/, namespace: 'provider-check' }, () => ({ loader: 'ts', resolveDir: fileURLToPath(new URL('..', import.meta.url)), contents }));
    } }] });
    if (!build.success) throw new AggregateError(build.logs);
    const output = join(directory, 'check.mjs'); await Bun.write(output, build.outputs[0]);
    const api = await import(pathToFileURL(output).href);
    const { artifact } = await api.captureArtifact(() => run(api, calls), { scenario: 'provider-picker-open-retry-and-review' });
    api.expectNoDiagnostics(artifact);
  } finally {
    delete globalThis[key];
    await rm(directory, { recursive: true, force: true });
  }
}
const settle = async api => { for (let i = 0; i < 4; i++) await Promise.resolve(); api.flush(); };
const pick = { serverId: 'server', provider: 'modrinth', projectId: 'project', name: 'Test pack', versionId: null };

test('opening the picker loads in the effect phase, retries failures, and reviews the chosen version without diagnostics', () => harness(async (api, calls) => {
  const owner = api.createRoot(dispose => ({ dispose, dialog: api.ProviderPickDialog({ pick }) }));
  try {
    await settle(api);
    expect(calls.loads).toHaveLength(1);
    expect(api.untrack(owner.dialog.loading)).toBe(true);
    calls.loads[0].reject(Error('offline'));
    await settle(api);
    expect(api.untrack(owner.dialog.failed)).toBe(true);
    expect(api.untrack(owner.dialog.loading)).toBe(false);
    const retry = owner.dialog.load();
    api.flush();
    expect(api.untrack(owner.dialog.failed)).toBe(false);
    calls.loads[1].resolve([{ id: 'version' }]); await retry; await settle(api);
    expect(api.untrack(owner.dialog.loading)).toBe(false);
    expect(calls.closes).toEqual(['server']);
    expect(calls.opens).toBe(1);
    expect(calls.reviews).toEqual([{ source: { source: 'provider', provider: 'modrinth', projectId: 'project', versionId: 'version' }, name: 'Test pack', mode: 'link' }]);
  } finally { owner.dispose(); }
}));

test('a late failed load after the picker closes does not update disposed state', () => harness(async (api, calls) => {
  const owner = api.createRoot(dispose => ({ dispose, dialog: api.ProviderPickDialog({ pick }) }));
  await settle(api); owner.dispose();
  calls.loads[0].reject(Error('late failure'));
  await settle(api);
  expect(calls.reviews).toHaveLength(0);
}));


test('a client-pack target confirms a draft import without installing on the server', () => harness(async (api, calls) => {
 const owner = api.createRoot(dispose => ({ dispose, dialog: api.ProviderPickDialog({ pick: {...pick, destination:'modpack'} }) }));
 try {
  await settle(api); calls.loads[0].resolve([{id:'version'}]); await settle(api);
  expect(calls.reviews).toHaveLength(0); expect(calls.imports).toHaveLength(0);
  await owner.dialog.go(); await settle(api);
  expect(calls.imports[0]).toEqual(['server', { source:'provider', expectedRevision:'7', provider:'modrinth', projectId:'project', versionId:'version' }, 'intent']);
  expect(calls.opens).toBe(0); expect(calls.closes).toEqual(['server']);
 } finally {owner.dispose();}
}));
