// Removed servers, deleting for good and disk use on a Vesta Server machine. Pure rules: which
// capability gates what, how long until the machine deletes a removed server on its own, the
// retention choices, and how full each disk is. The pages live in pages/servers/host-*.tsx.
import type { MessageId } from '../../localization/messages';
import { toServerError } from './errors';
import type { HostInfo, HostStorage, RemovedServer, StorageParts, StorageVolume } from './native-hosts';

/** Capabilities a machine advertises for this area (older machines leave them out). */
export type RemovedCapability = 'removed-servers' | 'server-purge' | 'storage' | 'removed-server-retention';
export const hostHas = (info: HostInfo | undefined, capability: RemovedCapability) => !!info?.capabilities?.includes(capability);

/** The machine's default when it doesn't say (and the only value older machines have). */
export const DEFAULT_RETENTION_DAYS = 7;
export const retentionDays = (info: HostInfo | undefined) => info?.removedServerRetentionDays ?? DEFAULT_RETENTION_DAYS;

/** Choices for the retention setting; the machine accepts 1 to 365, so a custom value it reports is kept in the list. */
export function retentionChoices(current: number): number[] {
  const base = [1, 3, 7, 14, 30, 90, 365];
  return base.includes(current) || current < 1 || current > 365 ? base : [...base, current].sort((a, b) => a - b);
}

/** How long until the machine deletes a removed server on its own, in whole days, hours or minutes. */
export function purgeIn(restoreUntil: string, nowMs: number): { message: MessageId; count: number } | null {
  const left = Date.parse(restoreUntil) - nowMs;
  if (!Number.isFinite(left) || left <= 0) return null;
  const minutes = Math.ceil(left / 60_000);
  if (minutes < 60) return { message: 'servers.age.minutes', count: minutes };
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return { message: 'servers.age.hours', count: hours };
  return { message: 'servers.age.days', count: Math.floor(hours / 24) };
}

/** Removed servers the page can act on: restorable ones first by the soonest deadline, then the rest. */
export function sortRemoved(list: readonly RemovedServer[]): RemovedServer[] {
  const rank = (server: RemovedServer) => (server.state === 'restorable' ? 0 : 1);
  return [...list].sort((a, b) => rank(a) - rank(b) || Date.parse(a.restoreUntil) - Date.parse(b.restoreUntil));
}

/** Sizes in the units people read on a disk: KB, MB, GB, TB (powers of 1024, one decimal past MB). */
export function formatStorage(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${unit >= 3 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/** How full a disk is (0 to 1), and whether it is past the machine's own low-space line. */
export function volumeUse(volume: StorageVolume): { used: number; fraction: number; low: boolean } {
  const used = Math.max(0, volume.totalBytes - volume.freeBytes);
  return { used, fraction: volume.totalBytes > 0 ? Math.min(1, used / volume.totalBytes) : 0, low: volume.freeBytes <= volume.lowAt };
}

export const partLabels: Record<keyof StorageParts, MessageId> = {
  worlds: 'vesta-server.storage.part-worlds',
  backups: 'vesta-server.storage.part-backups',
  content: 'vesta-server.storage.part-content',
  logs: 'vesta-server.storage.part-logs',
  software: 'vesta-server.storage.part-software',
  trash: 'vesta-server.storage.part-trash',
  other: 'vesta-server.storage.part-other',
};

/** A server's two biggest parts, for a one-line summary under its name. */
export function biggestParts(parts: StorageParts, count = 2): Array<{ part: keyof StorageParts; bytes: number }> {
  return (Object.keys(parts) as Array<keyof StorageParts>)
    .filter((part) => part !== 'other' && parts[part] > 0)
    .map((part) => ({ part, bytes: parts[part] }))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, count);
}

/** Everything the machine's Vesta data uses, for the storage heading. */
export const storageTotal = (storage: HostStorage) =>
  storage.servers.reduce((sum, server) => sum + server.bytes, 0) + storage.removed.bytes + storage.backups.bytes
  + storage.caches.reduce((sum, cache) => sum + cache.bytes, 0) + storage.other;

export type LifecycleProblem = 'name' | 'busy' | 'purging' | 'gone' | 'forbidden' | 'port' | 'rate' | 'other';

/** Why the machine refused a restore, a delete or a measurement, in one word. */
export function lifecycleProblem(reason: unknown): LifecycleProblem {
  const error = toServerError(reason);
  const code = error.reason ?? error.code ?? '';
  if (code === 'confirm_name_mismatch') return 'name';
  if (code === 'server_busy') return 'busy';
  if (code === 'purging') return 'purging';
  if (code === 'gone' || code === 'not_found') return 'gone';
  if (code === 'forbidden') return 'forbidden';
  if (code === 'game_port_in_use' || code === 'port_unresolved' || code === 'port_state_unknown') return 'port';
  if (code === 'rate_limited') return 'rate';
  return 'other';
}

export const lifecycleProblemLines: Record<LifecycleProblem, MessageId> = {
  name: 'servers.host-remove.error-name',
  busy: 'servers.host-remove.error-busy',
  purging: 'vesta-server.removed.error-purging',
  gone: 'vesta-server.removed.error-gone',
  forbidden: 'vesta-server.removed.error-forbidden',
  port: 'vesta-server.removed.error-port',
  rate: 'vesta-server.storage.rate-limited',
  other: 'vesta-server.removed.error-other',
};
