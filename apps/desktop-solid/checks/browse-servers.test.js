import { describe, expect, test } from 'bun:test';
import {
  categoryDisplayName,
  normalizeQuery,
  parseProjectUrl,
  sourceById,
  sourcesForType,
  typeUsesLoader,
} from '../src/features/browse/browse-model.ts';
import {
  joinFit,
  parseInstanceServerStatus,
  pingFreshness,
  recommendedGameVersion,
  regionFallback,
  regionMessage,
  serverPack,
  vanillaVersionText,
} from '../src/features/browse/server-listing.ts';

const vanilla = {
  address: 'donutsmp.net',
  content: { kind: 'vanilla', gameVersions: ['1.21.11', '1.21.10', '1.21.4', '1.21'], recommendedVersion: '1.21.11' },
  ping: { at: '2026-11-02T02:33:14Z', online: 21929, max: 50000, versionName: 'Velocity', latencyMs: 22 },
  region: 'us_east',
  languages: ['en'],
  plays2w: 10521,
};
const modpack = {
  ...vanilla,
  address: 'play.aerosmp.com',
  content: { kind: 'modpack', projectId: 'OgcNPs6n', versionId: 'GDELFL7Y', projectName: 'Aero SMP', projectIcon: null },
};

describe('server listings in Browse', () => {
  test('servers are a Modrinth-only type that filters by loader', () => {
    expect(sourcesForType('server').map((source) => source.id)).toEqual(['modrinth']);
    expect(sourceById('curseforge').types).not.toContain('server');
    const modrinth = sourceById('modrinth').types;
    expect(modrinth.indexOf('server')).toBe(modrinth.indexOf('modpack') + 1);
    expect(typeUsesLoader('server')).toBe(true);
    expect(normalizeQuery({ type: 'server', source: 'modrinth', text: '', gameVersion: null, loader: 'NeoForge', client: true,
      server: true, creator: null, categories: [], sort: 'relevance', sortOrder: 'desc', pageSize: 20, page: 1 }))
      .toMatchObject({ loader: 'neoforge', client: false, server: false });
  });

  test('server pages parse and server categories read as acronyms', () => {
    expect(parseProjectUrl('https://modrinth.com/server/aero-server')).toEqual({ platform: 'modrinth', id: 'aero-server' });
    expect(['smp', 'pvp', 'survival-mode', 'kitpvp'].map(categoryDisplayName)).toEqual(['SMP', 'PvP', 'Survival Mode', 'KitPvP']);
    expect(categoryDisplayName('kitchen-sink')).toBe('Kitchen Sink');
  });

  test('ping freshness: recent is live, old is stale, none is offline', () => {
    const at = Date.parse(vanilla.ping.at);
    expect(pingFreshness(vanilla.ping, at + 5 * 60_000)).toBe('live');
    expect(pingFreshness(vanilla.ping, at + 2 * 3_600_000)).toBe('stale');
    expect(pingFreshness(null, at)).toBe('none');
  });

  test('content labels, regions and the version a new vanilla instance uses', () => {
    expect(vanillaVersionText(vanilla)).toBe('1.21.11');
    expect(vanillaVersionText({ ...vanilla, content: { ...vanilla.content, recommendedVersion: null } })).toBe('1.21 – 1.21.11');
    expect(recommendedGameVersion(vanilla)).toBe('1.21.11');
    expect(serverPack(modpack)?.versionId).toBe('GDELFL7Y');
    expect(serverPack(vanilla)).toBeUndefined();
    expect(regionMessage('us_east')).toBe('browse.region-us-east');
    expect(regionMessage('mars')).toBeUndefined();
    expect(regionFallback('north_africa')).toBe('North africa');
  });

  test('which instances can join: same Modrinth pack, or a supported vanilla version', () => {
    const pack = { platform: 'modrinth', projectId: 'OgcNPs6n' };
    expect(joinFit(modpack, { minecraftVersion: '1.21.1', modloader: 'neoforge', pack })).toBe('fits');
    expect(joinFit(modpack, { minecraftVersion: '1.21.1', modloader: 'neoforge', pack: { ...pack, platform: 'curseforge' } })).toBe('pack');
    expect(joinFit(modpack, { minecraftVersion: '1.21.1', modloader: 'neoforge' })).toBe('pack');
    expect(joinFit(vanilla, { minecraftVersion: '1.21.4', modloader: 'vanilla' })).toBe('fits');
    expect(joinFit(vanilla, { minecraftVersion: '1.20.1', modloader: 'fabric' })).toBe('game');
  });

  test('instance_server_status reads the backend shape (snake_case flags, listing ping)', () => {
    const status = parseInstanceServerStatus({
      server: { platform: 'modrinth', projectId: 'OgcNPs6n', address: 'play.aerosmp.com' },
      listing: modpack,
      update_available: true,
      update_required: false,
    });
    expect(status).toEqual({
      link: { platform: 'modrinth', projectId: 'OgcNPs6n', address: 'play.aerosmp.com' },
      ping: modpack.ping,
      versionId: 'GDELFL7Y',
      updateAvailable: true,
      updateRequired: false,
    });
    expect(parseInstanceServerStatus(null)).toBeNull();
    expect(parseInstanceServerStatus({ server: { platform: 'curseforge', projectId: 'x' }, listing: vanilla }).link).toBeNull();
  });
});
