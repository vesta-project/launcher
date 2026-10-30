import type { serversPackNative, PackWorkspace, PackEntry, PackManifest, PackPreview, PackSuggestion, PackImport, PackBrowseAdd, PackUploadBegin, PackUploadReceipt, PackArchiveInspection, PackInstallPlan, PackInstallSource } from './native-pack';
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
  return { serverModpack: null, clientPack: { mode: 'custom', requireUpdate: false }, draft: { revision: '3', manifest: { name: vanilla ? 'Vanilla textures' : scenario === 'paper' ? 'Riverside client pack' : 'Friends client pack', summary: 'Client resources shared with players.', icon: null, displayVersion: '1.2.0', minecraftVersion: '1.21.4', loader: vanilla ? 'none' : 'fabric', loaderVersion: vanilla ? null : '0.16.10', entries } }, serverMinecraftVersion: '1.21.4', minecraftDrift: false, publishedRevision: '14', minimumRevision: '12', pendingPublication: scenario === 'diff' || scenario === 'suggestions' || scenario === 'validation_failures', safetySnapshotRecommended: true };
}
interface Host {
  scenario?: PackFixtureScenario;
  server(id: string): { snapshot: { capabilities: { granted: string[] }; connection: { role: string | null }; pack: { hostedRevision: string | null; minimumRevision: string | null; status: 'published' | 'unpublished' } | null } };
  switchSoftware?(id: string, target: import('./native-pack').SoftwareSwitchTarget): void;
  software(id: string): string | null;
  minecraftVersion?(id: string): string;
  content?(id: string): Promise<ServerContentInventory>;
  publish?(id: string): void;
  wait(ms?: number): Promise<unknown>;
}
export function createPackFixtures(host: Host): typeof serversPackNative & { fixturePublishedManifest(id: string): PackManifest; fixtureRestartServerModpack(id: string): void } {
  const history = new Map<string, import('./native-pack').PublishedRevision[]>();
  const states = new Map<string, { view: PackWorkspace; published: PackManifest; publishedDraft: string }>();
  const receipts = new Map<string, { input: string; result: unknown }>();
  const installPlans = new Map<string,{id:string;plan:PackInstallPlan;source:PackInstallSource}>();
  const blobs = new Map<string, Uint8Array>();
  const uploads = new Map<string, { request: PackUploadBegin; bytes: Uint8Array; complete: boolean }>();
  const tails = new Map<string, Promise<unknown>>();
  const requireCap = (id: string, cap = 'pack.edit') => { if (!host.server(id).snapshot.capabilities.granted.includes(cap)) fail('forbidden'); };
  const state = (id: string, requireEdit = true) => {
    if (requireEdit) requireCap(id);
    let s = states.get(id);
    if (!s) { const view = seedPackWorkspace(host.scenario ?? (host.software(id) === 'vanilla' ? 'vanilla' : host.software(id) === 'paper' ? 'paper' : 'fabric')); const pack = host.server(id).snapshot.pack; view.publishedRevision = pack?.hostedRevision ?? '0'; view.minimumRevision = pack?.minimumRevision ?? '0'; s = { view, published: clone(view.draft.manifest), publishedDraft: view.pendingPublication ? '2' : view.draft.revision };
      if (host.scenario === 'diff') { s.published.entries = s.published.entries.filter(e => e.kind !== 'resource_pack'); const old = s.published.entries[0]; if (old?.source.type === 'provider') old.source.versionId += '-old'; s.published.entries.push(entry('previous-mod')); }
      history.set(id, view.publishedRevision === '0' ? [] : [{ revision: view.publishedRevision, publishedAt: 1793000000000, publishedBy: 'owner', requiredUpdate: view.minimumRevision === view.publishedRevision, entryCount: s.published.entries.length, overrideCount: (s.published.overrideFiles ?? []).filter(f => !f.trashed && f.sha256 !== null).length, providerVersion: view.providerPack?.versionId ?? null }]);
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
    const result: PackPreview = { draftRevision, publishedRevision: s.view.publishedRevision, manifest, resolvedEntries, warnings: [], issues, valid: !issues.some(i => i.severity === 'error'), diff: { added: manifest.entries.filter(e => !before.some(b => b.path === e.path)), removed: before.filter(b => !manifest.entries.some(e => e.path === b.path)), changed: manifest.entries.flatMap(e => { const b = before.find(b => b.path === e.path); return b && JSON.stringify(b) !== JSON.stringify(e) ? [{ before: b, after: e, versionChanged: b.source.type === 'provider' && e.source.type === 'provider' && b.source.versionId !== e.source.versionId }] : []; }), metadataChanged: JSON.stringify({ ...s.published, entries: [] }) !== JSON.stringify({ ...manifest, entries: [] }), customOverrides: [...manifest.entries.filter(e => e.source.type === 'upload').map(e => e.path), ...(manifest.overrideFiles ?? []).filter(f => !f.trashed && f.sha256 !== null).map(f => `${f.root}/${f.path}`)], symbolicLinks: [] }, suggestions: (await suggestions(id)).items, reviewSha256: '', safetySnapshotRecommended: true };
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
    fixtureRestartServerModpack(id) { const link=state(id).view.serverModpack;if(link?.pending){link.installed=clone(link.pending);link.pending=null;link.pendingIds=[];link.state='installed';} },
    async serverModpackUpdate(id) { const link=state(id).view.serverModpack??fail('conflict');return {installed:clone(link.installed??null),pending:clone(link.pending??null),available:!link.pending&&link.installed?.source.source==='provider'?{...clone(link.installed.source),versionId:`${link.installed.source.versionId}-next`}:null}; },
    async clientPackMode(id, request, intent) { return mutate(id,intent,request,()=>{requireCap(id,'pack.publish');if(request.mode==='server-modpack'&&!state(id).view.serverModpack)fail('conflict');state(id).view.clientPack=clone(request);return clone(request);}); },
    async serverModpackUnlink(id, removeOwnedFiles, intent) { return mutate(id,intent,{removeOwnedFiles},()=>{requireCap(id,'content.install');const view=state(id).view;const link=view.serverModpack??fail('conflict');if(link.pending)fail('conflict');view.serverModpack=null;if(view.clientPack?.mode==='server-modpack')view.clientPack={mode:'none',requireUpdate:false};return {state:'staged_until_restart' as const,pendingIds:removeOwnedFiles?Object.keys(link.files).map((_,i)=>`unlink-${i}`):[],modpackRevision:null,serverModpack:null};}); },
    fixturePublishedManifest(id) { return clone(state(id, false).published); },
    async packHistory(id) { await host.wait(); const s = state(id); return clone(history.get(id) ?? (s.view.publishedRevision === '0' ? [] : [{ revision: s.view.publishedRevision, publishedAt: 1793000000000, publishedBy: 'owner', requiredUpdate: s.view.minimumRevision === s.view.publishedRevision, entryCount: s.published.entries.length, overrideCount: (s.published.overrideFiles ?? []).filter(f => !f.trashed && f.sha256 !== null).length, providerVersion: s.view.providerPack?.versionId ?? null }])); },
    async packUploadDropped() { return fail('unsupported'); },
    async packDraft(id) { await host.wait(); return clone(state(id).view); },
    async packIcon(id) { const sha = state(id).view.draft.manifest.icon; if (!sha) return null; const bytes = blobs.get(`${id}:${sha}`) ?? fail('not_found'); let binary = ''; for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768)); return { mimeType: bytes[0] === 0x89 ? 'image/png' : 'image/jpeg', contentBase64: btoa(binary) }; },
    async packWrite(id, request, intent) { return mutate(id, intent, request, () => save(id, request.expectedRevision, request.manifest)); },
    async packDelete(id, expected, intent) { return mutate(id, intent, ['delete', expected], () => save(id, expected, { ...state(id).view.draft.manifest, loader: 'none', loaderVersion: null, minecraftVersion: state(id).view.serverMinecraftVersion, entries: [] })); },
    async packAdd(id, request: PackBrowseAdd, intent) { return mutate(id, intent, request, () => { const m = clone(state(id).view.draft.manifest); for (const r of [{ ...request, required: request.required }, ...request.dependencies]) { const e = resource(id, r, r.required).entry; const old = m.entries.findIndex(old => old.id === e.id); if (old >= 0) m.entries[old] = e; else m.entries.push(e); } return save(id, request.expectedRevision, m); }); },
    async packProviderPublish(id, request, intent) {
      return mutate(id, intent, request, () => {
        requireCap(id, 'pack.build'); requireCap(id, 'pack.publish'); if (request.requiredUpdate) requireCap(id, 'pack.force_update');
        const s = state(id); if (request.expectedRevision !== s.view.publishedRevision || request.draftRevision !== s.view.draft.revision) fail('stale_target');
        s.publishedDraft = s.view.draft.revision; s.published = clone(s.view.draft.manifest); s.view.customizingProvider = false; s.view.pendingPublication = false;
        s.view.providerPack = { provider: request.provider, projectId: request.projectId, versionId: request.versionId };
        s.view.publishedRevision = String(BigInt(s.view.publishedRevision) + 1n);
        if (request.requiredUpdate) s.view.minimumRevision = s.view.publishedRevision;
        const pack = host.server(id).snapshot.pack;
        if (pack) { pack.hostedRevision = s.view.publishedRevision; pack.minimumRevision = s.view.minimumRevision; }
const rows = history.get(id) ?? []; rows.unshift({ revision: s.view.publishedRevision, publishedAt: Date.now(), publishedBy: 'owner', requiredUpdate: request.requiredUpdate, entryCount: s.view.providerPack ? 0 : s.published.entries.length, overrideCount: s.view.providerPack ? 0 : (s.published.overrideFiles ?? []).filter(f => !f.trashed && f.sha256 !== null).length, providerVersion: s.view.providerPack?.versionId ?? null }); history.set(id, rows);         return { hostedRevision: s.view.publishedRevision, minimumRevision: s.view.minimumRevision };
      });
    },
    async packFileRead(id, request) {
      requireCap(id); const draft = state(id).view.draft;
      if (draft.revision !== request.expectedRevision) fail('stale_target');
      const file = draft.manifest.overrideFiles?.find(f => !f.trashed && f.root === request.root && f.path === request.path);
      const sha256 = file?.sha256 ?? fail('not_found');
      const bytes = blobs.get(`${id}:${sha256}`) ?? fail('not_found');
      if (bytes.length > 1024 * 1024) fail('invalid_input');
      new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      return { revision: draft.revision, sha256, contentBase64: btoa(Array.from(bytes, b => String.fromCharCode(b)).join('')) };
    },
    async packFileMutate(id, request, intent) {
      return mutate(id, intent, request, async () => {
        const manifest = clone(state(id).view.draft.manifest);
        if (state(id).view.draft.revision !== request.expectedRevision) fail('stale_target');
        const change = request.change;
        const valid = (p: string) => !!p && !p.startsWith('/') && !p.includes('\\') && p.split('/').every(s => !!s && s !== '.' && s !== '..' && !s.includes(':'));
        if (!valid(change.path) || !['overrides', 'client-overrides', 'server-overrides'].includes(change.root)) fail('invalid_input');
        const files = manifest.overrideFiles ??= [];
        const selected = files.filter(f => !f.trashed && f.root === change.root && (f.path === change.path || f.path.startsWith(`${change.path}/`)));
        if (change.operation === 'write' || change.operation === 'attach') {
          if (!/^(mods|resourcepacks|shaderpacks|datapacks|config|defaultconfigs|kubejs|scripts|resources)\//.test(change.path) && !['options.txt', 'optionsof.txt', 'optionsshaders.txt', 'servers.dat'].includes(change.path)) fail('invalid_input');
          let sha: string;
          if (change.operation === 'write') {
            const bytes = Uint8Array.from(atob(change.contentBase64), c => c.charCodeAt(0));
            if (bytes.length > 1024 * 1024) fail('invalid_input');
            new TextDecoder('utf-8', { fatal: true }).decode(bytes);
            sha = await bytesHash(bytes); blobs.set(`${id}:${sha}`, bytes);
          } else { sha = change.sha256; if (!blobs.has(`${id}:${sha}`)) fail('not_found'); }
          const old = files.find(f => !f.trashed && f.root === change.root && f.path === change.path);
          if (old) { if (old.sha256 === null) fail('conflict'); old.sha256 = sha; }
          else files.push({ root: change.root, path: change.path, sha256: sha, trashed: false });
        } else if (change.operation === 'mkdir') files.push({ root: change.root, path: change.path, sha256: null, trashed: false });
        else {
          if (!selected.length) fail('not_found');
          if (change.operation === 'rename') {
            if (!valid(change.destination) || change.destination.startsWith(`${change.path}/`)) fail('invalid_input');
            for (const file of selected) file.path = change.destination + file.path.slice(change.path.length);
          } else for (const file of selected) file.trashed = true;
        }
        const names = files.filter(f => !f.trashed).map(f => `${f.root}/${f.path.toLowerCase()}`);
        if (new Set(names).size !== names.length || files.length > 256) fail('conflict');
        return save(id, request.expectedRevision, manifest);
      });
    },
    async packInstallPlan(id, request) {
      requireCap(id,'content.install');
      if(state(id).view.serverModpack?.pending)fail('conflict');
      if (!['owner','administrator','admin'].includes(host.server(id).snapshot.connection.role ?? '')) fail('forbidden');
      const scenario=request.source.source==='provider'?'provider':request.source.source==='uploaded_archive'?'archive':'conflicts';
      const plan=seedPackInstallPlan(scenario); plan.planId=crypto.randomUUID(); plan.confirmationToken=crypto.randomUUID();plan.expiresAtMs=Date.now()+900000;
      plan.softwareSwitchRequired=host.software(id)!==plan.software||(host.minecraftVersion?.(id)??'1.21.4')!==plan.minecraftVersion;
      plan.softwareSwitch = plan.softwareSwitchRequired ? {from:{software:host.software(id)??'unknown',minecraftVersion:host.minecraftVersion?.(id)??'1.21.4',loaderVersion:null},to:{software:plan.software,minecraftVersion:plan.minecraftVersion,loaderVersion:plan.loaderVersion}} : null;
      installPlans.set(plan.planId,{id,plan:clone(plan),source:clone(request.source)});return plan;
    },
    async packInstallApply(id, request, intent) {
      requireCap(id,'content.install');
      if (!['owner','administrator','admin'].includes(host.server(id).snapshot.connection.role ?? '')) fail('forbidden');
      return mutate(id,intent,request,()=>{
        const saved=installPlans.get(request.planId)??fail('not_found'),p=saved.plan;
        if(saved.id!==id||p.confirmationToken!==request.confirmationToken||p.expiresAtMs<Date.now())fail('conflict');
        if(p.warnings.length && !request.acknowledgeWarnings)fail('invalid_input');
        if(p.softwareSwitchRequired && !request.acknowledgeSoftwareSwitch)fail('stale_target');
        if(!p.softwareSwitchRequired && (host.software(id)!==p.software||(host.minecraftVersion?.(id)??'1.21.4')!==p.minecraftVersion))fail('stale_target');
        const conflicts=p.files.filter(f=>f.conflict).map(f=>f.path).sort();
        if(JSON.stringify(conflicts)!==JSON.stringify(request.choices.map(c=>c.path).sort())||request.choices.some(c=>!['keep','replace'].includes(c.choice)))fail('invalid_input');
        const view=state(id).view;
        const selected=p.files.filter(f=>!request.choices.some(c=>c.path===f.path&&c.choice==='keep'));
        if(view.serverModpack?.pending)fail('conflict');
        if(p.softwareSwitchRequired)host.switchSoftware?.(id,{software:p.software,minecraftVersion:p.minecraftVersion,loaderVersion:p.loaderVersion});
        view.serverModpack={source:clone(saved.source),displayVersion:'1',files:Object.fromEntries(selected.map(f=>[f.path,f.sha256])),state:'staged_until_restart',installed:view.serverModpack?.installed??null,pending:{source:clone(saved.source),displayVersion:'1'},pendingIds:selected.map((_,i)=>`${p.planId}-${i}`)};
        if(!selected.length){view.serverModpack.installed=view.serverModpack.pending;view.serverModpack.pending=null;view.serverModpack.state='installed';}
        return {state:'staged_until_restart' as const,pendingIds:selected.map((_,i)=>`${p.planId}-${i}`),modpackRevision:null,serverModpack:clone(view.serverModpack)};
      });
    },
    async packArchiveInspect(id, uploadId) {
      requireCap(id);
      const upload = uploads.get(`${id}:${uploadId}`) ?? fail('not_found');
      if (!upload.complete || !upload.request.archive) fail('conflict');
      return seedArchiveInspection('mrpack');
    },
    async packImport(id, request: PackImport, intent) { return mutate(id, intent, request, async () => { const s = state(id); if (request.source === 'published') { if (s.view.publishedRevision !== request.expectedPublishedRevision) fail('stale_target'); s.view.customizingProvider = !!s.view.providerPack; return save(id, request.expectedRevision, s.published); } // Archive fixtures use a deterministic imported manifest; archive parsing is covered by agent Rust tests.
      if (request.source === 'uploaded_archive' && !uploads.get(`${id}:${request.uploadId}`)?.complete) fail('invalid_input');
      const m = clone(seedPackWorkspace('fabric').draft.manifest); m.name = 'Imported client pack'; return save(id, request.expectedRevision, m); }); },
    packSuggestions: suggestions,
    async packDependencies(id, source, projectId, versionId) { const target = clone(state(id).view); if (target.minecraftDrift) fail('stale_target'); const r = resource(id, { provider: source, projectId, versionId }, true); const dependencies = projectId === 'needs-api' ? [{ ...resource(id, provider('fabric-api'), true), required: true, installed: target.draft.manifest.entries.some(e => e.id === 'modrinth-fabric-api') }] : []; return { target, ...r, dependencies, warnings: [] }; },
    packPreview: preview,
    async packBuildPublish(id, request, intent) { requireCap(id, 'pack.publish'); if (request.requiredUpdate) requireCap(id, 'pack.force_update'); return mutate(id, intent, request, async () => { const s = state(id), p = await preview(id, request.draftRevision); if (!p.valid) fail('conflict', 'pack_unresolved_file'); if (request.expectedRevision !== s.view.publishedRevision || request.reviewSha256 !== p.reviewSha256 || JSON.stringify(request.resolvedEntries) !== JSON.stringify(p.resolvedEntries)) fail('stale_target'); const next = String(BigInt(s.view.publishedRevision) + 1n); const minimum = request.requiredUpdate || s.view.publishedRevision === '0' ? next : s.view.minimumRevision; s.view.publishedRevision = next; s.view.minimumRevision = minimum; s.view.providerPack = null; s.published = clone(p.manifest); s.publishedDraft = s.view.draft.revision; host.server(id).snapshot.pack = { hostedRevision: next, minimumRevision: minimum, status: 'published' }; const rows = history.get(id) ?? []; rows.unshift({ revision: s.view.publishedRevision, publishedAt: Date.now(), publishedBy: 'owner', requiredUpdate: request.requiredUpdate, entryCount: s.view.providerPack ? 0 : s.published.entries.length, overrideCount: s.view.providerPack ? 0 : (s.published.overrideFiles ?? []).filter(f => !f.trashed && f.sha256 !== null).length, providerVersion: null }); history.set(id, rows); host.publish?.(id); return { hostedRevision: next, minimumRevision: minimum }; }); },
    async packUploadBegin(id, request, intent) { return mutate(id, intent, request, () => { if (BigInt(request.totalSize) > (request.archive ? 128n * 1024n * 1024n * 1024n : 16n * 1024n * 1024n)) fail('invalid_input'); uploads.set(`${id}:${request.uploadId}`, { request, bytes: new Uint8Array(), complete: false }); return { uploadId: request.uploadId, size: '0', sha256: request.sha256, complete: false }; }); },
    async packUploadChunk(id, request, intent) { return mutate(id, intent, request, () => { const u = uploads.get(`${id}:${request.uploadId}`) ?? fail('not_found'); const bytes = Uint8Array.from(atob(request.contentBase64), c => c.charCodeAt(0)); if (String(u.bytes.length) !== request.offset || bytes.length > 512 * 1024 || BigInt(u.bytes.length + bytes.length) > BigInt(u.request.totalSize)) fail('stale_target'); const combined = new Uint8Array(u.bytes.length + bytes.length); combined.set(u.bytes); combined.set(bytes, u.bytes.length); u.bytes = combined; return { uploadId: request.uploadId, size: String(combined.length), sha256: u.request.sha256, complete: false }; }); },
    async packUploadFinish(id, uploadId, intent): Promise<PackUploadReceipt> { return mutate(id, intent, ['finish', uploadId], async () => { const u = uploads.get(`${id}:${uploadId}`) ?? fail('not_found'); if (String(u.bytes.length) !== u.request.totalSize || await bytesHash(u.bytes) !== u.request.sha256) fail('conflict'); u.complete = true; if (!u.request.archive) blobs.set(`${id}:${u.request.sha256}`, u.bytes); return { uploadId, size: u.request.totalSize, sha256: u.request.sha256, complete: true }; }); },
    async packUploadCancel(id, uploadId, intent) { return mutate(id, intent, ['cancel', uploadId], () => uploads.delete(`${id}:${uploadId}`)); },
  };
}

