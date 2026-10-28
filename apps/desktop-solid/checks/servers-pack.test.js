import { describe, expect, test } from 'bun:test';
import { createPackFixtures, seedPackWorkspace } from '../src/features/servers/fixtures-pack.ts';
import { uploadPackBytes, MODPACK_TARGET_READY } from '../src/features/servers/native-pack.ts';

function fixture(software = 'paper') {
  const target = { snapshot: { connection: { role: 'owner' }, capabilities: { granted: ['pack.edit', 'pack.build', 'pack.publish', 'pack.force_update'] }, pack: { hostedRevision: '14', minimumRevision: '12', status: 'published' } } };
  let minecraft = '1.21.4';
  const inventory = { software, minecraftVersion: minecraft, truncated: false, capabilities: {}, items: [] };
  const api = createPackFixtures({ server: () => target, software: () => software, minecraftVersion: () => minecraft, content: async () => inventory, wait: async () => {} });
  return { api, target, inventory, drift: () => { minecraft = '1.21.5'; } };
}
const publishRequest = (p, requiredUpdate = false) => ({ expectedRevision: p.publishedRevision, draftRevision: p.draftRevision, reviewSha256: p.reviewSha256, resolvedEntries: p.resolvedEntries, requiredUpdate, acknowledgeLowerVersion: false });

describe('client pack workspace', () => {
  test('covers Fabric, Paper with Fabric client loader, and vanilla resource-only packs', () => {
    expect(MODPACK_TARGET_READY).toBe(true);
    expect(seedPackWorkspace('fabric').draft.manifest.loader).toBe('fabric');
    expect(seedPackWorkspace('paper').draft.manifest.loader).toBe('fabric');
    const vanilla = seedPackWorkspace('vanilla').draft.manifest;
    expect(vanilla.loader).toBe('none'); expect(vanilla.entries.every(e => e.kind === 'resource_pack')).toBe(true);
    expect(seedPackWorkspace('validation_failures').draft.manifest.entries.some(e => e.source.type === 'manual')).toBe(true);
    expect(seedPackWorkspace('suggestions').draft.manifest.entries.some(e => e.environment.server === 'required')).toBe(true);
  });
  test('draft CRUD is revision guarded, idempotent and separate from published state', async () => {
    const { api, target } = fixture(); const before = await api.packDraft('paper');
    const request = { expectedRevision: before.draft.revision, manifest: { ...before.draft.manifest, name: 'Edited client pack' } };
    const first = await api.packWrite('paper', request, 'edit');
    expect(first.revision).toBe('4'); expect(await api.packWrite('paper', request, 'edit')).toEqual(first);
    await expect(api.packWrite('paper', request, 'stale')).rejects.toMatchObject({ code: 'stale_target' });
    await expect(api.packWrite('paper', { ...request, manifest: { ...request.manifest, name: 'Different' } }, 'edit')).rejects.toMatchObject({ reason: 'idempotency_conflict' });
    expect(target.snapshot.pack.hostedRevision).toBe('14'); expect((await api.packDraft('paper')).pendingPublication).toBe(true);
    const diff = await api.packPreview('paper', '4'); expect(diff.diff.metadataChanged).toBe(true);
    const imported = await api.packImport('paper', { source: 'published', expectedRevision: '4', expectedPublishedRevision: '14' }, 'import');
    expect(imported.manifest.name).toBe(before.draft.manifest.name);
    expect((await api.packDelete('paper', '5', 'clear')).manifest.entries).toEqual([]);
  });
  test('complete reviewed publication increments revision and preserves or advances minimum', async () => {
    const { api } = fixture();
    const first = publishRequest(await api.packPreview('paper', '3'));
    expect(await api.packBuildPublish('paper', first, 'publish-one')).toEqual({ hostedRevision: '15', minimumRevision: '12' });
    const required = publishRequest(await api.packPreview('paper', '3'), true);
    expect(await api.packBuildPublish('paper', required, 'publish-two')).toEqual({ hostedRevision: '16', minimumRevision: '16' });
    await api.packDelete('paper', '3', 'edit-after-publish');
    expect(await api.packBuildPublish('paper', first, 'publish-one')).toEqual({ hostedRevision: '15', minimumRevision: '12' });
    const stale = publishRequest(await api.packPreview('paper', '4')); stale.reviewSha256 = '0'.repeat(64);
    await expect(api.packBuildPublish('paper', stale, 'bad-review')).rejects.toMatchObject({ code: 'stale_target' });
  });
  test('suggestions and dependency previews never edit the draft; required dependencies appear in build preview', async () => {
    const { api, inventory } = fixture('fabric'); const before = await api.packDraft('fabric');
    inventory.items.push({ kind: 'mod', path: 'mods/missing.jar', enabled: true, declared: { side: 'required' }, provider: { provider: 'modrinth', projectId: 'needed-client', versionId: 'v1' } });
    const suggestions = await api.packSuggestions('fabric'); expect(suggestions.items.some(s => s.kind === 'client_mod_missing')).toBe(true);
    const root = before.draft.manifest.entries[0];
    root.source.projectId = 'needs-api'; root.id = 'needs-api'; root.path = 'mods/needs-api.jar';
    await api.packWrite('fabric', { expectedRevision: '3', manifest: { ...before.draft.manifest, entries: [root] } }, 'dependency-root');
    const preview = await api.packPreview('fabric', '4'); expect(preview.resolvedEntries.some(e => e.source.projectId === 'fabric-api')).toBe(true);
    expect((await api.packDraft('fabric')).draft.manifest.entries).toHaveLength(1);
    expect(preview.diff.removed.length).toBeGreaterThan(0); expect(preview.diff.added.length).toBeGreaterThan(0);
  });
  test('validation exposes compatibility, manual downloads, drift and capability failures', async () => {
    const { api, drift, target } = fixture(); const draft = (await api.packDraft('paper')).draft;
    await api.packWrite('paper', { expectedRevision: draft.revision, manifest: seedPackWorkspace('validation_failures').draft.manifest }, 'invalid-draft');
    const invalid = await api.packPreview('paper', '4'); expect(invalid.valid).toBe(false);
    expect(invalid.issues.map(i => i.code)).toContain('entry_incompatible'); expect(invalid.issues.map(i => i.code)).toContain('manual_download_required');
    await expect(api.packBuildPublish('paper', publishRequest(invalid), 'invalid-publish')).rejects.toMatchObject({ reason: 'pack_unresolved_file' });
    drift(); expect((await api.packDraft('paper')).minecraftDrift).toBe(true); expect((await api.packPreview('paper', '4')).issues.map(i => i.code)).toContain('minecraft_version_drift');
    target.snapshot.capabilities.granted = []; await expect(api.packDraft('paper')).rejects.toMatchObject({ code: 'forbidden' });
  });
  test('chunked uploads bind bytes and can resume using the same intents', async () => {
    const { api } = fixture(); const bytes = new TextEncoder().encode('config=true\n'.repeat(6000));
    const first = await uploadPackBytes(api, 'paper', bytes, false, 'config-upload');
    expect(first.complete).toBe(true); expect(await uploadPackBytes(api, 'paper', bytes, false, 'config-upload')).toEqual(first);
    const view = await api.packDraft('paper'); view.draft.manifest.entries.push({ id: 'override', kind: 'config_override', path: 'config/client.toml', required: false, environment: { client: 'optional', server: 'unsupported' }, source: { type: 'upload', sha256: first.sha256 } });
    await api.packWrite('paper', { expectedRevision: '3', manifest: view.draft.manifest }, 'attach-upload');
    expect((await api.packPreview('paper', '4')).diff.customOverrides).toContain('config/client.toml');
  });
});

