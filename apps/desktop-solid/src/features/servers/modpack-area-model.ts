import { contentPathKind, isContentEntry } from './content-kind';
// Pure decisions for a server's Modpack area. Two independent, optional links:
//  - the server modpack: the server installation linked to a modpack, like an instance linked
//    to a modpack (link review, installed vs pending version, update, ownership, unlink);
//  - the client pack: what players get: none, the server's modpack, or a custom Vesta pack
//    (draft, override files, publish review).
// No IO or reactivity; the pages own those.
import type { MessageId } from '../../localization/messages';
import type { CapabilityView, ServerCommandError } from './native';
import type { PackSyncApply, PackSyncChange, PackSyncPreview } from './native-pack-sync';
import { canInstallServerModpack, gate } from './capabilities';
import type { ContentProvider } from './native-content';
import type {
  ClientPackConfig, PackArchiveInspection, PackDiff, PackEntry, PackEntryKind, PackInstallApply, PackInstallPlan, PackInstallSource,
  PackManifest, PackLoader, PackOverrideFile, PackOverrideRoot, PackPreview, PackPublish, PackPublishOutcome, PackWorkspace,
  ServerModpackUpdate, ServerModpackVersion,
} from './native-pack';

/* ---- Rollout ---- */

/**
 * The single switch for the "Same as the server's modpack" player offering. The agent fails
 * closed (`pack_unavailable`) until its independent delivery stream ships, so the choice is
 * shown disabled ("Coming soon"). Flip to true once MODPACK-REDESIGN.md says delivery is live.
 */
export const SERVER_MODPACK_DELIVERY_LIVE = true;

/* ---- Sections ---- */

/** Server modpack (the installation link) and Client pack (what players get) are separate. */
export type ModpackSection = 'server' | 'client';

/**
 * `/servers/:id/pack` is the server modpack; `/pack/client` the client pack, whose custom
 * workspace sections keep their own segments (`/pack/content`, `/pack/files`, `/pack/versions`).
 */
export function modpackSection(item: string | undefined): ModpackSection {
  return item === 'client' || item === 'content' || item === 'files' || item === 'versions' ? 'client' : 'server';
}

export const serverModpackPath = (id: string) => `/servers/${id}/pack`;

/* ---- Server modpack link ---- */

/**
 * `installing`: the first link is staged and nothing is confirmed yet. `updating`: a confirmed
 * version is installed and the reviewed next one waits for a restart. Both block replan/unlink.
 */
export type ServerLinkPhase = 'unlinked' | 'installing' | 'updating' | 'installed';

export interface ServerLinkView {
  phase: ServerLinkPhase;
  /** What to name the link: the installed identity, else the pending one. */
  source: PackInstallSource | null;
  installed: ServerModpackVersion | null;
  pending: ServerModpackVersion | null;
  pendingIds: string[];
  /** Paths the link installed and therefore owns (user additions are never listed). */
  owned: string[];
  /** A link/update review or an unlink can start (nothing waits for a restart). */
  canChange: boolean;
}

/**
 * The server's own modpack link. Older agents send only the selected `source` + `state`; a
 * staged one is then pending with no confirmed version, never a made-up installed one.
 */
export function serverLinkView(workspace: PackWorkspace | undefined): ServerLinkView {
  const link = workspace?.serverModpack ?? null;
  if (!link) return { phase: 'unlinked', source: null, installed: null, pending: null, pendingIds: [], owned: [], canChange: true };
  const selected = { source: link.source, displayVersion: link.displayVersion };
  const installed = link.installed !== undefined ? link.installed : link.state === 'installed' ? selected : null;
  const pending = link.pending !== undefined ? link.pending : link.state === 'staged_until_restart' ? selected : null;
  const phase: ServerLinkPhase = pending ? (installed ? 'updating' : 'installing') : 'installed';
  return {
    phase, source: (installed ?? pending ?? selected).source, installed, pending, pendingIds: link.pendingIds ?? [],
    owned: Object.keys(link.files ?? {}).filter(path => contentPathKind(path) !== null).sort(), canChange: !pending,
  };
}

