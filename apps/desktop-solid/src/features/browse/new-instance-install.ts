import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { untrack } from 'solid-js';
import { installationDefaults, startInstallation } from '../installation/install-service';
import { loadMetadata, metadata, metadataError } from '../instances/metadata';
import type { NativeInstance } from '../instances/native-model';
import { nativeInstances } from '../instances/native-service';
import { hasDownloadableArtifact, loaderIds, selectInstallVersion, requiresWorldTarget,
  type ResourceProject, type ResourceType } from './browse-model';
import { loadVersions } from './browse-projects';
import { installInto, setNotice } from './browse-store';

const active = new Map<string, Promise<void>>();
type Choice = { minecraftVersion?: string; loader?: string };

/** Direct creation uses the same draft/host pipeline as Create. Duplicate clicks join it. */
export async function installIntoNewInstance(
  project: ResourceProject,
  kind: ResourceType,
  choice?: Choice,
): Promise<void> {
  const key = JSON.stringify([project.source, project.id, kind, choice?.minecraftVersion, choice?.loader]);
  const existing = active.get(key);
  if (existing) return existing;
  const pending = createAndInstall(project, kind, choice).catch((reason: unknown) => {
    setNotice({ tone: 'danger', text: String(reason instanceof Error ? reason.message : reason) });
  }).finally(() => active.delete(key));
  active.set(key, pending);
  return pending;
}

async function createAndInstall(project: ResourceProject, kind: ResourceType, choice: Choice = {}) {
  if (!nativeInstances) throw new Error('Creating an instance requires the desktop launcher.');
  if (kind === 'modpack') throw new Error('Use the modpack create flow for modpacks.');
  const [versions, defaults] = await Promise.all([
    loadVersions(project.source, project.id), installationDefaults(), loadMetadata(),
  ]);
  const catalog = untrack(metadata);
  if (!catalog) throw new Error(untrack(metadataError) || 'Minecraft metadata is unavailable.');
  const requestedLoader = choice.loader?.trim().toLowerCase();
  if (requestedLoader && requestedLoader !== 'vanilla' && !loaderIds.some((id) => id === requestedLoader))
    throw new Error(`Unsupported loader: ${requestedLoader}`);
  // Metadata order is Minecraft release order. Prefer a stable resource release, then
  // the newest stable game it supports. Never mistake provider tags (iris/datapack) for loaders.
  const games = choice.minecraftVersion
    ? catalog.game_versions.filter((game) => game.id === choice.minecraftVersion)
    : [...catalog.game_versions.filter((game) => game.stable), ...catalog.game_versions.filter((game) => !game.stable)];
  const candidates = games.flatMap((game) => {
    const loaders = requestedLoader ? [requestedLoader] : kind === 'mod' || kind === 'shader' ? [...loaderIds] : ['vanilla'];
    return loaders.flatMap((loader) => {
      const loaderVersion = game.loaders[loader]?.find((version) => version.stable)?.version
        || game.loaders[loader]?.[0]?.version || '';
      if (kind === 'shader' && loader === 'vanilla') return [];
      if (loader !== 'vanilla' && !loaderVersion) return [];
      const target = { minecraftVersion: game.id, modloader: loader };
      const selected = selectInstallVersion(versions, target, kind, project.source);
      return selected && hasDownloadableArtifact(selected.version)
        ? [{ target, loaderVersion, selected }] : [];
    });
  });
  const rank = { release: 0, beta: 1, alpha: 2 };
  candidates.sort((a, b) => rank[a.selected.version.release_type] - rank[b.selected.version.release_type]);
  const selected = candidates[0];
  if (!selected) throw new Error(`No downloadable compatible version of ${project.name} is available.`);
  setNotice({ tone: 'neutral', text: `Creating an instance for ${project.name}…` });
  const instance = await createReadyInstance(() => startInstallation({
    name: project.name,
    icon: project.icon_url || 'builtin:placeholder-1',
    minecraft: selected.target.minecraftVersion,
    loader: selected.target.modloader,
    loaderVersion: selected.loaderVersion,
    memory: [defaults.default_min_memory, defaults.default_max_memory],
  }));
  if (requiresWorldTarget(selected.selected.version, kind)) {
    setNotice({ tone: 'warning', text: `${instance.name} is ready. Launch Minecraft and play a World, then add ${project.name} from that World's datapack view.` });
    return;
  }
  const outcome = await installInto(project, {
    id: String(instance.id), minecraftVersion: instance.minecraftVersion, modloader: instance.modloader || 'vanilla',
  }, kind);
  if (outcome.kind !== 'started') throw new Error(outcome.kind === 'failed' ? outcome.message : `Could not install ${project.name}: ${outcome.kind}.`);
  setNotice({ tone: 'success', text: `${project.name} installation started in ${instance.name}.` });
}

/** Subscribe before creation; initial read closes the event-before-command-return race.
 * Polling reconciles missed events and interrupted tasks. Every exit releases subscriptions.
 */
async function createReadyInstance(start: () => Promise<number>): Promise<NativeInstance> {
  const stops: (() => void)[] = [];
  const removed = new Set<number>();
  const failures = new Map<number, string>();
  let wake: (() => void) | undefined;
  let id: number | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const subscriptions = await Promise.allSettled([
      ...['core://instance-updated', 'core://instance-installed'].map((event) =>
        listen<NativeInstance>(event, ({ payload }) => { if (payload.id === id) wake?.(); })),
      ...['core://instance-delete-queued', 'core://instance-deleted'].map((event) =>
        listen<{ id: number }>(event, ({ payload }) => { removed.add(payload.id); if (payload.id === id) wake?.(); })),
      ...['core://notification', 'core://notification-progress'].map((event) =>
        listen<{ severity: string; metadata?: string; description?: string; title: string }>(event, ({ payload }) => {
          if (!payload.metadata || !['error', 'warning'].includes(payload.severity)) return;
          try {
            const context = JSON.parse(payload.metadata).context;
            // InstallTask owns this context; warnings with no progress include queued cancellation.
            if (context?.kind === 'instance' && (payload.severity === 'error' || /cancel/i.test(payload.description || ''))) {
              failures.set(Number(context.id), payload.description || payload.title);
              if (Number(context.id) === id) wake?.();
            }
          } catch { /* unrelated notification */ }
        })),
    ]);
    for (const result of subscriptions) if (result.status === 'fulfilled') stops.push(result.value);
    const failed = subscriptions.find((result) => result.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
    id = await start();
    const deadline = Date.now() + 30 * 60_000;
    while (true) {
      if (removed.has(id)) throw new Error('The new instance was removed; resource installation cancelled.');
      if (failures.has(id)) throw new Error(failures.get(id));
      const instance = await invoke<NativeInstance>('get_instance', { instanceId: id });
      if (removed.has(id)) continue;
      if (failures.has(id)) continue;
      const status = instance.installationStatus || '';
      if (status === 'installed') return instance;
      if (/^(failed|interrupted|cancelled|canceled)/i.test(status)) throw new Error(`Instance creation stopped: ${status}`);
      if (Date.now() >= deadline) throw new Error('Timed out waiting for the new instance. Resume it from the Library; the resource was not queued.');
      await new Promise<void>((resolve) => {
        wake = () => { clearTimeout(timer); wake = undefined; resolve(); };
        timer = setTimeout(wake, 2000);
      });
    }
  } finally {
    clearTimeout(timer);
    stops.forEach((stop) => stop());
  }
}
