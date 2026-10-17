import { createSignal } from 'solid-js';
import { RequestCache } from '../../platform/cache/request-cache';
import { fetchPeerProject, fetchProject, fetchProjects, fetchVersionDetails, fetchVersions } from './browse-api';
import {
  projectKey,
  type ResourceProject,
  type ResourceVersion,
  type ResourceVersionDetails,
  type SourceId,
} from './browse-model';

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

const detailsCache = new RequestCache<ResourceVersionDetails>({
  maxEntries: 200,
  staleTimeMs: 30 * minute,
  retentionMs: 120 * minute,
});
const peerCache = new RequestCache<ResourceProject | null>({
  maxEntries: 60,
  staleTimeMs: 60 * minute,
  retentionMs: 120 * minute,
});

const versionKey = (platform: string, projectId: string, versionId: string) =>
  `${projectKey(platform, projectId)}:${versionId}`;

/**
 * Bumped whenever a project or version list lands, so the peeks below are reactive where it
 * matters (the titlebar names a project as soon as it is known) without subscribing to keys.
 */
const [revision, setRevision] = createSignal(0, { name: 'browseProjectsRevision' });
const landed = <T,>(value: T) => {
  setRevision((count) => count + 1);
  return value;
};

export const loadProject = (platform: SourceId, id: string) =>
  projectCache.read(projectKey(platform, id), () => fetchProject(platform, id)).then(landed);
export const loadVersions = (platform: SourceId, id: string) =>
  versionsCache.read(projectKey(platform, id), () => fetchVersions(platform, id)).then(landed);
export const peekProject = (platform: string, id: string): ResourceProject | undefined => {
  revision();
  return projectCache.peek(projectKey(platform, id))?.data;
};
export const peekVersions = (platform: string, id: string): ResourceVersion[] | undefined => {
  revision();
  return versionsCache.peek(projectKey(platform, id))?.data;
};
/** Subscribes to a project entry; returns the unsubscribe. */
export const watchProject = (platform: string, id: string, listener: (project: ResourceProject | undefined) => void) =>
  projectCache.subscribe(projectKey(platform, id), (snapshot) => listener(snapshot.data));

/** Changelog and full metadata of one version; host-cached too, so a re-read is cheap. */
export const loadVersionDetails = (platform: SourceId, projectId: string, versionId: string, refresh = false) => {
  const key = versionKey(platform, projectId, versionId);
  if (refresh) detailsCache.invalidate(key);
  return detailsCache.read(key, () => fetchVersionDetails(platform, projectId, versionId, refresh));
};
export const peekVersionDetails = (platform: string, projectId: string, versionId: string) =>
  detailsCache.peek(versionKey(platform, projectId, versionId))?.data;

export const loadPeerProject = (project: ResourceProject) =>
  peerCache.read(projectKey(project.source, project.id), () => fetchPeerProject(project));

/**
 * Projects for a dependency list: cached ones are used as they are, the rest arrive in one
 * batch request and join the cache. Ids the host could not resolve are simply absent.
 */
export async function loadProjects(platform: SourceId, ids: readonly string[]): Promise<Map<string, ResourceProject>> {
  const found = new Map<string, ResourceProject>();
  const missing: string[] = [];
  for (const id of new Set(ids)) {
    const snapshot = projectCache.peek(projectKey(platform, id));
    if (snapshot?.hasData) found.set(id, snapshot.data!);
    else missing.push(id);
  }
  if (missing.length) {
    for (const project of await fetchProjects(platform, missing)) {
      // Batch responses can be summaries. Never replace a full entry or retire its in-flight load.
      const key = projectKey(platform, project.id);
      const cached = projectCache.peek(key);
      if (!cached?.hasData && !cached?.refreshing) projectCache.seed(key, project, false);
      found.set(project.id, project);
      // Slug lookups answer with the canonical id; keep the requested key too.
      const asked = missing.find((id) => id.toLowerCase() === project.id.toLowerCase());
      if (asked) found.set(asked, project);
    }
    landed(undefined);
  }
  return found;
}

/** Hits are partial (no description), so seed them as stale: details still load in full. */
export function seedProjects(hits: readonly ResourceProject[]) {
  for (const hit of hits) {
    const key = projectKey(hit.source, hit.id);
    const snapshot = projectCache.peek(key);
    if (!snapshot?.hasData && !snapshot?.refreshing) projectCache.seed(key, hit, false);
  }
  landed(undefined);
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

/* ---- Version details prefetch (hovered rows): the same small queue ---- */

const detailQueue: { platform: SourceId; projectId: string; versionId: string }[] = [];
let detailsInFlight = 0;

function pumpDetails() {
  while (detailsInFlight < maxInFlight && detailQueue.length) {
    const next = detailQueue.shift()!;
    if (detailsCache.peek(versionKey(next.platform, next.projectId, next.versionId))?.hasData) continue;
    detailsInFlight++;
    void loadVersionDetails(next.platform, next.projectId, next.versionId)
      .catch(() => undefined)
      .finally(() => {
        detailsInFlight--;
        pumpDetails();
      });
  }
}

export function prefetchVersionDetails(platform: SourceId, projectId: string, versionId: string) {
  const key = versionKey(platform, projectId, versionId);
  if (detailsCache.peek(key)?.hasData) return;
  if (detailQueue.some((item) => versionKey(item.platform, item.projectId, item.versionId) === key)) return;
  detailQueue.push({ platform, projectId, versionId });
  while (detailQueue.length > maxQueued) detailQueue.shift();
  pumpDetails();
}