export type LinkSourceKind = 'modrinth' | 'curseforge' | 'upload' | 'vesta';
export function linkSourceKind(source: PackInstallSource): LinkSourceKind {
  if (source.source === 'provider') return source.provider;
  return source.source === 'uploaded_archive' ? 'upload' : 'vesta';
}
/** Names for links without a provider project. */
export const linkSourceLabel: Record<'upload' | 'vesta', MessageId> = {
  upload: 'server-pack.link-source-upload',
  vesta: 'server-pack.link-source-vesta',
};
/** The provider reference of a link, for project names, icons and version lists. */
export const linkProvider = (source: PackInstallSource | null): ContentProvider | null =>
  source?.source === 'provider' ? { provider: source.provider, projectId: source.projectId, versionId: source.versionId } : null;

/** Check for updates → review. `pending` while a reviewed version waits for a restart. */
export type UpdateCheck =
  | { step: 'idle' }
  | { step: 'checking' }
  | { step: 'current' }
  | { step: 'pending' }
  | { step: 'available'; source: PackInstallSource }
  | { step: 'failed'; error: ServerCommandError };

/**
 * `available: null` means no candidate in the agent's bounded provider response, not proof
 * that nothing newer exists anywhere, so the copy says "no newer version found".
 */
export function updateCheckOutcome(update: ServerModpackUpdate): UpdateCheck {
  if (update.pending) return { step: 'pending' };
  return update.available ? { step: 'available', source: update.available } : { step: 'current' };
}

/** Unlink: keep the pack's files as ordinary content, or stage deletion of the files it owns. */
export type UnlinkChoice = 'keep' | 'remove';

/* ---- Client pack mode ---- */

export type ClientPackMode = ClientPackConfig['mode'];
export const clientPackModes: readonly ClientPackMode[] = ['none', 'server-modpack', 'custom'];
/** New servers default to none: a server works without offering players anything. */
export const clientPackMode = (workspace: PackWorkspace | undefined): ClientPackMode => workspace?.clientPack?.mode ?? 'none';

export type ClientModeNote = 'coming-soon' | 'needs-link' | 'no-permission';
export interface ClientModeOption { id: ClientPackMode; enabled: boolean; note: ClientModeNote | null }

/**
 * Each mode and whether this user can pick it. Changing the offering needs publish authority;
 * following the server modpack also needs a link and the delivery rollout flag.
 */
export function clientModeOptions(
  workspace: PackWorkspace | undefined, gates: Pick<ModpackGates, 'publish'>, live = SERVER_MODPACK_DELIVERY_LIVE,
): ClientModeOption[] {
  const linked = !!workspace?.serverModpack;
  const permission: ClientModeNote | null = gates.publish ? null : 'no-permission';
  return clientPackModes.map((id) => {
    if (id !== 'server-modpack') return { id, enabled: gates.publish, note: permission };
    const note: ClientModeNote | null = !live ? 'coming-soon' : !linked ? 'needs-link' : permission;
    return { id, enabled: note === null, note };
  });
}

/**
 * The stored offering. Require-players-to-update belongs to following the server modpack; a
 * custom pack keeps its own required publication and minimum revision on Versions.
 */
export function clientModeRequest(mode: ClientPackMode, requireUpdate = false): ClientPackConfig {
  return { mode, requireUpdate: mode === 'server-modpack' && requireUpdate };
}

/** "Also offer it to players" after a link review; null when players already get it or it is not ours to change. */
export function offerToPlayers(workspace: PackWorkspace | undefined, gates: Pick<ModpackGates, 'publish'>, live = SERVER_MODPACK_DELIVERY_LIVE): ClientModeOption | null {
  if (!gates.publish || clientPackMode(workspace) === 'server-modpack') return null;
  return clientModeOptions(workspace, gates, live).find((option) => option.id === 'server-modpack') ?? null;
}

/* ---- Source ---- */

/**
 * `provider`: a Modrinth/CurseForge pack the server only points at (not hosted).
 * `custom`: a Vesta-hosted draft workspace. `none`: nothing set up yet (first run).
 */
export type PackSourceKind = 'none' | 'provider' | 'custom';

/** Whether the draft holds anything a player would receive. */
export const draftHasContent = (manifest: PackManifest) =>
  manifest.entries.length > 0 || (manifest.overrideFiles ?? []).some((file) => !file.trashed);

/**
 * A provider release stays the source until the owner customizes it: Customize imports it into
 * the draft, which then differs from publication (`pendingPublication`) and edits like a custom
 * pack while the provider release keeps serving players. `started` keeps a fresh empty draft
 * (Start from scratch) out of the first-run screen for the session.
 */
