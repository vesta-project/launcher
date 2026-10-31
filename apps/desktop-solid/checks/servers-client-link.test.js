import { expect, test } from 'bun:test';
import { createPackFixtures } from '../src/features/servers/fixtures-pack.ts';
function fixture() {
 const target = { snapshot: { connection: { role: 'owner' }, capabilities: { granted: ['pack.edit', 'pack.build', 'pack.publish'] }, pack: { hostedRevision: '14', minimumRevision: '12', status: 'published' } } };
 const api = createPackFixtures({ server: () => target, software: () => 'fabric', content: async () => ({ items: [], truncated: false }), wait: async () => {} });
 return { api, target };
}
test('custom provider link versions and unlink choices are draft-only and replayable', async () => {
 for (const choice of ['keep_everything', 'keep_resources', 'remove_everything']) {
  const {api,target} = fixture(); const before = await api.packDraft('s');
  const request = { source: 'provider', expectedRevision: before.draft.revision, provider: 'modrinth', projectId: 'pack', versionId: '1' };
  const linked = await api.packImport('s', request, 'link');
  expect(await api.packImport('s', request, 'link')).toEqual(linked);
  await expect(api.packWrite('s', { expectedRevision: linked.revision, manifest: {...linked.manifest, entries: []} }, 'edit-owned')).rejects.toMatchObject({code:'conflict'});
  const switched = await api.packImport('s', {...request, expectedRevision: linked.revision, versionId: '2'}, 'switch');
  expect(switched.manifest.modpackLink.versionId).toBe('2');
  expect(switched.manifest.entries.length).toBe(linked.manifest.entries.length);
  const result = await api.packImport('s', { source: 'unlink', expectedRevision: switched.revision, choice }, 'unlink');
  expect(result.manifest.modpackLink).toBeNull();
  expect(result.manifest.overrideFiles.some(f => f.path === 'config/linked-pack.txt')).toBe(choice === 'keep_everything');
  expect(result.manifest.entries.filter(e => !e.id.startsWith('linked-'))).toEqual(before.draft.manifest.entries);
  expect(result.manifest.entries.length).toBe(choice === 'remove_everything' ? before.draft.manifest.entries.length : linked.manifest.entries.length);
  expect(target.snapshot.pack.hostedRevision).toBe('14');
  await expect(api.packImport('s', request, 'stale')).rejects.toMatchObject({code:'stale_target'});
 }
});
