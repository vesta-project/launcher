import { describe, expect, test } from 'bun:test';
import {
  baseName, contentErrorMessage, contentGates, contentKinds, contentList, contentName, contentRows, contentUpdate, customJarReview,
  datapackId, isServerJarPath, jarPickerEntries, launchKind, mutationRequest, pendingLabel, pendingSummary, primaryKind,
  providerLookups, rowActions, updateRequest,
} from '../src/features/servers/content-model.ts';
import { seedContentInventory } from '../src/features/servers/fixtures-content.ts';
import { previewCandidates, serverInstallPlan } from '../src/features/browse/install-targets.ts';
import { messageIds } from '../src/localization/messages.ts';
import { mainTabs } from '../src/features/servers/shell-model.ts';

const owner = { source: 'session', granted: ['files.list', 'content.install'], refused: [] };
const running = { status: { state: 'running', generation: 'g1' }, capabilities: owner };
const stopped = { status: { state: 'stopped', generation: null }, capabilities: owner };
const known = new Set(messageIds);

describe('server resources inventory view model', () => {
  test('kinds follow the software, keep leftovers and always include datapacks', () => {
    expect(contentKinds(seedContentInventory('fabric'))).toEqual(['mod', 'datapack']);
    expect(contentKinds(seedContentInventory('paper'))).toEqual(['plugin', 'datapack']);
    expect(contentKinds(seedContentInventory('vanilla'))).toEqual(['datapack']);
    const leftover = seedContentInventory('vanilla');
    leftover.items.push({ ...leftover.items[0], kind: 'mod', path: 'mods/x.jar', filename: 'x.jar' });
    expect(contentKinds(leftover)).toEqual(['mod', 'datapack']);
    expect(primaryKind(seedContentInventory('fabric'))).toBe('mod');
    expect(primaryKind(seedContentInventory('paper'))).toBe('plugin');
    expect(primaryKind(seedContentInventory('vanilla'))).toBe('datapack');
  });

  test('names prefer the provider, then declared metadata, then the file', () => {
    expect(baseName('old-mod.jar.disabled')).toBe('old-mod');
    expect(contentName({ filename: 'a.jar', declared: { name: 'Declared' } }, { name: 'Provider' })).toBe('Provider');
    expect(contentName({ filename: 'a.jar', declared: { name: 'Declared' } })).toBe('Declared');
    expect(contentName({ filename: 'terralith.zip', declared: null })).toBe('terralith');
  });

  test('all groups by kind with headers; a filter or a single kind has none', () => {
    const fabric = seedContentInventory('fabric');
    const all = contentList(fabric.items, { filter: 'all', query: '' });
    expect(all.filter((row) => row.kind === 'group').map((row) => [row.group, row.count])).toEqual([['mod', 4], ['datapack', 1]]);
    expect(all[0]).toMatchObject({ kind: 'group', group: 'mod' });
    const mods = contentList(fabric.items, { filter: 'mod', query: '' });
    expect(mods.every((row) => row.kind === 'entry' && row.row.entry.kind === 'mod')).toBe(true);
    const vanilla = contentList(seedContentInventory('vanilla').items, { filter: 'all', query: '' });
    expect(vanilla.some((row) => row.kind === 'group')).toBe(false);
  });

  test('search matches names, files and versions; rows sort by name', () => {
    const fabric = seedContentInventory('fabric');
    expect(contentRows(fabric.items, { filter: 'all', query: 'LITHIUM' }).map((row) => row.name)).toEqual(['Lithium']);
    expect(contentRows(fabric.items, { filter: 'all', query: 'old-mod.jar' }).map((row) => row.key)).toEqual(['mods/old-mod.jar']);
    expect(contentRows(fabric.items, { filter: 'all', query: '1.0' }).map((row) => row.name)).toEqual(['Lithium']);
    const names = contentRows(fabric.items, { filter: 'all', query: '', project: (entry) => entry.provider?.projectId === 'fabric-api' ? { name: 'Fabric API' } : undefined }).map((row) => row.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })));
    expect(names).toContain('Fabric API');
  });

  test('pending changes have restart labels and a summary', () => {
    for (const id of Object.values(pendingLabel)) expect(known.has(id)).toBe(true);
    expect(pendingLabel.install).toBe('server-content.pending-install');
    const fabric = seedContentInventory('fabric');
    expect(pendingSummary(fabric.items, running)).toEqual({ count: 2, failed: 0, running: true });
    fabric.items[0].pending = 'disable';
    fabric.items[0].pendingError = 'disk full';
    expect(pendingSummary(fabric.items, stopped)).toEqual({ count: 3, failed: 1, running: false });
  });

  test('capabilities gate actions; queued, unfingerprinted and unknown-state rows stay safe', () => {
    const inventory = seedContentInventory('fabric');
    const gates = contentGates(inventory, running);
    expect(gates).toMatchObject({ running: true, install: true, remove: true, toggle: true, cancel: true, datapackToggle: true });
    const denied = contentGates(inventory, { ...running, capabilities: { source: 'session', granted: ['files.list'], refused: [] } });
    expect(denied.install || denied.remove || denied.toggle || denied.cancel).toBe(false);
    inventory.capabilities.datapackToggleRunning = false;
    expect(contentGates(inventory, running).datapackToggle).toBe(false);
    expect(contentGates(inventory, stopped).datapackToggle).toBe(true);

    const [lithium, unidentified, pendingRemove, pendingInstall] = inventory.items;
    expect(rowActions(lithium, gates, true)).toEqual({ toggle: true, remove: true, update: true, cancel: false, identify: false, managed: false });
    expect(rowActions(unidentified, gates, false)).toMatchObject({ identify: true, update: false });
    expect(rowActions(pendingRemove, gates, false)).toMatchObject({ toggle: false, remove: false, cancel: true });
    expect(rowActions(pendingInstall, gates, false)).toMatchObject({ toggle: false, remove: false, identify: false, cancel: true });
    expect(rowActions({ ...lithium, sha256: null }, gates, true)).toMatchObject({ toggle: false, remove: false, update: false });
  });

  test('requests carry the validator and datapacks never use contentMutate toggles', () => {
    const [lithium] = seedContentInventory('fabric').items;
    expect(mutationRequest(lithium, 'disable')).toEqual({ action: 'disable', kind: 'mod', path: 'mods/lithium.jar', expectedSha256: lithium.sha256 });
    expect(mutationRequest({ ...lithium, sha256: null }, 'remove')).toBeNull();
    const datapack = seedContentInventory('vanilla').items[0];
    expect(mutationRequest(datapack, 'enable')).toBeNull();
    expect(mutationRequest(datapack, 'remove')?.action).toBe('remove');
    expect(datapackId(datapack)).toBe('file/terralith.zip');
    expect(updateRequest(lithium, { id: 'lithium-3' })).toEqual({ provider: 'modrinth', projectId: 'lithium', versionId: 'lithium-3', kind: 'mod', path: 'mods/lithium.jar', expectedSha256: lithium.sha256 });
    expect(providerLookups(seedContentInventory('fabric').items).get('modrinth')).toEqual(['lithium', 'fabric-api', 'terralith']);
  });

  test('updates use the server software and version, and only offer newer releases', () => {
    const inventory = seedContentInventory('fabric');
    const versions = [
      { id: 'lithium-3', version_number: '1.9.0', game_versions: ['1.21.4'], loaders: ['fabric'], release_type: 'release', dependencies: [] },
      { id: 'lithium-1.0', version_number: '1.0', game_versions: ['1.21.4'], loaders: ['fabric'], release_type: 'release', dependencies: [] },
    ];
    expect(contentUpdate(inventory.items[0], versions, inventory)?.id).toBe('lithium-3');
    expect(contentUpdate({ ...inventory.items[0], provider: { ...inventory.items[0].provider, versionId: 'lithium-3' } }, versions, inventory)).toBeUndefined();
    expect(contentUpdate(inventory.items[0], versions, { ...inventory, software: 'forge' })).toBeUndefined();
    expect(contentUpdate(inventory.items[1], versions, inventory)).toBeUndefined();
  });

  test('content errors name unsupported kinds', () => {
    expect(contentErrorMessage({ code: 'conflict', reason: 'content_mods_unsupported' })).toBe('server-content.error-mods-unsupported');
    expect(contentErrorMessage({ code: 'conflict', reason: 'content_plugins_unsupported' })).toBe('server-content.error-plugins-unsupported');
    expect(contentErrorMessage({ code: 'stale_target' })).toBe('server-content.error-stale');
    expect(known.has(contentErrorMessage({ code: 'forbidden' }))).toBe(true);
  });

  test('the Resources tab is a live main tab that needs file listing', () => {
    expect(mainTabs.find((tab) => tab.id === 'resources')).toMatchObject({ live: true, needs: ['files.list'], label: 'server-content.tab' });
  });
});

