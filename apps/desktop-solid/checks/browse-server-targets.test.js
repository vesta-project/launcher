import { describe, expect, test } from 'bun:test';
import {
  connectionState,
  defaultDestination,
  dependencyRows,
  preferredDestination,
  projectSides,
  serverPermissions,
  serverTargets,
  serverVersion,
  softwareFamily,
  targetStates,
} from '../src/features/browse/install-targets';
import { capabilitiesForRole } from '../src/features/servers/capabilities';

const online = { phase: 'online', access: 'paired', retryAtMs: null, rateLimitedUntilMs: null, lastError: null };
const snapshot = (id, capabilities, patch = {}) => ({
  connection: { id, name: `Server ${id}`, serverId: `srv_${id}`, endpoint: 'example.test:8443', pinned: false },
  state: online,
  info: { serverId: `srv_${id}`, name: id, agentVersion: '0.9.0', minecraftVersion: '1.21.4', packVersion: '1' },
  capabilities,
  ...patch,
});
const role = (name) => ({ source: 'role_defaults', granted: capabilitiesForRole(name) ?? [], refused: [] });
const target = (patch = {}) => ({
  id: 'a', serverId: 'srv_a', name: 'A', minecraftVersion: '1.21.4', software: 'fabric', connection: 'online',
  canInstall: true, canEditPack: true, ...patch,
});
const project = (patch = {}) => ({ source: 'modrinth', categories: ['fabric'], environment: { client: true, server: true }, ...patch });
const version = (patch = {}) => ({ id: 'v1', project_id: 'p', version_number: '1.0', game_versions: ['1.21.4'], loaders: ['fabric'],
  download_url: 'https://example.test/a.jar', file_name: 'a.jar', release_type: 'release', ...patch });

describe('permission filtering', () => {
  test('servers appear only with content install or pack edit', () => {
    const list = serverTargets(
      [
        snapshot('owner', role('owner')),
        snapshot('maintainer', role('maintainer')),
        snapshot('viewer', role('viewer')),
        snapshot('pack-user', role('pack-user')),
        snapshot('pack-editor', { source: 'session', granted: ['pack.edit'], refused: [] }),
      ],
      () => 'fabric',
    );
    expect(list.map((entry) => entry.id)).toEqual(['owner', 'maintainer', 'pack-editor']);
    expect(list.find((entry) => entry.id === 'maintainer')).toMatchObject({ canInstall: true, canEditPack: false });
    expect(list.find((entry) => entry.id === 'pack-editor')).toMatchObject({ canInstall: false, canEditPack: true });
  });

  test('a refused capability hides the server; an unknown set lets the server decide', () => {
    expect(serverPermissions({ capabilities: { source: 'session', granted: ['content.install'], refused: ['content.install'] } }))
      .toEqual({ server: false, modpack: false });
    expect(serverPermissions({ capabilities: { source: 'unknown', granted: [], refused: [] } })).toEqual({ server: true, modpack: true });
  });

  test('connection state and software come from the snapshot and the software reader', () => {
    expect(connectionState({ state: { ...online, phase: 'backoff' } })).toBe('connecting');
    expect(connectionState({ state: { ...online, phase: 'disconnected' } })).toBe('offline');
    expect(connectionState({ state: { ...online, access: 'credentials_rejected' } })).toBe('access');
    const [entry] = serverTargets([snapshot('a', role('owner'), { info: null })], () => undefined);
    expect(entry).toMatchObject({ minecraftVersion: null, software: undefined, serverId: 'srv_a' });
  });
});

describe('default target mapping', () => {
  test('sides map to server, modpack or both', () => {
    const sides = (client, server) => projectSides({ environment: { client, server } });
    expect(preferredDestination(sides(true, true), 'mod')).toBe('both');
    expect(preferredDestination(sides(false, true), 'mod')).toBe('server');
    expect(preferredDestination(sides(true, false), 'mod')).toBe('modpack');
    expect(preferredDestination(projectSides({}), 'mod')).toBe('both');
    expect(preferredDestination(sides(true, true), 'plugin')).toBe('server');
    expect(preferredDestination(sides(true, true), 'datapack')).toBe('server');
    expect(preferredDestination(sides(true, true), 'shader')).toBe('modpack');
  });

  test('normalized requirements win over the booleans', () => {
    expect(projectSides({ environment: { client: true, server: true, client_requirement: 'unsupported', server_requirement: 'required' } }))
      .toEqual({ client: 'unsupported', server: 'required' });
    expect(projectSides({ client_side: 'required', server_side: 'optional' })).toEqual({ client: 'required', server: 'optional' });
    expect(projectSides({ environment: null })).toEqual({ client: 'unknown', server: 'unknown' });
  });

  test('the default falls back to an available destination', () => {
    const sides = projectSides({ environment: { client: true, server: true } });
    const states = targetStates(target(), { project: project(), kind: 'mod', versions: [version()] });
    // The modpack is not editable yet, so Both falls back to the server.
    expect(states.modpack).toEqual({ available: false, reason: 'modpack-coming' });
    expect(defaultDestination(sides, 'mod', states)).toBe('server');
    const none = { available: false, reason: 'offline' };
    expect(defaultDestination(sides, 'mod', { server: none, modpack: none, both: none })).toBe('both');
  });

  test('dependencies: required ticked, optional unticked, installed left alone', () => {
    const rows = dependencyRows([
      { project: { id: 'a', name: 'A', source: 'modrinth' }, version: null, required: true },
      { project: { id: 'b', name: 'B', source: 'modrinth' }, version: null, required: false },
      { project: { id: 'c', name: 'C', source: 'modrinth' }, version: null, required: true, installed: true },
    ]);
    expect(rows.map((row) => row.selected)).toEqual([true, false, false]);
  });
});

