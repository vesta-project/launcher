// Staged provider metadata for installed server content: stage 1 reads names/icons the host
// already has on disk (instant, local), stage 2 asks the providers (network, batched, cached).
import { loadCachedProjects, peekCachedProject } from '../browse/cached-project-records';
import { loadProjects, peekProject } from '../browse/browse-projects';
import { providerLookups } from './content-model';
import type { ServerContentEntry } from './native-content';

export async function warmContentMetadata(items: readonly Pick<ServerContentEntry, 'provider' | 'displayProvider'>[], active: () => boolean = () => true) {
  const lookups = providerLookups(items);
  if (!lookups.size) return;
  await loadCachedProjects(lookups);
  for (const [provider, ids] of lookups) {
    if (!active()) return;
    const missing = ids.filter(id => {
      const known = peekProject(provider, id) ?? peekCachedProject(provider, id);
      return !known?.name || !known.icon_url;
    });
    // Cached list metadata is sufficient for first paint. Fill misses in small
    // batches instead of competing with visible icon requests for the whole pack.
    for (let offset = 0; offset < missing.length && active(); offset += 16)
      await loadProjects(provider, missing.slice(offset, offset + 16)).catch(() => {});
  }
}

/** The freshest name/icon known for a row: the provider's answer, else the local record. */
export function contentProject(entry: Pick<ServerContentEntry, 'provider' | 'displayProvider'>): { name: string; icon_url?: string | null } | undefined {
  const provider = entry.provider ?? entry.displayProvider;
  if (!provider) return undefined;
  return peekProject(provider.provider, provider.projectId) ?? peekCachedProject(provider.provider, provider.projectId);
}
