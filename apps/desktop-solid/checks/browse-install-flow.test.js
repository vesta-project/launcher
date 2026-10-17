import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const project = { source: 'modrinth', id: 'project', name: 'Project', icon_url: 'https://example.test/icon.png', web_url: 'https://example.test/project' };
const release = { id: 'release', release_type: 'release', game_versions: ['1.21.1'], loaders: ['fabric'], download_url: 'https://example.test/file.jar' };
const instance = { id: '7', name: 'Instance', minecraftVersion: '1.21.4', modloader: 'fabric' };
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

async function harness(entry, run) {
  const directory = await mkdtemp(join(tmpdir(), 'vesta-browse-install-'));
  const key = `vestaInstall${crypto.randomUUID().replaceAll('-', '')}`;
  const control = { notices: [], installs: [], handoffs: [], events: new Map(), versions: [release],
    invoke: async () => {}, worlds: [], install: async () => ({ kind: 'started' }) };
  globalThis[key] = control;
  const prefix = `const c = globalThis[${JSON.stringify(key)}];`;
  const fixtures = {
    '@tauri-apps/api/core': `export const invoke = (...args) => c.invoke(...args);`,
    '@tauri-apps/api/event': `export const listen = async (name, handler) => { c.events.set(name, handler); return () => c.events.delete(name); };`,
    '@tauri-apps/plugin-shell': 'export const open = async () => {};',
    '../../localization': 'export const t = (id, args) => id + JSON.stringify(args || {});',
    '../instances/metadata': `export const loadMetadata = async () => {}, metadataError = () => '', metadata = () => ({ game_versions: [
      { id: '1.21.4', stable: true, loaders: {fabric: [{version: 'new', stable: true}]} },
      { id: '1.21.1', stable: true, loaders: {fabric: [{version: 'older', stable: true}]} }
    ] });`,
    '../instances/native-service': 'export const nativeInstances = true;',
    '../../features/instances/native-service': 'export const nativeInstances = true;',
    '../../features/instances/details': 'export const worldsFor = () => [];',
    './browse-projects': 'export const loadVersions = async () => c.versions;',
    '../../features/browse/browse-projects': 'export const loadVersions = async () => c.versions;',
    './browse-store': 'export const setNotice = (value) => c.notices.push(value), installInto = (...args) => c.install(...args);',
    '../../features/browse/browse-store': `export const gameVersion = () => null, loader = () => null, setNotice = (value) => c.notices.push(value), installInto = (...args) => c.install(...args);`,
    '../../features/browse/browse-api': 'export const installResource = async (request) => { c.installs.push(request); return "task"; };',
    '../../pages/create/install-navigation': 'export const openResourceInstall = (pending) => c.handoffs.push(pending);',
    '../create/install-navigation': 'export const openInstallSource = (source) => c.handoffs.push(source);',
    '../../features/browse/new-instance-install': 'export const installIntoNewInstance = async (...args) => c.handoffs.push(args);',
  };
  try {
    const built = await Bun.build({ entrypoints: [new URL(`../src/${entry}`, import.meta.url).pathname],
      target: 'bun', conditions: ['browser', 'development'], plugins: [{ name: 'install-boundaries', setup(build) {
        build.onResolve({ filter: /.*/ }, ({ path }) => path in fixtures ? { path, namespace: 'fixture' } : undefined);
        build.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ contents: prefix + fixtures[path], loader: 'js' }));
      } }] });
    if (!built.success) throw new AggregateError(built.logs, 'Install harness failed');
    const path = join(directory, 'harness.mjs');
    await Bun.write(path, built.outputs[0]);
    await run(await import(pathToFileURL(path).href), control);
  } finally {
    delete globalThis[key];
    await rm(directory, { recursive: true, force: true });
  }
}

