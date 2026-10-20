import { convertFileSrc, invoke, isTauri } from '@tauri-apps/api/core';
import { createSignal } from 'solid-js';
import { createLauncherImport, type ImportSource } from './service';
import { fixtureCandidates, fixtureLaunchers } from './fixtures';
import type { HostCandidate, LauncherSummary } from './model';

export type { ImportCandidate, ImportResult, LauncherSummary, HostCandidate } from './model';
const native = typeof window !== 'undefined' && isTauri();
const [detectedLaunchers, publish] = createSignal<LauncherSummary[] | undefined>(undefined, { name: 'detectedImportLaunchers' });
const previewImports: ImportSource[] = [{ importLauncherKind: 'prism', importInstancePath: '/preview/PrismLauncher/0' }];
const service = createLauncherImport({
  detect: () => native ? invoke('detect_external_launchers') : Promise.resolve(fixtureLaunchers),
  list: (launcher, path) => native ? invoke<HostCandidate[]>('list_external_instances', {
    launcher, basePathOverride: path ?? null,
  }) : Promise.resolve(fixtureCandidates(launcher)),
  existing: () => native ? invoke<ImportSource[]>('list_instances') : Promise.resolve(previewImports),
  enqueue: async (launcher, candidate, path) => {
    if (!native) {
      previewImports.push({ importLauncherKind: launcher, importInstancePath: candidate.key });
      return;
    }
    await invoke('import_external_instance', { request: { launcher, instancePath: candidate.key,
      selectedInstance: candidate.raw, basePathOverride: path ?? null, instanceNameOverride: null } });
  },
  icon: (path) => native && /^(\/|[A-Za-z]:[\\/])/.test(path) ? convertFileSrc(path) : path,
  publish,
});
export { detectedLaunchers };
export const { refreshLaunchers, loadCandidates, importMany, detectedLauncherPaths } = service;