/** Deterministic archive review fixtures; production parsing lives in the agent. */
export function seedArchiveInspection(format: PackArchiveInspection['format']): PackArchiveInspection {
  const manifest = seedPackWorkspace('fabric').draft.manifest;
  manifest.name = `Imported ${format} pack`;
  if (format === 'zip') { manifest.loader = 'none'; manifest.loaderVersion = null; }
  const override: PackEntry = { id: 'config', kind: 'config_override', path: 'config/example.toml', required: true, environment: { client: 'required', server: 'optional' }, source: { type: 'upload', sha256: 'a'.repeat(64) } };
  if (format === 'curseforge') manifest.entries = manifest.entries.map((e, i) => ({ ...e, source: { type: 'provider', provider: 'curseforge', projectId: String(100 + i), versionId: String(200 + i) } }));
  if (format === 'zip') manifest.entries = manifest.entries.map(e => ({ ...e, source: { type: 'upload', sha256: 'e'.repeat(64) }, environment: { client: 'required', server: 'optional' } }));
  if (format === 'mrpack' || format === 'curseforge') manifest.overrideFiles = [{ root: 'overrides', path: override.path, sha256: 'a'.repeat(64), trashed: false }];
  else manifest.entries.push(override);
  if (format === 'mrpack') manifest.entries.push({ ...override, id: 'unresolved', kind: 'mod', path: 'mods/unresolved.jar', source: { type: 'manual', reason: 'import_provider_identity_missing' } });
  return { format, manifest, entryCount: manifest.entries.length,
    providerEntries: manifest.entries.flatMap(e => e.source.type === 'provider' ? [{ provider: e.source.provider, projectId: e.source.projectId, versionId: e.source.versionId }] : []),
    unresolvedFiles: manifest.entries.filter(e => e.source.type === 'manual' || (format === 'zip' && e.kind !== 'config_override')).map(e => e.path),
    overrides: [format === 'mrpack' || format === 'curseforge' ? `overrides/${override.path}` : override.path], providerPack: null,
    warnings: ['archive_does_not_establish_pack_provider_identity', ...(format === 'zip' ? ['archive_runtime_inferred_from_server'] : [])] };
}