export function packSourceKind(workspace: PackWorkspace | undefined, started = false): PackSourceKind {
  if (!workspace) return 'none';
  if (workspace.providerPack) return workspace.customizingProvider ? 'custom' : 'provider';
  if (workspace.publishedRevision !== '0' || started || draftHasContent(workspace.draft.manifest)) return 'custom';
  return 'none';
}

/** A customized provider pack: the draft is custom, the active release is still the provider's. */
export const customizingProvider = (workspace: PackWorkspace | undefined) =>
  !!workspace?.providerPack && !!workspace.customizingProvider;

/* ---- Sub-tabs ---- */

export type ModpackSubTab = 'overview' | 'content' | 'files' | 'versions';
/** `locked`: shown but needs Customize first. `read-only`: browsable, not editable. */
export type SubTabState = 'ready' | 'read-only' | 'locked';
export interface ModpackSubTabDef { id: ModpackSubTab; label: MessageId; icon: string; state: SubTabState }

const subTabDefs: Record<ModpackSubTab, Omit<ModpackSubTabDef, 'state'>> = {
  overview: { id: 'overview', label: 'server-pack.tab-overview', icon: 'icons/navigation/home' },
  content: { id: 'content', label: 'server-pack.tab-content', icon: 'icons/content/layers' },
  files: { id: 'files', label: 'server-pack.tab-files', icon: 'icons/content/folder' },
  versions: { id: 'versions', label: 'server-pack.tab-versions', icon: 'icons/content/history' },
};

/**
 * The custom client pack's sections. Only Custom has a workspace; None and the server's modpack
 * have nothing to edit here, so they get no sections.
 */
export function clientSubTabs(mode: ClientPackMode, kind: PackSourceKind, canEdit: boolean): ModpackSubTabDef[] {
  return mode === 'custom' ? modpackSubTabs(kind, canEdit) : [];
}

/**
 * Editors get the full workspace; the draft itself needs `pack.edit`. Legacy provider pointers
 * keep Files locked until Customize. Before anything exists only the overview (first run) shows.
 */
export function modpackSubTabs(kind: PackSourceKind, canEdit: boolean): ModpackSubTabDef[] {
  if (!canEdit || kind === 'none') return [{ ...subTabDefs.overview, state: 'ready' }];
  if (kind === 'provider') {
    return [
      { ...subTabDefs.overview, state: 'ready' },
      { ...subTabDefs.content, state: 'read-only' },
      { ...subTabDefs.files, state: 'locked' },
      { ...subTabDefs.versions, state: 'ready' },
    ];
  }
  return (['overview', 'content', 'files', 'versions'] as const).map((id) => ({ ...subTabDefs[id], state: 'ready' as const }));
}

export function resolveSubTab(item: string | undefined, tabs: readonly ModpackSubTabDef[]): ModpackSubTab {
  return tabs.find((tab) => tab.id === item)?.id ?? 'overview';
}

/** Client pack paths; its overview is `/pack/client`. */
export const modpackPath = (id: string, tab: ModpackSubTab) =>
  tab === 'overview' ? `/servers/${id}/pack/client` : `/servers/${id}/pack/${tab}`;

/* ---- Permissions ---- */

export interface ModpackGates {
  edit: boolean;
  build: boolean;
  publish: boolean;
  forceUpdate: boolean;
  download: boolean;
  /** Install a whole pack on the server: owner/administrator with content.install + pack.edit. */
  installOnServer: boolean;
}

export function modpackGates(view: CapabilityView | undefined, role: string | null | undefined): ModpackGates {
  const can = (capability: string) => gate(view, capability) === 'allowed';
  return {
    edit: can('pack.edit'),
    build: can('pack.build'),
    publish: can('pack.build') && can('pack.publish'),
    forceUpdate: can('pack.force_update'),
    download: can('pack.download') || can('pack.access'),
    installOnServer: canInstallServerModpack(view, role),
  };
}

/* ---- First run ---- */

export type FirstRunChoice = 'provider' | 'link' | 'upload' | 'scratch';

/**
 * Starting points. Linking the server takes a modpack from a provider or a file and needs the
 * install gate. A custom client pack is built from a file or from scratch; players get a
 * provider modpack by following the server's modpack instead.
 */
