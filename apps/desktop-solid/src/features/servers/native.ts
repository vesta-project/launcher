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
import { serversManageNative } from './native-manage';

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
  /** What was requested, from the agent's operation `kind`; absent on agents without detail projection. */
  kind?: string | null;
  /** Who requested it. */
  actor?: OperationActor | null;
  /** Exactly what was requested, as far as the caller may see. */
  summary?: OperationSummary | null;
  /** Fixed, safe outcome code once terminal, e.g. `stdin_written`, `stale_generation`, `timeout`. */
  outcome?: string | null;
}

export type OperationActor =
  | { kind: 'principal'; principalId: string; displayName: string; deviceName: string | null; self: boolean }
  | { kind: 'system' | 'workflow'; name: string };

export type OperationSummary =
  /** `command` is null when the caller lacks `console.read` (the agent redacts it). */
  | { kind: 'console.command'; command: string | null }
  | { kind: 'players.moderate'; action: string; player: string; reason?: string | null; durationSeconds?: number | null }
  | { kind: 'lifecycle'; action: 'start' | 'stop' | 'restart' | 'kill'; targetGeneration: string | null; resultGeneration: string | null }
  | { kind: 'backup'; action: string; profile: string; snapshot?: string | null }
  | { kind: 'file'; action: string; path: string; to?: string | null }
  /** The canonical input was purged under the agent's retention policy. */
  | { kind: 'purged' };

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

/**
 * Global Tauri event: the saved connection list or a connection's coarse state changed.
 * Native code coalesces bursts; per-server detail flows through topic subscriptions.
 */
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
  /** False when the OS credential store is unavailable; the UI then offers a session-only sign-in. */
  secureStorageAvailable: boolean;
}

export interface SignInOptions {
  /**
   * Keep the device key and session in memory for this launcher session only. Chosen
   * explicitly by the user when secure storage is unavailable; never a silent fallback.
   * Without it, an unavailable store rejects with `credentials_unavailable` before the
   * pairing code is redeemed.
   */
  memoryOnly?: boolean;
}

// ------------------------------------------------------------------- commands

const call = <T>(command: string, args?: Record<string, unknown>) => invoke<T>(command, args);

export const serversNative = {
  /** Saved connections with their last-known snapshot. No network work. */
  list: () => call<ServerSnapshot[]>('server_connections_list'),
  /** Unauthenticated first contact: TLS handshake, fingerprint, `/api/v3/status`. Accepts a pairing link. */
  discover: (address: string) => call<Discovery>('server_discover', { address }),
  /** Redeem a pairing code. Never retried automatically; an uncertain outcome rejects with `pair_outcome_unknown`. */
  pair: (discoveryId: string, code: string, options: SignInOptions = {}) =>
    call<ServerSnapshot>('server_pair', { discoveryId, code, memoryOnly: options.memoryOnly ?? false }),
  /** Enroll with a launcher Minecraft account via the server's Mojang join challenge. */
  signInMinecraft: (discoveryId: string, accountUuid: string, options: SignInOptions = {}) =>
    call<ServerSnapshot>('server_sign_in_minecraft', { discoveryId, accountUuid, memoryOnly: options.memoryOnly ?? false }),
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

  /**
   * Agent semantics: `null` reads the bounded retained tail (oldest first); a cursor
   * continues forward after that line. Lines evicted at a gap are not retrievable.
   * Line cursors are identical in pages and stream events, so the UI can merge them.
   */
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
  ...serversFilesNative(),

  // Backups, access and pack: see native-manage.ts.
  ...serversManageNative,
};

export type ServersNative = typeof serversNative;

// ============================================================================
// Game-root files, logs and server.properties (stage 4)
//
// Kept in one block at the end of the contract so it merges cleanly with other
// server work; `serversNative` spreads it in (a hoisted function, so the block can
// live below). Each command names the agent route it maps to, all under
// `/api/v3/manage` (agent management API contract §2.2, "Rotated gzip logs" and
// "File download"). Paths are game-root-relative `/`-joined segments, never native
// or absolute paths; `''` is the root. Sizes and byte offsets are decimal strings;
// hashes are lowercase hex SHA-256. Mutations take an `intentId` as above.
//
// Error mapping onto the closed codes:
// - 412 `precondition_failed` (stale If-Match, existing create/rename/restore
//   target, stale upload offset) → `stale_target`. The UI re-reads the file for the
//   current content and validator rather than relying on `current_sha256`.
// - 409 `confirmation_invalid` → `confirmation_expired`; 409 `idempotency_conflict`
//   and `cursor_gap` → `conflict`; 409 `recovery_required` → `outcome_unknown`.
// - 400 `invalid_request` (protected admission documents, traversal, not a regular
//   file), 400 `not_compressed`, 413 `request_too_large`, 416 and 422
//   `archive_corrupt` → `invalid_input`.
// - 404 → `not_found`; 403 → `forbidden`; 503 `temporarily_unavailable` → `server_busy`.
// ============================================================================

