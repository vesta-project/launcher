import { expect, test } from 'bun:test';
import { onlinePackInfo } from '../src/features/installation/online-pack';

const project = { id: 'project', source: 'modrinth', name: 'Pack', summary: 'Short summary',
  description: 'Long markdown body', author: 'Author', icon_url: 'https://example.test/icon.png', download_count: 42 };
const release = { id: 'uQxD0ENB', version_number: 'Pack 2.0', game_versions: ['1.21.1'],
  loaders: ['mrpack', 'fabric'], download_url: 'https://example.test/pack.mrpack' };

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
