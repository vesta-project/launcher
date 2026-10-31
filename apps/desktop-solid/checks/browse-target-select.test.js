import { describe, expect, test } from 'bun:test';
import {
  buildTargetOptions,
  parseTargetValue,
  primaryServerType,
  SEARCH_THRESHOLD,
  serverFilters,
  serverInstallState,
  serverInstalledKeys,
  serverScope,
  serverTargetInfo,
  serverTypes,
  targetPath,
  targetValue,
} from '../src/features/browse/browse-targets';
import { capabilitiesForRole } from '../src/features/servers/capabilities';

const online = { phase: 'online', access: 'paired', retryAtMs: null, rateLimitedUntilMs: null, lastError: null };
const snapshot = (id, capabilities, patch = {}) => ({
  connection: { id, name: `Server ${id}`, serverId: `srv_${id}`, endpoint: 'example.test:8443', pinned: false },
  state: online,
  info: { serverId: `srv_${id}`, name: id, agentVersion: '0.9.0', minecraftVersion: '1.21.4', packVersion: '1' },
  capabilities,
  ...patch,
});
const role = (name) => ({ source: 'session', roles: [name], granted: capabilitiesForRole(name) ?? [], refused: [] });
const instance = (id, patch = {}) => ({ id, name: `Instance ${id}`, image: '', minecraftVersion: '1.21.4', modloader: 'fabric', ...patch });
const server = (patch = {}) => ({ minecraftVersion: '1.21.4', software: 'fabric', canEditPack: false, ...patch });
const project = (patch = {}) => ({ source: 'modrinth', id: 'p', categories: [], resource_type: 'mod', ...patch });

describe('target references', () => {
  test('values and routes round-trip for instances and servers', () => {
    expect(targetValue({ kind: 'instance', id: '7' })).toBe('instance:7');
    expect(parseTargetValue('server:conn:1')).toEqual({ kind: 'server', id: 'conn:1' });
    expect(parseTargetValue('')).toBeUndefined();
    expect(parseTargetValue('7')).toBeUndefined();
    expect(targetPath(undefined)).toBe('/browse');
    expect(targetPath({ kind: 'instance', id: '7' })).toBe('/browse/for/7');
    expect(targetPath({ kind: 'server', id: 'a b' })).toBe('/browse/server/a%20b');
  });
});