test('provider link resets an unrelated draft baseline; only Customize forks it', async () => {
  const { api } = fixture();
  const before = await api.packDraft('paper');
  const draft = await api.packWrite('paper', { expectedRevision: before.draft.revision, manifest: { ...before.draft.manifest, summary: 'Unrelated edits' } }, 'prelink');
  const request = { expectedRevision: before.publishedRevision, draftRevision: draft.revision, provider: 'modrinth', projectId: 'pack', versionId: 'v1', requiredUpdate: false, acknowledgeLowerVersion: false };
  await api.packProviderPublish('paper', request, 'link');
  const linked = await api.packDraft('paper');
  expect(linked.pendingPublication).toBe(false);
  expect(linked.customizingProvider).toBe(false);
  await api.packImport('paper', { source: 'published', expectedRevision: draft.revision, expectedPublishedRevision: linked.publishedRevision }, 'customize');
  expect((await api.packDraft('paper')).customizingProvider).toBe(true);
  await api.packProviderPublish('paper', { ...request, expectedRevision: linked.publishedRevision, draftRevision: (await api.packDraft('paper')).draft.revision, versionId: 'v2', requiredUpdate: true }, 'relink');
  const rows = await api.packHistory('paper');
  expect(rows.slice(0, 2).map(row => [row.providerVersion, row.requiredUpdate])).toEqual([['v2', true], ['v1', false]]);
  expect((await api.packDraft('paper')).customizingProvider).toBe(false);
});