export function seedRedesignWorkspace(source: 'provider' | 'overrides'): PackWorkspace {
  const workspace = seedPackWorkspace('fabric');
  if (source === 'provider') workspace.providerPack = { provider: 'modrinth', projectId: 'pack', versionId: 'v2' };
  else workspace.draft.manifest.overrideFiles = [
    { root: 'overrides', path: 'config/shared.toml', sha256: 'a'.repeat(64), trashed: false },
    { root: 'client-overrides', path: 'config/client.toml', sha256: 'b'.repeat(64), trashed: false },
    { root: 'server-overrides', path: 'config/server.toml', sha256: 'c'.repeat(64), trashed: false },
    { root: 'overrides', path: 'config/old.toml', sha256: 'd'.repeat(64), trashed: true },
    { root: 'overrides', path: 'defaultconfigs', sha256: null, trashed: false },
  ];
  return workspace;
}

/** Review examples for the Modpack and Browse server destinations. */
export function seedPackInstallPlan(scenario:'provider'|'archive'|'conflicts'|'software_switch'):PackInstallPlan {
  return {softwareSwitch:scenario==='software_switch'?{from:{software:'paper',minecraftVersion:'1.21.4',loaderVersion:null},to:{software:'fabric',minecraftVersion:'1.21.5',loaderVersion:'0.16.10'}}:null,planId:'fixture-plan',confirmationToken:'fixture-confirmation',expiresAtMs:Date.now()+900000,
    minecraftVersion:scenario==='software_switch'?'1.21.5':'1.21.4',software:'fabric',loaderVersion:'0.16.10',softwareSwitchRequired:scenario==='software_switch',valid:true,backupRecommended:true,
    files:[{path:'mods/example.jar',sha256:'a'.repeat(64),expectedSha256:scenario==='conflicts'?'b'.repeat(64):null,conflict:scenario==='conflicts'?'project_version':null},
      ...(scenario==='archive'?[{path:'config/example.json',sha256:'c'.repeat(64),expectedSha256:null,conflict:null}]:[])],
    skipped:['mods/client-only.jar','client-overrides/options.txt'],warnings:['unknown_server_side:mods/example.jar']};
}

/** Corrected independent links, including a server that offers no player pack. */
export function seedServerModpackModel(scenario: 'none'|'linked-follow'|'linked-custom'|'unlinked-custom'): PackWorkspace {
  const view=seedPackWorkspace('fabric');
  view.serverModpack=scenario.startsWith('linked-')?{source:{source:'provider',provider:'modrinth',projectId:'friends-pack',versionId:'v2'},displayVersion:'2',files:{'mods/fabric-api.jar':'a'.repeat(64)},state:'installed'}:null;
  if(view.serverModpack){view.serverModpack.installed={source:clone(view.serverModpack.source),displayVersion:view.serverModpack.displayVersion};view.serverModpack.pending=null;view.serverModpack.pendingIds=[];}
  view.clientPack={mode:scenario==='none'?'none':scenario==='linked-follow'?'server-modpack':'custom',requireUpdate:scenario==='linked-follow'};
  return view;
}
