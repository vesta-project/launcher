import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

async function harness(run) {
  const directory = await mkdtemp(join(tmpdir(), 'vesta-pack-loading-'));
  if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith('vesta-pack-loading-')) throw new Error('Unexpected test temporary directory');
  const key = `packLoading${crypto.randomUUID().replaceAll('-', '')}`;
  const c = { reads: [], writes: [], previews: [], icons: [] };
  globalThis[key] = c;
  const source = path => JSON.stringify(fileURLToPath(new URL(path, import.meta.url)));
  try {
    const build = await Bun.build({ entrypoints: ['pack-loading-check'], target: 'bun', conditions: ['browser', 'development'],
      plugins: [{ name: 'pack-loading-boundaries', setup(build) {
        build.onResolve({ filter: /^pack-loading-check$/ }, () => ({ path: 'check', namespace: 'pack-check' }));
        build.onLoad({ filter: /.*/, namespace: 'pack-check' }, () => ({ loader: 'js', resolveDir: fileURLToPath(new URL('..', import.meta.url)), contents: `
          export { createRoot, createSignal, createEffect, flush, untrack } from 'solid-js';
          export { captureArtifact, expectNoDiagnostics } from '@solidjs/diagnostics';
          export { createModpackArea } from ${source('../src/pages/servers/pack/area.tsx')};
          export { capabilitiesForRole } from ${source('../src/features/servers/capabilities.ts')};
          export { seedPackWorkspace } from ${source('../src/features/servers/fixtures-pack.ts')};
          export { seedServerResource, peekServerResource, releaseServerResources } from ${source('../src/features/servers/resources.ts')};
          export { packWorkspaceResource } from ${source('../src/features/servers/server-resources.ts')};
        ` }));
        build.onLoad({ filter: /app[\\/]transition\.ts$/ }, () => ({ loader: 'js', contents: 'export const transitionTo = () => {};' }));
        build.onLoad({ filter: /browse[\\/]browse-projects\.ts$/ }, () => ({ loader: 'js', contents: 'export const loadProject = async () => {}; export const peekProject = () => undefined;' }));
        build.onLoad({ filter: /servers[\\/]server-resources\.ts$/ }, args => ({ loader: 'js', resolveDir: dirname(args.path), contents: `import { serverResource } from './resources'; import { serverCommand } from './store'; export const packWorkspaceResource = serverResource('pack-workspace', id => serverCommand(api => api.packDraft(id)));` }));
        build.onLoad({ filter: /servers[\\/]store\.ts$/ }, () => ({ loader: 'js', contents: `
          const c = globalThis[${JSON.stringify(key)}];
          const defer = (list, args) => new Promise((resolve, reject) => list.push({args, resolve, reject}));
          const api = { packDraft: (...args) => defer(c.reads, args), packWrite: (...args) => defer(c.writes, args),
            packPreview: (...args) => defer(c.previews, args), packIcon: (...args) => defer(c.icons, args) };
          export const serverCommand = async run => run(api);
        ` }));
      } }] });
    if (!build.success) throw new AggregateError(build.logs);
    const path = join(directory, 'check.mjs'); await Bun.write(path, build.outputs[0]);
    const api = await import(pathToFileURL(path).href);
    const { artifact } = await api.captureArtifact(() => run(api, c), { scenario: 'pack-workspace-latency-and-isolation' });
    api.expectNoDiagnostics(artifact);
  } finally {
    delete globalThis[key];
    await rm(directory, { recursive: true, force: true });
  }
}
const settle = async api => { for (let i = 0; i < 8; i++) await Promise.resolve(); api.flush(); };
const snapshot = (api, id) => ({ connection: { id, role: 'owner' }, capabilities: { granted: api.capabilitiesForRole('owner'), refused: [], hidden: [] } });

test('warm pack navigation is synchronous, confirmed draft edits survive remount, and viewing does no review IO', () => harness(async (api, c) => {
  const initial = api.seedPackWorkspace('fabric');
  api.seedServerResource('warm', api.packWorkspaceResource, initial);
  let owner = api.createRoot(dispose => ({ dispose, area: api.createModpackArea(() => snapshot(api, 'warm')) }));
  try {
    expect(api.untrack(owner.area.workspace)).toEqual(initial);
    await settle(api);
    expect(c.reads).toHaveLength(0); expect(c.previews).toHaveLength(0);
    const next = { revision: '4', manifest: { ...initial.draft.manifest, name: 'Confirmed' } };
    const write = owner.area.writeManifest(next.manifest);
    await settle(api);
    expect(api.untrack(owner.area.workspace).draft.revision).toBe('3');
    c.writes[0].resolve(next); await write;
    expect(api.peekServerResource('warm', api.packWorkspaceResource).draft).toEqual(next);
    owner.dispose();
    owner = api.createRoot(dispose => ({ dispose, area: api.createModpackArea(() => snapshot(api, 'warm')) }));
    expect(api.untrack(owner.area.workspace).draft).toEqual(next);
    await settle(api);
    expect(c.reads).toHaveLength(0); expect(c.previews).toHaveLength(0);
    const one = owner.area.refreshPreview(), two = owner.area.refreshPreview();
    expect(one).toBe(two); await settle(api); expect(c.previews).toHaveLength(1);
    c.previews[0].resolve({ draftRevision: '4' }); await one;
    const retry = owner.area.refreshPreview(); await settle(api);
    expect(c.previews).toHaveLength(2);
    c.previews[1].reject({ code: 'unreachable' }); await expect(retry).rejects.toMatchObject({ code: 'unreachable' });
  } finally { owner.dispose(); api.releaseServerResources('warm'); }
}));

