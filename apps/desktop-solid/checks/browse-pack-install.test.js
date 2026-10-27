import { expect, test } from 'bun:test';
import { prepareServerSelection, installToServerTarget } from '../src/features/browse/server-install-flow';

const project = { id: 'root', name: 'Root', source: 'modrinth', resource_type: 'mod', categories: ['fabric'], environment: { client: true, server: true } };
const version = (id, loader = 'fabric') => ({ id, project_id: 'root', version_number: id, game_versions: ['1.21.4'], loaders: [loader], release_type: 'release', download_url: 'https://example.test/a.jar', file_name: 'a.jar' });
const target = (software = 'paper') => ({ id: 'connection', name: 'Server', minecraftVersion: '1.21.4', software, canInstall: true, canEditPack: true, connection: 'online' });
function fixture() {
  const calls = [];
  const workspace = { draft: { revision: '7', manifest: { minecraftVersion: '1.21.4', loader: 'fabric' } }, minecraftDrift: false };
  const dependency = (id) => ({ project: { id, name: id, source: 'modrinth' }, version: version(`${id}-v`), required: true, installed: false });
  const api = {
    async packDraft() { return workspace; },
    async packDependencies() { return { target: workspace, dependencies: [dependency('client-dep')] }; },
    async contentDependencies() { return { dependencies: [dependency('server-dep')] }; },
    async contentInstall(id, request, intent) { calls.push({ destination: 'server', request, intent }); return { state: 'pending' }; },
    async packAdd(id, request, intent) { calls.push({ destination: 'modpack', request, intent }); return workspace.draft; },
  };
  return { calls, workspace, api, run: fn => fn(api) };
}

test('plugins and datapacks never read or mutate a client pack, even with conflicting side metadata', async () => {
  for (const kind of ['plugin', 'datapack']) {
    const f = fixture(); let reads = 0;
    f.api.packDraft = async () => { reads++; throw new Error('unexpected pack read'); };
    const item = { ...project, resource_type: kind, categories: [kind], environment: { client: true, server: false } };
    expect(await prepareServerSelection(target(), item, [version('v', kind === 'plugin' ? 'bukkit' : 'datapack')], 'modpack', f.run)).toBeUndefined();
    const prepared = await prepareServerSelection(target(), item, [version('v', kind === 'plugin' ? 'bukkit' : 'datapack')], 'server', f.run);
    expect(prepared.version.id).toBe('v');
    expect(reads).toBe(0);
    expect(prepared.rows.every(row => row.destination === 'server')).toBe(true);
  }
});

test('an untouched draft refuses client-pack review without creating it or reading dependencies', async () => {
  const f = fixture(); f.workspace.draft.revision = '0'; let dependencies = 0;
  f.api.packDependencies = async () => { dependencies++; throw new Error('unexpected dependency read'); };
  await expect(prepareServerSelection(target(), project, [version('fabric')], 'modpack', f.run)).rejects.toMatchObject({ code: 'stale_target' });
  expect(dependencies).toBe(0); expect(f.calls).toHaveLength(0);
});
test('Paper and vanilla choose the client draft loader and only mutate the draft', async () => {
  for (const software of ['paper', 'vanilla']) {
    const f = fixture();
    const prepared = await prepareServerSelection(target(software), project, [version('forge', 'forge'), version('fabric')], 'modpack', f.run);
    expect(prepared.version.id).toBe('fabric');
    expect(prepared.rows.map(row => row.destination)).toEqual(['modpack']);
    const result = await installToServerTarget(target(software), { ...prepared, project, kind: 'mod', destination: 'modpack', dependencies: prepared.rows }, f.run);
    expect(result).toMatchObject({ kind: 'started', destination: 'modpack', staged: false });
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].request).toMatchObject({ expectedRevision: '7', versionId: 'fabric', dependencies: [{ projectId: 'client-dep', versionId: 'client-dep-v', required: true }] });
  }
});
test('Both keeps dependency scopes separate and uses one reviewed atomic pack edit', async () => {
  const f = fixture(), server = target('fabric');
  const prepared = await prepareServerSelection(server, project, [version('fabric')], 'both', f.run);
  const selection = { ...prepared, project, kind: 'mod', destination: 'both', dependencies: prepared.rows };
  const result = await installToServerTarget(server, selection, f.run);
  expect(result).toMatchObject({ kind: 'started', destination: 'both', staged: true });
  expect(f.calls.filter(c => c.destination === 'server').map(c => c.request.projectId)).toEqual(['server-dep', 'root']);
  expect(f.calls.find(c => c.destination === 'modpack').request.dependencies.map(d => d.projectId)).toEqual(['client-dep']);
  const intents = f.calls.map(c => c.intent);
  await installToServerTarget(server, selection, f.run);
  expect(f.calls.slice(3).map(c => c.intent)).toEqual(intents);
});
test('Both reports partial success when the pack reply is uncertain', async () => {
  const f = fixture(), server = target('fabric');
  const prepared = await prepareServerSelection(server, project, [version('fabric')], 'both', f.run);
  f.api.packAdd = async () => { throw { code: 'uncertain', reason: 'request_uncertain' }; };
  const result = await installToServerTarget(server, { ...prepared, project, kind: 'mod', destination: 'both', dependencies: prepared.rows }, f.run);
  expect(result).toMatchObject({ kind: 'partial', count: 2, staged: true, error: { code: 'uncertain' } });
});
test('a changed draft or missing review prevents side effects', async () => {
  const f = fixture();
  f.api.packDependencies = async () => ({ target: { ...f.workspace, draft: { ...f.workspace.draft, revision: 'changed' } }, dependencies: [] });
  await expect(prepareServerSelection(target(), project, [version('fabric')], 'modpack', f.run)).rejects.toMatchObject({ code: 'stale_target' });
  const result = await installToServerTarget(target('fabric'), { project, version: version('fabric'), kind: 'mod', destination: 'both', dependencies: [] }, f.run);
  expect(result.kind).toBe('failed');
  expect(f.calls).toHaveLength(0);
});
test('Both refuses a version that only fits one runtime', async () => {
  const f = fixture();
  expect(await prepareServerSelection(target('forge'), project, [version('forge', 'forge'), version('fabric')], 'both', f.run)).toBeUndefined();
  expect(f.calls).toHaveLength(0);
});
