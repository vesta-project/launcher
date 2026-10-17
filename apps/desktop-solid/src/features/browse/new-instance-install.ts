import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { untrack } from 'solid-js';
import { openResourceInstall } from '../../pages/create/install-navigation';
import { t } from '../../localization';
import { loadMetadata, metadata, metadataError } from '../instances/metadata';
import type { NativeInstance } from '../instances/native-model';
import { nativeInstances } from '../instances/native-service';
import { hasDownloadableArtifact, loaderIds, selectInstallVersion, requiresWorldTarget,
  type ResourceProject, type ResourceType } from './browse-model';
import { loadVersions } from './browse-projects';
import { installInto, setNotice } from './browse-store';

const active = new Map<string, Promise<void>>();
type Choice = { minecraftVersion?: string; loader?: string };
export interface PendingResourceInstall {
  project: ResourceProject;
  kind: ResourceType;
  minecraft: string;
  loader: string;
  loaderVersion: string;
}

/** One-shot navigation intent. No instance exists until the user submits Create. */
export async function installIntoNewInstance(project: ResourceProject, kind: ResourceType, choice?: Choice): Promise<void> {
  const key = JSON.stringify([project.source, project.id, kind, choice]);
  const existing = active.get(key);
  if (existing) return existing;
  const pending = prepare(project, kind, choice).catch((reason: unknown) => {
    setNotice({ tone: 'danger', text: t('browse.install-failed', { message: String(reason instanceof Error ? reason.message : reason) }) });
  }).finally(() => active.delete(key));
  active.set(key, pending);
  return pending;
}

async function prepare(project: ResourceProject, kind: ResourceType, choice: Choice = {}) {
  if (!nativeInstances) throw new Error(t('browse.new-instance-desktop'));
  if (kind === 'modpack') throw new Error(t('browse.new-instance-pack'));
  const [versions] = await Promise.all([loadVersions(project.source, project.id), loadMetadata()]);
  const catalog = untrack(metadata);
  if (!catalog) throw new Error(untrack(metadataError) || t('browse.new-instance-metadata'));
  const requestedLoader = choice.loader?.trim().toLowerCase();
  if (requestedLoader && requestedLoader !== 'vanilla' && !loaderIds.some((id) => id === requestedLoader))
    throw new Error(t('browse.new-instance-loader', { loader: requestedLoader }));
  const games = catalog.game_versions.filter((game) => choice.minecraftVersion ? game.id === choice.minecraftVersion : game.stable);
  const rank = { release: 0, beta: 1, alpha: 2 };
  const releases = [...versions].sort((a, b) => rank[a.release_type] - rank[b.release_type]
    || String(b.published_at ?? '').localeCompare(String(a.published_at ?? '')));
  for (const release of releases) {
    for (const game of games) {
      const supportedLoaders = release.loaders.map((id) => id.toLowerCase()).filter((id) => loaderIds.some((known) => known === id));
      const loaders = requestedLoader ? [requestedLoader] : supportedLoaders.length ? supportedLoaders : kind === 'shader' ? [...loaderIds] : kind === 'mod' ? [] : ['vanilla'];
      for (const loader of loaders) {
        const loaderVersion = game.loaders[loader]?.find((version) => version.stable)?.version || game.loaders[loader]?.[0]?.version || '';
        if ((kind === 'shader' && loader === 'vanilla') || (loader !== 'vanilla' && !loaderVersion)) continue;
        const selected = selectInstallVersion([release], { minecraftVersion: game.id, modloader: loader }, kind, project.source);
        if (!selected || !hasDownloadableArtifact(selected.version)) continue;
        openResourceInstall({ project, kind, minecraft: game.id, loader, loaderVersion });
        return;
      }
    }
  }
  throw new Error(t('browse.new-instance-no-version', { name: project.name }));
}

/** Subscribe before queueing. Return the id promptly; resource continuation survives page disposal. */
export function startPendingResourceInstallation(pending: PendingResourceInstall, start: () => Promise<number>): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    void createReadyInstance(async () => {
      const id = await start();
      resolve(id);
      return id;
    }).then(async (instance) => {
      const target = { id: String(instance.id), minecraftVersion: instance.minecraftVersion, modloader: instance.modloader || 'vanilla' };
      const versions = await loadVersions(pending.project.source, pending.project.id);
      const selected = selectInstallVersion(versions, target, pending.kind, pending.project.source);
      if (pending.kind === 'datapack' || (selected && requiresWorldTarget(selected.version, pending.kind))) {
        setNotice({ tone: 'warning', text: t('browse.new-instance-world', { name: pending.project.name, title: instance.name }) });
        return;
      }
      const outcome = await installInto(pending.project, target, pending.kind);
      if (outcome.kind === 'started') setNotice({ tone: 'success', text: t('browse.install-started', { name: pending.project.name, title: instance.name }) });
      else if (outcome.kind === 'no-version') setNotice({ tone: 'warning', text: t('browse.no-version', { name: pending.project.name, title: instance.name }) });
      else throw new Error(outcome.kind === 'failed' ? outcome.message : t('browse.external-download', { name: pending.project.name }));
    }).catch((reason: unknown) => {
      reject(reason);
      setNotice({ tone: 'danger', text: t('browse.install-failed', { message: String(reason instanceof Error ? reason.message : reason) }) });
    });
  });
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
      if (removed.has(id)) throw new Error(t('browse.new-instance-removed'));
      if (failures.has(id)) throw new Error(failures.get(id));
      const instance = await invoke<NativeInstance>('get_instance', { instanceId: id });
      if (removed.has(id)) continue;
      if (failures.has(id)) continue;
      const status = instance.installationStatus || '';
      if (status === 'installed') return instance;
      if (/^(failed|interrupted|cancelled|canceled)/i.test(status)) throw new Error(t('browse.new-instance-stopped', { message: status }));
      if (Date.now() >= deadline) throw new Error(t('browse.new-instance-timeout'));
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
