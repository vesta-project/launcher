import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  FILE_LISTING_FRESH_MS, FILE_LISTING_REUSE_MS, cachedListing, fileListingResource, hoverIntent, invalidateListings,
  listingPlan, readListing, reconcileEntries,
} from '../src/features/servers/file-listing';
import { seedServerResource, serverResourceCache, resourceKey } from '../src/features/servers/resources';

const entry = (name, size = 1) => ({ name, kind: 'file', size, modifiedAtMs: 1, protection: null });
const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('server file listing stages and cache', () => {
  test('a new directory never shows the previous directory while it loads', () => {
    expect(listingPlan(null, false, false, 1000)).toEqual({ show: 'skeleton', fetch: true });
    // Too old to trust: skeleton, not a flash of a long-gone listing.
    expect(listingPlan({ updatedAt: 0 }, false, false, FILE_LISTING_REUSE_MS + 1)).toEqual({ show: 'skeleton', fetch: true });
  });

  test('fresh cache shows instantly with no request; recent cache revalidates quietly', () => {
    expect(listingPlan({ updatedAt: 0 }, false, false, FILE_LISTING_FRESH_MS)).toEqual({ show: 'cached', fetch: false });
    expect(listingPlan({ updatedAt: 0 }, false, false, FILE_LISTING_FRESH_MS + 1)).toEqual({ show: 'cached', fetch: true });
  });

  test('refresh and mutations keep the current rows and always ask the server', () => {
    expect(listingPlan({ updatedAt: 0 }, true, true, 1)).toEqual({ show: 'current', fetch: true });
    expect(listingPlan(null, false, true, 1)).toEqual({ show: 'skeleton', fetch: true });
  });

  test('revalidation keeps unchanged rows so they swap in place', () => {
    const a = entry('a'), b = entry('b');
    const next = reconcileEntries([a, b], [entry('a'), entry('b', 2), entry('c')]);
    expect(next[0]).toBe(a);
    expect(next[1]).not.toBe(b);
    expect(next.map((e) => e.name)).toEqual(['a', 'b', 'c']);
  });

  test('cached listings are per server and path, and file mutations invalidate them', () => {
    const page = { items: [entry('server.properties')], nextCursor: null };
    seedServerResource('listing-a', fileListingResource, page, 'config');
    expect(cachedListing('listing-a', 'config')?.page).toBe(page);
    expect(cachedListing('listing-a', '')).toBeNull();
    expect(cachedListing('listing-b', 'config')).toBeNull();
    expect(serverResourceCache.isFresh(resourceKey('listing-a', 'files-list', 'config'))).toBe(true);
    invalidateListings('listing-a');
    expect(serverResourceCache.isFresh(resourceKey('listing-a', 'files-list', 'config'))).toBe(false);
  });

  test('concurrent reads of one directory share a request', async () => {
    const first = readListing('fixture-listing', '');
    const second = readListing('fixture-listing', '');
    const [a, b] = await Promise.all([first.catch((e) => e), second.catch((e) => e)]);
    expect(a).toBe(b);
  });

  test('hover intent is debounced, deduped and cancellable', async () => {
    const runs = [];
    const intent = hoverIntent((key) => runs.push(key), 10);
    intent.enter('mods'); intent.enter('mods');
    await Bun.sleep(25);
    expect(runs).toEqual(['mods']);
    intent.enter('config'); intent.leave();
    intent.enter('world'); intent.enter('logs');
    await Bun.sleep(25);
    expect(runs).toEqual(['mods', 'logs']);
  });

  test('the Files nav tab and folder rows prefetch through the shared listing', () => {
    const nav = source('../src/pages/servers/nav-prefetch.ts');
    expect(nav).toContain("files: ['files.list']");
    expect(nav).toContain("registerServerPrefetch('files', (snapshot) => prefetchListing(snapshot.connection.id, ''))");
    const tab = source('../src/pages/servers/tabs/files-tab.tsx');
    expect(tab).toContain('folderHover.enter(pathOf(entry))');
    expect(tab).toContain('onPointerLeave={() => folderHover.leave()}');
    expect(tab).toContain('invalidateListings(connection)');
    expect(tab).not.toContain('client.filesList(id(), path, more ? cursor() : null)');
  });
});
