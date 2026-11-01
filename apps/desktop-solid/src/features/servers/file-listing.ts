// Directory listings for the server Files tab, through the shared server resource cache:
// one request per server+path, shared by the view, nav hover and folder-row hover.
import { peekServerResource, prefetchServerResource, readServerResource, invalidateServerResources, resourceKey, serverResource, serverResourceCache } from './resources';
import { serverCommand } from './store';
import type { ConnectionId, FileEntry, Page } from './native';

/** A listing this young is shown as-is with no request. */
export const FILE_LISTING_FRESH_MS = 15_000;
/** Older listings up to this age are shown while a quiet revalidation swaps them in place;
 *  anything older is never shown, so a revisit can't flash a long-gone directory. */
export const FILE_LISTING_REUSE_MS = 120_000;
export const FILE_LISTING_RESOURCE = 'files-list';

/** First page of a directory. Later pages stay view-owned ("Load more"). */
export const fileListingResource = serverResource(FILE_LISTING_RESOURCE,
  (id, path: string) => serverCommand((client) => client.filesList(id, path, null)), FILE_LISTING_FRESH_MS);

export type ListingPlan = { show: 'cached'; fetch: boolean } | { show: 'current' | 'skeleton'; fetch: true };

/**
 * What to draw while `path` loads. `sameDirectory` (a refresh) keeps the rows on screen and
 * swaps quietly; a usable cached listing shows at once; otherwise the previous directory is
 * cleared to a skeleton rather than left visible under the new path.
 */
export function listingPlan(cached: { updatedAt: number | undefined } | null, sameDirectory: boolean, force: boolean, now: number): ListingPlan {
  if (sameDirectory && force) return { show: 'current', fetch: true };
  const age = cached?.updatedAt === undefined ? Infinity : now - cached.updatedAt;
  if (!force && age <= FILE_LISTING_REUSE_MS) return { show: 'cached', fetch: age > FILE_LISTING_FRESH_MS };
  return sameDirectory ? { show: 'current', fetch: true } : { show: 'skeleton', fetch: true };
}

const sameEntry = (a: FileEntry, b: FileEntry) => JSON.stringify(a) === JSON.stringify(b);
/** Keeps unchanged entry objects so a revalidated listing reuses their rows (no remount or shift). */
export function reconcileEntries(previous: readonly FileEntry[], next: readonly FileEntry[]): FileEntry[] {
  const byName = new Map(previous.map((entry) => [entry.name, entry]));
  return next.map((entry) => { const old = byName.get(entry.name); return old && sameEntry(old, entry) ? old : entry; });
}

export function cachedListing(id: ConnectionId, path: string): { page: Page<FileEntry>; updatedAt: number | undefined } | null {
  const page = peekServerResource(id, fileListingResource, path);
  if (!page) return null;
  return { page, updatedAt: serverResourceCache.peek(resourceKey(id, FILE_LISTING_RESOURCE, path))?.updatedAt };
}

/** Shared read; `force` (explicit refresh or after a mutation) always asks the server. */
export function readListing(id: ConnectionId, path: string, force = false) {
  if (force) serverResourceCache.invalidate(resourceKey(id, FILE_LISTING_RESOURCE, path));
  return readServerResource(id, fileListingResource, path);
}

/** Warms a directory; fresh or in-flight listings are not requested again. */
export const prefetchListing = (id: ConnectionId, path: string) => prefetchServerResource(id, fileListingResource, path);

/** Any file mutation can change several directories (moves, trash, uploads into folders). */
export const invalidateListings = (id: ConnectionId) => invalidateServerResources(id, [FILE_LISTING_RESOURCE]);

/**
 * Debounced, cancellable hover intent: `enter` schedules `run(key)` after `delayMs`, a repeat
 * `enter` for the same pending key is ignored, and `leave`/`cancel` drop the pending one.
 */
export function hoverIntent(run: (key: string) => void, delayMs = 150) {
  let pending: string | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => { clearTimeout(timer); timer = undefined; pending = null; };
  return {
    enter(key: string) {
      if (pending === key) return;
      cancel();
      pending = key;
      timer = setTimeout(() => { pending = null; timer = undefined; run(key); }, delayMs);
    },
    leave: cancel,
    cancel,
  };
}
