// Pure helpers for Modrinth server listings: ping freshness, what a listing plays, which
// instances can join it, and the host's instance-link status. No IO or reactivity here.
import {
  gameVersionMatches,
  minecraftVersionsOf,
  summarizeGameVersions,
  type ServerListing,
  type ServerPing,
} from './browse-model';
import type { MessageId } from '../../localization/messages';

/** A ping this recent reads as live; older ones are shown, but greyed as last known. */
export const LIVE_PING_MS = 30 * 60_000;

export type PingFreshness = 'live' | 'stale' | 'none';

export function pingFreshness(ping: Pick<ServerPing, 'at'> | null | undefined, now: number): PingFreshness {
  if (!ping) return 'none';
  const at = Date.parse(ping.at);
  if (!Number.isFinite(at)) return 'stale';
  return now - at <= LIVE_PING_MS ? 'live' : 'stale';
}

/** The shared status dot for a freshness (the same dots the Servers pages use). */
export const freshnessDot = { live: 'online', stale: 'stopped', none: 'offline' } as const satisfies Record<
  PingFreshness,
  string
>;

/** Newest first, without loader or side tags. */
export const serverGameVersions = (listing: ServerListing): string[] =>
  listing.content.kind === 'vanilla' ? minecraftVersionsOf(listing.content.gameVersions) : [];

/** The short version text for a vanilla listing: the recommended version, else the supported range. */
export function vanillaVersionText(listing: ServerListing): string {
  if (listing.content.kind !== 'vanilla') return '';
  return listing.content.recommendedVersion || summarizeGameVersions(serverGameVersions(listing));
}

/** The modpack a listing plays, if any. */
export const serverPack = (listing: ServerListing | null | undefined) =>
  listing?.content.kind === 'modpack' ? listing.content : undefined;

/** The version a new vanilla instance for this listing should use. */
export const recommendedGameVersion = (listing: ServerListing): string | undefined =>
  listing.content.kind === 'vanilla'
    ? listing.content.recommendedVersion || serverGameVersions(listing)[0]
    : undefined;

const knownRegions = new Set([
  'europe',
  'us_east',
  'us_west',
  'us_central',
  'north_america',
  'south_america',
  'asia',
  'australia',
  'oceania',
  'africa',
  'middle_east',
]);

/** The message for a Modrinth region id, or undefined for one this build does not name. */
export const regionMessage = (region: string | null | undefined): MessageId | undefined => {
  const id = region?.trim().toLowerCase();
  return id && knownRegions.has(id) ? (`browse.region-${id.replace(/_/g, '-')}` as MessageId) : undefined;
};

/** An unknown region id as words ("north_africa" -> "North africa"). */
export const regionFallback = (region: string) => {
  const words = region.trim().replace(/[_-]+/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/* ---- Instances that can join ---- */

/** The provider pack an instance is linked to, if any. */
export interface InstancePackRef {
  platform: string;
  projectId: string;
}

export interface JoinCandidate {
  minecraftVersion: string;
  modloader: string;
  pack?: InstancePackRef;
}

export type JoinFit = 'fits' | 'pack' | 'game';

/**
 * Whether an instance can join a listing, mirroring the host's `link_instance_to_server` check:
 * a modpack listing takes instances of the same Modrinth modpack project (any version; joining
 * reviews the update on Versions); a vanilla listing takes any instance on a supported version.
 */
export function joinFit(listing: ServerListing, instance: JoinCandidate): JoinFit {
  const pack = serverPack(listing);
  if (pack)
    return instance.pack?.platform.toLowerCase() === 'modrinth' && instance.pack.projectId === pack.projectId
      ? 'fits'
      : 'pack';
  return gameVersionMatches(serverGameVersions(listing), instance.minecraftVersion) ? 'fits' : 'game';
}

/* ---- Instance link status ---- */

/** The server an instance follows (`link.server` on the host's provider modpack link). */
export interface ServerLink {
  platform: 'modrinth';
  projectId: string;
  address: string;
}

/** `instance_server_status`: the cached listing ping and whether the pack must follow it. */
export interface InstanceServerStatus {
  link: ServerLink | null;
  ping: ServerPing | null;
  /** The listing's current `content.version_id` (modpack listings). */
  versionId: string | null;
  updateAvailable: boolean;
  updateRequired: boolean;
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value : null);
const pick = (source: Record<string, unknown>, ...keys: string[]) => keys.map((key) => source[key]).find((value) => value !== undefined);

/** A server link from the host, in either serde casing; anything malformed is no link. */
export function parseServerLink(raw: unknown): ServerLink | null {
  const value = record(raw);
  if (!value) return null;
  const projectId = text(pick(value, 'projectId', 'project_id'));
  const platform = text(value.platform)?.toLowerCase() ?? 'modrinth';
  if (!projectId || platform !== 'modrinth') return null;
  return { platform: 'modrinth', projectId, address: text(value.address) ?? '' };
}

function parsePing(raw: unknown): ServerPing | null {
  const value = record(raw);
  if (!value) return null;
  const at = text(pick(value, 'at', 'when'));
  const online = Number(pick(value, 'online', 'players_online', 'playersOnline'));
  const max = Number(pick(value, 'max', 'players_max', 'playersMax'));
  if (!at || !Number.isFinite(online) || !Number.isFinite(max)) return null;
  const latency = Number(pick(value, 'latencyMs', 'latency_ms'));
  return { at, online, max, versionName: text(pick(value, 'versionName', 'version_name')), latencyMs: Number.isFinite(latency) ? latency : null };
}

/**
 * Reads `instance_server_status`. The contract names the flags `update_available` and
 * `update_required`; camelCase is accepted too so either serde casing works. `null` means the
 * instance has no server link.
 */
export function parseInstanceServerStatus(raw: unknown): InstanceServerStatus | null {
  const value = record(raw);
  if (!value) return null;
  const listing = record(value.listing);
  return {
    link: parseServerLink(pick(value, 'link', 'server')),
    ping: parsePing(value.ping ?? listing?.ping),
    versionId: text(pick(value, 'versionId', 'version_id', 'targetVersionId', 'target_version_id')) ??
      text(record(listing?.content)?.versionId),
    updateAvailable: pick(value, 'update_available', 'updateAvailable') === true,
    updateRequired: pick(value, 'update_required', 'updateRequired') === true,
  };
}
