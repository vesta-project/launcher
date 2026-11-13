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

// Same format as the vesta-host-client crate (`SetupCode`): 12 Crockford base32 characters,
// shown as XXXX-XXXX-XXXX. The machine accepts any case with hyphens or spaces.
export const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const CODE_LENGTH = 12;
export const CODE_GROUPS = [4, 4, 4] as const;

/** One typed character as it goes in the code, or null when it can't be part of one. */
export function codeChar(input: string): string | null {
  if (input.length !== 1) return null;
  const upper = input.toUpperCase();
  // Crockford look alikes: O reads as zero, I and L as one.
  const folded = upper === 'O' ? '0' : upper === 'I' || upper === 'L' ? '1' : upper;
  return CODE_ALPHABET.includes(folded) ? folded : null;
}

const fold = (text: string) => [...text].map((char) => codeChar(char) ?? '').join('');
const isCode = (text: string) => fold(text).length === text.length;

/**
 * Code characters only, uppercased and folded. A pasted line ("Setup code: K7Q4-MX29-P3AB
 * expires in 30 minutes") keeps just the code: grouped XXXX-XXXX-XXXX first, then a lone
 * 12 character word, then everything that could be part of a code.
 */
export function canonicalCode(input: string): string {
  const grouped = [...input.matchAll(/(?<![0-9a-z])(?=([0-9a-z]{4})([-\s]+)([0-9a-z]{4})([-\s]+)([0-9a-z]{4})(?![0-9a-z]))/gi)]
    .map((match) => ({ parts: [match[1], match[3], match[5]], dashed: match[2].includes('-') && match[4].includes('-') }))
    .filter((match) => match.parts.every(isCode));
  const best = grouped.findLast((match) => match.dashed) ?? grouped.at(-1);
  if (best) return fold(best.parts.join(''));
  const word = input.split(/[^0-9a-z]+/i).findLast((part) => part.length === CODE_LENGTH && isCode(part));
  if (word) return fold(word);
  return fold(input).slice(0, CODE_LENGTH);
}

/** What the machine prints: groups of four joined by hyphens. */
export function formatCode(input: string): string {
  return canonicalCode(input).match(/.{1,4}/g)?.join('-') ?? '';
}

export const codeComplete = (input: string) => canonicalCode(input).length === CODE_LENGTH;

/** Where a typed character lands in the cells. Cells fill in order, without gaps. */
export function typeIntoCode(value: string, at: number, char: string): { value: string; focus: number } | null {
  const next = codeChar(char);
  if (!next) return null;
  const index = Math.min(at, value.length, CODE_LENGTH - 1);
  const typed = (value.slice(0, index) + next + value.slice(index + 1)).slice(0, CODE_LENGTH);
  return { value: typed, focus: Math.min(index + 1, CODE_LENGTH - 1) };
}

/** Backspace in a cell: clear it when filled, otherwise step back and clear the one before. */
export function backspaceCode(value: string, at: number): { value: string; focus: number } {
  if (at < value.length) return { value: value.slice(0, at) + value.slice(at + 1), focus: at };
  const index = Math.min(at, value.length) - 1;
  if (index < 0) return { value, focus: 0 };
  return { value: value.slice(0, index) + value.slice(index + 1), focus: index };
}

/** The group each cell sits in, for drawing the fixed separators between groups. */
export const codeGroups = () => {
  let start = 0;
  return CODE_GROUPS.map((size) => {
    const cells = Array.from({ length: size }, (_, offset) => start + offset);
    start += size;
    return cells;
  });
};

// ------------------------------------------------------------------ discovery

export type MachineState = 'ready' | 'linked' | 'claimed';

/** What a found machine means for this launcher. */
export function machineState(found: Pick<HostDiscovery, 'hostId' | 'state'>, hosts: readonly Pick<VestaHost, 'id'>[]): MachineState {
  if (hosts.some((host) => host.id === found.hostId)) return 'linked';
  return found.state === 'claimed' ? 'claimed' : 'ready';
}

/** A certificate fingerprint in groups of four, for reading against the machine. */
export const formatFingerprint = (fingerprint: string) => fingerprint.toLowerCase().match(/.{1,4}/g)?.join(' ') ?? '';

