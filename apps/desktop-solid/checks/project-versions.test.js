import { describe, expect, test } from 'bun:test';
import {
  emptyVersionFilter,
  filterVersions,
  minecraftVersionsOf,
  projectPath,
  sortVersions,
  summarizeGameVersions,
  versionFacets,
  versionFiles,
  versionFit,
  versionPath,
} from '../src/features/browse/browse-model.ts';
import { activateVersionFilter, updateVersionFilter, versionFilterFor } from '../src/features/browse/version-filter.ts';
import { parseRoute } from '../src/app/router.ts';

const version = (id, games, loaders, release_type = 'release', published_at = '2026-01-01') => ({
  id,
  project_id: 'p',
  version_number: `v${id}`,
  game_versions: games,
  loaders,
  download_url: `https://example.test/${id}.jar`,
  file_name: `${id}.jar`,
  release_type,
  published_at,
});

const fabric = { minecraftVersion: '1.21.1', modloader: 'fabric' };
const context = { target: fabric, type: 'mod', source: 'modrinth' };

describe('project page versions', () => {
  test('Minecraft versions drop loader and side tags and sort newest first, releases above snapshots', () => {
    expect(minecraftVersionsOf(['1.20.1', 'fabric', 'Client', '24w14a', '1.21.10', '1.21.4'])).toEqual([
      '1.21.10',
      '1.21.4',
      '1.20.1',
      '24w14a',
    ]);
    expect(summarizeGameVersions(['1.21.4'])).toBe('1.21.4');
    expect(summarizeGameVersions(['1.21.4', '1.21.1'])).toBe('1.21.4, 1.21.1');
    expect(summarizeGameVersions(['1.21.4', '1.21.1', '1.20.1'])).toBe('1.20.1 – 1.21.4');
  });

  test('one version fits a target or says why not', () => {
    expect(versionFit(version('a', ['1.21.1'], ['fabric']), fabric, 'mod', 'modrinth')).toEqual({
      kind: 'fits',
      borrowedLoader: false,
    });
    expect(versionFit(version('a', ['1.21.1'], ['fabric']), { ...fabric, modloader: 'quilt' }, 'mod')).toEqual({
      kind: 'fits',
      borrowedLoader: true,
    });
    expect(versionFit(version('b', ['1.20.1'], ['fabric']), fabric, 'mod').kind).toBe('game');
    expect(versionFit(version('c', ['1.21.1'], ['forge']), fabric, 'mod').kind).toBe('loader');
    expect(versionFit(version('d', ['1.21.1'], ['iris']), { ...fabric, modloader: 'vanilla' }, 'shader').kind).toBe(
      'vanilla',
    );
  });

  test('filters combine channel, loader, Minecraft version, text and fit', () => {
    const list = sortVersions([
      version('old', ['1.20.1'], ['fabric'], 'release', '2025-01-01'),
      version('beta', ['1.21.1'], ['fabric'], 'beta', '2026-03-01'),
      version('forge', ['1.21.1'], ['forge'], 'release', '2026-02-01'),
      version('new', ['1.21.1'], ['fabric', 'quilt'], 'release', '2026-04-01'),
    ]);
    expect(list.map((item) => item.id)).toEqual(['new', 'beta', 'forge', 'old']);
    const ids = (filter) => filterVersions(list, { ...emptyVersionFilter, ...filter }, context).map((item) => item.id);
    expect(ids({})).toEqual(['new', 'beta', 'forge', 'old']);
    expect(ids({ channel: 'release' })).toEqual(['new', 'forge', 'old']);
    expect(ids({ loader: 'forge' })).toEqual(['forge']);
    expect(ids({ gameVersion: '1.20.1' })).toEqual(['old']);
    expect(ids({ text: 'vbeta' })).toEqual(['beta']);
    expect(ids({ text: '1.20.1' })).toEqual(['old']);
    expect(ids({ fits: true })).toEqual(['new', 'beta']);
    // Without a target, "fits" has nothing to compare against and filters nothing.
    expect(filterVersions(list, { ...emptyVersionFilter, fits: true }, { ...context, target: undefined })).toHaveLength(4);
  });

  test('facets list every Minecraft version and real loader once', () => {
    const facets = versionFacets([
      version('a', ['1.21.1', '1.20.1'], ['fabric', 'minecraft']),
      version('b', ['1.21.1'], ['neoforge', 'datapack']),
    ]);
    expect(facets.gameVersions).toEqual(['1.21.1', '1.20.1']);
    expect(facets.loaders).toEqual(['fabric', 'neoforge']);
  });

  test('legacy versions without a file list still show their download as the primary file', () => {
    expect(versionFiles(version('a', ['1.21.1'], ['fabric']))).toEqual([
      { url: 'https://example.test/a.jar', file_name: 'a.jar', hash: undefined, file_size: null, role: 'primary' },
    ]);
  });

  test('project and version routes round-trip through the router', () => {
    expect(projectPath('modrinth', 'sodium')).toBe('/browse/project/modrinth/sodium');
    expect(projectPath('modrinth', 'sodium', 'versions')).toBe('/browse/project/modrinth/sodium/versions');
    const path = versionPath('curseforge', '306612', 'a/b');
    expect(path).toBe('/browse/project/curseforge/306612/version/a%2Fb');
    const route = parseRoute(path);
    expect([route.page, route.section, route.detail, route.item]).toEqual(['browse', 'project', 'curseforge', '306612']);
    expect(route.rest.map(decodeURIComponent)).toEqual(['version', 'a/b']);
  });
});


test('version filters survive sibling views and reset after entering another project', () => {
  activateVersionFilter('modrinth:a');
  updateVersionFilter('modrinth:a', { text: 'old-release' });
  activateVersionFilter('modrinth:a');
  expect(versionFilterFor('modrinth:a').text).toBe('old-release');
  activateVersionFilter('modrinth:b');
  activateVersionFilter('modrinth:a');
  expect(versionFilterFor('modrinth:a').text).toBe('');
});
