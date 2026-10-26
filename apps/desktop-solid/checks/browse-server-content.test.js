import { describe, expect, test } from 'bun:test';
import { sourcesForType, normalizeQuery, parseOperators, pluginLoaderIds, projectCompatibility } from '../src/features/browse/browse-model.ts';
describe('plugin browse contracts', () => {
  test('plugins belong to provider catalogs and have server loader filters', () => {
    expect(sourcesForType('plugin').map(s => s.id)).toEqual(['modrinth', 'curseforge']);
    expect(pluginLoaderIds).toEqual(['paper', 'spigot', 'bukkit', 'purpur', 'folia']);
    expect(parseOperators('loader:paper ', {})).toMatchObject({ loader: 'paper', didExtract: true });
  });
  test('plugins cannot be installed into a client instance', () => {
    expect(projectCompatibility({ categories: ['paper'] }, 'plugin', { loader: 'fabric', minecraftVersion: '1.21.4' }).kind).toBe('incompatible');
  });
});