/** Ready machines first, then ones already set up; one row per machine. */
export function sortDiscovered(found: readonly HostDiscovery[], hosts: readonly Pick<VestaHost, 'id'>[]): HostDiscovery[] {
  const rank: Record<MachineState, number> = { ready: 0, linked: 1, claimed: 2 };
  const unique = new Map<string, HostDiscovery>();
  for (const entry of found) if (!unique.has(entry.hostId)) unique.set(entry.hostId, entry);
  return [...unique.values()].sort((a, b) =>
    rank[machineState(a, hosts)] - rank[machineState(b, hosts)] || (a.name ?? a.address).localeCompare(b.name ?? b.address));
}

// ------------------------------------------------------------------ errors

/** Setup and link failures, sorted by what the person can do about each one. */
export type SetupProblemKind =
  | 'unreachable' | 'wrong-code' | 'expired-code' | 'too-many' | 'claimed'
  | 'account-signin' | 'account-proof' | 'account-offline' | 'no-access' | 'approval' | 'identity' | 'other';

export interface SetupProblem {
  kind: SetupProblemKind;
  message: MessageId;
  /** Only for `too-many`: how long the machine asked us to wait. */
  retryAfterMs?: number;
}

const UNREACHABLE = ['unreachable', 'timeout', 'tls_failed', 'invalid_address', 'fingerprint_mismatch'];

/**
 * Maps a native setup error to one honest cause. The machine answers every bad code with the
 * same `pairing_failed` on purpose, so wrong and expired only differ when this launcher saw
 * the code pass earlier (native then says `code_expired`).
 */
export function setupProblem(reason: unknown, purpose: 'claim' | 'link'): SetupProblem {
  const error = toServerError(reason);
  const link = purpose === 'link';
  switch (error.reason) {
    case 'host_already_claimed': return { kind: 'claimed', message: 'vesta-server.problem.already-set-up' };
    case 'setup_code_expired_or_replaced': // the machine's own word for it, e.g. after a restart
    case 'code_expired': return { kind: 'expired-code', message: link ? 'vesta-server.problem.link-expired' : 'vesta-server.problem.code-expired' };
    case 'pairing_failed': return { kind: 'wrong-code', message: link ? 'vesta-server.problem.link-wrong' : 'vesta-server.problem.code-wrong' };
    case 'account_signin_required': return { kind: 'account-signin', message: 'vesta-server.problem.account-signin' };
    case 'account_proof_failed': return { kind: 'account-proof', message: 'vesta-server.problem.account-proof' };
    case 'account_service_unreachable':
    case 'account_verification_unavailable': return { kind: 'account-offline', message: 'vesta-server.problem.account' };
  }
  if (error.code === 'rate_limited') return { kind: 'too-many', message: 'vesta-server.problem.too-many', retryAfterMs: error.retryAfterMs ?? undefined };
  if (UNREACHABLE.includes(error.code)) return { kind: 'unreachable', message: 'vesta-server.problem.unreachable' };
  if (error.code === 'credentials_rejected' || error.code === 'pair_code_invalid')
    return { kind: 'wrong-code', message: link ? 'vesta-server.problem.link-wrong' : 'vesta-server.problem.code-wrong' };
  if (error.code === 'credentials_unavailable') return { kind: 'account-signin', message: 'vesta-server.problem.account-signin' };
  if (error.code === 'conflict' && !link) return { kind: 'claimed', message: 'vesta-server.problem.already-set-up' };
  if (error.code === 'forbidden') return { kind: 'no-access', message: 'vesta-server.problem.no-access' };
  return { kind: 'other', message: errorMessage(error) };
}


/**
 * Signing in with the Minecraft account on a machine someone already set up, no code. The
 * account having no role and the owner wanting approval are answers, not errors: each one
 * leads somewhere. A different machine answering, or a challenge that doesn't add up,
 * stops before Mojang is asked anything.
 */