test('new-instance action only hands a compatible prefilled draft to Create, joining duplicate clicks', () =>
  harness('features/browse/new-instance-install.ts', async (api, c) => {
    c.invoke = () => { throw new Error('Must not create before submit'); };
    c.versions = [{ ...release, loaders: ['quilt', 'fabric'] }];
    await Promise.all([api.installIntoNewInstance(project, 'mod'), api.installIntoNewInstance(project, 'mod')]);
    expect(c.handoffs).toEqual([{ project, kind: 'mod', minecraft: '1.21.1', loader: 'fabric', loaderVersion: 'older' }]);
    expect(c.notices).toEqual([]);
  }));

test('pending resource subscribes before creation and installs only after the persisted instance is ready', () =>
  harness('features/browse/new-instance-install.ts', async (api, c) => {
    const installed = deferred();
    let reads = 0;
    c.invoke = async (command) => {
      expect(command).toBe('get_instance');
      reads++;
      await installed.promise;
      return { id: 7, name: 'Created', minecraftVersion: '1.21.1', modloader: 'fabric', installationStatus: 'installed' };
    };
    c.install = async (...args) => { c.installs.push(args); return { kind: 'started' }; };
    expect(await api.startPendingResourceInstallation({ project, kind: 'mod' }, async () => {
      expect(c.events.size).toBe(6);
      return 7;
    })).toBe(7);
    expect(c.installs).toEqual([]);
    installed.resolve();
    for (let i = 0; i < 15; i++) await Promise.resolve();
    expect(reads).toBe(1);
    expect(c.installs).toEqual([[project, { id: '7', minecraftVersion: '1.21.1', modloader: 'fabric' }, 'mod']]);
    expect(c.events.size).toBe(0);
  }));

test('datapacks select an instance first and install into an opaque world directory using its saved version', () =>
  harness('pages/browse/install-actions.ts', async (api, c) => {
    c.versions = [{ ...release, loaders: ['datapack'] }];
    await api.runInstall(project, 'datapack', undefined);
    expect(api.pickerProject()).toEqual(project);
    const rows = deferred();
    c.invoke = async (command, args) => {
      expect(command).toBe('list_instance_worlds');
      expect(args).toEqual({ instanceId: 7, forceRefresh: true });
      return rows.promise;
    };
    const loading = api.installFromPicker(project, 'datapack', instance);
    await Promise.resolve();
    expect(api.worldChoice().worlds).toBeUndefined();
    expect(api.pickerProject()).toBeUndefined();
    rows.resolve([{ ref: { instanceId: 7, directoryName: 'A/world/B:copy' }, displayName: 'World', gameVersion: '1.21.1', running: false }]);
    await loading;
    await api.installIntoWorld(api.worldChoice().worlds[0]);
    expect(c.installs[0]).toMatchObject({ instanceId: '7', type: 'datapack', world: { instanceId: 7, directoryName: 'A/world/B:copy' }, version: { id: 'release' } });
    expect(api.worldChoice()).toBeUndefined();
    expect(c.notices[0].tone).toBe('success');
  }));

test('closing the world chooser discards a late world-list response', () =>
  harness('pages/browse/install-actions.ts', async (api, c) => {
    const rows = deferred();
    c.invoke = () => rows.promise;
    const loading = api.runInstall(project, 'datapack', instance);
    api.closeWorldChoice();
    rows.resolve([]);
    await loading;
    expect(api.worldChoice()).toBeUndefined();
  }));


test('deletion queued before the create command returns cancels the resource continuation and releases listeners', () =>
  harness('features/browse/new-instance-install.ts', async (api, c) => {
    c.install = () => { throw new Error('Deleted instances must not receive resources'); };
    expect(await api.startPendingResourceInstallation({ project, kind: 'mod' }, async () => {
      c.events.get('core://instance-delete-queued')({ payload: { id: 7 } });
      return 7;
    })).toBe(7);
    for (let i = 0; i < 15; i++) await Promise.resolve();
    expect(c.events.size).toBe(0);
    expect(c.notices).toHaveLength(1);
    expect(c.notices[0].text).toContain('browse.new-instance-removed');
  }));

