import { invoke, isTauri } from '@tauri-apps/api/core';
import { createSignal, untrack } from 'solid-js';
import { loadProject, loadVersions, seedProjects } from '../browse/browse-projects';
import { searchResources } from '../browse/browse-api';
import { hasDownloadableArtifact, type ResourceProject } from '../browse/browse-model';
import { startInstallation, readPack, InstallationStartError, type InstallDraft, type PackSource, type PackInfo } from '../installation/install-service';
import { findLauncher } from '../installation/launchers';
import { defaultInstanceIcons } from '../instances/icon-catalog';
import { loadMetadata, metadata } from '../instances/metadata';
import { refreshNativeInstances } from '../instances/native-service';
import type { NativeInstance } from '../instances/native-model';
import { t } from '../../localization';
import { detectedLaunchers, preloadLaunchers, importMany as queueImports, type ImportCandidate, type ImportResult } from '../launcher-import';
import { fixturePacks } from './onboarding-fixtures';
import type { FeaturedPack } from './types';

/** Resolve these through Browse's normal cache; failed entries are filled by download rank. */
export const FEATURED_PACK_IDS = ['sop', 'fabulously-optimized', 'adrenaline', 'additive', 'cobblemon-fabric', 'prominence-2-rpg'] as const;
const native = typeof window !== 'undefined' && isTauri();
const [packs, setPacks] = createSignal<FeaturedPack[] | undefined>(undefined, { name: 'onboardingPacks' });
const [packsError, setPacksError] = createSignal<string | undefined>(undefined, { name: 'onboardingPacksError' });
const launchers = detectedLaunchers;
const [chosen, setChosen] = createSignal<{ kind: 'pack' | 'blank' | 'import'; name: string; iconUrl?: string; count?: number } | undefined>(undefined, { name: 'onboardingChosenInstance' });
const [latest, setLatest] = createSignal<string | undefined>(undefined, { name: 'onboardingLatestRelease' });
const toPack = (project: ResourceProject): FeaturedPack => ({
  projectId: project.id, source: 'modrinth', name: project.name, author: project.author,
  summary: project.summary, iconUrl: project.icon_url ?? undefined, downloads: project.download_count,
});
let prefetched: Promise<void> | undefined;
export function prefetchFirstInstance() {
  void preloadLaunchers().catch(() => {});
  if (prefetched) return prefetched;
  prefetched = (async () => {
    if (!native) { setPacks(fixturePacks); setLatest('1.21.1'); return; }
    await Promise.allSettled([
      (async () => {
        try {
          const results = await Promise.allSettled(FEATURED_PACK_IDS.map((id) => loadProject('modrinth', id)));
          const projects = results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
          if (projects.length < 6) {
            try {
              const fallback = await searchResources('modrinth', { text: null, resource_type: 'modpack', offset: 0, limit: 12,
                game_version: null, loader: null, client: false, server: false, creator: null, categories: null, sort_by: 'downloads', sort_order: 'desc' });
              seedProjects(fallback.hits);
              for (const project of fallback.hits) if (!projects.some((item) => item.id === project.id)) projects.push(project);
            } catch (error) { if (!projects.length) throw error; }
          }
          if (!projects.length) throw new Error('No packs');
          setPacks(projects.slice(0, 6).map(toPack));
          setPacksError(undefined);
        } catch { setPacks([]); setPacksError(t('onboarding.packs-error')); }
      })(),
      loadMetadata().then(() => setLatest(untrack(metadata)?.latest.release)),
    ]);
  })();
  return prefetched;
}

