// Contract for owner hosting features: the world, the server software and the optional
// built-in SFTP service. See docs/architecture/SERVER_HOSTING_UI.md. Same rules as
// `native.ts`: camelCase DTOs, seeds/revisions/ids stay strings, mutations take a UI
// `intentId`, confirmation tokens stay native, rejections use `ServerCommandError`
// (optionally with the agent's fixed `reason` code).
import { invoke } from '@tauri-apps/api/core';
import type { ConnectionId } from './native';

const call = <T>(command: string, args?: Record<string, unknown>) => invoke<T>(command, args);

// ------------------------------------------------------------------ world

export interface ServerWorld {
  sizeBytes: string | null;
  sizeComplete: boolean;
  sizeObservedAtMs: number | null;
  lastModifiedAtMs: number | null;
  lastPlayedAtMs: number | null;
  dimensions: WorldDimension[];
  datapacks: WorldDatapack[];
  datapackStateSource: 'saved_level_dat' | null;
  /** The `level-name` Minecraft loads. */
  name: string;
  /** Actual seed from `level.dat`, signed 64-bit as a decimal string; null before generation. */
  seed: string | null;
  /** The `level-seed` generation setting; "" means random. */
  configuredSeed: string;
  exists: boolean;
  revision: string;
}

export interface WorldDimension { id: 'overworld' | 'nether' | 'end' | string; present: boolean; folders: string[]; layout: 'nested' | 'split' }
export interface WorldDatapack { id: string; name: string; kind: 'folder' | 'zip' | 'builtin' | 'missing'; path: string | null; enabled: boolean | null }

// ------------------------------------------------------------------ software

export const SOFTWARE_IDS = ['vanilla', 'paper', 'folia', 'purpur', 'fabric', 'quilt', 'forge', 'neoforge', 'bukkit', 'spigot'] as const;
export type SoftwareId = (typeof SOFTWARE_IDS)[number];

export interface SoftwareLaunch {
  customJar?: { path: string } | null;
  /** Null for the original, locally approved launch. */
  software: SoftwareId | null;
  version: string | null;
  build: number | null;
  /** `original` for the locally approved launch. */
  installationId: string;
  loaderVersion?: string | null;
  javaMajor?: number | null;
}

export interface SoftwareDescriptor {
  software: SoftwareId;
  automaticBackend: boolean;
  unavailableReason: string | null;
  source: string;
  licence: string;
  eula: string;
  caution: string | null;
}

export interface SoftwareState {
  available: boolean;
  unavailableReason: string | null;
  revision: string;
  current: SoftwareLaunch | null;
  previous: SoftwareLaunch | null;
  previousRestorable?: boolean;
  recoveryRequired: boolean;
  catalog: SoftwareDescriptor[];
}

export interface SoftwareRelease { id: string; build: number | null; loaderVersion: string | null }
export interface SoftwareReleases { software: SoftwareId; version: string; releases: SoftwareRelease[] }
export interface SoftwareVersions { software: SoftwareId; versions: string[] }

export interface SoftwarePlanRequest {
  software: SoftwareId;
  version: string;
  build?: number;
  loaderVersion?: string;
  experimental?: false;
}

export type SoftwareWarning =
  | 'legacy_checksum' | 'unsupported_upstream' | 'experimental_build'
  | 'region_threading' | 'first_run_effects' | 'proxy_resolution' | 'source_build';

/** A reviewed switch. Native keeps its confirmation token. */
export interface SoftwarePlan {
  loaderVersion?: string | null;
  planId: string;
  expiresAtMs: number;
  expectedRevision: string;
  software: SoftwareId;
  version: string;
  build: number | null;
  java: { major: number; evidence: string };
  javaCompatible?: boolean | null;
  selectedJavaMajor?: number | null;
  managedDownloadMajor?: number | null;
  warnings: (SoftwareWarning | string)[];
  risks: string[];
}

export type SoftwareJobState = 'queued' | 'staging' | 'activating' | 'succeeded' | 'failed' | 'recovery_required';

export interface SoftwareJob {
  id: string;
  kind: 'apply' | 'rollback' | 'java_select' | 'java_download' | 'custom_jar' | 'restore_managed';
  state: SoftwareJobState;
  createdAtMs: number;
  updatedAtMs: number;
  /** Fixed safe code, e.g. `server_install.storage_low`. */
  error: string | null;
}

// ------------------------------------------------------------------ sftp

export interface SftpLimits {
  sessions: number;
  sessionsPerIp: number;
  handlesPerSession: number;
  transfersPerPrincipal: number;
  bytesPerSecond: number;
  bytesPerSession: number;
  maxFileBytes: number;
  idleTimeoutSecs: number;
}

export interface SftpConfig {
  enabled: boolean;
  /** Literal IPv4/IPv6 address. */
  bindAddress: string;
  port: number;
  allowCidrs: string[];
  denyCidrs: string[];
  limits: SftpLimits;
}