export function signInProblem(reason: unknown): SetupProblem {
  const error = toServerError(reason);
  switch (error.reason) {
    case 'account_has_no_access': return { kind: 'no-access', message: 'vesta-server.problem.no-access' };
    case 'device_approval_required': return { kind: 'approval', message: 'vesta-server.account.approval' };
    case 'server_hash_mismatch':
    case 'host_identity_changed': return { kind: 'identity', message: 'vesta-server.problem.identity' };
  }
  if (error.code === 'fingerprint_mismatch') return { kind: 'identity', message: 'vesta-server.problem.identity' };
  const problem = setupProblem(error, 'link');
  // No code is involved here, so a refused proof is about the account.
  if (codeProblem(problem.kind)) return { kind: 'account-proof', message: 'vesta-server.problem.account-proof' };
  return problem.kind === 'claimed' ? { kind: 'other', message: errorMessage(error) } : problem;
}

/** Looking a machine up or signing in to one already linked, before any code is involved. */
export function enrollProblemForFind(reason: unknown): MessageId {
  const error = toServerError(reason);
  if (error.reason === 'account_has_no_access') return 'vesta-server.problem.no-access';
  if (error.reason === 'host_identity_changed' || error.reason === 'server_hash_mismatch') return 'vesta-server.problem.identity';
  if (error.reason === 'account_signin_required') return 'vesta-server.problem.account-signin';
  if (UNREACHABLE.includes(error.code)) return 'vesta-server.problem.unreachable';
  if (error.code === 'rate_limited') return 'vesta-server.problem.too-many';
  if (error.code === 'forbidden' || error.code === 'credentials_rejected') return 'vesta-server.problem.no-access';
  return errorMessage(error);
}
/** Problems that belong to the code itself: the code cells shake and clear. */
export const codeProblem = (kind: SetupProblemKind) => kind === 'wrong-code' || kind === 'expired-code';

/** The machine's wait, rounded up to whole seconds (at least one). */
export const waitSeconds = (ms: number | undefined) => Math.max(1, Math.ceil((ms ?? 60_000) / 1000));

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

/** A machine name as the machine stores it: hidden characters dropped, spaces collapsed. */
export const tidyHostName = (name: string) =>
  name.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069\u061c\ufeff]/g, '').replace(/\s+/g, ' ').trim();

/** Why a new machine name can't be used: it must be 1 to 63 bytes once tidied. */
export function hostNameProblem(name: string): 'empty' | 'long' | null {
  const tidy = tidyHostName(name);
  if (!tidy) return 'empty';
  return new TextEncoder().encode(tidy).length > 63 ? 'long' : null;
}

// ------------------------------------------------------------------ import: finding a folder

const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value : null);

const SOFTWARE: Record<string, string> = {
  vanilla: 'Vanilla', fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', neoforge: 'NeoForge',
  paper: 'Paper', purpur: 'Purpur', spigot: 'Spigot', bukkit: 'Bukkit', folia: 'Folia', velocity: 'Velocity',
};
const softwareName = (value: string | null) => (value ? SOFTWARE[value.toLowerCase()] ?? value : null);

export interface ImportCandidate {
  candidateId: string;
  label: string;
  displayPath: string;
  /** Null when Vesta Server can see the folder but can't read it yet. */
  folderToken: string | null;
  /** What a local admin runs so Vesta Server can read it; set only when it can't. */
  command: string | null;
  software: string | null;
  bytes: number | null;
}

/**
 * Likely servers from the machine, ready ones first. Malformed rows are dropped, never guessed
 * at. Machine wide warnings (a default location that isn't readable) are not shown: only a
 * specific found server can need permission. `truncated` means the search stopped early.
 */
export function readCandidates(reply: { candidates?: unknown; warnings?: unknown } | null | undefined): { candidates: ImportCandidate[]; truncated: boolean } {
  const rows = Array.isArray(reply?.candidates) ? reply.candidates : [];
  const candidates = rows.flatMap((row): ImportCandidate[] => {
    const value = row as Record<string, unknown> | null;
    const displayPath = text(value?.displayPath);
    if (!value || !displayPath) return [];
    const folderToken = text(value.folderToken);
    return [{
      candidateId: text(value.candidateId) ?? displayPath,
      label: text(value.label) ?? folderName(displayPath),
      displayPath,
      folderToken,
      command: folderToken ? null : text(value.remediationCommand) ?? importRootCommand(displayPath),
      software: softwareName(text(value.loader) ?? text(value.software)),
      bytes: typeof value.bytes === 'number' && value.bytes > 0 ? value.bytes : null,
    }];
  }).sort((a, b) => Number(!a.folderToken) - Number(!b.folderToken) || a.label.localeCompare(b.label));
  const warnings = Array.isArray(reply?.warnings) ? reply.warnings : [];
  const truncated = warnings.some((row) => (row as Record<string, unknown> | null)?.code === 'scan_truncated');
  return { candidates, truncated };
}

