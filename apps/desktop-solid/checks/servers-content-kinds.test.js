import { expect, test } from 'bun:test';
import { contentPathKind } from '../src/features/servers/content-kind.ts';
import { contentRows, isModpackOwned } from '../src/features/servers/content-model.ts';
import { filterEntries, serverLinkView } from '../src/features/servers/modpack-area-model.ts';

test('documents and configuration never become content rows or pack-owned content counts', () => {
  for (const ext of ['md', 'pdf', 'cfg', 'json5']) for (const folder of ['mods', 'plugins', 'resourcepacks', 'shaderpacks', 'datapacks']) {
    const path = `${folder}/License.${ext}`;
    expect(contentPathKind(path)).toBeNull();
    expect(contentRows([{ path, filename: path, kind: 'mod', modpackOwned: true }], { filter: 'all', query: '' })).toEqual([]);
    expect(isModpackOwned({ path, modpackOwned: true })).toBe(false);
    expect(filterEntries([{ path, kind: 'mod' }], '', 'all')).toEqual([]);
    expect(serverLinkView({ serverModpack: { files: { [path]: 'hash' }, state: 'installed' } }).owned).toEqual([]);
  }
});
test('content uses folder and archive type, including disabled archives', () => {
  for (const [path, kind] of [['mods/a.jar.disabled', 'mod'], ['plugins/a.jar', 'plugin'], ['resourcepacks/a.zip', 'resource_pack'], ['shaderpacks/a.zip', 'shader'], ['world/datapacks/a.zip', 'datapack']]) expect(contentPathKind(path)).toBe(kind);
  expect(contentPathKind('config/a.jar')).toBeNull();
  expect(contentPathKind('mods/a.zip')).toBeNull();
});
