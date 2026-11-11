import type { ServerContentEntry } from './native-content';

/** Read-only catalogue identity; mutation code must use the verified provider instead. */
export const displayIdentity = (entry: Pick<ServerContentEntry, 'provider' | 'displayProvider'>) => entry.provider ?? entry.displayProvider ?? null;

/** Bounded, cancellable recovery; identity is always resolved from the server's file bytes. */
export async function recoverBundledIdentities(items: readonly ServerContentEntry[], attempted: Set<string>, current: () => boolean,
  identify: (entry: ServerContentEntry) => Promise<unknown>): Promise<boolean> {
  const pending = items.filter(item => {
    const size = Number(item.size);
    return item.modpackOwned && !item.provider && !item.displayProvider
      && !item.pending && /\.jar(?:\.disabled)?$/.test(item.path) && (item.kind === 'mod' || item.kind === 'plugin')
      && /^\d+$/.test(item.size) && Number.isSafeInteger(size) && size <= 16 * 1024 * 1024
      && !attempted.has(item.path);
  });
  let cursor = 0, found = false;
  const worker = async () => {
    while (current() && cursor < pending.length) {
      const item = pending[cursor++];
      attempted.add(item.path);
      try { if (await identify(item)) found = true; } catch { /* Metadata is optional. */ }
    }
  };
  await Promise.all([worker(), worker()]);
  return found;
}
