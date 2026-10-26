import type { ConnectionId, ServerCommandError } from './native';
import type { ContentChange, ContentInstallRequest, ContentMutation, ContentProvider, ServerContentEntry, ServerContentInventory } from './native-content';

const clone = <T,>(v: T): T => structuredClone(v);
const fail = (code: ServerCommandError['code'], reason?: string): never => { throw { code, reason: reason ?? null, retryAfterMs: null } satisfies ServerCommandError; };
const hash = 'a'.repeat(64);
const entry = (kind: ServerContentEntry['kind'], path: string, provider: ContentProvider | null, extra: Partial<ServerContentEntry> = {}): ServerContentEntry => ({ kind, path, filename: path.split('/').at(-1)!, size: '456789', enabled: !path.endsWith('.disabled'), sha256: hash, provider, declared: null, pending: null, pendingId: null, pendingError: null, ...extra });

/** Stable, isolated scenarios for the Resources page and checks. */
export function seedContentInventory(software: string): ServerContentInventory {
  const modded = ['fabric', 'quilt', 'forge', 'neoforge'].includes(software);
  const plugins = ['paper', 'spigot', 'bukkit', 'purpur', 'folia'].includes(software);
  return {
    software, minecraftVersion: '1.21.4', truncated: false,
    capabilities: { list: true, install: true, update: true, remove: true, toggle: true, cancel: true, modsSupported: modded, pluginsSupported: plugins },
    items: [
      ...(modded ? [entry('mod', 'mods/lithium.jar', { provider: 'modrinth', projectId: 'lithium', versionId: 'lithium-1.0' }, { declared: { loader: 'fabric', side: '*', name: 'Lithium', version: '1.0', dependencies: ['minecraft', 'fabricloader'] } }), entry('mod', 'mods/unidentified.jar', null), entry('mod', 'mods/old-mod.jar.disabled', null, { pending: 'remove', pendingId: 'seed-remove' }), entry('mod', 'mods/fabric-api.jar', { provider: 'modrinth', projectId: 'fabric-api', versionId: 'fabric-api-2' }, { pending: 'install', pendingId: 'seed-install', enabled: null, sha256: null, size: '0' })] : []),
      ...(plugins ? [entry('plugin', 'plugins/LuckPerms.jar', { provider: 'modrinth', projectId: 'luckperms', versionId: 'lp-5' }, { declared: { loader: 'bukkit', side: 'server', name: 'LuckPerms', version: '5.4', dependencies: [] } }), entry('plugin', 'plugins/custom-plugin.jar', null, { pending: 'update', pendingId: 'seed-update' })] : []),
      entry('datapack', 'world/datapacks/terralith.zip', { provider: 'modrinth', projectId: 'terralith', versionId: 'terralith-2' }),
    ],
  };
}
interface Host {
  server(id: ConnectionId): { snapshot: { connection: { role: string | null }; status: { state: string; generation: string | null } | null; capabilities: { granted: string[] } } };
  software(id: ConnectionId): string | null;
  minecraftVersion?(id: ConnectionId): string;
  wait(ms?: number): Promise<unknown>;
}
export function createContentFixtures(host: Host) {
  const inventories = new Map<string, ServerContentInventory>();
  const intents = new Map<string, { payload: string; result: ContentChange }>();
  const pending = new Map<string, { generation: string | null; apply(): void; result: ContentChange }>();
  const state = (id: string) => {
    const target = host.server(id);
    const software = host.software(id) ?? 'unknown';
    let inventory = inventories.get(id);
    if (!inventory || inventory.software !== software) { inventory = seedContentInventory(software); inventories.set(id, inventory); }
    inventory.minecraftVersion = host.minecraftVersion?.(id) ?? inventory.minecraftVersion;
    for (const [key, change] of pending) if (key.startsWith(`${id}:`) && target.snapshot.status?.generation && target.snapshot.status.generation !== change.generation) { change.apply(); pending.delete(key); }
    const granted = target.snapshot.capabilities.granted;
    const content = granted.includes('content.install');
    inventory.capabilities.install = content && granted.includes('files.create');
    inventory.capabilities.update = content && granted.includes('files.overwrite');
    inventory.capabilities.remove = content && granted.includes('files.delete');
    inventory.capabilities.toggle = content && granted.includes('files.rename');
    inventory.capabilities.cancel = content;
    return inventory;
  };
  const write = (id: string, intent: string, payload: unknown, action: string, item: ServerContentEntry, apply: () => void): ContentChange => {
    const target = host.server(id); if (!target.snapshot.capabilities.granted.includes('content.install')) fail('forbidden');
    const key = `${id}:${intent}`, binding = JSON.stringify(payload), known = intents.get(key);
    if (known) { if (known.payload !== binding) fail('conflict'); return clone(known.result); }
    if (item.pendingId && !item.pendingId.startsWith('seed-')) fail('conflict');
    const running = !!target.snapshot.status?.generation;
    const result: ContentChange = { id: `content-${crypto.randomUUID()}`, state: running ? 'pending' : 'applied', pending: running ? action as ContentChange['pending'] : null, path: item.path, error: null };
    const effect = () => { apply(); item.pending = null; item.pendingId = null; result.state = 'applied'; result.pending = null; };
    if (running) { item.pending = action as ContentChange['pending']; item.pendingId = result.id; pending.set(`${id}:${result.id}`, { generation: target.snapshot.status!.generation, apply: effect, result }); } else effect();
    intents.set(key, { payload: binding, result }); return clone(result);
  };
  return {
    async content(id: string) { await host.wait(); const target = host.server(id); if (!target.snapshot.capabilities.granted.includes('files.list')) fail('forbidden'); return clone(state(id)); },
    async contentInstall(id: string, request: ContentInstallRequest, intent: string) {
      const inventory = state(id);
      if (!inventory.capabilities.install || (request.path && !inventory.capabilities.update)) fail('forbidden');
      if (request.kind === 'mod' && !inventory.capabilities.modsSupported) fail('conflict', 'content_mods_unsupported');
      if (request.kind === 'plugin' && !inventory.capabilities.pluginsSupported) fail('conflict', 'content_plugins_unsupported');
      const path = request.path ?? `${request.kind === 'datapack' ? 'world/datapacks' : request.kind === 'plugin' ? 'plugins' : 'mods'}/${request.projectId}.${request.kind === 'datapack' ? 'zip' : 'jar'}`;
      let item = inventory.items.find(i => i.path === path);
      if (request.path && (!item || item.sha256 !== request.expectedSha256)) fail('stale_target');
      if (!item) { item = entry(request.kind, path, null, { enabled: null, sha256: null, size: '0' }); inventory.items.push(item); }
      const target = item;
      return write(id, intent, request, request.path ? 'update' : 'install', target, () => { target.provider = { provider: request.provider, projectId: request.projectId, versionId: request.versionId }; target.sha256 = hash; target.enabled = !path.endsWith('.disabled'); target.size = '456789'; });
    },
    async contentMutate(id: string, request: ContentMutation, intent: string) {
      const inventory = state(id), item = inventory.items.find(i => i.path === request.path) ?? fail('not_found');
      if (!(request.action === 'remove' ? inventory.capabilities.remove : inventory.capabilities.toggle)) fail('forbidden');
      if (item.sha256 !== request.expectedSha256) fail('stale_target');
      return write(id, intent, request, request.action, item, () => { if (request.action === 'remove') inventory.items = inventory.items.filter(i => i !== item); else { item.path = request.action === 'disable' ? `${item.path}.disabled` : item.path.replace(/\.disabled$/, ''); item.filename = item.path.split('/').at(-1)!; item.enabled = request.action === 'enable'; } });
    },
    async contentCancel(id: string, changeId: string, intent: string) {
      const inventory = state(id); if (!inventory.capabilities.cancel) fail('forbidden');
      const change = pending.get(`${id}:${changeId}`);
      const item = inventory.items.find(i => i.pendingId === changeId) ?? fail('conflict');
      item.pending = null; item.pendingId = null;
      if (change?.result.pending === 'install') inventory.items = inventory.items.filter(i => i !== item);
      pending.delete(`${id}:${changeId}`);
      const result: ContentChange = { id: changeId, state: 'cancelled', pending: null, path: item.path, error: null }; if (change) Object.assign(change.result, result);
      void intent; return clone(result);
    },
    async contentIdentify(id: string, path: string, intent: string) { if (!state(id).capabilities.cancel) fail('forbidden'); void intent; return clone(state(id).items.find(i => i.path === path)?.provider ?? null); },
    async contentDependencies(id: string, provider: ContentProvider['provider'], projectId: string, versionId: string) {
      const { fixtureProjects, fixtureVersions } = await import('../browse/browse-fixtures');
      const target = clone(state(id)); if (!target.capabilities.install) fail('forbidden');
      const project = fixtureProjects.find(p => p.source === provider && p.id === projectId) ?? fail('not_found');
      const version = fixtureVersions(projectId).find(v => v.id === versionId) ?? fail('not_found');
      return { target, project, version, dependencies: [], warnings: [] };
    },
  };
}
