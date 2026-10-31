// Pure rules for the server Files tab: game-root-relative paths, file kinds, size
// limits, capability gating and the validator-based save flow. The agent enforces
// all of this again; these rules keep the UI from offering what it would refuse.
import type { MessageId } from '../../localization/messages';
import { gate } from './capabilities';
import type { CapabilityView, FileEntry, ServerCommandError, TextFile, UploadCandidate } from './native';
import { rawProtectedFile } from './native-files';

/** Whole-file text reads (and so the editor) are bounded by the agent's legacy read. */
export const TEXT_READ_LIMIT = 1_048_576;
/** Writes and upload totals. */
export const WRITE_LIMIT = 16 * 1_048_576;
export const UPLOAD_CHUNK = 1_048_576;

/** Admission documents have their own structured editors and are refused by generic file routes. */
const PROTECTED = ['server.properties', 'whitelist.json', 'banned-players.json', 'banned-ips.json', 'ops.json'];
const DEVICE_NAMES = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

/**
 * A single portable path segment: printable ASCII without separators, Windows-reserved
 * characters, dot segments, trailing dots/spaces or device aliases.
 */
export function isSafeSegment(segment: string): boolean {
  if (!segment || segment.length > 255) return false;
  if (segment === '.' || segment === '..') return false;
  if (!/^[\x20-\x7e]+$/.test(segment)) return false;
  if (/[/\\:*?"<>|]/.test(segment)) return false;
  if (/[. ]$/.test(segment) || segment.startsWith(' ')) return false;
  return !DEVICE_NAMES.test(segment);
}

/** Splits a stored path into segments; null when any segment is unsafe. `''` is the root. */
export function splitPath(path: string): string[] | null {
  if (path === '') return [];
  const segments = path.split('/');
  return segments.every(isSafeSegment) ? segments : null;
}

export const joinPath = (segments: readonly string[]) => segments.join('/');

/** The path of `name` inside `directory`, or null when `name` is not one safe segment. */
export function childPath(directory: string, name: string): string | null {
  const trimmed = name.trim();
  if (!isSafeSegment(trimmed)) return null;
  return directory ? `${directory}/${trimmed}` : trimmed;
}

export const parentPath = (path: string) => path.split('/').slice(0, -1).join('/');
export const baseName = (path: string) => path.split('/').at(-1) ?? '';

/** Route segments for a directory: each segment URI-encoded on its own. */
export const encodeRouteSegments = (path: string) => (path ? path.split('/').map(encodeURIComponent) : []);

/**
 * Decodes route segments back to a game-root path. Any malformed, encoded separator or
 * dot segment rejects the whole route (null), so a crafted URL never escapes the root.
 */
export function decodeRouteSegments(segments: readonly (string | undefined)[]): string | null {
  const decoded: string[] = [];
  for (const raw of segments) {
    if (raw === undefined || raw === '') continue;
    let value: string;
    try { value = decodeURIComponent(raw); } catch { return null; }
    if (!isSafeSegment(value)) return null;
    decoded.push(value);
  }
  return joinPath(decoded);
}

export function isProtectedPath(path: string): boolean {
  return path.split('/').some((segment) => PROTECTED.includes(segment.toLowerCase()));
}

/** `raw`: editable here with confirmation. `redirect`: locked, managed in Settings. `none`: an ordinary file. */
export type ProtectedAccess = 'none' | 'raw' | 'redirect';

/**
 * Trusts the agent's flag when it sends one (`confirm_edit` for the root documents); an older
 * agent without it keeps every protected name locked. Raw access needs config.edit plus
 * files.read and files.overwrite, which owners and admins have by default.
 */
export function protectedAccess(view: CapabilityView | undefined, path: string, protection?: FileEntry['protection']): ProtectedAccess {
  if (protection === 'normal') return 'none';
  if (!isProtectedPath(path)) return 'none';
  const raw = protection === 'confirm_edit' || (protection === undefined && rawProtectedFile(path));
  const can = (capability: string) => gate(view, capability) === 'allowed';
  return raw && can('config.edit') && can('files.read') && can('files.overwrite') ? 'raw' : 'redirect';
}

/** Where a protected document is managed instead. */
export function protectedHome(path: string): 'settings' | 'players' | null {
  if (!isProtectedPath(path)) return null;
  return baseName(path).toLowerCase() === 'server.properties' ? 'settings' : 'players';
}

export type FileKind = 'directory' | 'text' | 'config' | 'log' | 'archived-log' | 'jar' | 'image' | 'archive' | 'world-data' | 'binary';

const TEXT = new Set(['txt', 'md', 'json', 'json5', 'jsonc', 'mcmeta', 'lang', 'csv', 'xml', 'html', 'js', 'ts', 'sh', 'bat', 'cmd', 'ps1', 'snbt', 'zs', 'kubejs', 'mcfunction', 'secret', 'gitignore', 'env']);
const CONFIG = new Set(['toml', 'yml', 'yaml', 'properties', 'cfg', 'conf', 'ini']);
const IMAGES = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico']);
const ARCHIVES = new Set(['zip', 'gz', 'tar', 'tgz', '7z', 'rar', 'xz', 'bz2', 'mcworld', 'mrpack']);
const WORLD = new Set(['dat', 'dat_old', 'mca', 'mcr', 'nbt', 'lock']);

const extension = (name: string) => {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
};

export function fileKind(path: string, kind: FileEntry['kind'] = 'file'): FileKind {
  if (kind === 'directory') return 'directory';
  const name = baseName(path).toLowerCase();
  if (isLogPath(path)) return name.endsWith('.gz') ? 'archived-log' : 'log';
  const ext = extension(name);
  if (ext === 'jar') return 'jar';
  if (CONFIG.has(ext)) return 'config';
  if (TEXT.has(ext) || name === 'eula.txt' || !ext) return 'text';
  if (ext === 'log') return 'log';
  if (IMAGES.has(ext)) return 'image';
  if (ARCHIVES.has(ext)) return 'archive';
  if (WORLD.has(ext)) return 'world-data';
  return 'binary';
}

export const fileIcon: Record<FileKind, string> = {
  directory: 'icons/content/folder',
  text: 'icons/content/file',
  config: 'icons/content/sliders',
  log: 'icons/content/list',
  'archived-log': 'icons/content/history',
  jar: 'icons/content/cube',
  image: 'icons/content/card-banner',
  archive: 'icons/content/storage',
  'world-data': 'icons/content/globe',
  binary: 'icons/content/file',
};

/** Logs live under `logs/`: `*.log` and rotated `*.log.gz` (read decompressed). */
export function isLogPath(path: string): boolean {
  const segments = path.toLowerCase().split('/');
  return segments.length >= 2 && segments[0] === 'logs' && /\.(log|log\.gz|gz)$/.test(segments.at(-1)!);
}

export const isArchivedLog = (path: string) => isLogPath(path) && path.toLowerCase().endsWith('.gz');

/** How a file opens: text editor, read-only log viewer, or download only. */
export function openMode(path: string, entry: Pick<FileEntry, 'kind' | 'size'>): 'directory' | 'editor' | 'log' | 'download' {
  if (entry.kind === 'directory') return 'directory';
  const kind = fileKind(path);
  if (kind === 'log' || kind === 'archived-log') return 'log';
  if ((kind === 'text' || kind === 'config') && Number(entry.size) <= TEXT_READ_LIMIT) return 'editor';
  return 'download';
}

/**
 * Writing a `.jar` under `mods/` or `plugins/` (any depth) or a server JAR in the game
 * root installs code the game will execute.
 */
export function isExecutableContent(path: string): boolean {
  const segments = path.split('/');
  const name = segments.at(-1) ?? '';
  if (!/\.jar$/i.test(name)) return false;
  if (segments.length === 1) return true;
  const top = segments[0].toLowerCase();
  return top === 'mods' || top === 'plugins';
}

/** Folders first, then ASCII case-insensitive name, then exact name (the agent's order). */
export function sortEntries(entries: readonly FileEntry[]): FileEntry[] {
  return entries.toSorted((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
    const lower = a.name.toLowerCase().localeCompare(b.name.toLowerCase(), 'en');
    return lower || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  });
}

export function formatBytes(size: string | number): string {
  const bytes = Number(size);
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/** Why a set of picked files can't be uploaded, or null. */
export function uploadProblem(candidates: readonly Pick<UploadCandidate, 'name' | 'size'>[]): MessageId | null {
  if (!candidates.length) return 'server-files.upload.nothing';
  if (candidates.some((file) => !isSafeSegment(file.name))) return 'server-files.upload.bad-name';
  if (candidates.some((file) => isProtectedPath(file.name))) return 'server-files.protected-name';
  const total = candidates.reduce((sum, file) => sum + Number(file.size), 0);
  return total > WRITE_LIMIT ? 'server-files.upload.too-large' : null;
}

export const chunkCount = (size: string | number) => Math.max(1, Math.ceil(Number(size) / UPLOAD_CHUNK));

/** Problem with a new or renamed name inside a directory listing, or null. */
export function nameProblem(name: string, siblings: readonly Pick<FileEntry, 'name'>[], current?: string): MessageId | null {
  const trimmed = name.trim();
  if (!trimmed) return 'server-files.name.empty';
  if (!isSafeSegment(trimmed)) return 'server-files.name.invalid';
  if (isProtectedPath(trimmed)) return 'server-files.protected-name';
  if (trimmed !== current && siblings.some((entry) => entry.name.toLowerCase() === trimmed.toLowerCase())) return 'server-files.name.exists';
  return null;
}

export interface FileActions {
  open: boolean;
  edit: boolean;
  rename: boolean;
  delete: boolean;
  download: boolean;
}

/** What may be offered for one entry. Directories only open; rename and delete are regular-file only. */
export function fileActions(view: CapabilityView | undefined, path: string, entry: Pick<FileEntry, 'kind' | 'size' | 'protection'>): FileActions {
  const can = (capability: string) => gate(view, capability) === 'allowed';
  const access = protectedAccess(view, path, entry.protection);
  // Raw protected documents open in the editor (with confirmation) but are never renamed or deleted here.
  const isProtected = access !== 'none';
  if (entry.kind === 'directory') return { open: can('files.list'), edit: false, rename: false, delete: false, download: false };
  const read = can('files.read') && access !== 'redirect';
  const mode = openMode(path, entry);
  return {
    open: read && mode !== 'download',
    edit: read && mode === 'editor' && can('files.overwrite'),
    rename: !isProtected && can('files.rename'),
    delete: !isProtected && can('files.delete'),
    download: read,
  };
}

export interface FolderActions {
  newFile: boolean;
  newFolder: boolean;
  upload: boolean;
  trash: boolean;
}

export function folderActions(view: CapabilityView | undefined): FolderActions {
  const can = (capability: string) => gate(view, capability) === 'allowed';
  return { newFile: can('files.create'), newFolder: can('files.mkdir'), upload: can('files.create'), trash: can('files.read') };
}

/** The minimum client surface the save flow needs (fixtures and native both satisfy it). */
export interface TextFileClient {
  fileReadText(connectionId: string, path: string): Promise<TextFile>;
  fileWriteText(connectionId: string, path: string, text: string, expectedSha256: string | null, intentId: string): Promise<{ sha256: string; size: string }>;
}

export type SaveOutcome =
  | { kind: 'saved'; sha256: string; size: string }
  /** The file changed on the server since `validator` was read. `server` is the current copy. */
  | { kind: 'conflict'; server: TextFile }
  /** The file was deleted on the server meanwhile; saving again would recreate it. */
  | { kind: 'gone' };

/**
 * One validator-bound save. A stale validator never overwrites: the current server copy is
 * read back so the user can compare and choose. "Overwrite with mine" saves again with
 * `server.sha256` as the fresh validator; it can conflict again if the file moved on.
 */
export async function saveTextFile(
  client: TextFileClient, connectionId: string, path: string, text: string, validator: string | null, intentId: string,
): Promise<SaveOutcome> {
  return saveText(serverTextSource(client, connectionId), path, text, validator, intentId);
}

/**
 * Where an editor reads and writes text: the server's game files, or a modpack's override
 * files. The editor and save/compare flow are the same; only the store differs.
 */
export interface TextFileSource {
  /** `server` files may be protected documents and link to Settings; other stores never are. */
  kind: 'server' | 'pack';
  read(path: string): Promise<TextFile>;
  /** Rejects with `stale_target` when `validator` no longer matches. */
  write(path: string, text: string, validator: string | null, intentId: string): Promise<{ sha256: string; size: string }>;
}

export const serverTextSource = (client: TextFileClient, connectionId: string): TextFileSource => ({
  kind: 'server',
  read: (path) => client.fileReadText(connectionId, path),
  write: (path, text, validator, intentId) => client.fileWriteText(connectionId, path, text, validator, intentId),
});

/** The validator-bound save over any text source. */
export async function saveText(source: TextFileSource, path: string, text: string, validator: string | null, intentId: string): Promise<SaveOutcome> {
  try {
    const change = await source.write(path, text, validator, intentId);
    return { kind: 'saved', sha256: change.sha256, size: change.size };
  } catch (reason) {
    if ((reason as ServerCommandError | undefined)?.code !== 'stale_target') throw reason;
    try {
      return { kind: 'conflict', server: await source.read(path) };
    } catch (readError) {
      if ((readError as ServerCommandError | undefined)?.code === 'not_found') return { kind: 'gone' };
      throw readError;
    }
  }
}

/** Line-level summary for the compare dialog: how many lines differ between the two copies. */
export function changedLineCount(left: string, right: string): number {
  const a = left.split('\n');
  const b = right.split('\n');
  let changed = 0;
  for (let index = 0; index < Math.max(a.length, b.length); index++) if (a[index] !== b[index]) changed++;
  return changed;
}

// ------------------------------------------------------------------ upload plan (picked or dropped)

/** What to do when an upload's name is already taken in its folder. */
export type ConflictChoice = 'replace' | 'keep-both' | 'skip';

/** A name already in the target folder: a file can be replaced, a folder cannot. */
export type UploadConflict = 'file' | 'directory';

export interface PlannedUpload {
  localId: string;
  /** Game-root-relative destination. */
  path: string;
  /** `replace` moves the current file to the trash first, then creates the upload. */
  mode: 'create' | 'replace';
}

export interface UploadPlan {
  uploads: PlannedUpload[];
  /** Folders to create first, parents before children. Existing ones are fine. */
  folders: string[];
  /** Candidates whose name is taken and that have no choice yet. */
  unresolved: string[];
  skipped: string[];
  problem: MessageId | null;
}

/** Display path of a candidate inside its drop, e.g. `plugins/LuckPerms/config.yml`. */
export const uploadLabel = (candidate: Pick<UploadCandidate, 'name' | 'folder'>) =>
  candidate.folder ? `${candidate.folder}/${candidate.name}` : candidate.name;

/** Only loose files can collide with the listing we have; files in dropped folders go to new or merged folders. */
export function uploadConflict(candidate: Pick<UploadCandidate, 'name' | 'folder'>, siblings: readonly FileEntry[]): UploadConflict | null {
  if (candidate.folder) return null;
  const taken = siblings.find((entry) => entry.name.toLowerCase() === candidate.name.toLowerCase());
  return taken ? taken.kind : null;
}

/** `name (2).ext`, the first such name not in `taken` (lower-cased names). */
export function keepBothName(name: string, taken: ReadonlySet<string>): string {
  const dot = name.lastIndexOf('.');
  const [stem, extension] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
  for (let index = 2; ; index++) {
    const next = `${stem} (${index})${extension}`;
    if (!taken.has(next.toLowerCase())) return next;
  }
}

/**
 * Turns picked or dropped files into the steps the existing upload path runs: folders to
 * create, then one create (or trash-then-create) per file. Limits and name rules are the
 * same as for picked files; protected admission documents stay refused anywhere in a path.
 */
export function planUploads(
  directory: string,
  candidates: readonly UploadCandidate[],
  siblings: readonly FileEntry[],
  choices: Readonly<Record<string, ConflictChoice>>,
): UploadPlan {
  const plan: UploadPlan = { uploads: [], folders: [], unresolved: [], skipped: [], problem: null };
  const taken = new Set(siblings.map((entry) => entry.name.toLowerCase()));
  const existingFolders = new Set(siblings.filter((entry) => entry.kind === 'directory').map((entry) => entry.name.toLowerCase()));
  const folders = new Set<string>();
  const active: UploadCandidate[] = [];
  for (const candidate of candidates) {
    const segments = candidate.folder ? candidate.folder.split('/') : [];
    if (!segments.every(isSafeSegment)) { plan.problem ??= 'server-files.upload.bad-name'; continue; }
    const conflict = uploadConflict(candidate, siblings);
    const choice = conflict ? choices[candidate.localId] : undefined;
    if (conflict && (!choice || (choice === 'replace' && conflict === 'directory'))) { plan.unresolved.push(candidate.localId); active.push(candidate); continue; }
    if (choice === 'skip') { plan.skipped.push(candidate.localId); continue; }
    active.push(candidate);
    let name = candidate.name;
    if (choice === 'keep-both') { name = keepBothName(name, taken); taken.add(name.toLowerCase()); }
    const relative = [...segments, name].join('/');
    const path = directory ? `${directory}/${relative}` : relative;
    if (isProtectedPath(relative)) plan.problem ??= 'server-files.protected-name';
    segments.forEach((_, index) => {
      if (index === 0 && existingFolders.has(segments[0]!.toLowerCase())) return;
      const folder = segments.slice(0, index + 1).join('/');
      folders.add(directory ? `${directory}/${folder}` : folder);
    });
    plan.uploads.push({ localId: candidate.localId, path, mode: choice === 'replace' ? 'replace' : 'create' });
  }
  plan.folders = [...folders].sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
  // Skipped files don't count towards the limit; skipping everything is not a problem, just nothing to do.
  const rules = active.length ? uploadProblem(active) : null;
  plan.problem = candidates.length ? rules ?? plan.problem : 'server-files.upload.nothing';
  return plan;
}
