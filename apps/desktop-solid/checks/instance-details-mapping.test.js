import { describe, expect, test } from 'bun:test';
import { logCatchup, parseNativeCrash, resourceFromNative, resourceScope, worldFromNative, worldRouteId, worldTransferNeedsAcknowledgement } from '../src/features/instances/native-details-model';

describe('native instance detail boundaries', () => {
  test('resource identity uses the ledger ID and exact update artifact', () => {
    const row = { id: 37, platform: 'curseforge', remote_id: '123', remote_version_id: 'old', resource_type: 'resourcepack',
      local_path: 'C:\\Game\\resourcepacks\\Pack.zip.disabled', display_name: 'Pack', current_version: '1.0',
      is_manual: false, is_enabled: false, file_size: 2049, source_kind: 'modpack' };
    expect(resourceFromNative(row, 'icon', { version_number: '2.0' })).toMatchObject({ id: '37', filename: 'Pack.zip.disabled',
      kind: 'resourcepack', source: 'CurseForge', enabled: false, bundled: true, sizeKb: 3, update: '2.0' });
    expect(resourceFromNative({ ...row, is_manual: true }, '').source).toBe('Local');
    expect(resourceFromNative({ ...row, source_kind: 'user' }, '').bundled).toBe(false);
  });
  test('world directory identity survives route escaping and missing metadata stays unknown', () => {
    const directoryName = '世界 #1 (100%)';
    const world = worldFromNative({ ref: { instanceId: 9, directoryName }, displayName: 'My world',
      lastPlayedAt: null, sizeBytes: 1048576, iconDataUrl: null, running: true }, 'fallback');
    expect(world).toMatchObject({ id: directoryName, mode: 'Unknown', days: undefined, lastPlayed: '', sizeMb: 1, running: true });
    expect(worldRouteId(encodeURIComponent(world.id))).toBe(directoryName);
    expect(worldRouteId('%broken')).toBeUndefined();
    expect(resourceScope(`9/world/${directoryName}`)).toEqual({ instanceId: '9', world: { instanceId: 9, directoryName } });
    expect(resourceScope('9')).toEqual({ instanceId: '9' });
  });
  test('world transfers require the same acknowledgements as Rust, even for modded duplicates', () => {
    const vanilla = { minecraftVersion: '1.21.4', modloader: null, modpackId: null, modpackVersionId: null };
    expect(worldTransferNeedsAcknowledgement(vanilla, vanilla)).toBe(false);
    expect(worldTransferNeedsAcknowledgement(vanilla, vanilla, '1.20.1')).toBe(true);
    const modded = { ...vanilla, modloader: 'fabric' };
    expect(worldTransferNeedsAcknowledgement(modded, modded)).toBe(true);
    expect(worldTransferNeedsAcknowledgement(vanilla, { ...vanilla, modpackVersionId: 'other' })).toBe(true);
    expect(worldTransferNeedsAcknowledgement(vanilla, { ...vanilla, minecraftVersion: '1.20.1' })).toBe(true);
  });
  test('crash data handles plain text, malformed data, and structured report paths', () => {
    expect(parseNativeCrash(null)).toEqual({});
    expect(parseNativeCrash('Legacy failure')).toEqual({ message: 'Legacy failure' });
    expect(parseNativeCrash('null')).toEqual({ message: 'null' });
    expect(parseNativeCrash('[1,2]')).toEqual({ message: '[1,2]' });
    expect(parseNativeCrash('{"message":"OOM","report_path":"/game/crash.txt"}')).toMatchObject({ message: 'OOM', report_path: '/game/crash.txt' });
  });
  test('catchup removes only the overlapping tail and preserves repeated log messages', () => {
    expect(logCatchup(['A', 'B'], ['B', 'C', 'C'])).toEqual(['A', 'B', 'C', 'C']);
    expect(logCatchup(['A', 'B', 'B'], ['B', 'B', 'C'])).toEqual(['A', 'B', 'B', 'C']);
    expect(logCatchup(['A'], ['B', 'A'])).toEqual(['A', 'B', 'A']);
    expect(logCatchup([], ['A'])).toEqual(['A']);
    expect(logCatchup(['A'], [])).toEqual(['A']);
  });
});