export interface FileEntry {
  name: string;
  kind: 'file' | 'directory';
  /** Decimal bytes; `'0'` for directories. */
  size: string;
  modifiedAtMs: number | null;
}

/** A whole text file read with its optimistic-concurrency validator. */
export interface TextFile {
  /** Decoded UTF-8 text; empty when `binary`. */
  text: string;
  /** Content SHA-256, or null when only a preview prefix was read (`truncated`). */
  sha256: string | null;
  size: string;
  /** NUL or invalid UTF-8 was found; the UI offers download only. */
  binary: boolean;
  /** The file exceeds the 1 MiB whole-read limit; `text` is a read-only prefix. */
  truncated: boolean;
}

/** The agent's `Change` result. */
export interface FileChange {
  sha256: string;
  size: string;
  /** Trash entry holding an overwritten original, if any. */
  trashId: string | null;
}

export interface TrashEntry {
  id: string;
  /** Original game-root-relative path. */
  path: string;
  sha256: string;
  size: string;
  trashedAtMs: number;
  expiresAtMs: number;
}

/** A local file chosen in the native picker. Native code keeps its path. */
export interface UploadCandidate {
  localId: string;
  name: string;
  size: string;
}

export interface UploadProgress {
  uploadId: string;
  /** Bytes staged on the server so far. */
  offset: string;
  totalSize: string;
}

export type DownloadResult = { kind: 'saved'; size: string } | { kind: 'cancelled' };

/** A decoded `TextPage`. Byte offsets refer to the decompressed text when `decompress` was set. */
export interface LogPage {
  text: string;
  binary: boolean;
  startByte: string;
  endByte: string;
  /** Start of the next page forward; null at EOF. */
  nextByte: string | null;
  /** Start of this page, for paging backward; null at the beginning of the file. */
  prevByte: string | null;
  size: string;
  etag: string;
}

/** Known keys are typed; secrets, unknown and malformed values are the string `"[redacted]"`. */
export type PropertyValue = boolean | number | string;

export interface ServerProperties {
  values: Record<string, PropertyValue>;
  sha256: string;
}

export type PropertiesUpdateResult =
  | { kind: 'applied'; sha256: string; restartNeeded: boolean }
  /** 202: repeat the same intent, changes and validator with this token to confirm (120 s). */
  | { kind: 'awaitingConfirmation'; operationId: string; confirmationToken: string; expiresAtMs: number };

