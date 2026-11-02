// Staged provider metadata for installed server content: stage 1 reads names/icons the host
// already has on disk (instant, local), stage 2 asks the providers (network, batched, cached).
import { loadCachedProjects, peekCachedProject } from '../browse/cached-project-records';
import { loadProjects, peekProject } from '../browse/browse-projects';
import { providerLookups } from './content-model';
import type { ServerContentEntry } from './native-content';

export function warmContentMetadata(items: readonly Pick<ServerContentEntry, 'provider'>[]) {
  const lookups = providerLookups(items);
  if (!lookups.size) return;
  void loadCachedProjects(lookups);
  for (const [provider, ids] of lookups) void loadProjects(provider, ids).catch(() => {});
}

/** The freshest name/icon known for a row: the provider's answer, else the local record. */
export function contentProject(entry: Pick<ServerContentEntry, 'provider'>): { name: string; icon_url?: string | null } | undefined {
  const provider = entry.provider;
  if (!provider) return undefined;
  return peekProject(provider.provider, provider.projectId) ?? peekCachedProject(provider.provider, provider.projectId);
}
