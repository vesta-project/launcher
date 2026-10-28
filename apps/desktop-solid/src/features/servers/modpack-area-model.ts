// Pure decisions for a server's Modpack area: which source the pack has, which sub-tabs it
// offers, the first-run choices, override file roots, the publish review machine, bulk entry
// edits and the install-on-server review. No IO or reactivity; the pages own those.
import type { MessageId } from '../../localization/messages';
import type { CapabilityView } from './native';
import type { PackSyncApply, PackSyncChange, PackSyncPreview } from './native-pack-sync';
import { gate, roleKey } from './capabilities';
import type { ContentProvider } from './native-content';
import type {
  PackArchiveInspection, PackDiff, PackEntry, PackEntryKind, PackInstallApply, PackInstallPlan, PackInstallSource, PackManifest,
  PackLoader, PackOverrideFile, PackOverrideRoot, PackPreview, PackPublish, PackPublishOutcome, PackWorkspace,
} from './native-pack';

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
 * Editors get the full area. Players with download access only get the overview (Get the
 * modpack); the draft itself needs `pack.edit`. Provider packs keep Files locked until Customize.
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

export const modpackPath = (id: string, tab: ModpackSubTab) =>
  tab === 'overview' ? `/servers/${id}/pack` : `/servers/${id}/pack/${tab}`;

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
  const manager = ['owner', 'administrator'].includes(roleKey(role));
  return {
    edit: can('pack.edit'),
    build: can('pack.build'),
    publish: can('pack.build') && can('pack.publish'),
    forceUpdate: can('pack.force_update'),
    download: can('pack.download') || can('pack.access'),
    installOnServer: manager && can('content.install') && can('pack.edit'),
  };
}

/* ---- First run ---- */

export type FirstRunChoice = 'provider' | 'upload' | 'scratch';

/** Each choice and whether this user may take it. */
export function firstRunChoices(gates: Pick<ModpackGates, 'edit'>): { id: FirstRunChoice; enabled: boolean }[] {
  return (['provider', 'upload', 'scratch'] as const).map((id) => ({ id, enabled: gates.edit }));
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
  return order.filter((kind) => entries.some((entry) => entry.kind === kind));
}

/** Search matches the display name (when known), file name or project id. */
export function filterEntries(entries: readonly PackEntry[], query: string, kind: EntryFilter, names: (entry: PackEntry) => string | undefined = () => undefined): PackEntry[] {
  const needle = query.trim().toLowerCase();
  return entries.filter((entry) => {
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

/* ---- Install on this server ---- */

export function installSource(workspace: PackWorkspace, kind: PackSourceKind): PackInstallSource {
  if (kind === 'provider' && workspace.providerPack) return { source: 'provider', ...workspace.providerPack };
  return { source: 'draft', revision: workspace.draft.revision };
}

export type ConflictChoice = 'replace' | 'keep';
export const installConflicts = (plan: PackInstallPlan) => plan.files.filter((file) => file.conflict !== null);

/** A newer version of the same project replaces by default; other collisions keep what is there. */
export function defaultInstallChoices(plan: PackInstallPlan): Record<string, ConflictChoice> {
  return Object.fromEntries(installConflicts(plan).map((file) => [file.path, file.conflict === 'project_version' ? 'replace' : 'keep']));
}

/** Exactly one choice per conflicting file, nothing else; null while any is missing. */
export function installApplyRequest(plan: PackInstallPlan, picks: Record<string, ConflictChoice>, setAsModpack: boolean): PackInstallApply | null {
  const choices: PackInstallApply['choices'] = [];
  for (const file of installConflicts(plan)) {
    const choice = picks[file.path];
    if (choice !== 'replace' && choice !== 'keep') return null;
    choices.push({ path: file.path, choice });
  }
  return { planId: plan.planId, confirmationToken: plan.confirmationToken, choices, setAsModpack };
}

/** Plan can be applied: valid, not expired, software already matches. */
export function installBlocker(plan: PackInstallPlan, nowMs: number): MessageId | null {
  if (!plan.valid) return 'server-pack.install-invalid';
  if (plan.softwareSwitchRequired) return 'server-pack.install-switch-first';
  if (plan.expiresAtMs <= nowMs) return 'server-pack.install-expired';
  return null;
}

/** Files the apply would stage (kept conflicts are skipped). */
export const installStagedCount = (plan: PackInstallPlan, picks: Record<string, ConflictChoice>) =>
  plan.files.filter((file) => !(file.conflict && picks[file.path] === 'keep')).length;

/** Splits files into server-side (shared + server overrides) and mod entries, for the review. */
export function installGroups(plan: PackInstallPlan): { content: string[]; overrides: string[] } {
  const isContent = (path: string) => /^(mods|plugins|datapacks|world\/datapacks)\//.test(path);
  return {
    content: plan.files.filter((file) => isContent(file.path)).map((file) => file.path),
    overrides: plan.files.filter((file) => !isContent(file.path)).map((file) => file.path),
  };
}

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
  unknown_server_side: 'server-pack.warning-unknown-side',
  retained_unidentified_content: 'server-pack.warning-retained',
  loader_inferred_from_server: 'server-pack.warning-loader-inferred',
};

/** Agent warnings are `code` or `code:path`; known codes read as sentences, others stay as sent. */
export function installWarning(warning: string, translate: (id: MessageId, args: Record<string, string>) => string): string {
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
