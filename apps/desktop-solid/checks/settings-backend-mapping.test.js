import { describe, expect, test } from 'bun:test';
import { availableSources, toFeed, rssFeedTitle } from '../src/features/settings/notification-model';
import { categoryState, syncOptionKeys, syncPreferences, hostCategory } from '../src/features/settings/sync-model';
import { shortcutCommandId, toHostChord, fromHostChord, shortcutOverrides, matchesShortcut } from '../src/features/settings/shortcut-model';
import { chordFromEvent } from '../src/features/settings/shortcuts';
import { storageSnapshotFromHost } from '../src/features/settings/storage-model';
import { persistSettings } from '../src/features/settings/native-config';

const snapshot = (patch = {}) => ({
  category: 'gameOptions', revision: 12, initialized: true, pending: [],
  preferences: { enabled: true, sourceInstanceId: 7, instanceIds: [7, 10], selectedKeys: null },
  sharedValues: { fov: '70', renderDistance: '12' },
  catalog: [{ key: 'fov' }, { key: 'renderDistance' }, { key: 'unknownNotInBundle' }],
  servers: [{ id: 'server-uuid', name: 'Private server', address: 'play.example.net' }], ...patch,
});
describe('settings sync host boundary', () => {
  test('maps camelCase categories and numeric instance IDs, expanding null selection', () => {
    expect(hostCategory).toEqual({ options: 'gameOptions', keybinds: 'keybinds', servers: 'servers', resourcepacks: 'resourcePacks' });
    expect(categoryState(snapshot())).toEqual({ enabled: true, selected: ['fov', 'renderDistance'], linked: ['7', '10'], source: '7', servers: snapshot().servers });
  });
  test('preserves explicit empty selections and filters unseeded catalog entries', () => {
    expect(categoryState(snapshot({ preferences: { ...snapshot().preferences, selectedKeys: [] } })).selected).toEqual([]);
    expect(syncOptionKeys(snapshot())).toEqual(['fov', 'renderDistance']);
    expect(syncOptionKeys(snapshot({ category: 'keybinds', sharedValues: { 'key_key.jump': 'key.keyboard.space' } }))).toEqual(['key_key.jump']);
  });
  test('membership edits preserve other preferences and move a removed source to a follower', () => {
    expect(syncPreferences(snapshot(), { linked: ['10'], selected: ['fov', 'fov'] })).toEqual({
      enabled: true, sourceInstanceId: 10, instanceIds: [10], selectedKeys: ['fov'],
    });
    expect(syncPreferences(snapshot(), { linked: [] }).sourceInstanceId).toBeNull();
    expect(syncPreferences(snapshot(), { source: '15' })).toEqual({ ...snapshot().preferences, sourceInstanceId: 15, instanceIds: [15, 7, 10] });
    expect(() => syncPreferences(snapshot(), { source: 'survival' })).toThrow('Invalid source instance ID');
    expect(syncPreferences(snapshot(), { enabled: false })).toEqual({ ...snapshot().preferences, enabled: false });
  });
  test('preview slugs cannot accidentally cross IPC as NaN', () => {
    expect(() => syncPreferences(snapshot(), { linked: ['survival'] })).toThrow('Invalid instance ID');
  });
});
describe('notification source mapping', () => {
  const source = { id: 'preset', title: 'Fabric', provider_type: 'rss', target_url: 'https://fabricmc.net/feed.xml', target_id: null, metadata: null };
  test('excludes subscribed presets by provider/target even when the UUID differs or subscription is disabled', () => {
    expect(availableSources([source], [{ ...source, id: 'subscription-uuid', enabled: false }])).toEqual([]);
    expect(availableSources([source], [{ ...source, id: 'other', target_url: 'https://example.net/feed', enabled: true }])).toEqual([source]);
  });
  test('accepts HTTP feeds and rejects malformed URLs without attempting IPC', () => {
    expect(rssFeedTitle('https://example.com/feed.xml')).toBe('example.com');
    expect(() => rssFeedTitle('https://example.com:bad/feed')).toThrow();
    expect(() => rssFeedTitle('file:///private/feed')).toThrow('HTTP or HTTPS');
  });
  test('maps title/URL and distinguishes RSS', () => {
    expect(toFeed({ ...source, enabled: false })).toEqual({ id: 'preset', name: 'Fabric', detail: source.target_url, enabled: false, custom: true });
    expect(toFeed({ ...source, provider_type: 'game', target_url: null }).detail).toBe('game');
  });
});
describe('durable shortcut catalog compatibility', () => {
  test('uses original command IDs', () => {
    expect(['reload', 'close-page', 'search', 'pinned-1', 'pinned-last', 'new-instance'].map(shortcutCommandId))
      .toEqual(['app.reload', 'app.close', 'navigation.focus-search', 'navigation.pinned.1', 'navigation.pinned.last', 'navigation.new-instance']);
  });
  test('round-trips display chords to physical codes', () => {
    for (const chord of ['Mod+R', 'Mod+Shift+K', 'Mod+1', 'Mod+,', 'Alt+ArrowLeft', null])
      expect(fromHostChord(toHostChord(chord))).toBe(chord);
    expect(toHostChord('Mod+R')).toBe('Mod+KeyR');
  });
  test('retains explicit unbound overrides and ignores retired catalog rows', () => {
    expect(shortcutOverrides([
      { commandId: 'app.reload', currentChord: null, available: true },
      { commandId: 'navigation.library', currentChord: 'Mod+KeyL', available: false },
    ], ['reload', 'library'])).toEqual({ reload: null });
  });
  test('matches physical keys on macOS and Windows, requiring exact modifiers', () => {
    const key = { key: 'r', code: 'KeyR', ctrlKey: false, metaKey: true, altKey: false, shiftKey: false };
    expect(matchesShortcut(key, 'Mod+R', true)).toBe(true);
    expect(matchesShortcut(key, 'Mod+R', false)).toBe(false);
    expect(matchesShortcut({ ...key, metaKey: false, ctrlKey: true }, 'Mod+R', false)).toBe(true);
    expect(matchesShortcut({ ...key, shiftKey: true }, 'Mod+R', true)).toBe(false);
    expect(matchesShortcut({ ...key, key: 'я' }, 'Mod+R', true)).toBe(true);
    expect(chordFromEvent({ ...key, key: 'я' }, 'macos')).toBe('Mod+R');
    expect(chordFromEvent({ ...key, code: 'Comma', key: ',' }, 'macos')).toBe('Mod+,');
    expect(matchesShortcut(key, 'Meta+R', false)).toBe(true);
    expect(matchesShortcut(key, 'Ctrl+R', false)).toBe(false);
  });
});
test('storage maps camelCase aggregates and category capabilities without extra host diagnostics', () => {
  expect(storageSnapshotFromHost({ totalBytes: 90, categories: [{ id: 'runtime', label: 'Runtime', bytes: 60, clearable: true, openable: true, kind: 'cache' }],
    instancesTotalBytes: 30, instances: [{ id: 7, name: 'World', bytes: 30, path: '/private/path' }], artifactCacheLimitBytes: 1024, artifactCacheUsageBytes: 60,
  })).toEqual({ totalBytes: 90, categories: [{ id: 'runtime', label: 'Runtime', bytes: 60, clearable: true, openable: true }], instancesTotalBytes: 30,
    instances: [{ id: 7, name: 'World', bytes: 30 }], artifactCacheLimitBytes: 1024, artifactCacheUsageBytes: 60 });
});
test('tray settings call host side-effect commands, and GPU/Discord/telemetry use per-field updates', async () => {
  const calls = [];
  await persistSettings(async (command, args) => calls.push({ command, args }), {
    show_tray_icon: false, minimize_to_tray: true, discord_presence_enabled: false, use_dedicated_gpu: true, telemetry_enabled: false, reduced_motion: true,
  });
  expect(calls).toEqual([
    { command: 'set_tray_icon_visibility', args: { visible: false } },
    { command: 'set_minimize_to_tray', args: { enabled: true } },
    { command: 'update_config_field', args: { field: 'use_dedicated_gpu', value: true } },
    { command: 'update_config_field', args: { field: 'discord_presence_enabled', value: false } },
    { command: 'update_config_field', args: { field: 'telemetry_enabled', value: false } },
    { command: 'update_config_fields', args: { updates: { reduced_motion: true } } },
  ]);
});