export function createFirstInstance(actions: {
  authorize(): Promise<void>; advance(): Promise<void>; finish(path?: string): Promise<void>;
}) {
  let pending: Promise<void> | undefined;
  let selectedKey: string | undefined;
  let pendingImports: Promise<ImportResult> | undefined;
  let recovery: { key: string; id: number } | undefined;
  const once = (work: () => Promise<void>) => {
    if (pending) return pending;
    pending = work().finally(() => { pending = undefined; });
    return pending;
  };
  const queueInstall = async (key: string, draft: InstallDraft, source?: PackSource, pack?: PackInfo) => {
    if (!native) return;
    if (recovery) {
      if (recovery.key !== key) throw new Error(t('onboarding.install-recovery'));
      const instanceData = await invoke<NativeInstance>('get_instance', { instanceId: recovery.id });
      await invoke('install_instance', { instanceData });
      recovery = undefined;
      await refreshNativeInstances(true);
      return;
    }
    try { await startInstallation(draft, source, pack); }
    catch (error) {
      if (error instanceof InstallationStartError) recovery = { key, id: error.instanceId };
      throw error;
    }
  };
  return {
    packs, packsError, launchers, chosen,
    blankSummary: () => ({ name: 'My First Instance', minecraft: latest() }),
    installPack: (pack: FeaturedPack) => once(async () => {
      await actions.authorize();
      if (selectedKey) { await actions.advance(); return; }
      try {
        if (native) {
          const project = await loadProject('modrinth', pack.projectId);
          const versions = (await loadVersions('modrinth', pack.projectId)).filter(hasDownloadableArtifact);
          const release = [...versions].sort((a, b) =>
            Number(a.release_type !== 'release') - Number(b.release_type !== 'release') ||
            String(b.published_at ?? '').localeCompare(String(a.published_at ?? '')))[0];
          const url = release?.download_url || release?.files?.[0]?.url;
          if (!release || !url) throw new Error(t('install.release-unavailable'));
          const source: PackSource = { kind: 'url', value: url, online: { project, release: { ...release, download_url: url } } };
          const info = await readPack(source);
          await queueInstall(pack.projectId, { name: project.name, icon: project.icon_url || defaultInstanceIcons[0].value,
            minecraft: info.minecraftVersion, loader: info.modloader, loaderVersion: '', memory: [2048, 4096] }, source, info);
        }
        selectedKey = pack.projectId;
        setChosen({ kind: 'pack', name: pack.name, iconUrl: pack.iconUrl });
      } catch { throw new Error(t(recovery ? 'onboarding.install-recovery' : 'onboarding.install-error')); }
      await actions.advance();
    }),
    createBlank: () => once(async () => {
      await actions.authorize();
      if (selectedKey) { await actions.advance(); return; }
      await prefetchFirstInstance();
      if (!untrack(latest) && native) { await loadMetadata(); setLatest(untrack(metadata)?.latest.release); }
      const minecraft = untrack(latest);
      if (!minecraft) throw new Error(t('onboarding.minecraft-error'));
      try {
        await queueInstall('blank', { name: 'My First Instance', icon: defaultInstanceIcons[0].value,
          minecraft, loader: 'vanilla', loaderVersion: '', memory: [2048, 4096] });
        selectedKey = 'blank';
        setChosen({ kind: 'blank', name: 'My First Instance' });
      } catch { throw new Error(t(recovery ? 'onboarding.install-recovery' : 'onboarding.install-error')); }
      await actions.advance();
    }),
    importMany: (id: string, candidates: ImportCandidate[], basePathOverride?: string): Promise<ImportResult> => {
      if (pendingImports) return pendingImports;
      pendingImports = (async () => {
        const launcher = findLauncher(id);
        if (!launcher) throw new Error(t('onboarding.launcher-error'));
        await actions.authorize();
        const result = await queueImports(id, candidates, basePathOverride);
        if (result.queued) {
          selectedKey = `import:${id}`;
          setChosen({ kind: 'import', count: result.queued,
            name: t('onboarding.import-summary', { count: result.queued, launcher: launcher.label }) });
        }
        return result;
      })().finally(() => { pendingImports = undefined; });
      return pendingImports;
    },
    importFrom: (id: string) => once(async () => {
      const launcher = findLauncher(id);
      if (!launcher) throw new Error(t('onboarding.launcher-error'));
      await actions.authorize();
      await actions.finish(`/create/import/${launcher.value}`);
      setChosen({ kind: 'import', name: launcher.label });
    }),
    skip: () => actions.advance(),
    reset: () => { if (!pending && !pendingImports) { selectedKey = undefined; recovery = undefined; setChosen(undefined); } },
  };
}