function serversFilesNative() {
  return {
    /** GET /files?path&cursor — one directory page; `files.list`. */
    filesList: (connectionId: ConnectionId, path: string, cursor: string | null) =>
      call<Page<FileEntry>>('server_files_list', { connectionId, path, cursor }),
    /** GET /files/content (≤1 MiB, `X-Vesta-Sha256`); larger files read a ranged prefix and set `truncated`. `files.read`. */
    fileReadText: (connectionId: ConnectionId, path: string) =>
      call<TextFile>('server_file_read_text', { connectionId, path }),
    /** PUT /files/content, `If-None-Match: *` when `expectedSha256` is null else `If-Match`; ≤16 MiB. `files.create`/`files.overwrite`. */
    fileWriteText: (connectionId: ConnectionId, path: string, text: string, expectedSha256: string | null, intentId: string) =>
      call<FileChange>('server_file_write_text', { connectionId, path, text, expectedSha256, intentId }),
    /** POST /files/mkdir `{path}` — one new directory; `files.mkdir`. */
    fileMkdir: (connectionId: ConnectionId, path: string, intentId: string) =>
      call<void>('server_file_mkdir', { connectionId, path, intentId }),
    /**
     * POST /files/rename `{from,to,expected_sha256}` — regular files only, never replaces; `files.rename`.
     * A null validator makes native code hash the current file once (download stream) first.
     */
    fileRename: (connectionId: ConnectionId, from: string, to: string, expectedSha256: string | null, intentId: string) =>
      call<FileChange>('server_file_rename', { connectionId, from, to, expectedSha256, intentId }),
    /** DELETE /files?path with `If-Match` — moves a regular file to trash; `files.delete`. Null validator as for rename. */
    fileDelete: (connectionId: ConnectionId, path: string, expectedSha256: string | null, intentId: string) =>
      call<{ trashId: string }>('server_file_delete', { connectionId, path, expectedSha256, intentId }),
    /** GET /trash?cursor — only entries this principal and device created. */
    trashList: (connectionId: ConnectionId, cursor: string | null) =>
      call<Page<TrashEntry>>('server_trash_list', { connectionId, cursor }),
    /** POST /trash/{id}/restore `{}` — back to the original path, never replacing (`stale_target`). */
    trashRestore: (connectionId: ConnectionId, trashId: string, intentId: string) =>
      call<FileChange>('server_trash_restore', { connectionId, trashId, intentId }),
    /** Native open dialog (multi-select); empty when cancelled. No network work. */
    uploadPick: () => call<UploadCandidate[]>('server_file_upload_pick'),
    /** POST /files/uploads `{path,total_size,sha256}` with the create/overwrite conditional; native hashes the local file. ≤16 MiB. */
    uploadBegin: (connectionId: ConnectionId, localId: string, path: string, expectedSha256: string | null, intentId: string) =>
      call<UploadProgress>('server_file_upload_begin', { connectionId, localId, path, expectedSha256, intentId }),
    /** PUT /files/uploads/{id}?offset — the next ≤1 MiB chunk from the staged offset (resumable). */
    uploadChunk: (connectionId: ConnectionId, uploadId: string) =>
      call<UploadProgress>('server_file_upload_chunk', { connectionId, uploadId }),
    /** POST /files/uploads/{id}/finish `{}` — verifies size and SHA-256 and rechecks the precondition. */
    uploadFinish: (connectionId: ConnectionId, uploadId: string) =>
      call<FileChange>('server_file_upload_finish', { connectionId, uploadId }),
    /** DELETE /files/uploads/{id} — discards staging only. */
    uploadAbort: (connectionId: ConnectionId, uploadId: string) =>
      call<void>('server_file_upload_abort', { connectionId, uploadId }),
    /**
     * GET /files/download?path[&decompress=1] — native save dialog, then streams to disk with
     * progress in the activity panel and `Range`/`If-Range` resume; `cancelled` when the dialog closes.
     */
    fileDownload: (connectionId: ConnectionId, path: string, decompress: boolean) =>
      call<DownloadResult>('server_file_download', { connectionId, path, decompress }),
    /** GET /files/tail?path&lines[&decompress=1] — the last 1–1000 lines. */
    logTail: (connectionId: ConnectionId, path: string, lines: number, decompress: boolean) =>
      call<LogPage>('server_log_tail', { connectionId, path, lines, decompress }),
    /** GET /files/lines?path&from_byte&limit&direction[&decompress=1] — whole lines from a byte cursor. */
    logLines: (connectionId: ConnectionId, path: string, fromByte: string | null, limit: number, direction: 'forward' | 'backward', decompress: boolean) =>
      call<LogPage>('server_log_lines', { connectionId, path, fromByte, limit, direction, decompress }),
    /** GET /config/server-properties — typed values and the source validator; `config.view` + `files.read`. */
    propertiesGet: (connectionId: ConnectionId) =>
      call<ServerProperties>('server_properties_get', { connectionId }),
    /**
     * PATCH /config/server-properties `{changes,expected_sha256,confirmation_token?}` — 1–32 known keys;
     * `config.edit`. A weakening change returns `awaitingConfirmation` (agent 202). Never restarts the game.
     */
    propertiesUpdate: (
      connectionId: ConnectionId, changes: Record<string, PropertyValue>, expectedSha256: string,
      confirmationToken: string | null, intentId: string,
    ) => call<PropertiesUpdateResult>('server_properties_update', { connectionId, changes, expectedSha256, confirmationToken, intentId }),
  };
}