describe('custom server JAR', () => {
  test('launch state maps custom, managed and original', () => {
    expect(launchKind({ current: { software: null, version: '1.21.1', build: null, installationId: 'custom_jar', customJar: { path: 'jars/server.jar' } } })).toEqual({ kind: 'custom', path: 'jars/server.jar' });
    expect(launchKind({ current: { software: 'paper', version: '1.21.1', build: 1, installationId: 'x' } })).toEqual({ kind: 'managed' });
    expect(launchKind({ current: null })).toEqual({ kind: 'original' });
    expect(launchKind(undefined)).toEqual({ kind: 'original' });
  });

  test('only game-relative .jar paths inside the server root are accepted', () => {
    expect(isServerJarPath('server.jar')).toBe(true);
    expect(isServerJarPath('jars/Custom.JAR')).toBe(true);
    for (const path of ['/server.jar', '../server.jar', 'a/../b.jar', 'C:/x.jar', 'a\\b.jar', 'server.zip', 'a//b.jar']) expect(isServerJarPath(path)).toBe(false);
  });

  test('the picker lists folders first, then jars only', () => {
    const entries = [
      { name: 'server.properties', kind: 'file', size: '1', modifiedAtMs: null },
      { name: 'paper.jar', kind: 'file', size: '1', modifiedAtMs: null },
      { name: 'world', kind: 'directory', size: '0', modifiedAtMs: null },
      { name: 'Alpha.jar', kind: 'file', size: '1', modifiedAtMs: null },
    ];
    expect(jarPickerEntries(entries).map((entry) => entry.name)).toEqual(['world', 'Alpha.jar', 'paper.jar']);
  });

  test('the review shows what the agent reported', () => {
    const review = customJarReview({ customJar: { path: 'server.jar' }, mainClass: 'net.minecraft.server.Main', risks: ['executes_owner_selected_server_jar', 'something_new'] });
    expect(review).toEqual({ path: 'server.jar', mainClass: 'net.minecraft.server.Main', risks: ['server-hosting.custom-jar-risk-executes', 'server-hosting.warning-other'] });
    expect(customJarReview({ customJar: null, mainClass: null, risks: [] }).path).toBeNull();
    for (const id of review.risks) expect(known.has(id)).toBe(true);
  });
});

