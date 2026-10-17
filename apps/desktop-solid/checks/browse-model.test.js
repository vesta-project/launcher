import { describe, expect, test } from 'bun:test';
import {
  normalizeQuery,
  pageCount,
  parseOperators,
  parseProjectUrl,
  queryKey,
  selectInstallVersion,
  taskMatchesInstall,
  updateAvailable,
} from '../src/features/browse/browse-model.ts';

const base = {
  type: 'mod',
  source: 'modrinth',
  text: '',
  gameVersion: null,
  loader: null,
  client: false,
  server: false,
  creator: null,
  categories: [],
  sort: 'relevance',
  sortOrder: 'desc',
  pageSize: 20,
  page: 1,
};

const version = (id, games, loaders, release_type = 'release', published_at = '2026-01-01') => ({
  id,
  project_id: 'p',
  version_number: id,
  game_versions: games,
  loaders,
  download_url: 'https://example.invalid/file.jar',
  file_name: 'file.jar',
  release_type,
  published_at,
});

describe('search operators', () => {
  test('whitespace-terminated tokens become filters and leave the text', () => {
    const result = parseOperators('sodium mc:1.20.1 loader:neo fast');
    expect(result).toMatchObject({ gameVersion: '1.20.1', loader: 'neoforge', remainder: 'sodium fast', didExtract: true });
  });

  test('a trailing token waits for Enter and unknown values stay in the text', () => {
    expect(parseOperators('mc:1.21.1').didExtract).toBe(false);
    expect(parseOperators('mc:1.21.1', { commitTrailing: true }).gameVersion).toBe('1.21.1');
    expect(parseOperators('loader:bukkit ', { commitTrailing: true }).didExtract).toBe(false);
    expect(parseOperators('mc:1.20-1.21 ').didExtract).toBe(false);
  });
});

describe('project URLs', () => {
  test('recognises Modrinth, CurseForge and Smithed pages', () => {
    expect(parseProjectUrl('https://modrinth.com/mod/sodium/versions')).toEqual({ platform: 'modrinth', id: 'sodium' });
    expect(parseProjectUrl('https://www.curseforge.com/minecraft/mc-mods/jei/files')).toEqual({ platform: 'curseforge', id: 'jei' });
    expect(parseProjectUrl('https://smithed.net/packs/coc')).toEqual({ platform: 'smithed', id: 'coc' });
    expect(parseProjectUrl('sodium')).toBeUndefined();
    expect(parseProjectUrl('https://example.com/mod/sodium')).toBeUndefined();
  });
});

describe('query keys', () => {
  test('equivalent searches share a key; real differences do not', () => {
    const a = queryKey({ ...base, text: '  sodium  ', categories: ['b', 'a', 'a'], client: true });
    const b = queryKey({ ...base, text: 'sodium', categories: ['a', 'b'], client: false });
    // Modrinth mods support the environment filter, so client differs; CurseForge ignores it.
    expect(a).not.toBe(b);
    const forge = { ...base, source: 'curseforge', sort: 'featured' };
    expect(queryKey({ ...forge, client: true, loader: ' ' })).toBe(queryKey(forge));
  });

  test('loaders only count for loader-aware types, and unknown sorts fall back', () => {
    expect(normalizeQuery({ ...base, type: 'resourcepack', loader: 'fabric' }).loader).toBeNull();
    expect(normalizeQuery({ ...base, sort: 'popularity' }).sort).toBe('relevance');
    expect(queryKey({ ...base, page: 2 }, false)).toBe(queryKey({ ...base, page: 9 }, false));
    expect(queryKey({ ...base, page: 2 })).not.toBe(queryKey({ ...base, page: 3 }));
  });

  test('page counts respect the host window', () => {
    expect(pageCount(0, 20)).toBe(1);
    expect(pageCount(41, 20)).toBe(3);
    expect(pageCount(1_000_000, 50)).toBe(200);
  });
});

describe('install version selection', () => {
  const target = { minecraftVersion: '1.21.1', modloader: 'fabric' };

  test('prefers the newest release for the game version and loader', () => {
    const versions = [
      version('beta', ['1.21.1'], ['fabric'], 'beta', '2026-03-01'),
      version('old', ['1.21.1'], ['fabric'], 'release', '2026-01-01'),
      version('new', ['1.21.1'], ['fabric'], 'release', '2026-02-01'),
      version('forge', ['1.21.1'], ['forge'], 'release', '2026-04-01'),
      version('other-game', ['1.20.1'], ['fabric'], 'release', '2026-05-01'),
    ];
    expect(selectInstallVersion(versions, target, 'mod')?.version.id).toBe('new');
  });

  test('falls back to beta, then alpha, and reports no match', () => {
    expect(selectInstallVersion([version('a', ['1.21.1'], ['fabric'], 'alpha'), version('b', ['1.21.1'], ['fabric'], 'beta')], target, 'mod')?.version.id).toBe('b');
    expect(selectInstallVersion([version('x', ['1.19'], ['fabric'])], target, 'mod')).toBeUndefined();
  });

  test('Quilt may borrow Fabric builds, vanilla cannot take mods, packs ignore loaders', () => {
    const fabricOnly = [version('f', ['1.21.1'], ['fabric'])];
    const borrowed = selectInstallVersion(fabricOnly, { ...target, modloader: 'quilt' }, 'mod');
    expect(borrowed?.version.id).toBe('f');
    expect(borrowed?.borrowedLoader).toBe(true);
    expect(selectInstallVersion(fabricOnly, { ...target, modloader: 'vanilla' }, 'mod')).toBeUndefined();
    expect(selectInstallVersion([version('r', ['1.21.1'], ['minecraft'])], { ...target, modloader: 'vanilla' }, 'resourcepack')?.version.id).toBe('r');
  });

  test('range tags like 1.21.x match, and updates compare against the installed version', () => {
    const choice = selectInstallVersion([version('range', ['1.21.x'], ['fabric'])], target, 'mod');
    expect(choice?.version.id).toBe('range');
    expect(updateAvailable({ remote_version_id: 'range' }, choice)).toBe(false);
    expect(updateAvailable({ remote_version_id: 'older' }, choice)).toBe(true);
    expect(updateAvailable(undefined, choice)).toBe(false);
  });
});

describe('install error task ids', () => {
  const b64 = (value) => btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const install = { instanceId: '7', platform: 'modrinth', projectId: 'sodium', versionId: 'v1' };

  test('matches v2 and legacy ids for the same install only', () => {
    expect(taskMatchesInstall(`download|v2|instance-7|modrinth|${b64('sodium')}|${b64('v1')}`, install)).toBe(true);
    expect(taskMatchesInstall(`download|v2|instance-8|modrinth|${b64('sodium')}|${b64('v1')}`, install)).toBe(false);
    expect(taskMatchesInstall(`download|v2|instance-7|curseforge|${b64('sodium')}|${b64('v1')}`, install)).toBe(false);
    expect(taskMatchesInstall('download_instance-7_sodium_v1', install)).toBe(true);
    expect(taskMatchesInstall('something-else', install)).toBe(false);
  });
});