export function firstRunChoices(section: ModpackSection, gates: Pick<ModpackGates, 'edit' | 'installOnServer'>): { id: FirstRunChoice; enabled: boolean }[] {
  if (section === 'server') return (['provider', 'upload'] as const).map((id) => ({ id, enabled: gates.installOnServer }));
  return (['link', 'upload', 'scratch'] as const).map((id) => ({ id, enabled: gates.edit }));
}

export const ARCHIVE_EXTENSIONS = ['.mrpack', '.zip'];
export const isPackArchiveName = (name: string) => ARCHIVE_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext));

/**
 * What an inspected archive offers. Linking is only possible when the agent identified the whole
 * pack (`providerPack`); then linking is primary because nothing is hosted. Otherwise the archive
 * becomes a hosted custom pack. Unresolved files stay visible: they block publication until
 * replaced, so the owner sees them before choosing.
 */
export interface ArchiveDecision {
  primary: 'link' | 'host';
  link: ContentProvider | null;
  unresolved: string[];
  /** The archive's loader cannot be read from file names (plain ZIP). */
  runtimeInferred: boolean;
  formatLabel: MessageId;
}

export const archiveFormatLabel: Record<PackArchiveInspection['format'], MessageId> = {
  mrpack: 'server-pack.format-mrpack',
  curseforge: 'server-pack.format-curseforge',
  zip: 'server-pack.format-zip',
  vesta: 'server-pack.format-vesta',
};

export function archiveDecision(inspection: PackArchiveInspection): ArchiveDecision {
  return {
    primary: inspection.providerPack ? 'link' : 'host',
    link: inspection.providerPack,
    unresolved: inspection.unresolvedFiles,
    runtimeInferred: inspection.warnings.includes('archive_runtime_inferred_from_server') || (inspection.format === 'zip' && inspection.manifest.loader === 'none'),
    formatLabel: archiveFormatLabel[inspection.format],
  };
}

/**
 * Linking the server to an uploaded file. A file the agent identified as a whole provider pack
 * links to that provider version, so updates can be discovered; anything else links the file.
 */
export function archiveLinkSource(inspection: PackArchiveInspection, uploadId: string): PackInstallSource {
  return inspection.providerPack ? { source: 'provider', ...inspection.providerPack } : { source: 'uploaded_archive', uploadId };
}

