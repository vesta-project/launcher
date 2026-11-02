import { contentPathKind, isContentEntry } from './content-kind';
// Pure decisions for the server Resources tab and the custom-JAR flow: which kinds a server
// lists, the rows (grouped, filtered, searched), what each row may do, the staged-change
// labels, update availability and the request each action sends. No IO here.
import type { MessageId } from '../../localization/messages';
import { serverVersion } from '../browse/install-targets';
import type { ResourceProject, ResourceVersion } from '../browse/browse-model';
import { gate } from './capabilities';
import { errorMessage } from './errors';
import type { SoftwareState } from './hosting-native';
import type { CapabilityView, FileEntry, ServerCommandError, ServerSnapshot } from './native';
import type {
  ContentInstallRequest, ContentMutation, ContentPending, ContentProvider, CustomJarPlan, ServerContentEntry,
  ServerContentInventory, ServerContentKind,
} from './native-content';

/* ---- Kinds and filters ---- */

export type ContentFilter = 'all' | ServerContentKind;
export const CONTENT_KINDS: readonly ServerContentKind[] = ['mod', 'plugin', 'datapack', 'resource_pack', 'shader'];

export const kindLabel: Record<ServerContentKind, MessageId> = {
  mod: 'server-content.kind-mod',
  plugin: 'server-content.kind-plugin',
  datapack: 'server-content.kind-datapack',
  resource_pack: 'server-pack.kind-resource-pack',
  shader: 'server-pack.kind-shader',
};
export const groupLabel: Record<ServerContentKind, MessageId> = {
  mod: 'server-content.group-mods',
  plugin: 'server-content.group-plugins',
  datapack: 'server-content.group-datapacks',
  resource_pack: 'server-pack.kind-resource-pack',
  shader: 'server-pack.kind-shader',
};

/**
 * Kinds the server can hold: what its software supports, plus anything already on disk (an
 * unsupported leftover is still shown, never hidden). Datapacks work on every server.
 */
export function contentKinds(inventory: Pick<ServerContentInventory, 'capabilities' | 'items'>): ServerContentKind[] {
  const present = new Set(inventory.items.filter(isContentEntry).map((item) => item.kind));
  return CONTENT_KINDS.filter((kind) =>
    kind === 'datapack'
    || present.has(kind)
    || (kind === 'mod' && inventory.capabilities.modsSupported)
    || (kind === 'plugin' && inventory.capabilities.pluginsSupported));
}

/** The kind Add content opens Browse on: the software's own kind first. */
export function primaryKind(inventory: Pick<ServerContentInventory, 'capabilities'>): 'mod' | 'plugin' | 'datapack' {
  if (inventory.capabilities.modsSupported) return 'mod';
  if (inventory.capabilities.pluginsSupported) return 'plugin';
  return 'datapack';
}

/* ---- Rows ---- */

/** Filename without the disabled suffix and archive extension. */
export function baseName(filename: string): string {
  return filename.replace(/\.disabled$/i, '').replace(/\.(jar|zip)$/i, '');
}

/** The provider's name when known, then the declared name, then the file's own name. */
export function contentName(entry: Pick<ServerContentEntry, 'filename' | 'declared'>, project?: Pick<ResourceProject, 'name'> | null): string {
  return project?.name || entry.declared?.name || baseName(entry.filename);
}

/** Entries are keyed by path, which a toggle renames; the pending change id follows the item. */
export const entryKey = (entry: Pick<ServerContentEntry, 'path'>) => entry.path.replace(/\.disabled$/i, '');

export interface ContentRowModel {
  key: string;
  entry: ServerContentEntry;
  name: string;
  version: string | null;
  identified: boolean;
}

export type ContentListRow =
  | { id: string; kind: 'group'; group: ServerContentKind; count: number }
  | { id: string; kind: 'entry'; row: ContentRowModel };

export interface ContentListInput {
  filter: ContentFilter;
  query: string;
  /** Provider project names and versions, when loaded. */
  project?: (entry: ServerContentEntry) => Pick<ResourceProject, 'name'> | undefined;
  version?: (entry: ServerContentEntry) => Pick<ResourceVersion, 'version_number'> | undefined;
}

