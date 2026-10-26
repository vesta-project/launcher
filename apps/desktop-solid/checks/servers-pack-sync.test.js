import { describe, expect, test } from 'bun:test';
import { createPackSyncFixtures, seedPackSync } from '../src/features/servers/fixtures-pack-sync';
import { parsePackSyncLaunchBlock } from '../src/features/servers/native-pack-sync';

function setup(scenario = 'optional_update') {
  const { instance } = seedPackSync(scenario);
  const snapshot = { connection: { id: 'fixture-survival', serverId: 'fixture-server', fingerprint: 'ab'.repeat(32) }, state: { phase: 'online', access: 'paired' }, pack: { hostedRevision: '14', minimumRevision: scenario === 'required_update' ? '14' : '12' } };
  const manifest = { name: 'Published client pack', summary: '', icon: null, displayVersion: '1.0', minecraftVersion: '1.21.1', loader: 'fabric', loaderVersion: '0.16.10', entries: [{ id: 'client', kind: 'mod', path: 'mods/server.jar', required: true, environment: { client: 'required', server: 'required' }, source: { type: 'provider', provider: 'modrinth', projectId: 'client', versionId: 'v2' } }, { id: 'config', kind: 'config_override', path: 'config/server.toml', required: true, environment: { client: 'required', server: 'unsupported' }, source: { type: 'upload', sha256: 'ef'.repeat(32) } }] };
  const instances = new Map([[instance.id, instance]]);
  const api = createPackSyncFixtures({ server: () => ({ snapshot }), publishedManifest: () => structuredClone(manifest), instances, scenario: () => scenario });
  return { api, instance, instances, snapshot, manifest };
}
const apply = (api, p, extra = {}) => api.packSyncApply({ reviewId: p.reviewId, consentRevision: p.revision, ...extra });

