// Pure helpers for Vesta Server machines: codes, addresses, import review and list grouping.
// No signals here, so the rules stay testable outside the UI.
import type { MessageId } from '../../localization/messages';
import { parseHostPort, type AddressProblem, type ParsedAddress } from './address';
import { errorMessage, toServerError } from './errors';
import type { HostDiscovery, ImportJob, ImportReview, ImportState, VestaHost } from './native-hosts';
import type { ServerSnapshot } from './native';

/** The Vesta Server management port when the address leaves it out. */
export const HOST_PORT = 25500;

/** `host`, `host:port`, `[v6]:port` or an https origin; the port defaults to 25500. */
export function parseVestaAddress(input: string): ParsedAddress | { kind: 'invalid'; problem: AddressProblem } {
  return parseHostPort(input, HOST_PORT);
}

// ------------------------------------------------------------------ setup and link codes

const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_LENGTH = 12;

/** Code characters only, uppercased, with look alike letters folded (O to 0, I and L to 1). */
export function canonicalCode(input: string): string {
  // A whole pasted line ("Setup code: K7Q4-MX29-P3AB  ...") keeps only the code itself.
  const grouped = /([0-9a-z]{4})[-\s]([0-9a-z]{4})[-\s]([0-9a-z]{4})/i.exec(input);
  const source = grouped ? grouped.slice(1).join('') : input;
  return [...source.toUpperCase()]
    .map((char) => (char === 'O' ? '0' : char === 'I' || char === 'L' ? '1' : char))
    .filter((char) => CODE_ALPHABET.includes(char))
    .join('')
    .slice(0, CODE_LENGTH);
}

/** What the code field shows while typing: groups of four, joined like the machine prints them. */
export function formatCode(input: string): string {
  return canonicalCode(input).match(/.{1,4}/g)?.join('-') ?? '';
}

export const codeComplete = (input: string) => canonicalCode(input).length === CODE_LENGTH;

// ------------------------------------------------------------------ discovery

export type MachineState = 'ready' | 'linked' | 'claimed';

/** What a found machine means for this launcher. */
export function machineState(found: Pick<HostDiscovery, 'hostId' | 'state'>, hosts: readonly Pick<VestaHost, 'id'>[]): MachineState {
  if (hosts.some((host) => host.id === found.hostId)) return 'linked';
  return found.state === 'claimed' ? 'claimed' : 'ready';
}

/** Ready machines first, then ones already set up; one row per machine. */
export function sortDiscovered(found: readonly HostDiscovery[], hosts: readonly Pick<VestaHost, 'id'>[]): HostDiscovery[] {
  const rank: Record<MachineState, number> = { ready: 0, linked: 1, claimed: 2 };
  const unique = new Map<string, HostDiscovery>();
  for (const entry of found) if (!unique.has(entry.hostId)) unique.set(entry.hostId, entry);
  return [...unique.values()].sort((a, b) =>
    rank[machineState(a, hosts)] - rank[machineState(b, hosts)] || (a.name ?? a.address).localeCompare(b.name ?? b.address));
}

// ------------------------------------------------------------------ errors

/** Setup and link failures, worded for what the person can do next. */
export function enrollProblem(reason: unknown, purpose: 'claim' | 'link'): MessageId {
  const error = toServerError(reason);
  if (error.reason === 'pairing_failed' || error.code === 'credentials_rejected' || error.code === 'pair_code_invalid')
    return purpose === 'claim' ? 'vesta-server.problem.setup-code' : 'vesta-server.problem.link-code';
  if (error.reason === 'account_verification_unavailable') return 'vesta-server.problem.account';
  if (error.code === 'rate_limited') return 'vesta-server.problem.too-many';
  if (error.code === 'unreachable' || error.code === 'timeout' || error.code === 'tls_failed' || error.code === 'invalid_address')
    return 'vesta-server.problem.unreachable';
  if (error.code === 'conflict') return purpose === 'claim' ? 'vesta-server.problem.already-set-up' : 'vesta-server.problem.link-code';
  if (error.code === 'forbidden') return 'vesta-server.problem.no-access';
  return errorMessage(error);
}

/** True when the code itself was the problem, so the code step should show it. */
export const codeRejected = (reason: unknown) => {
  const error = toServerError(reason);
  return error.reason === 'pairing_failed' || error.code === 'credentials_rejected' || error.code === 'pair_code_invalid' || error.code === 'conflict';
};

// ------------------------------------------------------------------ roles

export function hostRoleLabel(role: string | null | undefined): MessageId {
  switch (role) {
    case 'primary_owner': return 'vesta-server.role.primary-owner';
    case 'owner': return 'vesta-server.role.owner';
    case 'admin': return 'vesta-server.role.admin';
    case 'moderator': return 'vesta-server.role.moderator';
    default: return 'vesta-server.role.member';
  }
}

export const canManageHost = (role: string | null | undefined) => role === 'primary_owner' || role === 'owner';

// ------------------------------------------------------------------ import review