/** One collator for every comparison: `localeCompare` with options builds a new one per call. */
const nameOrder = new Intl.Collator(undefined, { sensitivity: 'base' });
const searchText = new WeakMap<ContentRowModel, string>();
const searchable = (row: ContentRowModel) => {
  let text = searchText.get(row);
  if (text === undefined) searchText.set(row, text = `${row.name} ${row.entry.filename} ${row.version ?? ''}`.toLowerCase());
  return text;
};

/** Sorted row models for a kind filter, before any search. Typing filters these, never rebuilds them. */
export function contentModels(items: readonly ServerContentEntry[], input: Omit<ContentListInput, 'query'>): ContentRowModel[] {
  return items
    .filter(isContentEntry)
    .filter((entry) => input.filter === 'all' || entry.kind === input.filter)
    .map((entry): ContentRowModel => ({
      key: entryKey(entry),
      entry,
      name: contentName(entry, input.project?.(entry)),
      version: entry.declared?.version ?? input.version?.(entry)?.version_number ?? null,
      identified: !!entry.provider,
    }))
    .toSorted((a, b) => nameOrder.compare(a.name, b.name) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** Keeps the previous model object for rows that did not change, so provider names arriving
 *  in batches only touch the rows they name. */
export function reuseContentModels(previous: readonly ContentRowModel[] | undefined, next: ContentRowModel[]): ContentRowModel[] {
  if (!previous?.length) return next;
  const byKey = new Map(previous.map((row) => [row.key, row]));
  const reused = next.map((row) => {
    const old = byKey.get(row.key);
    return old && old.entry === row.entry && old.name === row.name && old.version === row.version && old.identified === row.identified ? old : row;
  });
  return reused.length === previous.length && reused.every((row, index) => row === previous[index]) ? previous as ContentRowModel[] : reused;
}

export function searchContentRows(rows: readonly ContentRowModel[], query: string): ContentRowModel[] {
  const needle = query.trim().toLowerCase();
  return needle ? rows.filter((row) => searchable(row).includes(needle)) : [...rows];
}

export function contentRows(items: readonly ServerContentEntry[], input: ContentListInput): ContentRowModel[] {
  return searchContentRows(contentModels(items, input), input.query);
}

const listEntries = new WeakMap<ContentRowModel, Extract<ContentListRow, { kind: 'entry' }>>();
/** Rows in kind order; with "all" and more than one kind present, each kind gets a header.
 *  Entry wrappers are reused per model, so a search keeps unchanged rows' identity (no re-render). */
export function groupContentRows(rows: readonly ContentRowModel[], filter: ContentFilter): ContentListRow[] {
  const kinds = CONTENT_KINDS.filter((kind) => rows.some((row) => row.entry.kind === kind));
  const headed = filter === 'all' && kinds.length > 1;
  return kinds.flatMap((kind) => {
    const own = rows.filter((row) => row.entry.kind === kind);
    return [
      ...(headed ? [{ id: `group:${kind}`, kind: 'group' as const, group: kind, count: own.length }] : []),
      ...own.map((row) => {
        let entry = listEntries.get(row);
        if (!entry) listEntries.set(row, entry = { id: `entry:${row.key}`, kind: 'entry' as const, row });
        return entry;
      }),
    ];
  });
}

export function contentList(items: readonly ServerContentEntry[], input: ContentListInput): ContentListRow[] {
  return groupContentRows(contentRows(items, input), input.filter);
}

/* ---- Staged changes ---- */

export const pendingLabel: Record<ContentPending, MessageId> = {
  install: 'server-content.pending-install',
  remove: 'server-content.pending-remove',
  update: 'server-content.pending-update',
  enable: 'server-content.pending-enable',
  disable: 'server-content.pending-disable',
};

/** Changes waiting for the next start or restart, and whether a restart would apply them now. */
export function pendingSummary(items: readonly Pick<ServerContentEntry, 'pending' | 'pendingError'>[], snapshot: Pick<ServerSnapshot, 'status'>) {
  const pending = items.filter((item) => item.pending);
  const running = !!snapshot.status && snapshot.status.state !== 'stopped';
  return { count: pending.length, failed: pending.filter((item) => item.pendingError).length, running };
}

/* ---- Gates ---- */

export interface ContentGates {
  /** Minecraft runs: JAR changes are staged until the next start or restart. */
  running: boolean;
  install: boolean;
  update: boolean;
  remove: boolean;
  toggle: boolean;
  cancel: boolean;
  identify: boolean;
  /** Datapack toggles go through the world, with their own offline / running support. */
  datapackToggle: boolean;
}

/**
 * The agent's capability flags, narrowed by the caller's own access. These are hints only;
 * the server rechecks the exact scopes on every request.
 */
export function contentGates(
  inventory: Pick<ServerContentInventory, 'capabilities'>,
  snapshot: Pick<ServerSnapshot, 'status'> & { capabilities?: CapabilityView },
): ContentGates {
  const caps = inventory.capabilities;
  const allowed = gate(snapshot.capabilities, 'content.install') === 'allowed';
  const running = !!snapshot.status && snapshot.status.state !== 'stopped';
  const generation = snapshot.status?.generation ?? null;
  const datapack = running ? (caps.datapackToggleRunning ?? caps.toggle) && generation !== null : caps.datapackToggleOffline ?? caps.toggle;
  return {
    running,
    install: allowed && caps.install,
    update: allowed && caps.update,
    remove: allowed && caps.remove,
    toggle: allowed && caps.toggle,
    cancel: allowed && caps.cancel,
    identify: allowed && caps.list,
    datapackToggle: allowed && datapack,
  };
}

export interface RowActions {
  toggle: boolean;
  remove: boolean;
  update: boolean;
  cancel: boolean;
  identify: boolean;
  /** The server modpack owns this file: remove and update go through the modpack instead. */
  managed: boolean;
}

/**
 * Whether the server modpack link owns an inventory row: the agent's `modpackOwned` flag, or
 * the link's recorded path (agents that do not mark rows yet). User additions never match.
 */
export const isModpackOwned = (entry: Pick<ServerContentEntry, 'path' | 'modpackOwned'>, owned?: ReadonlySet<string>) =>
  (entry.modpackOwned === true || !!owned?.has(entry.path)) && (contentPathKind(entry.path) !== null || (entry.path.includes('/datapacks/') && !entry.path.split('/').at(-1)?.includes('.')));

/**
 * What one row may do. A queued change blocks others until it applies or is cancelled; an
 * entry the bounded scan did not fingerprint gets no destructive request (no guessed validator).
 */
export function rowActions(entry: ServerContentEntry, gates: ContentGates, hasUpdate: boolean, managed = false): RowActions {
  const queued = !!entry.pending;
  const validated = entry.sha256 !== null;
  const jar = entry.kind !== 'datapack';
  return {
    managed,
    toggle: !queued && entry.enabled !== null && (jar ? gates.toggle && validated : gates.datapackToggle),
    remove: !queued && validated && gates.remove && !managed,
    update: !queued && validated && hasUpdate && gates.update && !!entry.provider && !managed,
    cancel: queued && !!entry.pendingId && gates.cancel,
    identify: !entry.provider && jar && gates.identify && entry.pending !== 'install',
  };
}

/* ---- Updates ---- */

/**
 * The newer provider version this server would take, or undefined when the item is current,
 * unidentified, or its version list is unknown. Uses the server's software and Minecraft
 * version, never a client pack loader.
 */
export function contentUpdate(
  entry: Pick<ServerContentEntry, 'kind' | 'provider'>,
  versions: readonly ResourceVersion[] | undefined,
  inventory: Pick<ServerContentInventory, 'minecraftVersion' | 'software'>,
): ResourceVersion | undefined {
  if (!entry.provider || !versions?.length) return undefined;
  const best = serverVersion(versions, { minecraftVersion: inventory.minecraftVersion, software: inventory.software }, entry.kind === 'resource_pack' ? 'resourcepack' : entry.kind, entry.provider.provider);
  if (!best || best.id === entry.provider.versionId) return undefined;
  // Only offer newer: an installed version missing from the list is left alone.
  const installed = versions.findIndex((version) => version.id === entry.provider!.versionId);
  const candidate = versions.indexOf(best);
  return installed === -1 || candidate < installed ? best : undefined;
}

/* ---- Requests ---- */

export function mutationRequest(entry: ServerContentEntry, action: ContentMutation['action']): ContentMutation | null {
  if (entry.sha256 === null || entry.kind === 'datapack' && action !== 'remove') return null;
  return { action, kind: entry.kind, path: entry.path, expectedSha256: entry.sha256 };
}

export function updateRequest(entry: ServerContentEntry, version: Pick<ResourceVersion, 'id'>): ContentInstallRequest | null {
  if (!entry.provider || entry.sha256 === null) return null;
  return { provider: entry.provider.provider, projectId: entry.provider.projectId, versionId: version.id, kind: entry.kind, path: entry.path, expectedSha256: entry.sha256 };
}

/** The world's id for a datapack file: `file/<filename>`. */
export const datapackId = (entry: Pick<ServerContentEntry, 'filename'>) => `file/${entry.filename}`;

/** Providers to look projects up on, with the ids each needs. */
export function providerLookups(items: readonly Pick<ServerContentEntry, 'provider'>[]): Map<ContentProvider['provider'], string[]> {
  const lookups = new Map<ContentProvider['provider'], string[]>();
  for (const item of items) {
    if (!item.provider) continue;
    const ids = lookups.get(item.provider.provider) ?? [];
    if (!ids.includes(item.provider.projectId)) ids.push(item.provider.projectId);
    lookups.set(item.provider.provider, ids);
  }
  return lookups;
}

/* ---- Errors ---- */

const contentReasons: Record<string, MessageId> = {
  content_mods_unsupported: 'server-content.error-mods-unsupported',
  content_plugins_unsupported: 'server-content.error-plugins-unsupported',
};

export function contentErrorMessage(error: Pick<ServerCommandError, 'code'> & { reason?: string | null }): MessageId {
  const known = error.reason ? contentReasons[error.reason] : undefined;
  if (known) return known;
  if (error.code === 'stale_target') return 'server-content.error-stale';
  return errorMessage(error);
}

/* ---- Custom server JAR ---- */

export type LaunchKind = { kind: 'custom'; path: string } | { kind: 'managed' } | { kind: 'original' };

/** What the current launch is: a custom JAR from the server files, managed software, or the original setup. */
export function launchKind(state: Pick<SoftwareState, 'current'> | undefined): LaunchKind {
  const current = state?.current;
  if (current?.customJar?.path) return { kind: 'custom', path: current.customJar.path };
  return current?.software ? { kind: 'managed' } : { kind: 'original' };
}

/** A game-relative path inside the server root: no absolute, parent, drive or backslash segments. */
export function isServerJarPath(path: string): boolean {
  if (!path.toLowerCase().endsWith('.jar') || path.startsWith('/') || path.includes('\\') || path.includes(':')) return false;
  return path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

/** A picker listing: folders first, then only `.jar` files; everything else is left out. */
export function jarPickerEntries(entries: readonly FileEntry[]): FileEntry[] {
  return entries
    .filter((entry) => entry.kind === 'directory' || entry.name.toLowerCase().endsWith('.jar'))
    .toSorted((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'directory' ? -1 : 1));
}

const jarRisks: Record<string, MessageId> = {
  executes_owner_selected_server_jar: 'server-hosting.custom-jar-risk-executes',
};

export interface CustomJarReview {
  path: string | null;
  mainClass: string | null;
  risks: MessageId[];
}

/** What the agent reported for a plan, as the confirmation shows it. */
export function customJarReview(plan: Pick<CustomJarPlan, 'customJar' | 'mainClass' | 'risks'>): CustomJarReview {
  return {
    path: plan.customJar?.path ?? null,
    mainClass: plan.mainClass,
    risks: plan.risks.map((risk) => jarRisks[risk] ?? 'server-hosting.warning-other'),
  };
}

/** Placement and compatibility are separate: installing on a server does not imply server-only. */
export function contentSide(entry: Pick<ServerContentEntry, 'kind' | 'declared'>, project?: Pick<ResourceProject, 'environment'>): MessageId {
  if (entry.kind === 'plugin') return 'server-content.side-server';
  if (entry.kind === 'datapack') return 'server-content.side-world';
  const side = entry.declared?.side;
  if (side === '*' || side === 'both') return 'server-content.side-both';
  if (side === 'server' || side === 'dedicated_server') return 'server-content.side-server';
  if (side === 'client') return 'server-content.side-client';
  const env = project?.environment;
  if (env?.server_requirement === 'unsupported') return 'server-content.side-client';
  if (env?.client_requirement === 'unsupported') return 'server-content.side-server';
  if (env?.client_requirement && env.server_requirement) return 'server-content.side-both';
  return 'server-content.side-unknown';
}