describe('browse server adapters', () => {
  const project = { id: 'lithium', name: 'Lithium', source: 'modrinth' };
  const version = { id: 'lithium-3', version_number: '1.9.0' };
  const row = (id, extra) => ({ project: { id, name: id, source: 'modrinth' }, version: { id: `${id}-v`, version_number: '1' }, required: true, selected: true, ...extra });

  test('install plan sends selected, uninstalled, versioned dependencies before the project', () => {
    const plan = serverInstallPlan({ project, version, kind: 'mod', dependencies: [
      row('fabric-api'),
      row('modmenu', { selected: false, required: false }),
      row('installed', { installed: true }),
      row('unversioned', { version: null }),
    ] });
    expect(plan).toEqual([
      { provider: 'modrinth', projectId: 'fabric-api', versionId: 'fabric-api-v', kind: 'mod', name: 'fabric-api' },
      { provider: 'modrinth', projectId: 'lithium', versionId: 'lithium-3', kind: 'mod', name: 'Lithium' },
    ]);
  });

  test('plugins and datapacks install; client-only kinds and other sources do not', () => {
    expect(serverInstallPlan({ project, version, kind: 'plugin', dependencies: [] })?.[0].kind).toBe('plugin');
    expect(serverInstallPlan({ project, version, kind: 'datapack', dependencies: [] })?.[0].kind).toBe('datapack');
    expect(serverInstallPlan({ project, version, kind: 'shader', dependencies: [] })).toBeNull();
    expect(serverInstallPlan({ project: { ...project, source: 'smithed' }, version, kind: 'datapack', dependencies: [] })).toBeNull();
  });

  test('resolver rows map straight to dependency candidates', () => {
    const candidates = previewCandidates({ dependencies: [
      { project: { id: 'fabric-api', name: 'Fabric API', source: 'modrinth', icon_url: 'x.png', extra: 1 }, version: { id: 'v2', version_number: '2.0', loaders: [] }, required: true, installed: true },
      { project: { id: 'modmenu', name: 'Mod Menu', source: 'modrinth', icon_url: null }, version: { id: 'v1', version_number: '1.0' }, required: false, installed: false },
    ] });
    expect(candidates).toEqual([
      { project: { id: 'fabric-api', name: 'Fabric API', source: 'modrinth', icon_url: 'x.png' }, version: { id: 'v2', version_number: '2.0' }, required: true, installed: true },
      { project: { id: 'modmenu', name: 'Mod Menu', source: 'modrinth', icon_url: null }, version: { id: 'v1', version_number: '1.0' }, required: false, installed: false },
    ]);
  });
});
