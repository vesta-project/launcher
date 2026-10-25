// Pure decisions for the world, software and SFTP sections: input checks, labels, the
// copy for the agent's fixed reason codes, and the bounded job-follow cadence.
import type { MessageId } from '../../localization/messages';
import { roleKey } from './capabilities';
import type { ServerCommandError, ServerSnapshot } from './native';
import type { SftpKey, SftpStatus, SoftwareId, SoftwareJob, SoftwareLaunch } from './hosting-native';

// ------------------------------------------------------------------ software

export const softwareNames: Record<SoftwareId, string> = {
  vanilla: 'Vanilla', paper: 'Paper', folia: 'Folia', purpur: 'Purpur',
  fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', neoforge: 'NeoForge',
};

/** Loaders whose `version` is the Minecraft version and that add their own loader version. */
export const LOADERS: ReadonlySet<SoftwareId> = new Set(['fabric', 'quilt', 'forge', 'neoforge']);

export const softwareName = (id: SoftwareId | null | undefined) => (id ? softwareNames[id] ?? id : null);

/** "Paper 1.21.4 · build 130"; null for the original launch, which the agent doesn't describe. */
export function launchSummary(launch: SoftwareLaunch | null | undefined): string | null {
  if (!launch?.software) return null;
  const parts = [`${softwareName(launch.software)} ${launch.version ?? ''}`.trim()];
  if (launch.loaderVersion) parts.push(`loader ${launch.loaderVersion}`);
  if (launch.build !== null && launch.build !== undefined) parts.push(`build ${launch.build}`);
  return parts.join(' · ');
}

export const jobActive = (job: Pick<SoftwareJob, 'state'> | null | undefined) =>
  !!job && (job.state === 'queued' || job.state === 'staging' || job.state === 'activating');

/** Follow cadence for an accepted job: 2 s, backing off to 10 s. */
export const jobPollDelay = (attempt: number) => Math.min(10_000, 2_000 * 2 ** Math.max(0, Math.floor(attempt / 3)));

export const jobStepMessage: Record<SoftwareJob['state'], MessageId> = {
  queued: 'server-hosting.job-queued',
  staging: 'server-hosting.job-staging',
  activating: 'server-hosting.job-activating',
  succeeded: 'server-hosting.job-succeeded',
  failed: 'server-hosting.job-failed',
  recovery_required: 'server-hosting.job-recovery',
};

/** Plan warnings the agent sends; unknown codes use the generic line. */
export const warningMessage: Record<string, MessageId> = {
  legacy_checksum: 'server-hosting.warning-legacy-checksum',
  unsupported_upstream: 'server-hosting.warning-unsupported-upstream',
  experimental_build: 'server-hosting.warning-experimental',
  region_threading: 'server-hosting.warning-region-threading',
  first_run_effects: 'server-hosting.warning-first-run',
  proxy_resolution: 'server-hosting.warning-proxy',
};
export const warningCopy = (code: string): MessageId => warningMessage[code] ?? 'server-hosting.warning-other';

// ------------------------------------------------------------------ reasons

/** Copy for the agent's fixed reason codes (software_*, server_install.*, sftp/world). */
const reasons: Record<string, MessageId> = {
  software_forbidden: 'server-hosting.reason-owner-only',
  software_disabled: 'server-hosting.reason-software-disabled',
  software_runtime_unavailable: 'server-hosting.reason-software-disabled',
  provider_not_implemented: 'server-hosting.reason-provider-unavailable',
  software_busy: 'server-hosting.reason-busy',
  software_plan_expired: 'server-hosting.reason-plan-expired',
  software_confirmation_invalid: 'server-hosting.reason-plan-expired',
  software_revision_conflict: 'server-hosting.reason-changed',
  software_idempotency_conflict: 'server-hosting.reason-changed',
  software_previous_unavailable: 'server-hosting.reason-no-previous',
  software_recovery_required: 'server-hosting.reason-recovery',
  software_state_unavailable: 'server-hosting.reason-not-stopped',
  'server_install.unavailable': 'server-hosting.reason-version-unavailable',
  'server_install.invalid_metadata': 'server-hosting.reason-source-failed',
  'server_install.source_refused': 'server-hosting.reason-source-failed',
  'server_install.transport_failed': 'server-hosting.reason-download-failed',
  'server_install.deadline': 'server-hosting.reason-download-failed',
  'server_install.artifact_changed': 'server-hosting.reason-integrity',
  'server_install.integrity_conflict': 'server-hosting.reason-integrity',
  'server_install.runtime_unknown': 'server-hosting.reason-java-missing',
  'server_install.runtime_incompatible': 'server-hosting.reason-java-incompatible',
  'server_install.runtime_failed': 'server-hosting.reason-java-missing',
  'server_install.storage_low': 'server-hosting.reason-storage-low',
  'server_install.storage_unknown': 'server-hosting.reason-storage-unknown',
  'server_install.limit_exceeded': 'server-hosting.reason-limit',
  'server_install.busy': 'server-hosting.reason-busy',
  'server_install.expired': 'server-hosting.reason-plan-expired',
  'server_install.approval_mismatch': 'server-hosting.reason-plan-expired',
  world_not_stopped: 'server-hosting.reason-not-stopped',
  world_requires_stopped: 'server-hosting.reason-not-stopped',
  world_metadata_invalid: 'server-hosting.reason-world-metadata',
  sftp_bind_failed: 'server-hosting.reason-bind-failed',
  sftp_key_invalid: 'server-hosting.reason-key-invalid',
  sftp_key_duplicate: 'server-hosting.reason-key-duplicate',
  sftp_key_limit: 'server-hosting.reason-key-limit',
};