describe('option building', () => {
  const snapshots = [
    snapshot('owner', role('owner')),
    snapshot('viewer', role('viewer')),
    snapshot('pack-editor', { source: 'session', granted: ['pack.edit'], refused: [] }),
    snapshot('down', role('owner'), { state: { ...online, phase: 'offline' } }),
  ];

  test('servers follow the install picker permission gate; offline ones stay, marked', () => {
    const options = buildTargetOptions({ instances: [instance('1')], snapshots, software: () => 'paper', kind: 'mod' });
    expect(options.instances.map((option) => option.value)).toEqual(['instance:1']);
    expect(options.servers.map((option) => option.id)).toEqual(['owner', 'pack-editor', 'down']);
    expect(options.servers.find((option) => option.id === 'pack-editor')).toMatchObject({ canInstall: false, canEditPack: true });
    expect(options.servers.find((option) => option.id === 'down')).toMatchObject({ unreachable: true, connection: 'offline' });
    expect(options.servers.find((option) => option.id === 'owner')).toMatchObject({ unreachable: false, software: 'paper', value: 'server:owner' });
  });

  test('modpacks list servers only; the inventory version outranks the snapshot', () => {
    const options = buildTargetOptions({ instances: [instance('1')], snapshots, software: () => null, kind: 'modpack' });
    expect(options.instances).toEqual([]);
    expect(options.servers.map(option => option.id)).toEqual(['owner', 'pack-editor', 'down']);
    expect(options.servers.find(option => option.id === 'pack-editor')).toMatchObject({ canInstallModpack: false, canEditPack: true });
    const known = buildTargetOptions({ instances: [], snapshots, software: () => null, minecraftVersion: (id) => (id === 'owner' ? '1.21.1' : undefined), kind: 'mod' });
    expect(known.servers.map((option) => option.minecraftVersion)).toEqual(['1.21.1', '1.21.4', '1.21.4']);
  });

  test('server modpack installs use effective roles while client pack edits use capabilities', () => {
    const grants = capabilitiesForRole('owner');
    const candidates = [
      snapshot('minecraft-owner', { source: 'session', roles: ['owner'], granted: grants, refused: [] }),
      snapshot('custom', { source: 'session', roles: ['custom'], granted: grants, refused: [] }),
      snapshot('revoked', { source: 'session', roles: [], granted: grants, refused: [] }, { connection: { id: 'revoked', role: 'owner' } }),
    ];
    const options = buildTargetOptions({ instances: [], snapshots: candidates, software: () => null, kind: 'modpack' });
    expect(options.servers.map(option => option.id)).toEqual(['minecraft-owner', 'custom', 'revoked']);
    expect(options.servers.map(option => option.canInstallModpack)).toEqual([true, false, false]);
    expect(options.servers.every(option => option.canEditPack)).toBe(true);
  });

  test('search narrows by name, version and software; long lists are searchable', () => {
    const many = Array.from({ length: SEARCH_THRESHOLD }, (_, index) => instance(String(index), { name: `Pack ${index}` }));
    const options = buildTargetOptions({ instances: many, snapshots, software: (id) => (id === 'owner' ? 'paper' : null), kind: 'mod', query: 'PAPER' });
    expect(options.searchable).toBe(true);
    expect(options.instances).toEqual([]);
    expect(options.servers.map((option) => option.id)).toEqual(['owner']);
    expect(buildTargetOptions({ instances: [instance('1')], snapshots: [], software: () => null, kind: 'mod' }).searchable).toBe(false);
    expect(buildTargetOptions({ instances: many, snapshots: [], software: () => null, kind: 'mod', query: 'pack 3' }).instances.map((option) => option.id)).toEqual(['3']);
  });

  test('server info prefers the inventory and reports loading vs unknown software', () => {
    const owner = snapshot('owner', role('owner'));
    expect(serverTargetInfo(owner, undefined, false)?.software).toBeUndefined();
    expect(serverTargetInfo(owner, undefined, true)?.software).toBeNull();
    expect(serverTargetInfo(owner, { software: 'paper', minecraftVersion: '1.21.5' }, false)).toMatchObject({ software: 'paper', minecraftVersion: '1.21.5' });
    expect(serverTargetInfo(snapshot('viewer', role('viewer')), undefined, false)).toBeUndefined();
    expect(serverTargetInfo(undefined, undefined, false)).toBeUndefined();
  });
});

describe('filter mapping per software family', () => {
  test('modded servers filter by their loader and open on Mods', () => {
    expect(serverFilters(server({ software: 'NeoForge' }))).toEqual({ gameVersion: '1.21.4', loader: 'neoforge' });
    expect(serverScope(server({ software: 'fabric' }), 'plugin')).toMatchObject({ type: 'mod', loader: 'fabric', types: ['mod', 'modpack', 'datapack'] });
    expect(serverScope(server({ software: 'fabric' }), 'datapack').type).toBe('datapack');
  });

  test('Bukkit-family servers show Plugins with the plugin loader left open', () => {
    for (const software of ['paper', 'spigot', 'purpur', 'folia', 'bukkit']) {
      const scope = serverScope(server({ software }), 'mod');
      expect(scope).toMatchObject({ type: 'plugin', loader: null, gameVersion: '1.21.4' });
      expect(scope.types).toContain('plugin');
      expect(scope.types).not.toContain('mod');
    }
    expect(primaryServerType('plugin')).toBe('plugin');
  });

  test('vanilla servers browse datapacks; pack editors also get resource packs and shaders', () => {
    expect(serverScope(server({ software: 'vanilla' }), 'mod')).toMatchObject({ type: 'datapack', loader: null, types: ['modpack', 'datapack'] });
    expect(serverTypes(server({ software: 'vanilla', canEditPack: true }))).toEqual(['modpack', 'resourcepack', 'shader', 'datapack']);
    expect(serverTypes(server({ software: 'paper', canEditPack: true }))).toEqual(['plugin', 'modpack', 'resourcepack', 'shader', 'datapack']);
    expect(serverScope(server({ software: 'paper', canEditPack: true }), 'mod').type).toBe('plugin');
  });

  test('unknown software keeps every tab and the current type', () => {
    expect(serverTypes(server({ software: null }))).toBeUndefined();
    expect(serverTypes(server({ software: undefined }))).toBeUndefined();
    expect(serverScope(server({ software: null, minecraftVersion: null }), 'shader')).toMatchObject({ type: 'shader', gameVersion: null, loader: null });
  });
});

