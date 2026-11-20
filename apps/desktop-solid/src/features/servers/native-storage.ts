// One server's disk use, from the server itself (`storage.view`, owners and admins by default).
// The machine answers from its last background measurement, so this is quick.
import { invoke } from '@tauri-apps/api/core';
import type { StorageParts } from './native-hosts';
import type { ConnectionId } from './native';

/** Before the first measurement `measuredAt` and `volume` are null, sizes are 0 and `largest` is empty. */
export interface ServerStorageView {
  measuredAt: string | null;
  bytes: number;
  parts: StorageParts;
  volume: { label: string; freeBytes: number; totalBytes: number } | null;
  /** The ten biggest folders, relative to the Files tab's root. */
  largest: Array<{ path: string; bytes: number }>;
}

export const serversStorageNative = {
  storage: (connectionId: ConnectionId) => invoke<ServerStorageView>('server_storage', { connectionId }),
};
