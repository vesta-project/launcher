// Preview only: shapes the browser fixtures' owner server into the Modpack area's scenarios so
// each state can be seen without a live agent. Set before loading, comma-separated:
//   localStorage['vesta.fixtures.modpack'] = 'provider' | 'overrides' | 'empty' | 'linked'
//   plus optionally 'archive=mrpack|curseforge|zip|vesta|linked' for upload inspection results.
import { seedArchiveInspection } from './fixtures-pack';
import type { ServerContentEntry } from './native-content';
import type { ServersApi } from './service';

const OWNER = 'fixture-survival';

/** `linked`: the owner server follows a Modrinth modpack that installed these mods. */
const LINKED_MODS: [projectId: string | null, name: string][] = [
  ['sodium', 'Sodium'], ['lithium', 'Lithium'], [null, 'Create'], [null, "Farmer's Delight"], [null, 'Supplementaries'],
  [null, 'Waystones'], [null, 'Balm'], [null, 'Cloth Config API'], [null, 'Architectury API'], [null, 'Jade'], [null, 'Chunky'],
  [null, 'Spark'], [null, 'FerriteCore'], [null, 'Collective'],
];
const linkedPath = (name: string) => `mods/${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.jar`;
const linkedEntries = (): ServerContentEntry[] => LINKED_MODS.map(([projectId, name]) => ({
  kind: 'mod', path: linkedPath(name), filename: linkedPath(name).slice(5), size: '812345', enabled: true, sha256: 'd'.repeat(64), modpackOwned: true,
  provider: projectId ? { provider: 'modrinth', projectId, versionId: `${projectId}-1` } : null,
  declared: { loader: 'fabric', side: '*', name, version: '1.0', dependencies: [] }, pending: null, pendingId: null, pendingError: null,
}));

export function withModpackScenario(api: ServersApi, setting: string | null | undefined): ServersApi {
  if (!setting) return api;
  const parts = new Set(setting.split(',').map((part) => part.trim()));
  const archive = [...parts].find((part) => part.startsWith('archive='))?.slice('archive='.length);
  let prepared: Promise<void> | undefined;
  const prepare = (id: string) => {
    if (id !== OWNER) return Promise.resolve();
    return (prepared ??= (async () => {
      const view = await api.packDraft(id);
      if (parts.has('provider')) {
        await api.packProviderPublish(id, { provider: 'modrinth', projectId: 'fo', versionId: 'fo-2', expectedRevision: view.publishedRevision, draftRevision: view.draft.revision, requiredUpdate: false, acknowledgeLowerVersion: false }, 'preview-provider');
      } else if (parts.has('overrides')) {
        const files: [string, string, string][] = [
          ['overrides', 'config/sodium-options.json', '{\n  "quality": { "weather_quality": "FANCY" }\n}\n'],
          ['overrides', 'config/xaero/minimap.txt', 'minimap=true\nzoom=2\n'],
          ['client-overrides', 'options.txt', 'renderDistance:12\nguiScale:2\n'],
          ['server-overrides', 'config/ftbchunks-world.snbt', '{\n  max_claimed_chunks: 500\n}\n'],
        ];
        // The fixture draft targets 1.21.4; match the server first so file edits are accepted.
        let revision = (await api.packWrite(id, { expectedRevision: view.draft.revision, manifest: { ...view.draft.manifest, minecraftVersion: view.serverMinecraftVersion } }, 'preview-mc')).revision;
        for (const [root, path, text] of files) {
          const draft = await api.packFileMutate(id, { expectedRevision: revision, change: { operation: 'write', root: root as 'overrides', path, contentBase64: btoa(text) } }, `preview-${path}`);
          revision = draft.revision;
        }
      } else if (parts.has('empty')) {
        await api.packDelete(id, view.draft.revision, 'preview-empty');
      }
    })().catch((reason) => { prepared = undefined; throw reason; }));
  };
  // `empty` presents the owner server as never published while its draft stays empty.
  const unpublished = async (id: string) => {
    const view = await api.packDraft(id);
    const blank = !view.providerPack && view.draft.manifest.entries.length === 0 && !(view.draft.manifest.overrideFiles ?? []).some((file) => !file.trashed);
    return { view, blank: parts.has('empty') && id === OWNER && blank };
  };
  return {
    ...api,
    async packDraft(id) {
      await prepare(id);
      const { view, blank } = await unpublished(id);
      if (parts.has('linked') && id === OWNER && !view.serverModpack) {
        const source = { source: 'provider' as const, provider: 'modrinth' as const, projectId: 'fo', versionId: 'fo-2' };
        const files = Object.fromEntries(linkedEntries().map((entry) => [entry.path, entry.sha256!]));
        return { ...view, serverModpack: { source, displayVersion: '2', files, state: 'installed', installed: { source, displayVersion: '2' }, pending: null, pendingIds: [] } };
      }
      return blank ? { ...view, publishedRevision: '0', minimumRevision: '0', pendingPublication: false } : view;
    },
    async serverModpackUpdate(id) {
      if (!parts.has('linked') || id !== OWNER) return api.serverModpackUpdate(id);
      const link = (await this.packDraft(id)).serverModpack!;
      return { installed: link.installed ?? null, pending: null, available: null };
    },
    async content(id) {
      const inventory = await api.content(id);
      return parts.has('linked') && id === OWNER ? { ...inventory, items: [...linkedEntries(), ...inventory.items] } : inventory;
    },
    async packProviderPublish(id, request, intent) {
      const real = (await api.packDraft(id)).publishedRevision;
      return api.packProviderPublish(id, parts.has('empty') && id === OWNER ? { ...request, expectedRevision: real } : request, intent);
    },
    async packArchiveInspect(id, uploadId) {
      const result = await api.packArchiveInspect(id, uploadId);
      if (!archive) return result;
      if (archive === 'linked') return { ...seedArchiveInspection('mrpack'), unresolvedFiles: [], providerPack: { provider: 'modrinth', projectId: 'fo', versionId: 'fo-3' }, warnings: [] };
      return seedArchiveInspection(archive as 'mrpack');
    },
  };
}
