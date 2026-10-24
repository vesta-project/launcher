// Contract for sleep mode and the offline/transitional server-list presentation (MOTD,
// version label, player cap, icon). Maps to GET/PUT sleep/policy, GET/PUT motd/policy
// and POST motd/preview. The live online MOTD stays in server.properties.
import { invoke } from '@tauri-apps/api/core';
import type { ConnectionId } from './native';

const call = <T>(command: string, args?: Record<string, unknown>) => invoke<T>(command, args);

export interface SleepPolicy {
  /** Null/absent inherits host.toml; an explicit value persists with this policy. */
  onAgentStart?: 'stay_stopped' | 'sleep' | 'start' | null;
  enabled: boolean;
  /** Answer server-list pings while Minecraft is asleep or stopped. */
  offlineStatus: boolean;
  /** A real login attempt queues a start (pings never wake). */
  wakeOnJoin: boolean;
  /** 60–86400: verified empty time before the warning. */
  idleSeconds: number;
  /** 5–300: in-game countdown before stopping. */
  warningSeconds: number;
  /** 10–3600: minimum time between wake starts. */
  startCooldownSeconds: number;
}

export type SleepBlocker =
  | { reason: 'disabled' | 'not_ready' | 'players_online' | 'player_count_unknown' | 'operation_in_progress' | 'hold' | 'authority_unavailable' }
  | { reason: 'counting_down' | 'warning_sent'; remainingSeconds: number };

export interface SleepPolicyView {
  policy: SleepPolicy;
  revision: number;
  /** Null when connected to an older agent without this diagnostic. */
  sleepBlocker: SleepBlocker | null;
}

export const SLEEP_BOUNDS = {
  idleSeconds: [60, 86_400],
  warningSeconds: [5, 300],
  startCooldownSeconds: [10, 3600],
} as const;

export const PRESENCE_STATES = ['online', 'offline', 'sleeping', 'waking', 'starting', 'stopping', 'maintenance', 'crash_loop', 'recovery_required'] as const;
export type PresenceState = (typeof PRESENCE_STATES)[number];

export interface StatePresentation {
  /** Up to two lines with `§` colour/style codes and `{placeholder}`s. */
  template: string;
  /** Null is sent as the agent's default label, "Vesta"; saves return the concrete value. */
  versionName: string | null;
  /** Null is sent as the agent's default cap, 0; saves return the concrete value. */
  maximumPlayers: number | null;
  /** Base64 64×64 PNG, or null for the generated fallback. */
  iconPng: string | null;
}

export interface MotdDocument {
  states: Record<PresenceState, StatePresentation>;
  normalIconPng: string | null;
  /** Disconnect text shown to a player whose login wakes the server. */
  loginMessage: string;
}

export interface MotdPreview {
  lines: [string, string];
  /** Rendered segments with resolved colour/style, for faithful preview. */
  segments: { text: string; color: string | null; bold: boolean; italic: boolean; underlined: boolean; strikethrough: boolean; obfuscated: boolean; line: 0 | 1 }[];
  iconPng: string | null;
  placeholders: string[];
}

export const serversPresenceNative = {
  /** GET sleep/policy → policy plus its revision (starts at 0). */
  sleepPolicy: (connectionId: ConnectionId) => call<SleepPolicyView>('server_sleep_policy', { connectionId }),
  /** PUT sleep/policy; a stale revision rejects with `stale_target`. */
  updateSleepPolicy: (connectionId: ConnectionId, policy: SleepPolicy, expectedRevision: number, intentId: string) =>
    call<SleepPolicyView>('server_sleep_policy_update', { connectionId, policy, expectedRevision, intentId }),
  /** GET motd/policy → the document plus its revision (null before the first save). */
  motdPolicy: (connectionId: ConnectionId) => call<{ document: MotdDocument; revision: string | null }>('server_motd_policy', { connectionId }),
  updateMotdPolicy: (connectionId: ConnectionId, document: MotdDocument, expectedRevision: string | null, intentId: string) =>
    call<{ document: MotdDocument; revision: string }>('server_motd_policy_update', { connectionId, document, expectedRevision, intentId }),
  /** POST motd/preview: the agent's own rendering and validation of a draft. */
  motdPreview: (connectionId: ConnectionId, state: PresenceState, document: MotdDocument) =>
    call<MotdPreview>('server_motd_preview', { connectionId, state, document }),
};
