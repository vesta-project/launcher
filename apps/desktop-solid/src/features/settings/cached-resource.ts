import { createSignal } from "solid-js";
import {
  CacheInvalidatedError,
  RequestCache,
  type CacheSnapshot,
} from "../../platform/cache/request-cache";

const hasWindow = typeof window !== "undefined";

export interface CachedResource<T> {
  /** The latest data, or the fallback until the first load lands. Never undefined. */
  data: () => T;
  /** True once real data (cached or loaded) exists: render content, not skeletons. */
  ready: () => boolean;
  error: () => unknown;
  /** A refresh is in flight; show a quiet indicator, not a blocking spinner. */
  refreshing: () => boolean;
  /** Reloads when stale (or always with `force`). Safe to call often: concurrent calls share one request. */
  refresh: (force?: boolean) => Promise<void>;
  /** Replaces the cached value, e.g. after a local edit. */
  set: (value: T) => void;
}

/**
 * A stale-while-revalidate resource for the Settings pages: opening a page shows the last
 * known data immediately and refreshes in the background. Backed by RequestCache for request
 * sharing and invalidation; `persist` also mirrors the value to localStorage so even the first
 * open after launching the app has something to show. Only persist non-sensitive data.
 */
export function cachedResource<T>(options: {
  key: string;
  load: (force: boolean) => Promise<T>;
  fallback: T;
  staleTimeMs?: number;
  persist?: boolean;
}): CachedResource<T> {
  const staleTimeMs = options.staleTimeMs ?? 60_000;
  const storageKey = `vesta:cache:${options.key}`;
  const cache = new RequestCache<T>({
    maxEntries: 1,
    staleTimeMs,
    retentionMs: staleTimeMs * 10,
  });
  const [snapshot, setSnapshot] = createSignal<CacheSnapshot<T>>(
    {
      data: undefined,
      hasData: false,
      updatedAt: undefined,
      refreshing: false,
      error: undefined,
    },
    { name: `cache:${options.key}` },
  );

  if (hasWindow && options.persist) {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) cache.seed(options.key, JSON.parse(saved) as T, false);
    } catch {
      // A corrupt mirror is just a cache miss.
    }
  }

  // A module-level subscription keeps the entry alive, so it is never evicted.
  cache.subscribe(options.key, (next) => {
    setSnapshot(next);
    if (hasWindow && options.persist && next.hasData && !next.refreshing) {
      try {
        localStorage.setItem(storageKey, JSON.stringify(next.data));
      } catch {
        // Storage full or unavailable: the in-memory copy still works.
      }
    }
  });

  return {
    data: () => snapshot().data ?? options.fallback,
    ready: () => snapshot().hasData,
    error: () => snapshot().error,
    refreshing: () => snapshot().refreshing,
    refresh: async (force = false) => {
      if (force) cache.invalidate(options.key);
      try {
        await cache.read(options.key, () => options.load(force));
      } catch (reason) {
        if (!(reason instanceof CacheInvalidatedError))
          console.error(`Unable to load ${options.key}:`, reason);
      }
    },
    set: (value) => cache.seed(options.key, value),
  };
}
