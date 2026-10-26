import type { serversPackNative, PackWorkspace, PackEntry, PackManifest, PackPreview, PackSuggestion, PackImport, PackBrowseAdd, PackUploadBegin, PackUploadReceipt } from './native-pack';
import type { ServerCommandError } from './native';
import type { ServerContentInventory, ContentProvider } from './native-content';
import { fixtureProjects, fixtureVersions } from '../browse/browse-fixtures';
const clone = <T,>(value: T): T => structuredClone(value);
const fail = (code: ServerCommandError['code'], reason?: string): never => { throw { code, reason: reason ?? null, retryAfterMs: null } satisfies ServerCommandError; };
const hash = async (value: unknown) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value))))].map(n => n.toString(16).padStart(2, '0')).join('');
const bytesHash = async (bytes: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer))].map(n => n.toString(16).padStart(2, '0')).join('');
const provider = (projectId: string, versionId = `${projectId}-1`): ContentProvider => ({ provider: 'modrinth', projectId, versionId });
const entry = (projectId: string, kind: PackEntry['kind'] = 'mod', both = false): PackEntry => ({ id: `modrinth-${projectId}`, kind, path: `${kind === 'mod' ? 'mods' : kind === 'shader' ? 'shaderpacks' : kind === 'datapack' ? 'datapacks' : 'resourcepacks'}/${projectId}.${kind === 'mod' ? 'jar' : 'zip'}`, required: true, environment: { client: 'required', server: both ? 'required' : 'unsupported' }, source: { type: 'provider', ...provider(projectId) } });

