import { createMemo, type Accessor } from 'solid-js';
import type { ServerSnapshot } from './native';

/** Gate effects on server identity; status snapshots can change many times a second. */
export function stableConnectionId(snapshot: Accessor<ServerSnapshot>): Accessor<string> {
  return createMemo(() => snapshot().connection.id, { name: 'server:connection-id' });
}