/** The name a new server gets from its folder. A bare `minecraft` folder takes its parent's name. */
export function lastSegment(path: string): string {
  const parts = splitPath(path).parts;
  const last = parts.at(-1) ?? path;
  return last.toLowerCase() === 'minecraft' && parts.length > 1 ? parts.at(-2)! : last;
}

/** A folder's own name; the top of a drive is its path. */
export function folderName(path: string): string {
  const split = splitPath(path);
  return split.parts.at(-1) ?? split.root;
}

/** The local admin command that lets Vesta Server read a folder. Windows has no sudo. */
export function importRootCommand(path: string): string {
  if (/^[A-Za-z]:[\\/]/.test(path)) return `vesta import-root add ${/\s/.test(path) ? `"${path}"` : path}`;
  return `sudo vesta import-root add ${/[\s"'$`\\]/.test(path) ? `"${path.replace(/(["\\$`])/g, '\\$1')}"` : path}`;
}

// ------------------------------------------------------------------ import: paths on the machine

export interface SplitPath { root: string; parts: string[] }

/** `/srv/a/b` or `D:\games\a`, split into its top (`/`, `D:\`) and folder names. */
export function splitPath(path: string): SplitPath {
  const drive = /^([A-Za-z]):(?:[\\/]|$)/.exec(path);
  const root = drive ? `${drive[1]!.toUpperCase()}:\\` : '/';
  const rest = drive ? path.slice(drive[0].length) : path;
  return { root, parts: rest.split(/[\\/]+/).filter(Boolean) };
}

export function joinPath(root: string, parts: readonly string[]): string {
  return root + parts.join(root === '/' ? '/' : '\\');
}

