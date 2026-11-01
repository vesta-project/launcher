// When each agent last answered anything. Status confirmations arrive only on change while a
// live socket is open, so any successful agent response (a file list, a resource read, a
// lifecycle command…) also counts as "seen".
import { createSignal, untrack, type Accessor } from 'solid-js';
import type { ConnectionId } from './native';

const cells = new Map<ConnectionId, { read: Accessor<number | null>; write: (value: number) => void }>();

function cell(id: ConnectionId) {
  let entry = cells.get(id);
  if (!entry) {
    const [read, write] = createSignal<number | null>(null, { name: `serverContact:${id}` });
    entry = { read, write: (value) => write(value) };
    cells.set(id, entry);
  }
  return entry;
}

/** Epoch ms of the last successful response from this agent, or null. */
export const serverContactAt = (id: ConnectionId): number | null => cell(id).read();

/** Record a successful agent response. Coarse to the second so the clock, not every reply, drives updates. */
export function noteServerContact(id: ConnectionId, atMs = Date.now()) {
  const entry = cell(id);
  const current = untrack(entry.read);
  if (current === null || atMs - current >= 1000) entry.write(atMs);
}

export function forgetServerContact(id: ConnectionId) {
  cells.delete(id);
}

/** Commands answered from the launcher's own state; their success says nothing about the agent. */
const LOCAL_COMMANDS: ReadonlySet<string> = new Set([
  'list', 'discover', 'update', 'remove', 'snapshot', 'subscribe', 'unsubscribe', 'onChanged', 'uploadPick', 'uploadDropped',
]);

/**
 * Wraps a command API so that a successful call naming a known connection as its first
 * argument notes contact with that agent.
 */
export function withContact<T extends object>(api: T, known: (id: string) => boolean): T {
  return new Proxy(api, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== 'function' || typeof property !== 'string' || LOCAL_COMMANDS.has(property)) return value;
      return (...args: unknown[]) => {
        const result = value.apply(target, args);
        const id = args[0];
        if (typeof id === 'string' && known(id) && result && typeof (result as Promise<unknown>).then === 'function') {
          (result as Promise<unknown>).then(() => noteServerContact(id), () => {});
        }
        return result;
      };
    },
  });
}