describe('compatibility reasons', () => {
  const states = (patch, input = {}) => targetStates(target(patch), { project: project(), kind: 'mod', versions: [version()], ...input });

  test('connection and version problems block the whole row', () => {
    expect(states({ connection: 'offline' }).row).toEqual({ available: false, reason: 'offline' });
    expect(states({ connection: 'connecting' }).server).toEqual({ available: false, reason: 'connecting' });
    expect(states({ minecraftVersion: null }).row).toEqual({ available: false, reason: 'unknown-version' });
  });

  test('server software decides mods and plugins', () => {
    expect(states({ software: 'paper' }).server).toEqual({ available: false, reason: 'needs-mod-loader' });
    expect(states({ software: 'vanilla' }).server).toEqual({ available: false, reason: 'needs-mod-loader' });
    expect(states({ software: null }).server).toEqual({ available: false, reason: 'unknown-software' });
    expect(states({ software: undefined }).server).toEqual({ available: false, reason: 'checking' });
    expect(states({ software: 'forge' }).server).toEqual({ available: false, reason: 'loader' });
    expect(states({ software: 'fabric' }).server).toEqual({ available: true });
    const plugin = { project: project({ categories: ['paper'] }), kind: 'plugin', versions: [version({ loaders: ['paper'] })] };
    expect(states({ software: 'fabric' }, plugin).server).toEqual({ available: false, reason: 'needs-plugin-server' });
    expect(states({ software: 'purpur' }, plugin).server).toEqual({ available: true });
    expect(states({ software: 'folia' }, plugin).server).toEqual({ available: false, reason: 'no-version' });
    expect(states({ software: 'paper' }, plugin).modpack).toEqual({ available: false, reason: 'not-client-content' });
  });

  test('sides, permissions and versions explain the rest', () => {
    const clientOnly = { project: project({ environment: { client: true, server: false } }) };
    expect(states({}, clientOnly).server).toEqual({ available: false, reason: 'client-only' });
    expect(states({}, { project: project({ environment: { client: false, server: true } }) }).modpack)
      .toEqual({ available: false, reason: 'server-only' });
    expect(states({ canInstall: false }).server).toEqual({ available: false, reason: 'no-permission' });
    expect(states({ canEditPack: false }).modpack).toEqual({ available: false, reason: 'no-permission' });
    expect(states({ minecraftVersion: '1.20.1' }).server).toEqual({ available: false, reason: 'no-version' });
    expect(states({}, { kind: 'shader' }).server).toEqual({ available: false, reason: 'not-server-content' });
    // Datapacks go on any server software.
    expect(states({ software: 'paper' }, { kind: 'datapack', versions: [version({ loaders: ['datapack'] })] }).server)
      .toEqual({ available: true });
    // Both needs both.
    expect(states({}).both).toEqual({ available: false, reason: 'modpack-coming' });
  });

  test('a row stays open to explain that the modpack comes next', () => {
    expect(states({ software: 'paper' }).row).toEqual({ available: true });
    expect(states({ software: 'paper', canEditPack: false }).row).toEqual({ available: false, reason: 'needs-mod-loader' });
  });

  test('server versions follow the software family', () => {
    expect(softwareFamily('NeoForge')).toBe('modded');
    expect(softwareFamily('folia')).toBe('plugin');
    expect(serverVersion([version({ loaders: ['bukkit'] })], { minecraftVersion: '1.21.4', software: 'paper' }, 'plugin')?.id).toBe('v1');
    expect(serverVersion([version()], { minecraftVersion: '1.21.4', software: 'quilt' }, 'mod')?.id).toBe('v1');
  });
});