/** A pasted path, tidied: quotes and trailing separators dropped. Null unless it's absolute. */
export function normalisePath(input: string): string | null {
  const trimmed = input.trim().replace(/^(["'])(.*)\1$/, '$2').trim();
  if (!trimmed.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(trimmed)) return null;
  const split = splitPath(trimmed);
  if (split.parts.some((part) => part === '..' || part === '.')) return null;
  return joinPath(split.root, split.parts);
}

const samePart = (root: string) => (a: string, b: string) => (root === '/' ? a === b : a.toLowerCase() === b.toLowerCase());

/** Is `path` the folder `base` or somewhere inside it? Returns the names below `base`. */
export function below(base: string, path: string): string[] | null {
  const outer = splitPath(base);
  const inner = splitPath(path);
  if (outer.root !== inner.root || outer.parts.length > inner.parts.length) return null;
  const same = samePart(outer.root);
  return outer.parts.every((part, index) => same(part, inner.parts[index]!)) ? inner.parts.slice(outer.parts.length) : null;
}

/** A folder at the very top of a drive (`/`, `C:\`). */
export const isDriveRoot = (path: string) => splitPath(path).parts.length === 0;

export interface BrowseRoot { rootId: string; displayPath: string; readable: boolean }

/**
 * The root to open `path` through: the preferred one when it holds the path, otherwise the
 * deepest readable root that does (a shared folder is readable even where its parents aren't).
 */
export function locate<R extends BrowseRoot>(path: string, roots: readonly R[], prefer?: string | null): { root: R; segments: string[] } | null {
  const holding = roots.flatMap((root) => {
    const segments = root.readable ? below(root.displayPath, path) : null;
    return segments ? [{ root, segments }] : [];
  });
  return holding.find((entry) => entry.root.rootId === prefer)
    ?? holding.sort((a, b) => a.segments.length - b.segments.length)[0]
    ?? null;
}

// ------------------------------------------------------------------ import: can this folder be used?

export type ServerPart = 'server_properties' | 'server_jar' | 'world';

/** Why a folder isn't a server, in the order a person would fix it. */
const MISSING_REASONS: [ServerPart, MessageId][] = [
  ['server_properties', 'vesta-server.import.why-no-server-file'],
  ['server_jar', 'vesta-server.import.why-no-jar'],
  ['world', 'vesta-server.import.why-no-world'],
];

export type FolderUse = { usable: true } | { usable: false; reason: MessageId };

/** What the launcher knows about the open folder. Null means ask the machine. */
export function folderUse(folder: { top?: boolean; looksLikeServer?: boolean; missing?: readonly string[] | null }): FolderUse | null {
  if (folder.top) return { usable: false, reason: 'vesta-server.import.why-top' };
  if (folder.missing?.length) {
    const reason = MISSING_REASONS.find(([part]) => folder.missing!.includes(part))?.[1] ?? 'vesta-server.import.why-no-server-file';
    return { usable: false, reason };
  }
  if (folder.looksLikeServer === true) return { usable: true };
  if (folder.looksLikeServer === false) return { usable: false, reason: 'vesta-server.import.why-no-server-file' };
  return null;
}

const codeOf = (entry: unknown) => (typeof entry === 'string' ? entry : text((entry as Record<string, unknown> | null)?.code));
const parts = (value: unknown): string[] => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []);

/**
 * `not_minecraft_server` and what's missing, from an inspection report or an import review.
 * The machine may put `missing` at the top, on the blocker itself, or under `inspection`.
 */
export function readNotServer(report: unknown): { notServer: boolean; missing: string[] } {
  const value = (report ?? {}) as Record<string, unknown>;
  const blockers = Array.isArray(value.blockers) ? value.blockers : [];
  const blocker = blockers.find((entry) => codeOf(entry) === 'not_minecraft_server');
  if (blocker === undefined) return { notServer: false, missing: [] };
  const nested = [blocker, value, value.inspection, value.detected].map((entry) => parts((entry as Record<string, unknown> | null)?.missing));
  const missing = nested.find((list) => list.length) ?? [];
  return { notServer: true, missing: missing.length ? missing : ['server_properties'] };
}

export type CheckOutcome =
  | { kind: 'ok'; path: string; token: string }
  | { kind: 'permission'; path: string; command: string }
  | { kind: 'problem'; path: string; message: MessageId };

const CHECK_PROBLEMS: Record<string, MessageId> = {
  not_found: 'vesta-server.import.path-not-found',
  not_directory: 'vesta-server.import.path-not-folder',
  protected: 'vesta-server.import.path-protected',
};

/** The machine's answer about a typed path, or an honest fallback for anything unexpected. */
export function readFolderCheck(reply: unknown, typed: string): CheckOutcome {
  const value = (reply ?? {}) as Record<string, unknown>;
  const path = text(value.path) ?? typed;
  const token = text(value.folderToken);
  if (value.status === 'ok' && token) return { kind: 'ok', path, token };
  if (value.status === 'permission_needed') return { kind: 'permission', path, command: text(value.remediationCommand) ?? importRootCommand(typed) };
  return { kind: 'problem', path, message: CHECK_PROBLEMS[String(value.status)] ?? 'vesta-server.import.path-not-found' };
}

// ------------------------------------------------------------------ import: review

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
  launch_unresolved: 'vesta-server.blocker.launch',
  java_unresolved: 'vesta-server.blocker.java',
  not_minecraft_server: 'vesta-server.blocker.not-minecraft',
  memory_budget_exceeded: 'vesta-server.blocker.memory',
  memory_invalid: 'vesta-server.blocker.memory',
  memory_unresolved: 'vesta-server.blocker.memory-unknown',
  source_changed: 'vesta-server.blocker.changed',
  source_too_large: 'vesta-server.blocker.too-large',
  unsafe_path: 'vesta-server.blocker.unsafe',
  source_port_listening: 'vesta-server.blocker.source-listening',
  source_recently_active: 'vesta-server.blocker.source-active',
  world_outside_source: 'vesta-server.blocker.world-outside',
  launch_arguments_unsupported: 'vesta-server.blocker.launch-arguments',
};
/** Every blocker code the machine documents; each has its own line above. */
export const KNOWN_BLOCKERS = Object.keys(blockerMessages);

const CUSTOMIZE = ['game_port_in_use', 'port_unresolved', 'port_state_unknown', 'memory_budget_exceeded', 'memory_invalid'];

/** One plain fix per blocker code; unknown codes still get a readable line. */
export function blockerFix(code: string, sourcePath: string, missing: readonly string[] = []): BlockerFix {
  if (code === 'not_minecraft_server' && missing.length) {
    const use = folderUse({ missing });
    if (use && !use.usable) return { code, message: use.reason };
  }
  const message = blockerMessages[code] ?? 'vesta-server.blocker.other';
  if (code === 'source_unreadable') return { code, message, command: importRootCommand(sourcePath) };
  if (CUSTOMIZE.includes(code)) return { code, message, customize: true };
  return { code, message };
}

const warningMessages: Record<string, MessageId> = {
  disable_amp_auto_restart: 'vesta-server.warning.auto-restart',
  rcon_disabled: 'vesta-server.warning.rcon',
  source_process_unknown: 'vesta-server.warning.process-unknown',
  bind_address_cleared: 'vesta-server.warning.bind-cleared',
};
export const KNOWN_WARNINGS = Object.keys(warningMessages);
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

export function reviewSummary(review: ImportReview): ReviewSummary {
  const detected = (review.detected ?? {}) as Record<string, unknown>;
  const runtime = (review.runtime ?? {}) as Record<string, unknown>;
  const loader = text(detected.loader) ?? text(detected.software);
  const minecraftVersion = text(detected.minecraftVersion);
  return {
    software: softwareName(loader) ?? (minecraftVersion ? SOFTWARE.vanilla! : null),
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

/** What the machine is doing during a copy, in words. */
export function importPhase(phase: string | null | undefined): MessageId {
  if (phase === 'copy') return 'vesta-server.import.phase-copy';
  if (phase === 'configure' || phase === 'register' || phase === 'start') return 'vesta-server.import.phase-finish';
  return 'vesta-server.import.phase-check';
}

// Shown without review details, so none of these lines take arguments.
const jobErrors: Record<string, MessageId> = {
  game_port_in_use: 'vesta-server.import.port-busy',
  memory_budget_exceeded: 'vesta-server.blocker.memory',
  source_running: 'vesta-server.blocker.source-running',
  source_state_unknown: 'vesta-server.blocker.source-unknown',
  port_state_unknown: 'vesta-server.blocker.port-unknown',
  source_changed: 'vesta-server.blocker.changed',
  insufficient_space: 'vesta-server.import.disk-full',
  source_too_large: 'vesta-server.blocker.too-large',
  unsafe_path: 'vesta-server.blocker.unsafe',
  start_failed: 'vesta-server.import.start-failed',
  imports_unavailable: 'vesta-server.import.unavailable',
  import_jobs_saturated: 'vesta-server.import.busy',
  worker_unavailable: 'vesta-server.import.busy',
  unavailable: 'vesta-server.import.busy',
  eula_required: 'vesta-server.import.eula-needed',
  warnings_unacknowledged: 'vesta-server.import.confirm-all',
  source_stop_confirmation_required: 'vesta-server.import.confirm-all',
  plan_blocked: 'vesta-server.import.fix-first',
  plan_expired: 'vesta-server.import.out-of-date',
  confirmation_invalid: 'vesta-server.import.out-of-date',
  idempotency_conflict: 'vesta-server.import.out-of-date',
  conflict: 'vesta-server.import.out-of-date',
  server_capacity_reached: 'vesta-server.import.full',
  import_job_not_found: 'vesta-server.import.gone',
};
/** Every job and route error code the machine documents; each has its own line above. */
export const KNOWN_IMPORT_ERRORS = Object.keys(jobErrors);

/** A job error or command failure as one friendly line. */
export function importProblem(reason: unknown): MessageId {
  if (typeof reason === 'string') return jobErrors[reason] ?? 'vesta-server.import.failed';
  const error = toServerError(reason);
  if (error.reason && jobErrors[error.reason]) return jobErrors[error.reason]!;
  if (error.code === 'not_found') return 'vesta-server.import.gone';
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