export interface ImportCandidate {
  candidateId: string;
  kind: 'amp' | 'minecraft';
  label: string;
  displayPath: string;
  folderToken: string | null;
}

export interface CandidateWarning { code: string; displayPath: string; command: string | null }

const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value : null);

/** Server reply to candidate rows, AMP first. Malformed rows are dropped, never guessed at. */
export function readCandidates(reply: { candidates?: unknown; warnings?: unknown } | null | undefined): { candidates: ImportCandidate[]; warnings: CandidateWarning[] } {
  const rows = Array.isArray(reply?.candidates) ? reply.candidates : [];
  const candidates = rows.flatMap((row): ImportCandidate[] => {
    const value = row as Record<string, unknown>;
    const displayPath = text(value?.displayPath);
    if (!displayPath) return [];
    return [{
      candidateId: text(value.candidateId) ?? displayPath,
      kind: value.kind === 'amp' ? 'amp' : 'minecraft',
      label: text(value.label) ?? lastSegment(displayPath),
      displayPath,
      folderToken: text(value.folderToken),
    }];
  }).sort((a, b) => Number(b.kind === 'amp') - Number(a.kind === 'amp') || a.label.localeCompare(b.label));
  const warnings = (Array.isArray(reply?.warnings) ? reply.warnings : []).flatMap((row): CandidateWarning[] => {
    const value = row as Record<string, unknown>;
    const code = text(value?.code);
    if (!code) return [];
    const remediation = value.remediation as Record<string, unknown> | null | undefined;
    return [{ code, displayPath: text(value.displayPath) ?? '', command: text(remediation?.command) }];
  });
  return { candidates, warnings };
}

export function lastSegment(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  // AMP keeps the server one level below the instance: name it after the instance.
  const last = parts.at(-1) ?? path;
  return last.toLowerCase() === 'minecraft' && parts.length > 1 ? parts.at(-2)! : last;
}

/** The local admin command that lets Vesta Server read a folder. Windows has no sudo. */
export function importRootCommand(path: string): string {
  if (/^[A-Za-z]:[\\/]/.test(path)) return `vesta import-root add ${/\s/.test(path) ? `"${path}"` : path}`;
  return `sudo vesta import-root add ${/[\s"'$`\\]/.test(path) ? `"${path.replace(/(["\\$`])/g, '\\$1')}"` : path}`;
}

export interface BlockerFix {
  code: string;
  message: MessageId;
  /** A command to run on the machine, shown with a copy button. */
  command?: string;
  /** The fix is changing a setting under Customize. */
  customize?: boolean;
}

const blockerMessages: Record<string, MessageId> = {
  source_running: 'vesta-server.blocker.source-running',
  source_state_unknown: 'vesta-server.blocker.source-unknown',
  source_unreadable: 'vesta-server.blocker.permission',
  game_port_in_use: 'vesta-server.blocker.port-in-use',
  port_state_unknown: 'vesta-server.blocker.port-unknown',
  port_unresolved: 'vesta-server.blocker.port-unknown',
  insufficient_space: 'vesta-server.blocker.disk',
  software_unresolved: 'vesta-server.blocker.software',
  launch_unresolved: 'vesta-server.blocker.software',
  java_unresolved: 'vesta-server.blocker.software',
  not_minecraft_server: 'vesta-server.blocker.not-minecraft',
  memory_budget_exceeded: 'vesta-server.blocker.memory',
  memory_invalid: 'vesta-server.blocker.memory',
  memory_unresolved: 'vesta-server.blocker.memory-unknown',
  source_changed: 'vesta-server.blocker.changed',
  source_too_large: 'vesta-server.blocker.too-large',
  unsafe_path: 'vesta-server.blocker.unsafe',
};

/** One plain fix per blocker code; unknown codes still get a readable line. */
export function blockerFix(code: string, sourcePath: string): BlockerFix {
  const message = blockerMessages[code] ?? 'vesta-server.blocker.other';
  if (code === 'source_unreadable') return { code, message, command: importRootCommand(sourcePath) };
  if (code === 'game_port_in_use' || code === 'memory_budget_exceeded' || code === 'memory_invalid') return { code, message, customize: true };
  return { code, message };
}

const warningMessages: Record<string, MessageId> = {
  disable_amp_auto_restart: 'vesta-server.warning.amp-restart',
  source_unreadable: 'vesta-server.warning.unreadable',
  outside_import_roots: 'vesta-server.warning.outside',
  scan_truncated: 'vesta-server.warning.truncated',
};
export const warningMessage = (code: string): MessageId => warningMessages[code] ?? 'vesta-server.warning.other';

export interface ReviewSummary {
  software: string | null;
  minecraftVersion: string | null;
  instanceName: string | null;
  bytes: number;
  files: number;
  gamePort: number;
  memoryMiB: number;
  javaMajor: number | null;
  freeBytes: number;
}

