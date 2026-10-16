export interface CacheSnapshot<T> {
  data: T | undefined;
  hasData: boolean;
  updatedAt: number | undefined;
  refreshing: boolean;
  error: unknown;
}

interface Entry<T> extends CacheSnapshot<T> {
  freshUntil: number;
  touchedAt: number;
  generation: number;
  pending?: Promise<T>;
  pendingGeneration?: number;
  listeners: Set<(snapshot: CacheSnapshot<T>) => void>;
}

export class CacheInvalidatedError extends Error {
  constructor() { super('Request invalidated while loading'); }
}

/** Per-domain, per-WebView request reuse. Durable storage belongs to Rust.
 * Invalidation retires in-flight responses, even when IPC cannot be cancelled.
 * Only inactive entries may be evicted; exceeding the active budget fails explicitly.
 */
export class RequestCache<T> {
  private entries = new Map<string, Entry<T>>();
  readonly metrics = { hits: 0, misses: 0, deduplicated: 0, loads: 0, errors: 0, evictions: 0, discarded: 0 };

  constructor(private readonly policy: {
    maxEntries: number;
    staleTimeMs: number;
    retentionMs: number;
    now?: () => number;
  }) {
    if (!Number.isInteger(policy.maxEntries) || policy.maxEntries < 1
      || !Number.isFinite(policy.staleTimeMs) || policy.staleTimeMs < 0
      || !Number.isFinite(policy.retentionMs) || policy.retentionMs < policy.staleTimeMs) {
      throw new Error('Invalid cache policy');
    }
  }

  private now() { return (this.policy.now ?? (() => performance.now()))(); }

  private entry(key: string): Entry<T> {
    const now = this.now();
    // Opportunistic GC: no polling or per-entry timers in idle windows.
    for (const [id, entry] of this.entries) {
      if (!entry.pending && !entry.listeners.size && now - entry.touchedAt >= this.policy.retentionMs) {
        this.entries.delete(id);
        this.metrics.evictions++;
      }
    }
    let entry = this.entries.get(key);
    if (!entry) {
      if (this.entries.size >= this.policy.maxEntries) {
        const candidate = [...this.entries].filter(([, value]) => !value.pending && !value.listeners.size)
          .sort((a, b) => a[1].touchedAt - b[1].touchedAt)[0];
        if (!candidate) throw new Error('Request cache active-entry budget exceeded');
        this.entries.delete(candidate[0]);
        this.metrics.evictions++;
      }
      entry = { data: undefined, hasData: false, updatedAt: undefined, refreshing: false, error: undefined,
        freshUntil: -Infinity, touchedAt: now, generation: 0, listeners: new Set() };
      this.entries.set(key, entry);
    }
    entry.touchedAt = now;
    return entry;
  }

  peek(key: string): CacheSnapshot<T> | undefined {
    const entry = this.entries.get(key);
    return entry && this.snapshot(entry);
  }

  private snapshot(entry: Entry<T>): CacheSnapshot<T> {
    return { data: entry.data, hasData: entry.hasData, updatedAt: entry.updatedAt,
      refreshing: entry.refreshing, error: entry.error };
  }

  private publish(entry: Entry<T>) {
    const snapshot = this.snapshot(entry);
    const generation = entry.generation;
    const recipients = [...entry.listeners];
    for (const listener of recipients) {
      // A listener can synchronously invalidate/seed or unsubscribe another listener.
      // Its nested publication supersedes this one; never publish the older state after it.
      if (generation !== entry.generation) break;
      if (!entry.listeners.has(listener)) continue;
      try { listener(snapshot); }
      catch (error) { console.error('Request cache observer failed:', error); }
    }
  }

  subscribe(key: string, listener: (snapshot: CacheSnapshot<T>) => void): () => void {
    const entry = this.entry(key);
    entry.listeners.add(listener);
    try { listener(this.snapshot(entry)); }
    catch (error) { entry.listeners.delete(listener); throw error; }
    return () => { entry.listeners.delete(listener); entry.touchedAt = this.now(); };
  }

  seed(key: string, data: T, fresh = true) {
    const entry = this.entry(key);
    entry.generation++;
    Object.assign(entry, { data, hasData: true, updatedAt: this.now(), refreshing: !!entry.pending, error: undefined,
      freshUntil: fresh ? this.now() + this.policy.staleTimeMs : -Infinity });
    this.publish(entry);
  }

  /** Retains visible data unless removal/security boundaries require forgetting it. */
  invalidate(key: string, forget = false) {
    const entry = this.entries.get(key);
    if (!entry) return;
    entry.generation++;
    entry.freshUntil = -Infinity;
    entry.error = undefined;
    if (forget) { entry.data = undefined; entry.hasData = false; entry.updatedAt = undefined; }
    this.publish(entry);
  }

  invalidateAll(forget = false) {
    for (const key of this.entries.keys()) this.invalidate(key, forget);
  }

  read(key: string, loader: () => Promise<T>): Promise<T> {
    const entry = this.entry(key);
    if (entry.hasData && this.now() < entry.freshUntil) {
      this.metrics.hits++;
      return Promise.resolve(entry.data as T);
    }
    if (entry.pending) {
      this.metrics.deduplicated++;
      if (entry.pendingGeneration === entry.generation) return entry.pending;
      // IPC cannot be cancelled: wait for retired work, then share one fresh request.
      const queuedGeneration = entry.generation;
      return entry.pending.catch(() => undefined).then(() => {
        if (queuedGeneration !== entry.generation) throw new CacheInvalidatedError();
        return this.read(key, loader);
      });
    }
    this.metrics.misses++;
    const generation = entry.generation;
    entry.refreshing = true;
    entry.error = undefined;
    // Register before invoking loader, including synchronous throws/reentrant callers.
    const pending = Promise.resolve().then(() => {
      if (generation !== entry.generation) {
        this.metrics.discarded++;
        throw new CacheInvalidatedError();
      }
      this.metrics.loads++;
      return loader();
    }).then((data) => {
      if (generation !== entry.generation) {
        this.metrics.discarded++;
        throw new CacheInvalidatedError();
      }
      Object.assign(entry, { data, hasData: true, updatedAt: this.now(),
        freshUntil: this.now() + this.policy.staleTimeMs });
      return data;
    }).catch((error: unknown) => {
      if (generation !== entry.generation) {
        if (!(error instanceof CacheInvalidatedError)) this.metrics.discarded++;
        throw new CacheInvalidatedError();
      }
      entry.error = error;
      this.metrics.errors++;
      throw error;
    }).finally(() => {
      entry.pending = undefined;
      entry.refreshing = false;
      entry.touchedAt = this.now();
      this.publish(entry);
    });
    entry.pending = pending;
    entry.pendingGeneration = generation;
    this.publish(entry);
    return pending;
  }
}
