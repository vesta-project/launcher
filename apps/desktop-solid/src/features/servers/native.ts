// Typed IPC boundary for remote Vesta server management.
//
// This file is the contract between the Solid UI and the native server manager
// (`vesta-launcher/src-tauri/src/servers`, backed by `crates/vesta-server-client`).
// Rust command names, argument names (camelCase on the JS side) and DTO field
// names (camelCase via `#[serde(rename_all = "camelCase")]`) must match exactly.
//
// Rules the native side upholds:
// - No bearer tokens, private keys, pairing codes after redemption, or raw URLs
//   chosen by the UI cross this boundary. The UI names a connection; native
//   code owns endpoints, trust, sessions, retries and request budgets.
// - Generations, revisions, cursors and byte counts stay strings.
// - Every rejected command rejects with a `ServerCommandError` object.
// - Mutations take a UI-generated `intentId` (one per user intent). Native code
//   derives the server Idempotency-Key from it and never invents a fresh key for
//   an automatic retry.
import { Channel, invoke, isTauri } from '@tauri-apps/api/core';

export const nativeServers = typeof window !== 'undefined' && isTauri();

/** Launcher-local opaque connection id. Never an endpoint or server_id. */
export type ConnectionId = string;

/** Closed error model. The UI maps each code to one message and one action. */
export type ServerErrorCode =
  | 'invalid_address'
  | 'unreachable'
  | 'timeout'
  | 'tls_failed'
  | 'fingerprint_mismatch'
  | 'pair_code_invalid'
  | 'pair_outcome_unknown'
  | 'credentials_rejected'
  | 'credentials_unavailable'
  | 'no_management_access'
  | 'forbidden'
  | 'not_found'
  | 'stale_target'
  | 'confirmation_expired'
  | 'conflict'
  | 'rate_limited'
  | 'server_busy'
  | 'unsupported'
  | 'outcome_unknown'
  | 'invalid_input'
  | 'internal';

export interface ServerCommandError {
  code: ServerErrorCode;
  /** Present for `rate_limited` and `server_busy` when the server sent guidance. */
  retryAfterMs?: number | null;
}

export const isServerCommandError = (value: unknown): value is ServerCommandError =>
  typeof value === 'object' && value !== null && typeof (value as { code?: unknown }).code === 'string';

// ---------------------------------------------------------------- connections

export type ConnectionPhase = 'disconnected' | 'connecting' | 'online' | 'backoff' | 'unreachable';

export type AccessState =
  | 'paired'
  | 'fingerprint_changed'
  | 'credentials_rejected'
  | 'credentials_unavailable'
  | 'no_management_access';

export interface ConnectionState {
  phase: ConnectionPhase;
  access: AccessState;
  /** Epoch ms of the next reconnect attempt while `phase === 'backoff'`. */
  retryAtMs: number | null;
  /** Epoch ms until which non-interactive work is paused after a 429. */
  rateLimitedUntilMs: number | null;
  /** Last classified failure, cleared on success. */
  lastError: ServerErrorCode | null;
}

export interface ServerConnection {
  id: ConnectionId;
  /** User label; defaults to the server's reported name. */
  name: string;
  /** Normalized display form, e.g. `play.example.net:8443` or `[::1]:8443`. */
  endpoint: string;
  serverId: string;
  /** Approved TLS leaf SHA-256, lowercase hex. */
  fingerprint: string;
  /** Role name returned when pairing, or null after Minecraft sign-in. */
  role: string | null;
  signInMethod: 'pairing_code' | 'minecraft';
  /** True when credentials are kept in memory only for this session. */
  memoryOnly: boolean;
  pinned: boolean;
  addedAtMs: number;
  lastConnectedAtMs: number | null;
}

// ---------------------------------------------------------------- server data

export type MinecraftState = 'stopped' | 'running' | 'stopping' | 'draining';
export type Lifecycle =
  | 'offline' | 'sleeping' | 'waking' | 'starting' | 'online' | 'stopping' | 'crash_loop' | 'recovery_required';
export type Readiness = 'stopped' | 'starting' | 'ready' | 'degraded';
export type ReadinessReason = 'startup_timeout' | 'probe_failed' | 'fatal_output' | 'console_gap';

export interface SupervisorStatus {
  orphanRunning: boolean;
  launchUnresolved: boolean;
  observationFailed: boolean;
  crashRestartEnabled: boolean;
  crashLoop: boolean;
  restartStateUnsaved: boolean;
  recentCrashes: number;
  restartPendingMs: string | null;
}

export interface ServerStatus {
  state: MinecraftState;
  /** Absent on agents that predate the sleep/MOTD lifecycle field. */
  lifecycle: Lifecycle | null;
  generation: string | null;
  playerCount: number | null;
  playerCountKnown: boolean;
  playerCountObservedAtMs: number | null;
  uptimeSeconds: string | null;
  readiness: Readiness;
  readinessReason: ReadinessReason | null;
  readinessEvidence: 'log_and_probe' | 'log_only';
  supervision: 'in_process' | 'separate';
  supervisor: SupervisorStatus | null;
}

