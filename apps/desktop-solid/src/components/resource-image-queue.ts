/**
 * Shown icons are kept in memory so a revisit paints them synchronously. One instance's mod list
 * or a browse page is a few hundred icons; the previous 128-entry bound evicted the page just
 * left. Thumbnails are bounded to 192px natively, so the byte cap is what really limits memory.
 */
export const IMAGE_MEMORY = { entries: 600, bytes: 48 * 1024 * 1024 } as const;

/** Visible icons share a bounded pool; offscreen work cannot start a download flood. */
export function createResourceImageQueue(load: (url: string, priority: number) => Promise<string | void>, concurrency = 4,
  memory: { entries: number; bytes: number } = IMAGE_MEMORY) {
  type Client = { priority: number; ready: (ok: boolean, source?: string) => void };
  const jobs = new Map<string, Set<Client>>();
  const cached = new Map<string, string>();
  let cachedBytes = 0;
  const active = new Set<string>();
  const failed = new Map<string, number>();
  let scheduled = false;
  const remember = (url: string, source: string) => {
    cachedBytes -= cached.get(url)?.length ?? 0;
    cached.delete(url); cached.set(url, source); cachedBytes += source.length;
    while (cached.size > memory.entries || cachedBytes > memory.bytes) {
      const oldest = cached.keys().next().value!;
      cachedBytes -= cached.get(oldest)!.length; cached.delete(oldest);
    }
  };
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    // Collect visibility changes in the same frame before selecting the next icon.
    setTimeout(() => { scheduled = false; drain(); }, 0);
  };
  const drain = () => {
    if (active.size >= concurrency) return;
    let selected: string | undefined, best = Infinity;
    for (const [url, clients] of jobs) {
      if (active.has(url)) continue;
      for (const client of clients) if (client.priority < best) { best = client.priority; selected = url; }
    }
    if (!selected || (best > 0 && active.size >= 1)) return;
    const url = selected;
    active.add(url);
    void Promise.resolve().then(() => load(url, best)).then(source => {
      const result = source || url;
      remember(url, result);
      return result;
    }, () => {
      failed.set(url, Date.now() + 30_000);
      if (failed.size > 128) failed.delete(failed.keys().next().value!);
      return undefined;
    }).then(source => {
      const clients = jobs.get(url);
      jobs.delete(url); active.delete(url);
      try { for (const client of clients ?? []) client.ready(!!source, source); }
      finally { schedule(); }
    });
    drain();
  };
  return {
    peek(url: string) { const source = cached.get(url); if (source) remember(url, source); return source; },
    remember,
    request(url: string, priority: number, ready: Client['ready']) {
      const client = { priority, ready };
      if (cached.has(url)) { ready(true, cached.get(url)); return { dispose() {} }; }
      if ((failed.get(url) ?? 0) > Date.now()) { ready(false); return { dispose() {} }; }
      failed.delete(url);
      let clients = jobs.get(url);
      if (!clients) { clients = new Set(); jobs.set(url, clients); }
      clients.add(client); schedule();
      return { dispose() {
        clients!.delete(client);
        if (!clients!.size && !active.has(url)) jobs.delete(url);
      } };
    },
  };
}
