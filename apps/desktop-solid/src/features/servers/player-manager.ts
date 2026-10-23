// One list of the players a server knows about: the union of the whitelist, operators,
// bans and who is online now, keyed by name (Minecraft names are case-insensitive).
// Pure, so filtering and status chips can be checked without a server.
import type { MessageId } from '../../localization/messages';
import type { Tone } from '@vesta/ui';
import type { BanEntry, OperatorEntry, PlayersView, WhitelistEntry } from './native';

export interface KnownPlayer {
  /** Lowercased name. */
  key: string;
  name: string;
  /** From the first list that reported one; the online roster only has names. */
  uuid: string | null;
  online: boolean;
  whitelisted: boolean;
  operator: { level: number; bypassesPlayerLimit: boolean } | null;
  ban: { reason: string; created: string; expires: string; source: string } | null;
}

export interface PlayerSources {
  whitelist?: readonly WhitelistEntry[];
  ops?: readonly OperatorEntry[];
  bans?: readonly BanEntry[];
  roster?: PlayersView;
}

/** Merges every source. Online players sort first, then by name. */
export function mergePlayers(sources: PlayerSources): KnownPlayer[] {
  const players = new Map<string, KnownPlayer>();
  const entry = (name: string, uuid?: string | null) => {
    const key = name.toLowerCase();
    let player = players.get(key);
    if (!player) {
      player = { key, name, uuid: null, online: false, whitelisted: false, operator: null, ban: null };
      players.set(key, player);
    }
    if (!player.uuid && uuid) player.uuid = uuid;
    return player;
  };
  for (const item of sources.whitelist ?? []) entry(item.name, item.uuid).whitelisted = true;
  for (const item of sources.ops ?? []) entry(item.name, item.uuid).operator = { level: item.level, bypassesPlayerLimit: item.bypassesPlayerLimit };
  for (const item of sources.bans ?? []) entry(item.name, item.uuid).ban = { reason: item.reason, created: item.created, expires: item.expires, source: item.source };
  if (sources.roster?.known) for (const name of sources.roster.names) entry(name).online = true;
  return [...players.values()].sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

export type PlayerFilter = 'all' | 'online' | 'whitelisted' | 'operators' | 'banned';
export const PLAYER_FILTERS: readonly PlayerFilter[] = ['all', 'online', 'whitelisted', 'operators', 'banned'];

const inFilter = (player: KnownPlayer, filter: PlayerFilter) => {
  switch (filter) {
    case 'all': return true;
    case 'online': return player.online;
    case 'whitelisted': return player.whitelisted;
    case 'operators': return !!player.operator;
    case 'banned': return !!player.ban;
  }
};

/** Players in the filter whose name or UUID contains the query. */
export function filterPlayers(players: readonly KnownPlayer[], filter: PlayerFilter, query = ''): KnownPlayer[] {
  const needle = query.trim().toLowerCase();
  return players.filter((player) => inFilter(player, filter) && (!needle || player.key.includes(needle) || !!player.uuid?.toLowerCase().includes(needle)));
}

export function filterCounts(players: readonly KnownPlayer[]): Record<PlayerFilter, number> {
  return Object.fromEntries(PLAYER_FILTERS.map((filter) => [filter, players.filter((player) => inFilter(player, filter)).length])) as Record<PlayerFilter, number>;
}

/** When a ban ends: never, at a time, or unknown (unparseable). */
export function banExpiry(expires: string): { permanent: true } | { permanent: false; atMs: number } | null {
  if (!expires || /^forever$/i.test(expires.trim())) return { permanent: true };
  // Vanilla writes `2026-10-02 18:12:44 +0000`; make it ISO for Date.
  const iso = expires.trim().replace(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{2})(\d{2})$/, '$1T$2$3:$4');
  const atMs = Date.parse(iso);
  return Number.isNaN(atMs) ? null : { permanent: false, atMs };
}

export interface PlayerChip {
  tone: Tone;
  message: MessageId;
  args?: Record<string, string | number>;
}

/** Status chips in reading order. `date` formats a ban's end for "Banned until …". */
export function playerChips(player: KnownPlayer, date: (ms: number) => string): PlayerChip[] {
  const chips: PlayerChip[] = [];
  if (player.online) chips.push({ tone: 'success', message: 'servers.people.online' });
  if (player.ban) {
    const expiry = banExpiry(player.ban.expires);
    chips.push(expiry && !expiry.permanent
      ? { tone: 'danger', message: 'servers.people.banned-until', args: { time: date(expiry.atMs) } }
      : { tone: 'danger', message: 'servers.people.banned' });
  }
  if (player.operator) chips.push({ tone: 'accent', message: 'servers.people.operator', args: { count: player.operator.level } });
  if (player.whitelisted) chips.push({ tone: 'neutral', message: 'servers.people.whitelisted' });
  return chips;
}

/** First block of a UUID, enough to tell players apart at a glance. */
export const shortUuid = (uuid: string) => uuid.split('-')[0] ?? uuid.slice(0, 8);

/** Ban lengths offered when banning; null is permanent. */
export const BAN_DURATIONS: readonly (number | null)[] = [null, 3600, 86_400, 7 * 86_400, 30 * 86_400];