/** Specific copy for a reason code, or null to fall back to the closed error model. */
export const reasonMessage = (reason: string | null | undefined): MessageId | null => (reason ? reasons[reason] ?? null : null);

/** The message for a rejection: its reason when known, otherwise null (use ServerErrorNote). */
export const rejectionMessage = (error: Pick<ServerCommandError, 'reason'> | null | undefined) => reasonMessage(error?.reason);

// ------------------------------------------------------------------ sftp

const PUBLIC_KEY_TYPES = /^ssh-ed25519$/;

/** Checks a pasted OpenSSH public key before it leaves the UI. Private keys never pass. */
export function publicKeyProblem(text: string): 'empty' | 'private' | 'format' | null {
  const value = text.trim();
  if (!value) return 'empty';
  if (/PRIVATE KEY|-----BEGIN|PuTTY-User-Key-File/i.test(value)) return 'private';
  if (/[\r\n]/.test(value)) return 'format';
  const [type, body] = value.split(/\s+/);
  if (!type || !PUBLIC_KEY_TYPES.test(type) || !body || !/^[A-Za-z0-9+/]+={0,3}$/.test(body) || body.length < 60) return 'format';
  return null;
}

/** The key's comment ("user@laptop"), offered as the default label. */
export const publicKeyComment = (text: string) => text.trim().split(/\s+/).slice(2).join(' ').slice(0, 64);

/** True when the listener only accepts connections from the server computer itself. */
export const sftpLoopbackOnly = (status: Pick<SftpStatus, 'config'>) => /^127\./.test(status.config.bindAddress) || ['::1', '[::1]', 'localhost'].includes(status.config.bindAddress);

/** An owner without an active key of their own can't sign in yet. */
export const hasOwnKey = (keys: readonly SftpKey[], username: string, nowMs: number) =>
  keys.some((key) => key.principalId === username && !key.revokedAtMs && (key.expiresAtMs === null || key.expiresAtMs > nowMs));

/** Host of `https://host:port/…`, `host:port` or `[v6]:port`. */
export function hostOf(address: string): string {
  const value = address.replace(/^[a-z]+:\/\//i, '').split('/')[0] ?? '';
  if (value.startsWith('[')) return value.slice(0, value.indexOf(']') + 1);
  const parts = value.split(':');
  return parts.length === 2 ? parts[0]! : value;
}


export function portProblem(value: string): MessageId | null {
  if (!/^\d{1,5}$/.test(value.trim())) return 'server-hosting.port-invalid';
  const port = Number(value);
  return port >= 1 && port <= 65_535 ? null : 'server-hosting.port-invalid';
}

/** Literal IPv4 or IPv6, as the agent requires. */
export function bindProblem(value: string): MessageId | null {
  const text = value.trim();
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (v4) return v4.slice(1).every((part) => Number(part) <= 255) ? null : 'server-hosting.bind-invalid';
  if (text.includes(':') && /^[0-9a-f:.]+$/i.test(text) && (text.match(/::/g)?.length ?? 0) <= 1) return null;
  return 'server-hosting.bind-invalid';
}

/** Owner-reserved actions: shown for owners and while the role is unknown; the agent decides. */
export const mayOwn = (role: string | null | undefined) => !role || roleKey(role) === 'owner';

/** World and software changes need Minecraft positively stopped, on a reachable agent. */
export const gameStopped = (snapshot: Pick<ServerSnapshot, 'state' | 'status'>) =>
  snapshot.state.phase === 'online' && snapshot.status?.state === 'stopped';

/** SFTP's well-known port; links leave it out. */
export const SFTP_DEFAULT_PORT = 22;

/** A host as it goes in a URL: bare IPv6 addresses gain brackets. */
export function sftpUrlHost(host: string): string {
  const value = host.trim();
  return !value.startsWith('[') && value.includes(':') ? `[${value}]` : value;
}

/** `/a/b%20c/` for a game-root-relative folder; the root is `/`. Each segment is percent-encoded. */
export function sftpUrlPath(path: string): string {
  const segments = path.split(/[\\/]+/).filter((segment) => segment && segment !== '.').map(encodeURIComponent);
  return segments.length ? `/${segments.join('/')}/` : '/';
}

/** `sftp://user@host[:port]/folder/` for the given folder. */
export function sftpLink(target: { host: string; port: number; username: string; path?: string }): string {
  const port = target.port === SFTP_DEFAULT_PORT ? '' : `:${target.port}`;
  return `sftp://${encodeURIComponent(target.username)}@${sftpUrlHost(target.host)}${port}${sftpUrlPath(target.path ?? '')}`;
}