export type PackFixtureScenario = 'fabric' | 'paper' | 'vanilla' | 'suggestions' | 'diff' | 'validation_failures';
/** Independent client loader scenarios, including Paper + Fabric and vanilla + no loader. */
export function seedPackWorkspace(scenario: PackFixtureScenario): PackWorkspace {
  const vanilla = scenario === 'vanilla';
  const entries = vanilla ? [entry('faithful', 'resource_pack')] : [entry('sodium'), entry('fabric-api')];
  if (scenario === 'diff') entries.push(entry('faithful', 'resource_pack'));
  if (scenario === 'suggestions') entries.push(entry('removed-both-mod', 'mod', true));
  if (scenario === 'validation_failures') entries.push({ ...entry('forge-only'), source: { type: 'provider', ...provider('forge-only', 'incompatible') } }, { ...entry('manual'), source: { type: 'manual', reason: 'manual_download_required' } });
  return { draft: { revision: '3', manifest: { name: vanilla ? 'Vanilla textures' : scenario === 'paper' ? 'Riverside client pack' : 'Friends client pack', summary: 'Client resources shared with players.', icon: null, displayVersion: '1.2.0', minecraftVersion: '1.21.4', loader: vanilla ? 'none' : 'fabric', loaderVersion: vanilla ? null : '0.16.10', entries } }, serverMinecraftVersion: '1.21.4', minecraftDrift: false, publishedRevision: '14', minimumRevision: '12', pendingPublication: scenario === 'diff' || scenario === 'suggestions' || scenario === 'validation_failures', safetySnapshotRecommended: true };
}
interface Host {
  scenario?: PackFixtureScenario;
  server(id: string): { snapshot: { capabilities: { granted: string[] }; connection: { role: string | null }; pack: { hostedRevision: string | null; minimumRevision: string | null; status: 'published' | 'unpublished' } | null } };
  software(id: string): string | null;
  minecraftVersion?(id: string): string;
  content?(id: string): Promise<ServerContentInventory>;
  publish?(id: string): void;
  wait(ms?: number): Promise<unknown>;
}
export function createPackFixtures(host: Host): typeof serversPackNative & { fixturePublishedManifest(id: string): PackManifest } {
  const states = new Map<string, { view: PackWorkspace; published: PackManifest; publishedDraft: string }>();
  const receipts = new Map<string, { input: string; result: unknown }>();
  const blobs = new Map<string, Uint8Array>();
  const uploads = new Map<string, { request: PackUploadBegin; bytes: Uint8Array; complete: boolean }>();
  const tails = new Map<string, Promise<unknown>>();
  const requireCap = (id: string, cap = 'pack.edit') => { if (!host.server(id).snapshot.capabilities.granted.includes(cap)) fail('forbidden'); };
  const state = (id: string, requireEdit = true) => {
    if (requireEdit) requireCap(id);
    let s = states.get(id);
    if (!s) { const view = seedPackWorkspace(host.scenario ?? (host.software(id) === 'vanilla' ? 'vanilla' : host.software(id) === 'paper' ? 'paper' : 'fabric')); const pack = host.server(id).snapshot.pack; view.publishedRevision = pack?.hostedRevision ?? '0'; view.minimumRevision = pack?.minimumRevision ?? '0'; s = { view, published: clone(view.draft.manifest), publishedDraft: view.pendingPublication ? '2' : view.draft.revision };
      if (host.scenario === 'diff') { s.published.entries = s.published.entries.filter(e => e.kind !== 'resource_pack'); const old = s.published.entries[0]; if (old?.source.type === 'provider') old.source.versionId += '-old'; s.published.entries.push(entry('previous-mod')); }
      states.set(id, s); }
    s.view.serverMinecraftVersion = host.minecraftVersion?.(id) ?? '1.21.4'; s.view.minecraftDrift = s.view.draft.manifest.minecraftVersion !== s.view.serverMinecraftVersion;
    const pack = host.server(id).snapshot.pack; s.view.publishedRevision = pack?.hostedRevision ?? s.view.publishedRevision; s.view.minimumRevision = pack?.minimumRevision ?? s.view.minimumRevision;
    s.view.pendingPublication = s.publishedDraft !== s.view.draft.revision || s.view.publishedRevision === '0';
    return s;
  };
  const mutate = async <T,>(id: string, intent: string, input: unknown, action: () => T | Promise<T>): Promise<T> => {
    const previous = tails.get(id) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(async () => { requireCap(id); const key = `${id}:${intent}`, binding = JSON.stringify(input), old = receipts.get(key); if (old) { if (old.input !== binding) fail('conflict', 'idempotency_conflict'); return clone(old.result) as T; } const result = await action(); receipts.set(key, { input: binding, result: clone(result) }); return clone(result); });
    tails.set(id, next); return next;
  };
  const save = (id: string, expected: string, manifest: PackManifest) => {
    const s = state(id); if (s.view.draft.revision !== expected) fail('stale_target');
    if (manifest.minecraftVersion !== s.view.serverMinecraftVersion) fail('stale_target', 'pack_release_revision_mismatch');
    if ((manifest.loader === 'none') !== (manifest.loaderVersion === null) || manifest.entries.length > 256 || !/^\d+(\.\d+)*$/.test(manifest.displayVersion)) fail('invalid_input');
    const paths = new Set<string>(), ids = new Set<string>();
    for (const e of manifest.entries) { if (e.path.includes('..') || e.path.includes('\\') || !/^(mods|resourcepacks|shaderpacks|datapacks|config)\/.+/.test(e.path) || paths.has(e.path.toLowerCase()) || ids.has(e.id)) fail('invalid_input'); paths.add(e.path.toLowerCase()); ids.add(e.id); if (e.source.type === 'upload' && !blobs.has(`${id}:${e.source.sha256}`)) fail('invalid_input'); }
    s.view.draft = { revision: String(BigInt(expected) + 1n), manifest: clone(manifest) }; return s.view.draft;
  };
  const suggestions = async (id: string) => {
    const s = state(id), items: PackSuggestion[] = [], inventory = await host.content?.(id);
    if (s.view.minecraftDrift) items.push({ id: `minecraft:${s.view.serverMinecraftVersion}`, kind: 'minecraft_version_drift', entryId: null, provider: null, path: null });
    const same = (a: ContentProvider, b: ContentProvider) => a.provider === b.provider && a.projectId === b.projectId;
    if (inventory) {
      for (const resource of inventory.items) if (resource.kind === 'mod' && resource.enabled === true && resource.provider && resource.declared?.side === 'required' && !s.view.draft.manifest.entries.some(e => e.source.type === 'provider' && same(e.source, resource.provider!))) items.push({ id: `missing:${resource.provider.projectId}`, kind: 'client_mod_missing', entryId: null, provider: resource.provider, path: resource.path });
      if (!inventory.truncated) for (const e of s.view.draft.manifest.entries) if (e.kind === 'mod' && e.environment.server === 'required' && e.source.type === 'provider' && !inventory.items.some(r => r.kind === 'mod' && r.enabled === true && r.provider && e.source.type === 'provider' && same(e.source, r.provider))) items.push({ id: `removed:${e.id}`, kind: 'server_mod_removed', entryId: e.id, provider: e.source, path: e.path });
    }
    for (const e of s.view.draft.manifest.entries) if (e.source.type === 'provider' && e.source.versionId.endsWith('-old')) items.push({ id: `update:${e.id}`, kind: 'newer_compatible_version', entryId: e.id, provider: { ...e.source, versionId: e.source.versionId.replace(/-old$/, '-new') }, path: e.path });
    return { draftRevision: s.view.draft.revision, items, warnings: inventory?.truncated ? ['server_inventory_truncated'] : [], potentiallyOutdated: items.length > 0 };
  };
  const preview = async (id: string, draftRevision: string): Promise<PackPreview> => {
    requireCap(id, 'pack.build'); const s = state(id); if (s.view.draft.revision !== draftRevision) fail('stale_target');
    const manifest = clone(s.view.draft.manifest), resolvedEntries: PackEntry[] = [], issues: PackPreview['issues'] = [];
    for (const e of manifest.entries) {
      if (e.source.type === 'manual') issues.push({ code: 'manual_download_required', entryId: e.id, severity: 'error' });
      if (e.source.type === 'provider' && (e.source.versionId.includes('incompatible') || (e.kind === 'mod' && manifest.loader === 'none'))) issues.push({ code: 'entry_incompatible', entryId: e.id, severity: 'error' });
      if (e.source.type === 'provider' && e.source.projectId === 'needs-api' && !manifest.entries.some(d => d.source.type === 'provider' && d.source.projectId === 'fabric-api')) resolvedEntries.push(entry('fabric-api'));
    }
    manifest.entries.push(...resolvedEntries);
    if (s.view.minecraftDrift) issues.push({ code: 'minecraft_version_drift', entryId: null, severity: 'error' });
    const before = s.published.entries;
    const result: PackPreview = { draftRevision, publishedRevision: s.view.publishedRevision, manifest, resolvedEntries, warnings: [], issues, valid: !issues.some(i => i.severity === 'error'), diff: { added: manifest.entries.filter(e => !before.some(b => b.path === e.path)), removed: before.filter(b => !manifest.entries.some(e => e.path === b.path)), changed: manifest.entries.flatMap(e => { const b = before.find(b => b.path === e.path); return b && JSON.stringify(b) !== JSON.stringify(e) ? [{ before: b, after: e, versionChanged: b.source.type === 'provider' && e.source.type === 'provider' && b.source.versionId !== e.source.versionId }] : []; }), metadataChanged: JSON.stringify({ ...s.published, entries: [] }) !== JSON.stringify({ ...manifest, entries: [] }), customOverrides: manifest.entries.filter(e => e.source.type === 'upload').map(e => e.path), symbolicLinks: [] }, suggestions: (await suggestions(id)).items, reviewSha256: '', safetySnapshotRecommended: true };
    result.reviewSha256 = await hash(result); return result;
  };
  const resource = (id: string, ref: ContentProvider, required: boolean) => {
    const project = fixtureProjects.find(p => p.source === ref.provider && p.id === ref.projectId) ?? { ...fixtureProjects[0]!, id: ref.projectId, source: ref.provider };
    const version = fixtureVersions(ref.projectId).find(v => v.id === ref.versionId) ?? { ...fixtureVersions(ref.projectId)[0]!, id: ref.versionId, project_id: ref.projectId };
    if (project.resource_type === 'plugin' || project.resource_type === 'world' || project.resource_type === 'modpack') fail('unsupported');
    const kind: PackEntry['kind'] = project.resource_type === 'resourcepack' ? 'resource_pack' : project.resource_type === 'mod' ? 'mod' : project.resource_type === 'shader' ? 'shader' : project.resource_type === 'datapack' ? 'datapack' : fail('unsupported');
    const e = entry(ref.projectId, kind); e.required = required; e.environment.client = required ? 'required' : 'optional'; e.source = { type: 'provider', ...ref }; void id;
    return { project, version, entry: e };
  };
  return {
    fixturePublishedManifest(id) { return clone(state(id, false).published); },
    async packDraft(id) { await host.wait(); return clone(state(id).view); },
    async packIcon(id) { const sha = state(id).view.draft.manifest.icon; if (!sha) return null; const bytes = blobs.get(`${id}:${sha}`) ?? fail('not_found'); let binary = ''; for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768)); return { mimeType: bytes[0] === 0x89 ? 'image/png' : 'image/jpeg', contentBase64: btoa(binary) }; },
    async packWrite(id, request, intent) { return mutate(id, intent, request, () => save(id, request.expectedRevision, request.manifest)); },
    async packDelete(id, expected, intent) { return mutate(id, intent, ['delete', expected], () => save(id, expected, { ...state(id).view.draft.manifest, loader: 'none', loaderVersion: null, minecraftVersion: state(id).view.serverMinecraftVersion, entries: [] })); },
    async packAdd(id, request: PackBrowseAdd, intent) { return mutate(id, intent, request, () => { const m = clone(state(id).view.draft.manifest); for (const r of [{ ...request, required: request.required }, ...request.dependencies]) { const e = resource(id, r, r.required).entry; const old = m.entries.findIndex(old => old.id === e.id); if (old >= 0) m.entries[old] = e; else m.entries.push(e); } return save(id, request.expectedRevision, m); }); },
    async packImport(id, request: PackImport, intent) { return mutate(id, intent, request, async () => { const s = state(id); if (request.source === 'published') { if (s.view.publishedRevision !== request.expectedPublishedRevision) fail('stale_target'); return save(id, request.expectedRevision, s.published); } // Archive fixtures use a deterministic imported manifest; archive parsing is covered by agent Rust tests.
      if (request.source === 'uploaded_archive' && !uploads.get(`${id}:${request.uploadId}`)?.complete) fail('invalid_input');
      const m = clone(seedPackWorkspace('fabric').draft.manifest); m.name = 'Imported client pack'; return save(id, request.expectedRevision, m); }); },
    packSuggestions: suggestions,
    async packDependencies(id, source, projectId, versionId) { const target = clone(state(id).view); if (target.minecraftDrift) fail('stale_target'); const r = resource(id, { provider: source, projectId, versionId }, true); const dependencies = projectId === 'needs-api' ? [{ ...resource(id, provider('fabric-api'), true), required: true, installed: target.draft.manifest.entries.some(e => e.id === 'modrinth-fabric-api') }] : []; return { target, ...r, dependencies, warnings: [] }; },
    packPreview: preview,
    async packBuildPublish(id, request, intent) { requireCap(id, 'pack.publish'); if (request.requiredUpdate) requireCap(id, 'pack.force_update'); return mutate(id, intent, request, async () => { const s = state(id), p = await preview(id, request.draftRevision); if (!p.valid) fail('conflict', 'pack_unresolved_file'); if (request.expectedRevision !== s.view.publishedRevision || request.reviewSha256 !== p.reviewSha256 || JSON.stringify(request.resolvedEntries) !== JSON.stringify(p.resolvedEntries)) fail('stale_target'); const next = String(BigInt(s.view.publishedRevision) + 1n); const minimum = request.requiredUpdate || s.view.publishedRevision === '0' ? next : s.view.minimumRevision; s.view.publishedRevision = next; s.view.minimumRevision = minimum; s.published = clone(p.manifest); s.publishedDraft = s.view.draft.revision; host.server(id).snapshot.pack = { hostedRevision: next, minimumRevision: minimum, status: 'published' }; host.publish?.(id); return { hostedRevision: next, minimumRevision: minimum }; }); },
    async packUploadBegin(id, request, intent) { return mutate(id, intent, request, () => { if (BigInt(request.totalSize) > 68n * 1024n * 1024n) fail('invalid_input'); uploads.set(`${id}:${request.uploadId}`, { request, bytes: new Uint8Array(), complete: false }); return { uploadId: request.uploadId, size: '0', sha256: request.sha256, complete: false }; }); },
    async packUploadChunk(id, request, intent) { return mutate(id, intent, request, () => { const u = uploads.get(`${id}:${request.uploadId}`) ?? fail('not_found'); const bytes = Uint8Array.from(atob(request.contentBase64), c => c.charCodeAt(0)); if (String(u.bytes.length) !== request.offset || bytes.length > 32768 || BigInt(u.bytes.length + bytes.length) > BigInt(u.request.totalSize)) fail('stale_target'); const combined = new Uint8Array(u.bytes.length + bytes.length); combined.set(u.bytes); combined.set(bytes, u.bytes.length); u.bytes = combined; return { uploadId: request.uploadId, size: String(combined.length), sha256: u.request.sha256, complete: false }; }); },
    async packUploadFinish(id, uploadId, intent): Promise<PackUploadReceipt> { return mutate(id, intent, ['finish', uploadId], async () => { const u = uploads.get(`${id}:${uploadId}`) ?? fail('not_found'); if (String(u.bytes.length) !== u.request.totalSize || await bytesHash(u.bytes) !== u.request.sha256) fail('conflict'); u.complete = true; if (!u.request.archive) blobs.set(`${id}:${u.request.sha256}`, u.bytes); return { uploadId, size: u.request.totalSize, sha256: u.request.sha256, complete: true }; }); },
    async packUploadCancel(id, uploadId, intent) { return mutate(id, intent, ['cancel', uploadId], () => uploads.delete(`${id}:${uploadId}`)); },
  };
}
