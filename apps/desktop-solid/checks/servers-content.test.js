import { describe, expect, test } from 'bun:test';
import { seedContentInventory, createContentFixtures } from '../src/features/servers/fixtures-content.ts';

describe('server content inventory and staging', () => {
  test('covers Fabric, Paper, vanilla, unidentified jars and pending changes', () => {
    const fabric = seedContentInventory('fabric'), paper = seedContentInventory('paper'), vanilla = seedContentInventory('vanilla');
    expect(fabric.capabilities.modsSupported).toBe(true);
    expect(fabric.items.some(i => i.kind === 'mod' && i.provider === null)).toBe(true);
    expect(fabric.items.some(i => i.pending === 'install')).toBe(true);
    expect(paper.items.some(i => i.kind === 'plugin' && i.declared?.loader === 'bukkit')).toBe(true);
    expect(vanilla.items.every(i => i.kind === 'datapack')).toBe(true);
    expect(vanilla.capabilities.modsSupported).toBe(false);
    expect(vanilla.capabilities.pluginsSupported).toBe(false);
  });
  test('running jar changes remain pending through stop and apply on a new generation', async () => {
    const target = { snapshot: { connection: { role: 'owner' }, status: { state: 'running', generation: 'g1' }, capabilities: { granted: ['files.list', 'files.read', 'content.install', 'files.rename', 'files.delete', 'files.create', 'files.overwrite'] } } };
    const api = createContentFixtures({ server: () => target, software: () => 'fabric', wait: async () => {} });
    const item = (await api.content('f')).items.find(i => i.path.endsWith('lithium.jar'));
    const request = { action: 'disable', kind: 'mod', path: item.path, expectedSha256: item.sha256 };
    const change = await api.contentMutate('f', request, 'disable');
    expect(change.state).toBe('pending');
    expect((await api.content('f')).items.find(i => i.path === item.path).enabled).toBe(true);
    expect((await api.contentMutate('f', request, 'disable')).id).toBe(change.id);
    target.snapshot.status = { state: 'stopped', generation: null };
    expect((await api.content('f')).items.find(i => i.path === item.path).pending).toBe('disable');
    target.snapshot.status = { state: 'running', generation: 'g2' };
    expect((await api.content('f')).items.find(i => i.path === `${item.path}.disabled`).enabled).toBe(false);
  });
  test('capabilities gate writes and incompatible kinds have clear reasons', async () => {
    const target = { snapshot: { connection: { role: 'owner' }, status: { state: 'stopped', generation: null }, capabilities: { granted: ['files.list', 'content.install', 'files.create', 'files.overwrite'] } } };
    const api = createContentFixtures({ server: () => target, software: () => 'vanilla', wait: async () => {} });
    await expect(api.contentInstall('v', { kind: 'mod', provider: 'modrinth', projectId: 'lithium', versionId: 'v1' }, 'i')).rejects.toMatchObject({ reason: 'content_mods_unsupported' });
    target.snapshot.capabilities.granted = ['files.list'];
    expect((await api.content('v')).capabilities.install).toBe(false);
  });
});

import { contentSide } from '../src/features/servers/content-model.ts';
test('resource sides use declarations and explicit provider requirements, never installation location', () => {
 const mod={kind:'mod',declared:null};
 expect(contentSide(mod)).toBe('server-content.side-unknown');
 expect(contentSide({...mod,declared:{side:'*'}})).toBe('server-content.side-both');
 expect(contentSide({...mod,declared:{side:'client'}})).toBe('server-content.side-client');
 expect(contentSide({...mod,declared:{side:'server'}})).toBe('server-content.side-server');
 expect(contentSide({kind:'plugin',declared:null})).toBe('server-content.side-server');
 expect(contentSide({kind:'datapack',declared:null})).toBe('server-content.side-world');
 expect(contentSide(mod,{environment:{client:true,server:true}})).toBe('server-content.side-unknown');
 expect(contentSide(mod,{environment:{client:true,server:true,client_requirement:'required',server_requirement:'optional'}})).toBe('server-content.side-both');
 expect(contentSide(mod,{environment:{client:false,server:true,client_requirement:'unsupported',server_requirement:'required'}})).toBe('server-content.side-server');
});