describe('paired pack client sync', () => {
  test('optional and required policies preserve decimal revision semantics', async () => {
    const f = setup(); expect(await f.api.packSyncCheck(71)).toMatchObject({ status: 'update_available', canLaunch: true, installedRevision: '12', publishedRevision: '14', minimumRevision: '12' });
    f.snapshot.pack.minimumRevision = '14'; expect(await f.api.packSyncCheck(71)).toMatchObject({ status: 'update_required', canLaunch: false });
    f.snapshot.pack.minimumRevision = '12'; expect(await f.api.packSyncCheck(71)).toMatchObject({ availability: 'verification_failed', error: { reason: 'pack_rollback_rejected' } });
    const large = setup(); large.instance.installedRevision = '9007199254740993'; large.instance.link.highestRevision = '9007199254740993'; large.snapshot.pack.hostedRevision = '9007199254740994'; large.snapshot.pack.minimumRevision = '9007199254740993';
    expect(await large.api.packSyncCheck(71)).toMatchObject({ status: 'update_available', canLaunch: true });
  });
  test('offline, integrity and download-authority failures never permit launch', async () => {
    for (const scenario of ['server_offline', 'integrity_failure']) {
      const f = setup(scenario); expect(await f.api.packSyncCheck(71)).toMatchObject({ status: null, canLaunch: false, availability: scenario === 'server_offline' ? 'server_offline' : 'verification_failed' });
      await expect(f.api.packSyncPreview('fixture-survival', 71)).rejects.toMatchObject({ reason: scenario === 'server_offline' ? 'pack_server_offline' : 'pack_integrity_failure' });
    }
    const denied = setup(); denied.snapshot.capabilities = { source: 'session', granted: ['pack.edit'], refused: [] }; await expect(denied.api.packSyncPreview('fixture-survival', 71)).rejects.toMatchObject({ code: 'forbidden', reason: 'pack_access_denied' });
  });
  test('diff removes owned files, updates configs and preserves user mods', async () => {
    const f = setup(); f.instance.files['mods/obsolete.jar'] = 'old'; f.instance.owned['mods/obsolete.jar'] = 'old'; const p = await f.api.packSyncPreview('fixture-survival', 71);
    expect(p.changes).toEqual(expect.arrayContaining([{ path: 'mods/obsolete.jar', operation: 'remove', executable: true }, { path: 'config/server.toml', operation: 'add', executable: false }])); expect(p.executableChanges).toContain('mods/server.jar');
    expect(await apply(f.api, p)).toBe(71); expect(f.instance.files['mods/obsolete.jar']).toBeUndefined(); expect(f.instance.files['mods/user-client.jar']).toBe('user'); expect(f.instance.owned['mods/user-client.jar']).toBeUndefined(); expect(await f.api.packSyncCheck(71)).toMatchObject({ status: 'current', canLaunch: true, installedRevision: '14' });
  });
  test('executable consent binds one review and exact revision', async () => {
    const f = setup(); let p = await f.api.packSyncPreview('fixture-survival', 71); await expect(apply(f.api, p, { consentRevision: '13' })).rejects.toMatchObject({ reason: 'pack_executable_consent_required' }); await expect(apply(f.api, p)).rejects.toMatchObject({ reason: 'pack_review_expired' }); p = await f.api.packSyncPreview('fixture-survival', 71); await apply(f.api, p);
  });
  test('publication and identity changes invalidate a reviewed install', async () => {
    for (const mutate of [f => { f.snapshot.pack.hostedRevision = '15'; }, f => { f.snapshot.connection.fingerprint = 'ff'.repeat(32); }]) { const f = setup(), p = await f.api.packSyncPreview('fixture-survival', 71); mutate(f); await expect(apply(f.api, p)).rejects.toMatchObject({ reason: 'pack_review_stale' }); expect(f.instance.installedRevision).toBe('12'); }
  });
  test('rollback, substitution, incompatible runtime and local conflicts refuse', async () => {
    const f = setup(); await f.api.packSyncCheck(71); f.snapshot.pack.hostedRevision = '13'; await expect(f.api.packSyncPreview('fixture-survival', 71)).rejects.toMatchObject({ reason: 'pack_rollback_rejected' });
    const changed = setup(); await changed.api.packSyncCheck(71); changed.manifest.name = 'Substitution'; await expect(changed.api.packSyncPreview('fixture-survival', 71)).rejects.toMatchObject({ reason: 'pack_rollback_rejected' });
    const loader = setup(); loader.instance.runtime.loader = 'forge'; await expect(loader.api.packSyncPreview('fixture-survival', 71)).rejects.toMatchObject({ reason: 'pack_incompatible_runtime' });
    const local = setup(); local.instance.files['mods/server.jar'] = 'user edit'; await expect(local.api.packSyncPreview('fixture-survival', 71)).rejects.toMatchObject({ reason: 'pack_owned_file_modified' });
    const collision = setup(); collision.instance.files['config/server.toml'] = 'user config'; await expect(collision.api.packSyncPreview('fixture-survival', 71)).rejects.toMatchObject({ reason: 'pack_user_file_collision' });
  });
  test('failed apply leaves previous receipt and files intact', async () => {
    const f = setup(), before = structuredClone(f.instance), p = await f.api.packSyncPreview('fixture-survival', 71); f.instance.failApply = true; await expect(apply(f.api, p)).rejects.toMatchObject({ reason: 'pack_apply_failed' }); expect(f.instance.files).toEqual(before.files); expect(f.instance.installedRevision).toBe('12');
  });
  test('creates an instance and links an exact existing file set', async () => {
    const f = setup(), p = await f.api.packSyncPreview('fixture-survival'); expect(p.instanceId).toBeNull(); expect(p.executableChanges).toContain('Minecraft loader'); const id = await apply(f.api, p, { name: 'Joined server' }); const i = f.instances.get(id); expect(i.name).toBe('Joined server'); expect(i.installedRevision).toBe('14');
    i.link = null; i.installedRevision = null; i.owned = {}; i.files['mods/user.jar'] = 'user'; const linked = await f.api.packSyncPreview('fixture-survival', id); expect(linked.changes).toEqual([]); await f.api.packSyncApply({ reviewId: linked.reviewId, linkOnly: true }); expect(i.link.serverId).toBe('fixture-server'); expect(i.files['mods/user.jar']).toBe('user');
  });
  test('running state, post-review edits and cancelled reviews refuse', async () => {
    const f = setup(); let p = await f.api.packSyncPreview('fixture-survival', 71); f.instance.running = true; await expect(apply(f.api, p)).rejects.toMatchObject({ reason: 'pack_instance_running' }); f.instance.running = false; p = await f.api.packSyncPreview('fixture-survival', 71); delete f.instance.files['mods/server.jar']; await expect(apply(f.api, p)).rejects.toMatchObject({ reason: 'pack_review_stale' }); p = await f.api.packSyncPreview('fixture-survival', 71); await f.api.packSyncDiscard(p.reviewId); await expect(apply(f.api, p)).rejects.toMatchObject({ reason: 'pack_review_expired' });
  });
  test('launch parser preserves structured pack blocks', () => {
    const check = seedPackSync('required_update').check; expect(parsePackSyncLaunchBlock(`pack_sync:${JSON.stringify(check)}`)).toEqual(check); expect(parsePackSyncLaunchBlock('other launch error')).toBeNull(); expect(parsePackSyncLaunchBlock('pack_sync:{')).toBeNull();
  });
});
