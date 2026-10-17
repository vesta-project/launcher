import { invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';

/** Manual selection does not emit in the shared host, unlike managed downloads.
 * Publish the same invalidation after persistence so every rewrite window refreshes. */
export async function setGlobalJavaPath(version: number, path: string, managed: boolean) {
  await invoke('set_global_java_path', { version, pathStr: path, managed });
  await emit('java-paths-updated').catch((reason) => {
    console.error('Java selection saved, but inventory invalidation could not be broadcast:', reason);
  });
}
