import { invoke } from '@tauri-apps/api/core';
import { createSignal } from 'solid-js';
import { RequestCache } from '../../platform/cache/request-cache';
import { nativeInstances } from './native-service';
export interface GameVersion {
  id: string; stable: boolean; version_type: string;
  loaders: Record<string, {version:string;stable:boolean}[]>;
}
interface Metadata { game_versions: GameVersion[]; latest:{release:string;snapshot:string} }
const cache = new RequestCache<Metadata>({ maxEntries:1, staleTimeMs:300_000, retentionMs:1_800_000 });
const [metadata, setMetadata] = createSignal<Metadata | undefined>(undefined, { name:'minecraftMetadata' });
const [metadataError, setMetadataError] = createSignal<string | undefined>(undefined, { name:'minecraftMetadataError' });
export { metadata, metadataError };
export async function loadMetadata() {
  if (!nativeInstances) return;
  try { setMetadata(await cache.read('minecraft', () => invoke<Metadata>('get_minecraft_versions'))); setMetadataError(undefined); }
  catch (reason) { setMetadataError(String(reason)); }
}
export const loaderVersions = (minecraft:string,loader:string) => metadata()?.game_versions.find((version)=>version.id===minecraft)?.loaders[loader]?.map((version)=>version.version) ?? [];