const SOFTWARE: Record<string, string> = {
  vanilla: 'Vanilla', fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', neoforge: 'NeoForge',
  paper: 'Paper', purpur: 'Purpur', spigot: 'Spigot', bukkit: 'Bukkit', folia: 'Folia', velocity: 'Velocity',
};

export function reviewSummary(review: ImportReview): ReviewSummary {
  const detected = (review.detected ?? {}) as Record<string, unknown>;
  const runtime = (review.runtime ?? {}) as Record<string, unknown>;
  const loader = text(detected.loader) ?? text(detected.software);
  const minecraftVersion = text(detected.minecraftVersion);
  return {
    software: loader ? SOFTWARE[loader.toLowerCase()] ?? loader : minecraftVersion ? SOFTWARE.vanilla! : null,
    minecraftVersion,
    instanceName: text(detected.instanceName),
    bytes: review.source.bytes,
    files: review.source.files,
    gamePort: review.resources.gamePort,
    memoryMiB: review.resources.memoryMiB,
    javaMajor: typeof runtime.requiredMajor === 'number' ? runtime.requiredMajor : null,
    freeBytes: review.destination.freeBytes,
  };
}

// ------------------------------------------------------------------ import job

export const IMPORT_POLLING: readonly ImportState[] = ['planning', 'applying', 'starting'];
export const importBusy = (state: ImportState | undefined) => !!state && IMPORT_POLLING.includes(state);

/** Copy progress from 0 to 100, by bytes when known, else by files; null while unknown. */
export function importPercent(progress: ImportJob['progress'] | null | undefined): number | null {
  if (!progress) return null;
  if (progress.bytesTotal > 0) return Math.min(100, (progress.bytesDone / progress.bytesTotal) * 100);
  if (progress.filesTotal > 0) return Math.min(100, (progress.filesDone / progress.filesTotal) * 100);
  return null;
}

const jobErrors: Record<string, MessageId> = {
  game_port_in_use: 'vesta-server.blocker.port-in-use',
  source_running: 'vesta-server.blocker.source-running',
  source_state_unknown: 'vesta-server.blocker.source-unknown',
  port_state_unknown: 'vesta-server.blocker.port-unknown',
  source_changed: 'vesta-server.blocker.changed',
  insufficient_space: 'vesta-server.blocker.disk',
  start_failed: 'vesta-server.import.start-failed',
  imports_unavailable: 'vesta-server.import.unavailable',
  import_jobs_saturated: 'vesta-server.import.busy',
  worker_unavailable: 'vesta-server.import.busy',
};

/** A job error or command failure as one friendly line. */
export function importProblem(reason: unknown): MessageId {
  if (typeof reason === 'string') return jobErrors[reason] ?? 'vesta-server.import.failed';
  const error = toServerError(reason);
  if (error.reason && jobErrors[error.reason]) return jobErrors[error.reason]!;
  if (error.reason === 'eula_required') return 'vesta-server.import.eula-needed';
  if (error.reason === 'import_job_not_found' || error.code === 'not_found') return 'vesta-server.import.gone';
  return errorMessage(error);
}

/** Commands whose outcome is uncertain keep their idempotency key for a retry. */
export const keepKey = (reason: unknown) => {
  const code = toServerError(reason).code;
  return code === 'outcome_unknown' || code === 'unreachable' || code === 'timeout' || code === 'server_busy' || code === 'rate_limited';
};

// ------------------------------------------------------------------ servers list

/** The machine a server runs on, from its `hostId:serverId` connection id. */
export function hostIdOf(snapshot: Pick<ServerSnapshot, 'connection'>): string | null {
  if (snapshot.connection.signInMethod !== 'host') return null;
  const at = snapshot.connection.id.indexOf(':');
  return at > 0 ? snapshot.connection.id.slice(0, at) : null;
}

export interface ServerGroup<S> { key: string; host: VestaHost | null; servers: S[] }

/**
 * Servers grouped under their machine, but only when there is more than one machine.
 * With one machine (or none) everything is a single unnamed group, as before.
 */
export function groupServers<S extends Pick<ServerSnapshot, 'connection'>>(snapshots: readonly S[], hosts: readonly VestaHost[]): ServerGroup<S>[] {
  if (hosts.length < 2) return [{ key: 'all', host: null, servers: [...snapshots] }];
  const groups: ServerGroup<S>[] = hosts.map((host) => ({ key: `host:${host.id}`, host, servers: [] }));
  const other: ServerGroup<S> = { key: 'other', host: null, servers: [] };
  for (const snapshot of snapshots) {
    const hostId = hostIdOf(snapshot);
    (groups.find((group) => group.host?.id === hostId) ?? other).servers.push(snapshot);
  }
  return other.servers.length ? [...groups, other] : groups;
}

/** A short device name the machine shows in its devices list. */
export function deviceName(platform: 'macos' | 'windows' | 'linux' | 'web'): MessageId {
  return platform === 'macos' ? 'vesta-server.device.mac' : platform === 'windows' ? 'vesta-server.device.windows' : 'vesta-server.device.linux';
}
