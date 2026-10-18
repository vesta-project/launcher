import { runBackgroundActivity } from '../activity/activity-store';
import { t } from '../../localization';
import { invoke } from '@tauri-apps/api/core';
import { createSignal } from 'solid-js';
import { RequestCache } from '../../platform/cache/request-cache';
import { nativeInstances } from './native-service';
import { indexMetadata, type Metadata } from './metadata-index';
export type { GameVersion } from './metadata-index';

// Cache the indexed response too: joins and cache hits never rebuild the index.
const cache = new RequestCache<ReturnType<typeof indexMetadata>>({ maxEntries: 1, staleTimeMs: 300_000, retentionMs: 1_800_000 });
const [snapshot, setSnapshot] = createSignal<ReturnType<typeof indexMetadata> | undefined>(undefined, { name: 'minecraftMetadataSnapshot' });
const [metadataError, setMetadataError] = createSignal<string | undefined>(undefined, { name: 'minecraftMetadataError' });
export const metadata = () => snapshot()?.metadata;
export { metadataError };
export async function loadMetadata() {
  if (!nativeInstances) return;
  try {
    // Never clear the published snapshot while a stale response is refreshed.
    setSnapshot(await cache.read('minecraft', () => runBackgroundActivity(t('activity.metadata-refresh'), async () => indexMetadata(await invoke<Metadata>('get_minecraft_versions')))));
    setMetadataError(undefined);
  } catch (reason) { setMetadataError(String(reason)); }
}
const emptyVersions: string[] = [];
const emptyGames: import('./metadata-index').GameVersion[] = [];
export const minecraftVersionIds = () => snapshot()?.ids ?? emptyVersions;
export const loaderVersions = (minecraft: string, loader: string) => snapshot()?.loaderVersions(minecraft, loader) ?? emptyVersions;
export const gameVersionsForLoader = (loader: string, experimental: boolean) => snapshot()?.gameVersions(loader, experimental) ?? emptyGames;
