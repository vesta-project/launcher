// Browse → server Modpack area: a provider modpack chosen while Browse targets a server. The
// Modpack area picks it up and offers "use as the modpack" (provider pointer, not hosted) and
// "install on the server" (packInstallPlan/packInstallApply), so both share one review.
import { createSignal, untrack } from 'solid-js';
import type { ContentProvider } from './native-content';

export interface ModpackPick {
  serverId: string;
  provider: ContentProvider['provider'];
  projectId: string;
  /** The exact release picked on a version page; otherwise the area chooses with the user. */
  versionId: string | null;
  name: string;
  iconUrl: string | null;
}

const [pick, setPick] = createSignal<ModpackPick | undefined>(undefined, { name: 'servers:modpack-pick' });

/** Hands a modpack to a server's Modpack area. */
export function offerModpack(value: ModpackPick) {
  setPick(value);
}

/** The pending pick for this server, reactive. */
export const modpackPick = (serverId: string) => {
  const value = pick();
  return value && value.serverId === serverId ? value : undefined;
};

export function clearModpackPick(serverId: string) {
  if (untrack(pick)?.serverId === serverId) setPick(undefined);
}
