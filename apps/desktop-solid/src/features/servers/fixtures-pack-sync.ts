import type { ServerSnapshot, ServerCommandError } from './native';
import type { PackManifest } from './native-pack';
import type { serversPackSyncNative, PackSyncRuntime, PackSyncPreview, PackSyncLink, PackSyncCheck, PackSyncChange } from './native-pack-sync';

export type PackSyncFixtureScenario = 'optional_update' | 'required_update' | 'server_offline' | 'integrity_failure';
export interface PackSyncFixtureInstance {
  id: number; name: string; runtime: PackSyncRuntime; files: Record<string, string>;
  installedRevision: string | null; owned: Record<string, string>; link: PackSyncLink | null;
  running?: boolean; failApply?: boolean;
}
interface Host {
  server(id: string): { snapshot: Pick<ServerSnapshot, 'connection' | 'state' | 'pack'> & Partial<Pick<ServerSnapshot, 'capabilities'>> };
  publishedManifest?(id: string): PackManifest;
  instances?: Map<number, PackSyncFixtureInstance>;
  scenario?(id: string): PackSyncFixtureScenario | null;
}
const clone = <T,>(value: T): T => structuredClone(value);
const fail = (reason: string, code: ServerCommandError['code'] = 'conflict'): never => { throw { code, reason } satisfies ServerCommandError; };
const hash = async (value: unknown) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value))))].map(n => n.toString(16).padStart(2, '0')).join('');
const baseRuntime: PackSyncRuntime = { minecraftVersion: '1.21.1', loader: 'fabric', loaderVersion: '0.16.10' };
const sameRuntime = (a: PackSyncRuntime, b: PackSyncRuntime) => a.minecraftVersion === b.minecraftVersion && a.loader === b.loader && a.loaderVersion === b.loaderVersion;
/** Deterministic UI scenarios. These simulate native verification outcomes, never cryptographic evidence. */
export function seedPackSync(scenario: PackSyncFixtureScenario): { instance: PackSyncFixtureInstance; check: PackSyncCheck } {
  const instance: PackSyncFixtureInstance = { id: 71, name: 'Linked survival', runtime: clone(baseRuntime), files: { 'mods/server.jar': 'old', 'mods/user-client.jar': 'user' }, owned: { 'mods/server.jar': 'old' }, installedRevision: '12', link: { connectionId: 'fixture-survival', serverId: 'fixture-server', fingerprint: 'ab'.repeat(32), highestRevision: '12', highestMinimum: '12', highestSha256: 'cd'.repeat(32) } };
  const offline = scenario === 'server_offline', integrity = scenario === 'integrity_failure';
  const check: PackSyncCheck = { instanceId: 71, connectionId: 'fixture-survival', installedRevision: '12', publishedRevision: '14', minimumRevision: scenario === 'required_update' ? '14' : '12', status: offline || integrity ? null : scenario === 'required_update' ? 'update_required' : 'update_available', availability: offline ? 'server_offline' : integrity ? 'verification_failed' : 'online', canLaunch: !offline && !integrity && scenario !== 'required_update', checkedAtMs: 0, error: offline ? { code: 'unreachable' } : integrity ? { code: 'conflict', reason: 'pack_integrity_failure' } : null };
  return { instance, check };
}
export function createPackSyncFixtures(host: Host): typeof serversPackSyncNative {
  const instances = host.instances ?? new Map<number, PackSyncFixtureInstance>();
  const reviews = new Map<string, { preview: PackSyncPreview; files: Record<string, string>; oldRevision: string | null; expires: number }>();
  let nextId = Math.max(0, ...instances.keys()) + 1;
  const instance = (id: number) => instances.get(id) ?? fail('pack_instance_missing', 'not_found');
  const manifest = (id: string): PackManifest => host.publishedManifest?.(id) ?? { name: 'Server client pack', summary: '', icon: null, displayVersion: '1.0', minecraftVersion: '1.21.1', loader: 'fabric', loaderVersion: '0.16.10', entries: [{ id: 'client', kind: 'mod', path: 'mods/server.jar', required: true, environment: { client: 'required', server: 'required' }, source: { type: 'provider', provider: 'modrinth', projectId: 'client', versionId: 'v2' } }] };
  const release = async (id: string) => {
    const snapshot = host.server(id).snapshot;
    if (host.scenario?.(id) === 'server_offline' || snapshot.state.phase !== 'online') fail('pack_server_offline', 'unreachable');
    if (host.scenario?.(id) === 'integrity_failure') fail('pack_integrity_failure');
    if (snapshot.state.access !== 'paired') fail('pack_server_binding_mismatch', 'fingerprint_mismatch');
    const caps = snapshot.capabilities;
    if (caps && (caps.refused.some(c => c === 'pack.download' || c === 'pack.access') || caps.source !== 'unknown' && !caps.granted.some(c => c === 'pack.download' || c === 'pack.access'))) fail('pack_access_denied', 'forbidden');
    const revision = snapshot.pack?.hostedRevision, minimum = snapshot.pack?.minimumRevision;
    if (!revision || !minimum || revision === '0') fail('pack_not_published', 'not_found');
    const m = manifest(id), sha256 = await hash(m);
    return { revision: revision!, minimum: minimum!, sha256, manifest: m, binding: snapshot.connection };
  };
  const verify = (i: PackSyncFixtureInstance, r: Awaited<ReturnType<typeof release>>, id: string) => {
    const l = i.link;
    if (l && (l.connectionId !== id || l.serverId !== r.binding.serverId || l.fingerprint !== r.binding.fingerprint)) fail('pack_server_binding_mismatch');
    if (i.installedRevision && BigInt(i.installedRevision) > BigInt(r.revision) || l && (BigInt(l.highestRevision) > BigInt(r.revision) || BigInt(l.highestMinimum) > BigInt(r.minimum) || l.highestRevision === r.revision && l.highestSha256 !== r.sha256)) fail('pack_rollback_rejected');
  };
  const link = (id: string, r: Awaited<ReturnType<typeof release>>): PackSyncLink => ({ connectionId: id, serverId: r.binding.serverId, fingerprint: r.binding.fingerprint, highestRevision: r.revision, highestMinimum: r.minimum, highestSha256: r.sha256 });
  const changes = (i: PackSyncFixtureInstance | null, files: Record<string, string>): PackSyncChange[] => {
    const owned = i?.owned ?? {}, current = i?.files ?? {};
    return [...new Set([...Object.keys(owned), ...Object.keys(files)])].sort().flatMap(path => {
      if (!owned[path] && current[path] && current[path] !== files[path]) fail('pack_user_file_collision');
      if (owned[path] && current[path] && current[path] !== owned[path] && current[path] !== files[path]) fail('pack_owned_file_modified');
      return current[path] === files[path] ? [] : [{ path, operation: !files[path] ? 'remove' : !current[path] ? 'add' : 'update', executable: /\.jar$/i.test(path) || /^(scripts|kubejs)\//.test(path) } satisfies PackSyncChange];
    });
  };
  return {
    async packSyncLink(instanceId) { return clone(instances.get(instanceId)?.link ?? null); },
    async packSyncCheck(instanceId) {
      const i = instances.get(instanceId); if (!i?.link) return null;
      const check: PackSyncCheck = { instanceId, connectionId: i.link.connectionId, installedRevision: i.installedRevision, publishedRevision: i.link.highestRevision, minimumRevision: i.link.highestMinimum, status: null, availability: 'online', canLaunch: false, checkedAtMs: Date.now(), error: null };
      try {
        const r = await release(i.link.connectionId); verify(i, r, i.link.connectionId);
        if (!i.installedRevision) fail('pack_receipt_missing');
        i.link = link(i.link.connectionId, r); check.publishedRevision = r.revision; check.minimumRevision = r.minimum;
        check.status = BigInt(i.installedRevision!) < BigInt(r.minimum) ? 'update_required' : BigInt(i.installedRevision!) < BigInt(r.revision) ? 'update_available' : 'current'; check.canLaunch = check.status !== 'update_required';
      } catch (error) { check.error = clone(error as ServerCommandError); check.availability = check.error.code === 'unreachable' ? 'server_offline' : 'verification_failed'; }
      return clone(check);
    },
    async packSyncPreview(connectionId, instanceId = null) {
      const r = await release(connectionId), i = instanceId === null ? null : instance(instanceId); if (i) verify(i, r, connectionId);
      const runtime: PackSyncRuntime = { minecraftVersion: r.manifest.minecraftVersion, loader: r.manifest.loader === 'none' ? 'vanilla' : r.manifest.loader, loaderVersion: r.manifest.loaderVersion };
      if (i && !sameRuntime(i.runtime, runtime)) fail('pack_incompatible_runtime');
      const files = Object.fromEntries(await Promise.all(r.manifest.entries.filter(e => e.environment.client !== 'unsupported').map(async e => [e.path, await hash(e)])));
      const diff = changes(i, files), executableChanges = diff.filter(c => c.executable).map(c => c.path);
      if (!i && runtime.loader !== 'vanilla') executableChanges.push('Minecraft loader');
      const preview: PackSyncPreview = { reviewId: crypto.randomUUID(), connectionId, instanceId, serverId: r.binding.serverId, fingerprint: r.binding.fingerprint, revision: r.revision, minimumRevision: r.minimum, artifactSha256: r.sha256, name: r.manifest.name, runtime, changes: diff, executableChanges, consentRequired: executableChanges.length > 0 };
      for (const [key, review] of reviews) if (review.expires < Date.now()) reviews.delete(key);
      if (reviews.size >= 8) fail('pack_preview_limit');
      reviews.set(preview.reviewId, { preview: clone(preview), files, oldRevision: i?.installedRevision ?? null, expires: Date.now() + 900_000 });
      if (i?.link) i.link = link(connectionId, r);
      return clone(preview);
    },
    async packSyncApply(request) {
      const review = reviews.get(request.reviewId) ?? fail('pack_review_expired'); reviews.delete(request.reviewId);
      if (review.expires < Date.now()) fail('pack_review_expired');
      const p = review.preview;
      if (p.consentRequired && request.consentRevision !== p.revision && !request.linkOnly) fail('pack_executable_consent_required');
      const r = await release(p.connectionId);
      if (r.revision !== p.revision || r.sha256 !== p.artifactSha256 || r.binding.serverId !== p.serverId || r.binding.fingerprint !== p.fingerprint) fail('pack_review_stale');
      const i = p.instanceId === null ? null : instance(p.instanceId); if (i) verify(i, r, p.connectionId);
      if (i?.running) fail('pack_instance_running');
      if (i && !sameRuntime(i.runtime, p.runtime)) fail('pack_incompatible_runtime');
      if ((i?.installedRevision ?? null) !== review.oldRevision) fail('pack_review_stale');
      const diff = changes(i, review.files);
      if (p.instanceId !== null && JSON.stringify(diff) !== JSON.stringify(p.changes)) fail('pack_review_stale');
      if (request.linkOnly && (!i || diff.length)) fail('pack_existing_files_mismatch');
      // Simulate a transaction failure before publishing any files or receipt.
      if (i?.failApply) fail('pack_apply_failed');
      const target = i ?? { id: nextId++, name: request.name || p.name, runtime: clone(p.runtime), files: {}, owned: {}, installedRevision: null, link: null };
      const files = clone(target.files); for (const c of diff) { if (c.operation === 'remove') delete files[c.path]; else files[c.path] = review.files[c.path]; }
      Object.assign(target, { files, owned: clone(review.files), installedRevision: p.revision, link: link(p.connectionId, r) }); instances.set(target.id, target); return target.id;
    },
    async packSyncDiscard(reviewId) { reviews.delete(reviewId); },
  };
}
