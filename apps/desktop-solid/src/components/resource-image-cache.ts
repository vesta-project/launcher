/** Batch cheap local cache reads separately from the bounded network queue. */
export function createImageCacheReader(read: (urls: string[]) => Promise<Record<string, string>>) {
  const pending = new Map<string, { resolve: (value: string | undefined) => void; promise: Promise<string | undefined> }>();
  let scheduled = false;
  let running = false;
  const flush = async () => {
    scheduled = false;
    running = true;
    const batch = [...pending].slice(0, 32);
    // Remove only after the reply so concurrent consumers share this read.
    try {
      const values = await read(batch.map(([url]) => url));
      for (const [url, request] of batch) request.resolve(values[url]);
    } catch { for (const [, request] of batch) request.resolve(undefined); }
    finally {
      for (const [url] of batch) pending.delete(url);
      running = false;
      if (pending.size) schedule();
    }
  };
  const schedule = () => { if (!scheduled && !running) { scheduled = true; setTimeout(() => { void flush(); }, 0); } };
  return (url: string) => {
    const previous = pending.get(url);
    if (previous) return previous.promise;
    let resolve!: (value: string | undefined) => void;
    const promise = new Promise<string | undefined>(done => { resolve = done; });
    pending.set(url, { resolve, promise }); schedule();
    return promise;
  };
}
