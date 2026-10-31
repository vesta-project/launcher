import { expect, test } from 'bun:test';
import { onlinePackInfo, resolveOnlinePack } from '../src/features/installation/online-pack';

const project = { id: 'project', source: 'modrinth', name: 'Pack', summary: 'Short summary',
  description: 'Long markdown body', author: 'Author', icon_url: 'https://example.test/icon.png', download_count: 42 };
const release = { id: 'uQxD0ENB', version_number: 'Pack 2.0', game_versions: ['1.21.1'],
  loaders: ['mrpack', 'fabric'], download_url: 'https://example.test/pack.mrpack' };

test('RLCraft missing loader and empty API metadata both inspect the pinned client archive', async () => {
  for (const game_versions of [['1.12.2'], []]) {
    let calls = 0;
    const selection = { project: { ...project, id: '285109', source: 'curseforge' }, release: { ...release, id: '4612979', game_versions, loaders: [] } };
    expect(onlinePackInfo(selection).modloader).toBe('vanilla'); // previous Browse behavior
    const result = await resolveOnlinePack(selection, async () => { calls++; return { minecraftVersion: '1.12.2', modloader: 'forge', modloaderVersion: '14.23.5.2860', modCount: 185 }; });
    expect(calls).toBe(1);
    expect(result).toMatchObject({ minecraftVersion: '1.12.2', modloader: 'forge', modloaderVersion: '14.23.5.2860', versionFromManifest: true, modpackId: '285109', modpackVersionId: '4612979' });
  }
});

test('complete metadata avoids archive IO; a manual-download refusal is surfaced', async () => {
  await resolveOnlinePack({ project, release }, () => { throw new Error('unexpected download'); });
  await expect(resolveOnlinePack({ project: { ...project, source: 'curseforge' }, release: { ...release, loaders: [] } }, async () => { throw new Error('Manual download required for pack.zip'); })).rejects.toThrow('Manual download required');
});

test('provider pack metadata uses summary, real engine, project identity and release display name', () => {
  expect(onlinePackInfo({ project, release })).toMatchObject({ description: 'Short summary',
    modloader: 'fabric', minecraftVersion: '1.21.1', modpackId: 'project',
    modpackVersionId: 'uQxD0ENB', version: 'Pack 2.0', modpackPlatform: 'modrinth' });
});
test('release changes retain the project and map only supported loaders for either provider', () => {
  expect(onlinePackInfo({ project: { ...project, source: 'curseforge' },
    release: { ...release, id: 'next', version_number: 'Pack 3.0', loaders: ['modpack', 'neoforge'] } }))
    .toMatchObject({ modloader: 'neoforge', modpackId: 'project', modpackVersionId: 'next',
      version: 'Pack 3.0', modpackPlatform: 'curseforge', description: 'Short summary' });
  expect(onlinePackInfo({ project, release: { ...release, loaders: ['mrpack'] } }).modloader).toBe('vanilla');
});