test('Browse carries the provider project and selected pack release through the archive handoff', () =>
  harness('pages/browse/install-actions.ts', async (api, c) => {
    const pack = { ...project, resource_type: 'modpack', summary: 'Short summary', description: 'Long body' };
    c.versions = [{ ...release, project_id: project.id, version_number: 'Pack 2.0', loaders: ['mrpack', 'fabric'] }];
    await api.runInstall(pack, 'modpack', undefined);
    expect(c.handoffs).toEqual([{ kind: 'url', value: release.download_url,
      online: { project: pack, release: c.versions[0] } }]);
  }));

test('a version page installs exactly its version: into the target, through the picker, or as a pack', () =>
  harness('pages/browse/install-actions.ts', async (api, c) => {
    const older = { ...release, id: 'older', version_number: '0.9' };
    const calls = [];
    c.install = async (...args) => { calls.push(args); return { kind: 'started' }; };
    await api.runInstall(project, 'mod', { ...instance, name: 'Instance' }, older);
    expect(calls[0][3]).toEqual(older);

    await api.runInstall(project, 'mod', undefined, older);
    expect(api.pickerProject()).toEqual(project);
    expect(api.pickerVersion()).toEqual(older);
    await api.installFromPicker(project, 'mod', { ...instance, name: 'Instance' });
    expect(calls[1][3]).toEqual(older);
    expect(api.pickerVersion()).toBeUndefined();

    const pack = { ...project, resource_type: 'modpack' };
    c.versions = [{ ...release, id: 'newest', download_url: 'https://example.test/newest.mrpack' }];
    await api.runInstall(pack, 'modpack', undefined, older);
    expect(c.handoffs.at(-1)).toEqual({ kind: 'url', value: older.download_url, online: { project: pack, release: older } });
  }));

test('a pinned data pack goes into the chosen world as that version, not the best match for the world', () =>
  harness('pages/browse/install-actions.ts', async (api, c) => {
    const pinned = { ...release, id: 'pinned', loaders: ['datapack'], game_versions: ['1.20.1'] };
    c.versions = [{ ...release, loaders: ['datapack'] }];
    c.invoke = async () => [{ ref: { instanceId: 7, directoryName: 'World' }, displayName: 'World', gameVersion: '1.21.1', running: false }];
    await api.runInstall(project, 'datapack', instance, pinned);
    await api.installIntoWorld(api.worldChoice().worlds[0]);
    expect(c.installs[0]).toMatchObject({ type: 'datapack', version: { id: 'pinned' } });
  }));


test('new-instance picker preserves the pinned release in its Create handoff', () =>
  harness('pages/browse/install-actions.ts', async (api, c) => {
    await api.runInstall(project, 'mod', undefined, release);
    await api.installIntoNew(project, 'mod');
    expect(c.handoffs[0][2].version).toEqual(release);
  }));

test('Create preparation keeps the pinned release even when a newer version fits', () =>
  harness('features/browse/new-instance-install.ts', async (api, c) => {
    c.versions = [{ ...release, id: 'newer' }, release];
    await api.installIntoNewInstance(project, 'mod', { version: release });
    expect(c.handoffs[0].version).toEqual(release);
    expect(c.handoffs[0].minecraft).toBe('1.21.1');
  }));

test('Create continuation installs the pinned version and refuses an edited incompatible target', () =>
  harness('features/browse/new-instance-install.ts', async (api, c) => {
    c.versions = [{ ...release, id: 'newer' }, release];
    c.invoke = async () => ({ id: 7, name: 'Created', minecraftVersion: '1.21.1', modloader: 'fabric', installationStatus: 'installed' });
    c.install = async (...args) => { c.installs.push(args); return { kind: 'started' }; };
    await api.startPendingResourceInstallation({ project, kind: 'mod', version: release }, async () => 7);
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(c.installs[0][3]).toEqual(release);
    c.installs = [];
    c.invoke = async () => ({ id: 8, name: 'Edited', minecraftVersion: '1.21.4', modloader: 'fabric', installationStatus: 'installed' });
    await api.startPendingResourceInstallation({ project, kind: 'mod', version: release }, async () => 8);
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(c.installs).toEqual([]);
    expect(c.notices.at(-1).text).toContain('browse.no-version');
  }));