export interface ServerInfo {
  serverId: string;
  name: string;
  agentVersion: string;
  minecraftVersion: string;
  packVersion: string;
}

export interface PackStatus {
  hostedRevision: string | null;
  minimumRevision: string | null;
  status: 'published' | 'unpublished';
}

export interface CapabilityView {
  /** `session`: the server reported effective capabilities. `role_defaults`: derived from a built-in role name. */
  source: 'session' | 'role_defaults' | 'unknown';
  granted: string[];
  /** Capabilities the server refused at least once this session. */
  refused: string[];
}

export interface ServerSnapshot {
  connection: ServerConnection;
  state: ConnectionState;
  info: ServerInfo | null;
  status: ServerStatus | null;
  /** Epoch ms when `status` was last confirmed by the server. */
  statusObservedAtMs: number | null;
  pack: PackStatus | null;
  capabilities: CapabilityView;
  /** True after a settings change reported `restart_needed` until the next start. */
  restartRequired: boolean;
}

// ----------------------------------------------------------------- operations

export type OperationState =
  | 'queued' | 'validating' | 'awaiting_confirmation' | 'running' | 'cancelling'
  | 'succeeded' | 'failed' | 'cancelled' | 'recovery_required';

export interface ServerOperation {
  operationId: string;
  /** Launcher-side label of what was requested, e.g. `lifecycle.stop`; null for operations started elsewhere. */
  intent: string | null;
  state: OperationState;
  progressPercent: number | null;
  createdAtMs: number;
  updatedAtMs: number;
  finishedAtMs: number | null;
  /** True while native code is reconciling an uncertain submission. */
  reconciling: boolean;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

// -------------------------------------------------------------------- console

export interface ConsoleLine {
  cursor: string;
  text: string;
  truncated: boolean;
}

export interface ConsolePage extends Page<ConsoleLine> {
  latestCursor: string;
}

// -------------------------------------------------------------------- players

export type PlayersView =
  | { known: false }
  | { known: true; generation: string; playerCount: number; names: string[] };

export interface WhitelistEntry { name: string; uuid: string }
export interface OperatorEntry { name: string; uuid: string; level: number; bypassesPlayerLimit: boolean }
export interface BanEntry { name: string; uuid: string; reason: string; created: string; expires: string; source: string }

export type ModerationAction =
  | { action: 'kick'; player: string; reason?: string }
  /** `durationSeconds` 60–31,536,000; absent means permanent. */
  | { action: 'ban'; player: string; reason?: string; durationSeconds?: number }
  | { action: 'pardon'; player: string }
  | { action: 'whitelist_add'; player: string }
  | { action: 'whitelist_remove'; player: string }
  /** OP is two-step: `moderate` prepares, `moderateConfirm` submits the same intent. */
  | { action: 'op'; player: string }
  | { action: 'deop'; player: string }
  | { action: 'kill'; player: string }
  | { action: 'lightning'; player: string };

export type ModerationResult =
  | { kind: 'operation'; operation: ServerOperation }
  | { kind: 'awaitingConfirmation'; expiresAtMs: number };

// -------------------------------------------------------------------- metrics

export interface MetricsSample {
  atMs: number;
  cpuPercent: number | null;
  memoryUsedBytes: string | null;
  memoryMaxBytes: string | null;
  tps: number | null;
  mspt: number | null;
  playersOnline: number | null;
}

// --------------------------------------------------------------------- events

export type ServerTopic = 'status' | 'console' | 'metrics' | 'operations';

/** Batched delivery on a subscription channel. */
export type ServerEvent =
  | { kind: 'snapshot'; snapshot: ServerSnapshot }
  | { kind: 'console'; lines: ConsoleLine[] }
  | { kind: 'consoleGap'; cursor: string }
  | { kind: 'metrics'; sample: MetricsSample }
  | { kind: 'operation'; operation: ServerOperation }
  /** The consumer fell behind or a stream restarted; re-read authoritative state. */
  | { kind: 'resync'; topic: ServerTopic };

/** Global Tauri event emitted when the saved connection list or any snapshot changes. */
export const SERVERS_CHANGED_EVENT = 'core://servers-changed';

// ------------------------------------------------------------------ discovery

export interface Discovery {
  /** Short-lived native handle for the unverified contact; expires after 10 minutes. */
  discoveryId: string;
  endpoint: string;
  serverId: string;
  /** SHA-256 of the presented TLS leaf, computed by the client during the handshake. */
  fingerprint: string;
  /** Coarse public lifecycle from `/api/v3/status`, if provided. */
  publicLifecycle: string | null;
  /** Set when the pasted address was a pairing link with a fingerprint. */
  expectedFingerprint: string | null;
  /** Code carried by a pasted pairing link, so the UI can prefill it. */
  linkCode: string | null;
  /** An existing saved connection to the same server, if any. */
  existingConnectionId: ConnectionId | null;
}

// ------------------------------------------------------------------- commands

const call = <T>(command: string, args?: Record<string, unknown>) => invoke<T>(command, args);

export const serversNative = {
  /** Saved connections with their last-known snapshot. No network work. */
  list: () => call<ServerSnapshot[]>('server_connections_list'),
  /** Unauthenticated first contact: TLS handshake, fingerprint, `/api/v3/status`. Accepts a pairing link. */
  discover: (address: string) => call<Discovery>('server_discover', { address }),
  /** Redeem a pairing code. Never retried automatically; an uncertain outcome rejects with `pair_outcome_unknown`. */
  pair: (discoveryId: string, code: string) => call<ServerSnapshot>('server_pair', { discoveryId, code }),
  /** Enroll with a launcher Minecraft account via the server's Mojang join challenge. */
  signInMinecraft: (discoveryId: string, accountUuid: string) =>
    call<ServerSnapshot>('server_sign_in_minecraft', { discoveryId, accountUuid }),
  /** Accept the currently presented fingerprint after the user compared it. */
  approveFingerprint: (connectionId: ConnectionId, fingerprint: string) =>
    call<ServerSnapshot>('server_trust_approve', { connectionId, fingerprint }),
  update: (connectionId: ConnectionId, patch: { name?: string; pinned?: boolean }) =>
    call<ServerSnapshot>('server_connection_update', { connectionId, patch }),
  /** Forget the connection and delete its device key. Does not touch the server. */
  remove: (connectionId: ConnectionId) => call<void>('server_connection_remove', { connectionId }),
  /** Last-known snapshot; `refresh` asks native code to re-read status within the request budget. */
  snapshot: (connectionId: ConnectionId, refresh = false) =>
    call<ServerSnapshot>('server_snapshot', { connectionId, refresh }),
  /** Open a topic subscription. Native code shares one stream per server across windows. */
  subscribe: (connectionId: ConnectionId, topic: ServerTopic, channel: Channel<ServerEvent>) =>
    call<string>('server_subscribe', { connectionId, topic, channel }),
  unsubscribe: (handle: string) => call<void>('server_unsubscribe', { handle }),

  lifecycle: (connectionId: ConnectionId, action: 'start' | 'stop' | 'restart', expectedGeneration: string | null, intentId: string) =>
    call<ServerOperation>('server_lifecycle', { connectionId, action, expectedGeneration, intentId }),
  /** Prepare a force kill. Native code keeps the confirmation token. */
  killPrepare: (connectionId: ConnectionId, expectedGeneration: string, intentId: string) =>
    call<{ operationId: string; expiresAtMs: number }>('server_kill_prepare', { connectionId, expectedGeneration, intentId }),
  /** Confirm the prepared kill for the same intent; rejects with `confirmation_expired` after expiry. */
  killConfirm: (connectionId: ConnectionId, intentId: string) =>
    call<ServerOperation>('server_kill_confirm', { connectionId, intentId }),
  operations: (connectionId: ConnectionId, cursor: string | null) =>
    call<Page<ServerOperation>>('server_operations', { connectionId, cursor }),

  consolePage: (connectionId: ConnectionId, cursor: string | null, limit: number) =>
    call<ConsolePage>('server_console_page', { connectionId, cursor, limit }),
  consoleSend: (connectionId: ConnectionId, line: string, expectedGeneration: string, intentId: string) =>
    call<ServerOperation>('server_console_send', { connectionId, line, expectedGeneration, intentId }),

  players: (connectionId: ConnectionId) => call<PlayersView>('server_players', { connectionId }),
  whitelist: (connectionId: ConnectionId) => call<WhitelistEntry[]>('server_players_whitelist', { connectionId }),
  operators: (connectionId: ConnectionId) => call<OperatorEntry[]>('server_players_ops', { connectionId }),
  bans: (connectionId: ConnectionId) => call<BanEntry[]>('server_players_bans', { connectionId }),
  /** Player names are Java Edition `[A-Za-z0-9_]{1,16}`. Requires the running generation. */
  moderate: (connectionId: ConnectionId, request: ModerationAction, expectedGeneration: string, intentId: string) =>
    call<ModerationResult>('server_moderate', { connectionId, request, expectedGeneration, intentId }),
  moderateConfirm: (connectionId: ConnectionId, intentId: string) =>
    call<ServerOperation>('server_moderate_confirm', { connectionId, intentId }),
};

export type ServersNative = typeof serversNative;
