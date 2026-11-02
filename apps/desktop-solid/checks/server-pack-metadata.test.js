import { expect, test } from 'bun:test';
import { customModsWithoutProvider, serverPackMetadata } from '../src/features/servers/native-pack-sync';

test('form uses actual pack version and inventory, never publication revision or empty diff', () => {
  const details = { name: 'Client pack', version: '4.2', revision: '97', runtime: { minecraftVersion: '1.21.1', loader: 'neoforge', loaderVersion: '21.1.229' }, changes: [], resources: [{ path: 'mods/a.jar' }, { path: 'resourcepacks/art.zip' }], author: 'Author', iconUrl: 'https://example.com/icon.png', format: 'custom' };
  const info = serverPackMetadata(details);
  expect(info.version).toBe('4.2');
  expect(info.modCount).toBe(2);
  expect(info.author).toBe('Author');
  expect(info.iconUrl).toBe(details.iconUrl);
  expect(serverPackMetadata({ ...details, version: undefined }).version).toBe('');
});

test('custom-pack warning targets only mods without a recognized provider', () => {
  const resources = [
    { path: 'mods/local.jar', platform: null },
    { path: 'mods/external.jar', platform: 'other' },
    { path: 'mods/known.jar', platform: 'modrinth' },
    { path: 'mods/also-known.jar', platform: 'curseforge' },
    { path: 'resourcepacks/local.zip', platform: null },
    { path: 'shaderpacks/local.zip', platform: null },
    { path: 'config/settings.json', platform: null },
  ];
  expect(customModsWithoutProvider({ format: 'custom', resources }).map(item => item.path)).toEqual(['mods/local.jar', 'mods/external.jar']);
  expect(customModsWithoutProvider({ format: 'modrinth', resources })).toEqual([]);
});