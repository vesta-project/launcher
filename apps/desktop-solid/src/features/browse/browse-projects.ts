import { RequestCache } from '../../platform/cache/request-cache';
import { fetchProject, fetchVersions } from './browse-api';
import { projectKey, type ResourceProject, type ResourceVersion, type SourceId } from './browse-model';

/**
 * Module caches for project details and version lists, shared with the project page.
 * Search hits seed the project cache (stale, so a real load still replaces them) which gives
 * the details page a name and icon before anything arrives.
 */

const minute = 60_000;
const projectCache = new RequestCache<ResourceProject>({
  maxEntries: 200,
  staleTimeMs: 10 * minute,
  retentionMs: 60 * minute,
});
const versionsCache = new RequestCache<ResourceVersion[]>({
  maxEntries: 120,
  staleTimeMs: 10 * minute,
  retentionMs: 60 * minute,
});

export const loadProject = (platform: SourceId, id: string) =>
  projectCache.read(projectKey(platform, id), () => fetchProject(platform, id));
export const loadVersions = (platform: SourceId, id: string) =>
  versionsCache.read(projectKey(platform, id), () => fetchVersions(platform, id));
export const peekProject = (platform: string, id: string): ResourceProject | undefined =>
  projectCache.peek(projectKey(platform, id))?.data;
export const peekVersions = (platform: string, id: string): ResourceVersion[] | undefined =>
  versionsCache.peek(projectKey(platform, id))?.data;
/** Subscribes to a project entry; returns the unsubscribe. */
export const watchProject = (platform: string, id: string, listener: (project: ResourceProject | undefined) => void) =>
  projectCache.subscribe(projectKey(platform, id), (snapshot) => listener(snapshot.data));

/** Hits are partial (no description), so seed them as stale: details still load in full. */
export function seedProjects(hits: readonly ResourceProject[]) {
  for (const hit of hits) {
    const key = projectKey(hit.source, hit.id);
    const snapshot = projectCache.peek(key);
    if (!snapshot?.hasData && !snapshot?.refreshing) projectCache.seed(key, hit, false);
  }
}

/* ---- Hover prefetch: at most 2 in flight, at most 6 waiting (the oldest is dropped) ---- */

const maxInFlight = 2;
const maxQueued = 6;
let inFlight = 0;
const queue: { platform: SourceId; id: string }[] = [];

function pump() {
  while (inFlight < maxInFlight && queue.length) {
    const next = queue.shift()!;
    inFlight++;
    void Promise.allSettled([loadProject(next.platform, next.id), loadVersions(next.platform, next.id)]).then(() => {
      inFlight--;
      pump();
    });
  }
}

export function prefetchProject(platform: SourceId, id: string) {
  const key = projectKey(platform, id);
  if (queue.some((item) => projectKey(item.platform, item.id) === key)) return;
  queue.push({ platform, id });
  while (queue.length > maxQueued) queue.shift();
  pump();
}