test('late writes, reads and uploaded icons cannot cross server identity or disposal', () => harness(async (api, c) => {
  const initial = api.seedPackWorkspace('fabric'); initial.draft.manifest.icon = 'old';
  api.seedServerResource('one', api.packWorkspaceResource, initial);
  const owner = api.createRoot(dispose => {
    const [state, setState] = api.createSignal(snapshot(api, 'one'), { name: 'pack-loading:snapshot' });
    return { dispose, setState, area: api.createModpackArea(state) };
  });
  try {
    await settle(api);
    const write = owner.area.writeManifest({ ...initial.draft.manifest, name: 'Late old write' });
    await settle(api);
    owner.setState(snapshot(api, 'two')); await settle(api);
    expect(api.untrack(owner.area.workspace)).toBeUndefined();
    c.writes[0].resolve({ revision: '4', manifest: initial.draft.manifest }); await write;
    expect(api.untrack(owner.area.workspace)).toBeUndefined();
    const second = api.seedPackWorkspace('vanilla');
    c.reads[0].resolve(second); await settle(api);
    c.icons[0].resolve({ mimeType: 'image/png', contentBase64: 'old-image' }); await settle(api);
    expect(api.untrack(owner.area.icon)).not.toContain('old-image');
    expect(api.peekServerResource('two', api.packWorkspaceResource).draft).toEqual(second.draft);
    const refresh = owner.area.reload(); await settle(api); owner.dispose();
    c.reads[1].resolve({ ...second, draft: { ...second.draft, revision: '99' } }); await refresh;
    expect(api.peekServerResource('two', api.packWorkspaceResource).draft.revision).toBe('3');
  } finally { owner.dispose(); for (const id of ['one', 'two']) api.releaseServerResources(id); }
}));

test('live status snapshots do not flash loading or restart workspace reads', () => harness(async (api, c) => {
  api.seedServerResource('live', api.packWorkspaceResource, api.seedPackWorkspace('fabric'));
  let loadingRuns = 0;
  const initial = snapshot(api, 'live');
  const owner = api.createRoot(dispose => {
    const [state, setState] = api.createSignal(initial, { name: 'pack-loading:live-snapshot' });
    const area = api.createModpackArea(state);
    api.createEffect(area.loading, () => { loadingRuns++; }, { name: 'pack-loading:loading-observer' });
    return { dispose, setState, area };
  });
  try {
    await settle(api);
    const before = loadingRuns;
    // Status events preserve the capability projection; a full refresh can replace it.
    for (let tick = 0; tick < 60; tick++) { owner.setState({ ...initial, tick }); await settle(api); }
    owner.setState(snapshot(api, 'live')); await settle(api);
    expect(loadingRuns).toBe(before);
    expect(c.reads).toHaveLength(0); expect(c.previews).toHaveLength(0);
    owner.setState({ ...initial, capabilities: { ...initial.capabilities, refused: ['pack.edit'] } }); await settle(api);
    expect(api.untrack(owner.area.gates).edit).toBe(false);
    expect(api.untrack(owner.area.workspace)).toBeUndefined();
  } finally { owner.dispose(); api.releaseServerResources('live'); }
}));

test('failed draft saves keep confirmed data and reuse the uncertain intent; older refreshes cannot undo an acknowledgement', () => harness(async (api, c) => {
  const initial = api.seedPackWorkspace('fabric');
  api.seedServerResource('retry', api.packWorkspaceResource, initial);
  const owner = api.createRoot(dispose => ({ dispose, area: api.createModpackArea(() => snapshot(api, 'retry')) }));
  try {
    await settle(api);
    const manifest = { ...initial.draft.manifest, name: 'New name' };
    const first = owner.area.writeManifest(manifest);
    await settle(api); c.writes[0].reject({ code: 'unreachable' });
    await expect(first).rejects.toMatchObject({ code: 'unreachable' });
    expect(api.peekServerResource('retry', api.packWorkspaceResource)).toEqual(initial);
    const refresh = owner.area.reload(); await settle(api);
    const retry = owner.area.writeManifest(manifest); await settle(api);
    expect(c.writes[1].args[2]).toBe(c.writes[0].args[2]);
    c.writes[1].resolve({ revision: '4', manifest }); await retry;
    c.reads[0].resolve(initial); await refresh; await settle(api);
    expect(api.untrack(owner.area.workspace).draft.revision).toBe('4');
    expect(api.untrack(owner.area.error)).toBeNull();
    expect(api.untrack(owner.area.loading)).toBe(false);
    expect(api.peekServerResource('retry', api.packWorkspaceResource).draft.revision).toBe('4');
    owner.area.applyPublication({ hostedRevision: '15', minimumRevision: '12' }, '3');
    api.flush();
    expect(api.untrack(owner.area.workspace).pendingPublication).toBe(true);
    owner.area.applyPublication({ hostedRevision: '16', minimumRevision: '16' }, '4');
    api.flush();
    expect(api.untrack(owner.area.workspace).pendingPublication).toBe(false);
    expect(api.peekServerResource('retry', api.packWorkspaceResource).publishedRevision).toBe('16');
  } finally { owner.dispose(); api.releaseServerResources('retry'); }
}));