export type SftpConfigPatch = Partial<Omit<SftpConfig, 'limits'>> & { limits?: Partial<SftpLimits> };

export interface SftpStatus {
  config: SftpConfig;
  running: boolean;
  boundAddress: string | null;
  /** `SHA256:…`; null until the service has been enabled once. */
  hostKeyFingerprint: string | null;
  activeSessions: number;
  authentication: string[];
  /** The caller's canonical principal id, used as the SFTP username. */
  username: string;
}

export interface SftpKey {
  id: string;
  principalId: string;
  label: string;
  fingerprint: string;
  publicKey: string;
  createdAtMs: number;
  expiresAtMs: number | null;
  revokedAtMs: number | null;
}

/** What native handed to the OS when opening the SFTP client. */
export interface SftpTarget { host: string; port: number; username: string; hostKeyFingerprint: string | null }

// ------------------------------------------------------------------ commands

export const serversHostingNative = {
  /** GET world. */
  world: (connectionId: ConnectionId) => call<ServerWorld>('server_world', { connectionId }),
  worldDatapackOffline: (connectionId: ConnectionId, packId: string, enabled: boolean, expectedRevision: string, intentId: string) =>
    call<ServerWorld>('server_world_datapack_offline', { connectionId, packId, enabled, expectedRevision, intentId }),
  /** Uses Minecraft's own command while running; state is read from saved level.dat. */
  worldDatapackToggle: (connectionId: ConnectionId, packId: string, enabled: boolean, expectedGeneration: string, intentId: string) =>
    call<import('./native').ServerOperation>('server_world_datapack_toggle', { connectionId, packId, enabled, expectedGeneration, intentId }),

  /** GET software. */
  software: (connectionId: ConnectionId) => call<SoftwareState>('server_software', { connectionId }),
  /** GET software/versions; read on demand for one software. */
  softwareVersions: (connectionId: ConnectionId, software: SoftwareId) =>
    call<SoftwareVersions>('server_software_versions', { connectionId, software }),
  softwareReleases: (connectionId: ConnectionId, software: SoftwareId, version: string) =>
    call<SoftwareReleases>('server_software_releases', { connectionId, software, version }),
  /** POST software/plan → a reviewed plan; the confirmation token stays native. */
  softwarePlan: (connectionId: ConnectionId, request: SoftwarePlanRequest) =>
    call<SoftwarePlan>('server_software_plan', { connectionId, request }),
  /** POST software/apply with the token native kept for `planId`. Never starts or stops Minecraft. */
  softwareApply: (connectionId: ConnectionId, planId: string, acknowledgeWarnings: boolean, acknowledgeLegacyChecksum: boolean, intentId: string) =>
    call<SoftwareJob>('server_software_apply', { connectionId, planId, acknowledgeWarnings, acknowledgeLegacyChecksum, intentId }),
  /** GET software/jobs, newest first. */
  softwareJobs: (connectionId: ConnectionId) => call<SoftwareJob[]>('server_software_jobs', { connectionId }),
  /** POST software/rollback to the stored previous launch. */
  softwareRollback: (connectionId: ConnectionId, expectedRevision: string, intentId: string) =>
    call<SoftwareJob>('server_software_rollback', { connectionId, expectedRevision, intentId }),

  /** GET sftp. */
  sftp: (connectionId: ConnectionId) => call<SftpStatus>('server_sftp', { connectionId }),
  /** PATCH sftp; only the given fields change. Disconnects open SFTP sessions. */
  sftpUpdate: (connectionId: ConnectionId, patch: SftpConfigPatch, intentId: string) =>
    call<SftpStatus>('server_sftp_update', { connectionId, patch, intentId }),
  /** GET sftp/keys, including revoked keys. */
  sftpKeys: (connectionId: ConnectionId) => call<SftpKey[]>('server_sftp_keys', { connectionId }),
  /** POST sftp/keys. Public keys only. */
  sftpKeyAdd: (connectionId: ConnectionId, principalId: string, label: string, publicKey: string, expiresAtMs: number | null, intentId: string) =>
    call<SftpKey>('server_sftp_key_add', { connectionId, principalId, label, publicKey, expiresAtMs, intentId }),
  /** DELETE sftp/keys/{id}; idempotent. */
  sftpKeyRevoke: (connectionId: ConnectionId, keyId: string, intentId: string) =>
    call<void>('server_sftp_key_revoke', { connectionId, keyId, intentId }),
  /**
   * Opens the OS default SFTP client. Native builds `sftp://user@host:port/` from the trusted
   * connection hostname and the agent's SFTP port, then appends the validated relative directory.
   * Omit path to open the server root; the UI never supplies a URL.
   */
  sftpOpen: (connectionId: ConnectionId, path?: string) => call<SftpTarget>('server_sftp_open', { connectionId, path }),
};