/** "Start from scratch": the server's client-needed mods the suggestions found, as pack additions. */
export function scratchSelections(items: readonly { kind: string; provider: ContentProvider | null }[]): ContentProvider[] {
  const seen = new Set<string>();
  return items.flatMap((item) => {
    if (item.kind !== 'client_mod_missing' || !item.provider) return [];
    const key = `${item.provider.provider}:${item.provider.projectId}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [item.provider];
  });
}

/* ---- Content ---- */

export type EntryFilter = 'all' | PackEntryKind;

export const entryKindLabel: Record<PackEntryKind, MessageId> = {
  mod: 'server-pack.kind-mod',
  resource_pack: 'server-pack.kind-resource-pack',
  shader: 'server-pack.kind-shader',
  datapack: 'server-pack.kind-datapack',
  config_override: 'server-pack.kind-config',
};

export const entryFileName = (entry: Pick<PackEntry, 'path'>) => entry.path.split('/').at(-1) ?? entry.path;

/** Kinds present, in a stable order, for the filter control. */
export function entryKinds(entries: readonly PackEntry[]): PackEntryKind[] {
  const order: PackEntryKind[] = ['mod', 'resource_pack', 'shader', 'datapack', 'config_override'];
  return order.filter((kind) => entries.some((entry) => isContentEntry(entry) && entry.kind === kind));
}

/** Search matches the display name (when known), file name or project id. */
export function filterEntries(entries: readonly PackEntry[], query: string, kind: EntryFilter, names: (entry: PackEntry) => string | undefined = () => undefined): PackEntry[] {
  const needle = query.trim().toLowerCase();
  return entries.filter((entry) => {
    if (!isContentEntry(entry)) return false;
    if (kind !== 'all' && entry.kind !== kind) return false;
    if (!needle) return true;
    const haystack = [names(entry), entryFileName(entry), entry.source.type === 'provider' ? entry.source.projectId : ''].join(' ').toLowerCase();
    return haystack.includes(needle);
  });
}

/** Selection limited to rows that still exist. */
export const liveSelection = (selected: readonly string[], entries: readonly PackEntry[]) =>
  selected.filter((id) => entries.some((entry) => entry.id === id));

export function bulkRemove(manifest: PackManifest, ids: readonly string[]): PackManifest {
  const drop = new Set(ids);
  return { ...manifest, entries: manifest.entries.filter((entry) => !drop.has(entry.id)) };
}

export function bulkSetRequired(manifest: PackManifest, ids: readonly string[], required: boolean): PackManifest {
  const pick = new Set(ids);
  return { ...manifest, entries: manifest.entries.map((entry) => (pick.has(entry.id) ? { ...entry, required } : entry)) };
}

/** One toggle for a selection: if every chosen entry is required make them optional, else required. */
export const bulkRequiredTarget = (entries: readonly PackEntry[], ids: readonly string[]) =>
  !ids.every((id) => entries.find((entry) => entry.id === id)?.required);

/** Pin an entry to a newer provider version (from a `newer_compatible_version` suggestion). */
export function updateEntry(manifest: PackManifest, entryId: string, next: ContentProvider): PackManifest {
  return {
    ...manifest,
    entries: manifest.entries.map((entry) => (entry.id === entryId && entry.source.type === 'provider'
      ? { ...entry, source: { type: 'provider', ...next } } : entry)),
  };
}

/* ---- Files (override roots) ---- */

export interface PackRootDef { id: PackOverrideRoot; label: MessageId; hint: MessageId }
/** Like mrpack: shared overrides go to both sides, the other two to one side only. */
export const packFileRoots: readonly PackRootDef[] = [
  { id: 'overrides', label: 'server-pack.root-all', hint: 'server-pack.root-all-hint' },
  { id: 'client-overrides', label: 'server-pack.root-client', hint: 'server-pack.root-client-hint' },
  { id: 'server-overrides', label: 'server-pack.root-server', hint: 'server-pack.root-server-hint' },
];

export const isPackRoot = (value: string | undefined): value is PackOverrideRoot =>
  packFileRoots.some((root) => root.id === value);

export interface PackFileRow { name: string; path: string; kind: 'file' | 'directory'; sha256: string | null }

/**
 * One directory level of a root: explicit files and folders plus parents implied by deeper
 * paths. Trashed rows are hidden (the agent keeps their bytes). Folders first, then by name.
 */
export function packDirectory(files: readonly PackOverrideFile[], root: PackOverrideRoot, directory: string): PackFileRow[] {
  const prefix = directory ? `${directory}/` : '';
  const rows = new Map<string, PackFileRow>();
  for (const file of files) {
    if (file.trashed || file.root !== root || !file.path.startsWith(prefix) || file.path === directory) continue;
    const rest = file.path.slice(prefix.length);
    const [name, ...deeper] = rest.split('/');
    if (!name) continue;
    const path = `${prefix}${name}`;
    const directoryRow = deeper.length > 0 || file.sha256 === null;
    if (directoryRow) rows.set(name, { name, path, kind: 'directory', sha256: null });
    else if (!rows.has(name)) rows.set(name, { name, path, kind: 'file', sha256: file.sha256 });
  }
  return [...rows.values()].sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'directory' ? -1 : 1));
}

export function packRootCounts(files: readonly PackOverrideFile[]): Record<PackOverrideRoot, number> {
  const counts: Record<PackOverrideRoot, number> = { overrides: 0, 'client-overrides': 0, 'server-overrides': 0 };
  for (const file of files) if (!file.trashed && file.sha256 !== null) counts[file.root]++;
  return counts;
}

/** Override paths are game paths: only the portable allowlist is accepted by the agent. */
export const PACK_FILE_PREFIXES = ['mods/', 'resourcepacks/', 'shaderpacks/', 'datapacks/', 'config/', 'defaultconfigs/', 'kubejs/', 'scripts/', 'resources/'];
export const PACK_ROOT_FILES = ['options.txt', 'optionsof.txt', 'optionsshaders.txt', 'servers.dat'];
export const packPathAllowed = (path: string) =>
  PACK_FILE_PREFIXES.some((prefix) => path.startsWith(prefix)) || PACK_ROOT_FILES.includes(path);

export const TEXT_LIMIT = 1_048_576;
export const BLOB_LIMIT = 16 * 1_048_576;

/* ---- Versions / publish ---- */

/** How many things publication would change, from a preview diff. */
export function diffChangeCount(diff: PackDiff): number {
  return diff.added.length + diff.removed.length + diff.changed.length + diff.customOverrides.length + (diff.metadataChanged ? 1 : 0);
}

export type PublishState =
  | { step: 'idle' }
  | { step: 'reviewing' }
  | { step: 'review'; preview: PackPreview; required: boolean; acknowledged: boolean }
  | { step: 'publishing'; preview: PackPreview; request: PackPublish }
  | { step: 'published'; outcome: PackPublishOutcome; required: boolean }
  | { step: 'failed'; reason: 'stale' | 'invalid' | 'uncertain' | 'error'; preview?: PackPreview; request?: PackPublish };

export type PublishEvent =
  | { type: 'review' }
  | { type: 'previewed'; preview: PackPreview }
  | { type: 'required'; value: boolean }
  | { type: 'acknowledge'; value: boolean }
  | { type: 'publish' }
  | { type: 'published'; outcome: PackPublishOutcome }
  | { type: 'failed'; code: string }
  | { type: 'retry' }
  | { type: 'reset' };

export const needsLowerAck = (preview: PackPreview) => preview.issues.some((issue) => issue.code === 'display_version_lower');

export function publishRequest(preview: PackPreview, requiredUpdate: boolean, acknowledgeLowerVersion: boolean): PackPublish {
  return {
    expectedRevision: preview.publishedRevision, draftRevision: preview.draftRevision, resolvedEntries: preview.resolvedEntries,
    reviewSha256: preview.reviewSha256, requiredUpdate, acknowledgeLowerVersion,
  };
}

export function canPublish(state: PublishState, gates: Pick<ModpackGates, 'publish' | 'forceUpdate'>): boolean {
  if (state.step !== 'review' || !gates.publish || !state.preview.valid) return false;
  if (state.required && !gates.forceUpdate) return false;
  return !needsLowerAck(state.preview) || state.acknowledged;
}

const uncertainCodes = new Set(['outcome_unknown', 'timeout', 'unreachable']);

/**
 * Review → publish. A publish request is frozen from the reviewed preview so a retry after an
 * uncertain outcome sends the exact same body (same intent); a stale target needs a new review.
 */
export function publishReducer(state: PublishState, event: PublishEvent): PublishState {
  switch (event.type) {
    case 'reset': return { step: 'idle' };
    case 'review': return state.step === 'publishing' ? state : { step: 'reviewing' };
    case 'previewed': return state.step === 'reviewing' ? { step: 'review', preview: event.preview, required: false, acknowledged: false } : state;
    case 'required': return state.step === 'review' ? { ...state, required: event.value } : state;
    case 'acknowledge': return state.step === 'review' ? { ...state, acknowledged: event.value } : state;
    case 'publish':
      if (state.step !== 'review' || !state.preview.valid) return state;
      if (needsLowerAck(state.preview) && !state.acknowledged) return state;
      return { step: 'publishing', preview: state.preview, request: publishRequest(state.preview, state.required, state.acknowledged) };
    case 'published':
      return state.step === 'publishing' ? { step: 'published', outcome: event.outcome, required: state.request.requiredUpdate } : state;
    case 'failed': {
      if (state.step === 'reviewing') return { step: 'failed', reason: 'error' };
      if (state.step !== 'publishing') return state;
      const reason = event.code === 'stale_target' ? 'stale' : uncertainCodes.has(event.code) ? 'uncertain' : event.code === 'conflict' ? 'invalid' : 'error';
      return { step: 'failed', reason, preview: state.preview, request: state.request };
    }
    case 'retry':
      // Only an uncertain outcome replays the frozen request; anything else starts a new review.
      if (state.step === 'failed' && state.reason === 'uncertain' && state.preview && state.request) {
        return { step: 'publishing', preview: state.preview, request: state.request };
      }
      return { step: 'reviewing' };
  }
}

/* ---- Link / update review ---- */

/** The server's link review; an update is reviewed exactly like the first link. */
export type LinkReviewMode = 'link' | 'update';

export type ConflictChoice = 'replace' | 'keep';
export const installConflicts = (plan: PackInstallPlan) => plan.files.filter((file) => file.conflict !== null);

/** A newer version of the same project replaces by default; other collisions keep what is there. */
export function defaultInstallChoices(plan: PackInstallPlan): Record<string, ConflictChoice> {
  return Object.fromEntries(installConflicts(plan).map((file) => [file.path, file.conflict === 'project_version' ? 'replace' : 'keep']));
}

/**
 * Exactly one choice per conflicting file, nothing else; null while any is missing.
 * `setAsModpack` is a deprecated agent input: linking the server never publishes a client pack.
 */
export function installApplyRequest(plan: PackInstallPlan, picks: Record<string, ConflictChoice>): PackInstallApply | null {
  const choices: PackInstallApply['choices'] = [];
  for (const file of installConflicts(plan)) {
    const choice = picks[file.path];
    if (choice !== 'replace' && choice !== 'keep') return null;
    choices.push({ path: file.path, choice });
  }
  return { planId: plan.planId, confirmationToken: plan.confirmationToken, choices, setAsModpack: false };
}

/** Expired credentials refresh at apply; only reviewed effects block the user. */
export function installBlocker(plan: PackInstallPlan, _nowMs: number): MessageId | null {
  if (!plan.valid) return 'server-pack.install-invalid';
  if (plan.softwareSwitchRequired) return 'server-pack.install-switch-first';
  return null;
}

const isServerContent = (path: string) => /^(mods|plugins|datapacks|world\/datapacks)\//.test(path);
const fileOperation = (file: PackInstallPlan['files'][number]): 'added' | 'updated' | 'unchanged' =>
  file.operation === 'updated' || file.operation === 'unchanged' ? file.operation : 'added';

/**
 * What the review changes on the server: server-side entries added, updated and removed,
 * override files, and how many already match. Removals are only earlier pack-owned files the
 * new version no longer has; user additions are never touched.
 */
export interface LinkReview { added: string[]; updated: string[]; removed: string[]; overrides: string[]; unchanged: number }
export function linkReview(plan: PackInstallPlan): LinkReview {
  const review: LinkReview = { added: [], updated: [], removed: (plan.removed ?? []).map(([path]) => path), overrides: [], unchanged: 0 };
  for (const file of plan.files) {
    const operation = fileOperation(file);
    if (operation === 'unchanged') review.unchanged++;
    else if (!isServerContent(file.path)) review.overrides.push(file.path);
    else review[operation].push(file.path);
  }
  return review;
}

/** Changes the apply stages: kept conflicts and unchanged files are skipped; removals count. */
export const installStagedCount = (plan: PackInstallPlan, picks: Record<string, ConflictChoice>) =>
  plan.files.filter((file) => fileOperation(file) !== 'unchanged' && !(file.conflict && picks[file.path] === 'keep')).length
  + (plan.removed?.length ?? 0);

/* ---- Labels ---- */

const loaderNames: Record<PackLoader, string> = { none: 'Vanilla', fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', neoforge: 'NeoForge' };
/** Client loader names are product names and stay untranslated. */
export const packLoaderName = (loader: PackLoader) => loaderNames[loader];
export const packLoaders: readonly PackLoader[] = ['none', 'fabric', 'quilt', 'forge', 'neoforge'];

/* ---- Get the modpack (linked client sync) ---- */

/**
 * The apply request for a reviewed sync. Executable changes need consent naming this revision;
 * linking exact files installs nothing and carries none. Null while consent is missing.
 */
export function syncApplyRequest(review: PackSyncPreview, consent: boolean, linkOnly: boolean): PackSyncApply | null {
  if (review.consentRequired && !consent && !linkOnly) return null;
  return { reviewId: review.reviewId, consentRevision: consent && !linkOnly ? review.revision : null, linkOnly, name: review.name };
}

export function syncChangeSummary(changes: readonly PackSyncChange[]) {
  return {
    added: changes.filter((change) => change.operation === 'add').length,
    updated: changes.filter((change) => change.operation === 'update').length,
    removed: changes.filter((change) => change.operation === 'remove').length,
  };
}

const installWarnings: Record<string, MessageId> = {
  missing_required_dependency: 'server-pack.warning-missing-dependency',
  software_legacy_checksum_review: 'server-pack.warning-software-checksum',
  unknown_server_side: 'server-pack.warning-unknown-side',
  unknown_or_optional_server_side: 'server-pack.warning-unknown-side',
  archive_loader_inferred_from_server_review_required: 'server-pack.warning-loader-inferred',
  retained_unidentified_content: 'server-pack.warning-retained',
  version_from_pack_manifest: 'install.version-from-manifest',
  loader_inferred_from_server: 'server-pack.warning-loader-inferred',
};

/** Agent warnings are `code` or `code:path`; known codes read as sentences, others stay as sent. */
export function installWarning(warning: string | import('./native-pack').PackInstallWarning, translate: (id: MessageId, args: Record<string, string>) => string): string {
  if (typeof warning !== 'string' && warning.code === 'version_from_pack_manifest') return translate('install.version-from-manifest', {});
  if (typeof warning !== 'string' && warning.code === 'archive_limit_warning') {
    const messages: Record<string, MessageId> = {
      legacy_archive_bytes: 'server-pack.warning-legacy-archive-bytes',
      legacy_archive_entries: 'server-pack.warning-legacy-archive-entries',
      legacy_member_bytes: 'server-pack.warning-legacy-member-bytes',
      legacy_blob_bytes: 'server-pack.warning-legacy-blob-bytes',
      catalogue_file_count: 'server-pack.warning-catalogue-file-count',
      catalogue_metadata_bytes: 'server-pack.warning-catalogue-metadata-bytes',
      catalogue_file_bytes: 'server-pack.warning-catalogue-file-bytes',
      catalogue_total_bytes: 'server-pack.warning-catalogue-total-bytes',
    };
    const id = messages[warning.rule];
    if (id) return `${translate(id, {})} (${warning.item}: ${warning.detail})`;
  }
  if (typeof warning !== 'string') return installWarning(warning.detail, translate);
  if (warning.startsWith("unusual_content_directory:")) return `Unusual content destination: ${warning.slice(26)}. Check the file before installing.`;
  if (warning.startsWith("pack_size_warning:")) return `Server files: ${Math.ceil(Number(warning.slice(18)) / 1048576)} MiB.`;
  const split = warning.indexOf(':');
  const code = split < 0 ? warning : warning.slice(0, split);
  const path = split < 0 ? '' : warning.slice(split + 1);
  const id = installWarnings[code];
  return id ? translate(id, { path }) : warning;
}

/* ---- Bytes ---- */

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

export const base64ToBytes = (value: string) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));

/** UTF-8 text small enough for a text write; anything else goes through a blob upload. */
export function asPackText(bytes: Uint8Array): string | null {
  if (bytes.length > TEXT_LIMIT) return null;
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return null; }
}

/** Where a picked or dropped file lands inside a root, or a reason it cannot. */
export function packUploadTarget(directory: string, name: string, size: number): { path: string } | { problem: MessageId } {
  const path = directory ? `${directory}/${name}` : name;
  if (size > BLOB_LIMIT) return { problem: 'server-pack.upload-too-large' };
  if (!packPathAllowed(path)) return { problem: 'server-pack.upload-path-refused' };
  return { path };
}

/** The newest release for the server's Minecraft version, else the newest of any type for it. */
export function pickProviderVersion<V extends { id: string; game_versions: string[]; release_type: string }>(versions: readonly V[], minecraft: string): V | undefined {
  const fits = versions.filter((version) => version.game_versions.includes(minecraft));
  return fits.find((version) => version.release_type === 'release') ?? fits[0];
}

/** Early Install consent covers additive, compatible plans; conflicts still need review. */
export function installCanProceedWithoutReview(plan: PackInstallPlan, now: number): boolean {
  return plan.expiresAtMs > now && !installBlocker(plan, now) && !installConflicts(plan).length && !(plan.removed?.length)
    && !plan.warnings.length && plan.files.every(file => file.operation === 'added' || file.operation === 'unchanged');
}

/** Decisions retained with an install job, including on reconnect. */
export function installDecision(decision: string, translate: (id: MessageId, args: Record<string, string>) => string): string {
  const separator = decision.indexOf(':');
  const kind = decision.slice(0, separator), path = decision.slice(separator + 1);
  if (kind === 'keep') return translate('server-pack.install-kept-file', { path });
  if (kind === 'preserved_or_skipped') return translate('server-pack.install-skipped-file', { path });
  return decision;
}