describe('installed marking', () => {
  test('inventory items with a provider mark their project; removals and unidentified files do not', () => {
    const keys = serverInstalledKeys([
      { provider: { provider: 'modrinth', projectId: 'AANobbMI', versionId: 'v' }, pending: null },
      { provider: { provider: 'curseforge', projectId: '238222', versionId: 'f' }, pending: 'install' },
      { provider: { provider: 'modrinth', projectId: 'gone', versionId: 'v' }, pending: 'remove' },
      { provider: null, pending: null },
    ]);
    expect([...keys].sort()).toEqual(['curseforge:238222', 'modrinth:AANobbMI']);
  });

  test('cards show installed, incompatible or installable for the server', () => {
    const installed = new Set(['modrinth:sodium']);
    const fabric = server({ software: 'fabric' });
    expect(serverInstallState(project({ id: 'sodium', categories: ['fabric'] }), fabric, installed)).toEqual({ kind: 'installed' });
    expect(serverInstallState(project({ id: 'other', categories: ['forge'] }), fabric, installed)).toEqual({ kind: 'unavailable', reason: 'loader' });
    expect(serverInstallState(project({ id: 'other', categories: ['fabric'] }), fabric, installed)).toEqual({ kind: 'install' });
    // Plugins: Paper runs Spigot plugins, not Velocity ones.
    const paper = server({ software: 'paper' });
    expect(serverInstallState(project({ resource_type: 'plugin', categories: ['spigot'] }), paper, installed)).toEqual({ kind: 'install' });
    expect(serverInstallState(project({ resource_type: 'plugin', categories: ['velocity'] }), paper, installed)).toEqual({ kind: 'install' });
    expect(serverInstallState(project({ resource_type: 'plugin', categories: ['folia'] }), paper, installed)).toEqual({ kind: 'unavailable', reason: 'loader' });
    expect(serverInstallState(project({ resource_type: 'plugin', categories: ['paper'] }), fabric, installed)).toEqual({ kind: 'unavailable', reason: 'loader' });
    // Mods on a plugin server only go to the client modpack.
    expect(serverInstallState(project({ categories: ['fabric'] }), paper, installed)).toEqual({ kind: 'unavailable', reason: 'vanilla' });
    expect(serverInstallState(project({ categories: ['fabric'] }), { ...paper, canEditPack: true }, installed)).toEqual({ kind: 'install' });
    // Installed wins even for modpack-less checks; modpacks are always installable.
    expect(serverInstallState(project({ id: 'sodium', resource_type: 'datapack' }), paper, installed)).toEqual({ kind: 'installed' });
    expect(serverInstallState(project({ id: 'sodium', resource_type: 'modpack' }), paper, installed)).toEqual({ kind: 'install' });
    expect(serverInstallState(project({ categories: ['forge'] }), server({ software: undefined }), installed)).toEqual({ kind: 'install' });
  });
});
