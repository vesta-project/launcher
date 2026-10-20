import { convertFileSrc, invoke, isTauri } from '@tauri-apps/api/core';
import { createSignal } from 'solid-js';
import { t } from '../../localization';
export type { CandidateState } from './service';
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
  existing: () => native ? invoke<ImportSource[]>('list_external_import_origins') : Promise.resolve(previewImports),
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
  errorMessage: (error) => t(String(error).includes('launcher-import-timeout') ? 'import.scan-timeout' : 'import.scan-error'),
});
export { detectedLaunchers };
export const { refreshLaunchers, ensureLaunchers, loadCandidates, importMany, detectedLauncherPaths, candidateState, preloadLaunchers } = service;

/** Optional statistics for the detailed Create preview; listing remains lightweight. */
export async function loadCandidateDetails(launcher: string, candidate: import('./model').ImportCandidate, path?: string): Promise<HostCandidate> {
  if (!native) return candidate.raw as HostCandidate;
  try {
    return await invoke<HostCandidate>('get_external_instance_details', {
      launcher, instancePath: candidate.key, basePathOverride: path?.trim() || null,
    });
  } catch (error) {
    throw new Error(t(String(error).includes('launcher-import-timeout') ? 'import.scan-timeout' : 'import.scan-error'));
  }
}
