// Pure rules for adding a server to a Vesta Server machine: which ways the machine offers,
// what the catalogue holds, one review shape for every way, the problems worth showing and
// what the person ticks before the machine starts. No signals, so every rule is testable.
import type { MessageId } from '../../localization/messages';
import { toServerError } from './errors';
import { folderName, folderUse, importProblem, importRootCommand, readNotServer, reviewSummary, warningMessage } from './host-model';
import type {
  CatalogueBuild, CatalogueKind, CatalogueVersion, CreateDefaults, CreateReview, CreateSoftware, Folder, ImportJob, ImportReview, MinecraftCatalogue,
  PackIssue, RestoreSource, SoftwareCatalogue,
} from './native-hosts';

// ------------------------------------------------------------------ ways to add a server

/**
 * A modpack is not a way to add a server: make one with New, then install a pack into it
 * from Browse, like any server.
 */
export type AddMode = 'new' | 'restore' | 'import';
/** The order the wizard offers them in. */
export const ADD_MODES: readonly AddMode[] = ['new', 'restore', 'import'];

/** What the machine answered when asked about each way. */
export type AddSupport = Record<AddMode, boolean>;

/** Only the ways this machine can do, in wizard order. A way it can't do is left out, never greyed. */
export const supportedModes = (support: Partial<AddSupport>): AddMode[] => ADD_MODES.filter((mode) => support[mode] === true);

/** Capability names a machine may advertise for each way. */
const MODE_CAPABILITIES: Record<AddMode, readonly string[]> = {
  new: ['create-jobs', 'create-new'], restore: ['create-restore'], import: ['import-jobs'],
};

/**
 * Which ways a machine offers, from what it advertises and what it answered when asked.
 * Defaults answering means New works. Restore needs at least one backup to start from.
 */
export function addSupport(input: { capabilities?: readonly string[] | null; defaults: boolean; restoreSources: number | null }): AddSupport {
  const caps = input.capabilities ?? [];
  const says = (mode: AddMode) => MODE_CAPABILITIES[mode].some((name) => caps.includes(name));
  return {
    new: input.defaults,
    restore: (input.restoreSources ?? 0) > 0,
    // An older machine lists no capabilities at all but can still import.
    import: caps.length === 0 || says('import'),
  };
}

const NOT_YET = ['creates_unavailable', 'imports_unavailable', 'not_supported_yet', 'not_implemented', 'legacy_endpoint_removed', 'not_found'];

/** The machine has no such route yet (an older Vesta Server), as opposed to a failure worth retrying. */
export function notOffered(reason: unknown): boolean {
  const error = toServerError(reason);
  return error.code === 'not_found' || error.code === 'unsupported' || (!!error.reason && NOT_YET.includes(error.reason));
}

// ------------------------------------------------------------------ catalogue

const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value : null);
const count = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const record = (value: unknown) => (value && typeof value === 'object' ? value as Record<string, unknown> : {});

export interface Option { value: string; label: string }

/** Releases, plus snapshots when asked. The chosen version always stays in the list. */
export function versionOptions(catalogue: MinecraftCatalogue | null | undefined, snapshots: boolean, chosen?: string | null): Option[] {
  const versions = list(catalogue?.versions).flatMap((entry) => {
    const version = record(entry);
    const id = text(version.id);
    const release = version.stable !== false && version.experimental !== true;
    return id && (snapshots || release || id === chosen) ? [{ value: id, label: id }] : [];
  });
  return chosen && !versions.some((version) => version.value === chosen) ? [{ value: chosen, label: chosen }, ...versions] : versions;
}

/** The catalogue entry for a version id, when the machine listed it. */
export const findVersion = (catalogue: MinecraftCatalogue | null | undefined, id: string | null | undefined): CatalogueVersion | null =>
  (id ? (list(catalogue?.versions).find((entry) => record(entry).id === id) as CatalogueVersion | undefined) ?? null : null);

/** The version a new server starts on: the suggestion when the catalogue has it, else the newest release. */
export function startVersion(catalogue: MinecraftCatalogue | null | undefined, suggested?: string | null): string | null {
  const ids = versionOptions(catalogue, true).map((version) => version.value);
  if (suggested && (ids.includes(suggested) || !ids.length)) return suggested;
  return text(catalogue?.latestStable) ?? versionOptions(catalogue, false)[0]?.value ?? ids[0] ?? null;
}

const softwareNames: Record<string, string> = {
  vanilla: 'Vanilla', fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', neoforge: 'NeoForge', paper: 'Paper', purpur: 'Purpur',
  spigot: 'Spigot', bukkit: 'CraftBukkit', folia: 'Folia', velocity: 'Velocity',
};
export const softwareLabel = (kind: string | null | undefined, label?: string | null) =>
  (kind ? label ?? softwareNames[kind.toLowerCase()] ?? kind : null);

/** "0.16.9" for loaders, "130" for builds; null when the software has no version of its own. */
export const buildLabel = (build: Pick<CatalogueBuild, 'build' | 'loaderVersion'>): string | null =>
  build.loaderVersion ?? (build.build === null || build.build === undefined ? null : String(build.build));

/** Builds worth choosing between. Vanilla (one unnamed build) has nothing to pick. */
export function buildOptions(kind: CatalogueKind | null | undefined): (Option & { build: CatalogueBuild })[] {
  return list(kind?.builds).flatMap((entry) => {
    const build = entry as CatalogueBuild;
    const label = build && typeof build === 'object' ? buildLabel(build) : null;
    return label && text(build.id) ? [{ value: build.id, label, build }] : [];
  });
}

const unavailableReason = (kind: unknown) => text(record(kind).unavailableReason);
/** Some software (vanilla, CraftBukkit, Spigot) lists one unnamed build: there is nothing to pick, but it can be installed. */
const canInstall = (kind: CatalogueKind) => kind.available === true && !unavailableReason(kind) && list(kind.builds).length > 0;

/** Software the machine can install for this version, as cards. The rest are named in words instead. */
export function softwareKinds(catalogue: SoftwareCatalogue | null | undefined): CatalogueKind[] {
  return list(catalogue?.kinds).filter((entry): entry is CatalogueKind => !!text(record(entry).kind) && canInstall(entry as CatalogueKind));
}

const REASON_WORDS: Record<string, MessageId> = {
  provider_unavailable: 'server-add.software.reason-offline',
  download_unavailable: 'server-add.software.reason-offline',
  unsupported_platform: 'server-add.software.reason-machine',
  unsupported_architecture: 'server-add.software.reason-machine',
  not_supported_yet: 'server-add.software.reason-soon',
  unsupported_version: 'server-add.software.reason-version',
};

/**
 * Software this version can't have, grouped by why, so the picker says it in a word
 * ("Not for 1.8.9: Folia, Quilt") instead of hiding it silently or greying it out.
 */
export function unavailableKinds(catalogue: SoftwareCatalogue | null | undefined): { reason: MessageId; names: string[] }[] {
  const groups = new Map<MessageId, string[]>();
  for (const entry of list(catalogue?.kinds)) {
    const kind = entry as CatalogueKind;
    if (!text(record(entry).kind) || canInstall(kind)) continue;
    const code = unavailableReason(kind);
    const reason = code ? REASON_WORDS[code] ?? 'server-add.software.reason-other' : 'server-add.software.reason-version';
    groups.set(reason, [...(groups.get(reason) ?? []), softwareLabel(kind.kind, text(kind.label))!]);
  }
  return [...groups].map(([reason, names]) => ({ reason, names }));
}

/** Keep the chosen software when this version has it, else the recommended one (vanilla). */
export function keepKind(kinds: readonly CatalogueKind[], preferred: string | null | undefined): string | null {
  if (preferred && kinds.some((kind) => kind.kind === preferred)) return preferred;
  return (kinds.find((kind) => kind.recommended) ?? kinds.find((kind) => kind.kind === 'vanilla') ?? kinds[0])?.kind ?? null;
}

/** The build chosen by default: the recommended one. An experimental build is never picked silently. */
export const recommendedBuild = (kind: CatalogueKind | null | undefined): CatalogueBuild | null =>
  buildOptions(kind).find((option) => option.build.recommended && !option.build.experimental)?.build ?? null;

/** The build a plan uses: the one picked, else the recommended one. Null when there is none to use. */
export const chosenBuild = (kind: CatalogueKind | null | undefined, buildId: string | null): CatalogueBuild | null =>
  buildOptions(kind).find((option) => option.value === buildId)?.build ?? recommendedBuild(kind);

/**
 * Vanilla has nothing to pick. Software whose builds are all experimental has no
 * recommendation, so the person picks one knowingly instead of getting one silently.
 */
export const needsBuild = (kind: CatalogueKind | null | undefined, buildId: string | null) =>
  !!kind && kind.kind !== 'vanilla' && buildOptions(kind).length > 0 && !chosenBuild(kind, buildId);

/** What a plan sends for the chosen software. */
export function softwareChoice(kind: CatalogueKind | null | undefined, buildId: string | null): CreateSoftware {
  const build = chosenBuild(kind, buildId);
  return { kind: kind?.kind ?? 'vanilla', build: build?.build ?? null, loaderVersion: build?.loaderVersion ?? null };
}

/** The chosen version, software or build is experimental: the picker says so plainly. */
export const experimentalChoice = (input: { version?: CatalogueVersion | null; kind?: CatalogueKind | null; build?: CatalogueBuild | null }) =>
  !!(input.version?.experimental || input.kind?.experimental || input.build?.experimental);

/** Defaults the machine suggested, or calm fallbacks when a field is missing. */
export function readDefaults(reply: unknown): CreateDefaults {
  const value = record(reply);
  const software = record(value.software);
  return {
    name: text(value.name) ?? 'Minecraft Server',
    minecraftVersion: text(value.minecraftVersion) ?? '',
    software: { kind: text(software.kind) ?? 'vanilla', build: count(software.build), loaderVersion: text(software.loaderVersion) },
    gamePort: count(value.gamePort) ?? 25565,
    memoryMiB: count(value.memoryMiB) ?? 4096,
    java: 'automatic',
  };
}

// ------------------------------------------------------------------ memory and port

export const MEMORY_STEP = 256;
export const MEMORY_MIN = 512;

export interface ResourceCheck {
  /** What the machine can spare for one more server; null when it didn't say. */
  availableMiB: number | null;
  totalMiB: number | null;
  /** The port the machine would pick, and why a chosen one can't be used. */
  suggestedPort: number | null;
  portProblem: 'in-use' | null;
}

/** The machine's resource preview (`/imports/resources`): memory to spare and whether a port is free. */
export function readResources(reply: unknown): ResourceCheck {
  const value = record(reply);
  const memory = record(value.memory);
  const port = record(value.port);
  return {
    availableMiB: count(memory.availableMib) ?? count(memory.availableMiB),
    totalMiB: count(memory.totalMib) ?? count(memory.totalMiB),
    suggestedPort: count(port.gamePort),
    portProblem: port.blocker === 'game_port_in_use' ? 'in-use' : null,
  };
}

/** The memory slider's range: up to what the machine can spare, or a sensible ceiling when unknown. */
export function memoryRange(availableMiB: number | null, chosen: number): { min: number; max: number; step: number } {
  const ceiling = availableMiB && availableMiB >= MEMORY_MIN ? availableMiB : Math.max(16_384, chosen);
  const max = Math.max(MEMORY_MIN, Math.floor(ceiling / MEMORY_STEP) * MEMORY_STEP);
  return { min: MEMORY_MIN, max, step: MEMORY_STEP };
}

export const clampMemory = (value: number, range: { min: number; max: number; step: number }) =>
  Math.min(range.max, Math.max(range.min, Math.round(value / range.step) * range.step));

/** "4 GB", "5.5 GB", "512 MB". */
export function formatMemory(mib: number): string {
  if (mib < 1024) return `${Math.round(mib)} MB`;
  const gb = mib / 1024;
  return `${Number.isInteger(gb) ? gb : Number(gb.toFixed(2)).toString()} GB`;
}

export const validPort = (port: number) => Number.isInteger(port) && port >= 1024 && port <= 65_535;

/** Why the settings can't be sent yet, or null. */
export function settingsProblem(settings: { name: string; gamePort: number; memoryMiB: number }): 'name' | 'port' | 'memory' | null {
  if (!settings.name.trim()) return 'name';
  if (!validPort(settings.gamePort)) return 'port';
  return settings.memoryMiB >= MEMORY_MIN ? null : 'memory';
}

// ------------------------------------------------------------------ restore

/** Backups the machine can turn into a server, newest first. Malformed rows are dropped. */
export function readRestoreSources(reply: unknown): RestoreSource[] {
  return list(record(reply).sources).flatMap((entry): RestoreSource[] => {
    const value = record(entry);
    const sourceId = text(value.sourceId);
    if (!sourceId) return [];
    const software = record(value.software);
    return [{
      sourceId, label: text(value.label) ?? sourceId, createdAt: text(value.createdAt) ?? '',
      minecraftVersion: text(value.minecraftVersion),
      software: text(software.kind) ? { kind: software.kind as string, version: text(software.version) } : null,
      bytes: count(value.bytes) ?? 0,
    }];
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// ------------------------------------------------------------------ import: is this folder a server?

export interface NearbyFolder { name: string; path: string; token: string }

/**
 * Server folders right inside a folder that isn't one ("Did you mean survival?"). The machine
 * lists them as `nearby`. An older machine doesn't, so the folder's own listing stands in.
 */
export function readNearby(report: unknown, children: readonly Folder[] = [], parent = ''): NearbyFolder[] {
  const value = record(report);
  const rows = [value.nearby, record(value.inspection).nearby].map(list).find((entries) => entries.length) ?? [];
  const told = rows.flatMap((entry): NearbyFolder[] => {
    const row = record(entry);
    const path = text(row.path) ?? text(row.displayPath);
    const token = text(row.folderToken);
    return path && token && row.looksLikeServer !== false ? [{ name: folderName(path), path, token }] : [];
  });
  if (told.length) return told;
  const separator = /^[A-Za-z]:/.test(parent) ? '\\' : '/';
  return children.filter((child) => child.looksLikeServer && child.readable && child.folderToken)
    .map((child) => ({ name: child.name, path: `${parent.replace(/[\\/]+$/, '')}${separator}${child.name}`, token: child.folderToken! }));
}

export type FolderVerdict =
  | { kind: 'server' }
  | { kind: 'not-server'; reason: MessageId; nearby: NearbyFolder[] }
  | { kind: 'unreadable'; command: string };

const codes = (value: unknown): string[] => list(value).flatMap((entry) => {
  const code = typeof entry === 'string' ? entry : text(record(entry).code);
  return code ? [code] : [];
});

/**
 * What the machine found in a folder. Only a readable folder that looks like a server can go
 * to review. An unreadable one needs permission first, and a folder that isn't a server offers
 * the server folders inside it instead.
 */
export function folderVerdict(report: unknown, path: string, children: readonly Folder[] = []): FolderVerdict {
  const value = record(report);
  const blockers = codes(value.blockers);
  if (blockers.includes('source_unreadable')) {
    return { kind: 'unreadable', command: text(value.remediationCommand) ?? text(record(value.remediation).command) ?? importRootCommand(path) };
  }
  const read = readNotServer(report);
  if (read.notServer) {
    const use = folderUse({ missing: read.missing });
    return { kind: 'not-server', reason: use && !use.usable ? use.reason : 'vesta-server.import.why-no-server-file', nearby: readNearby(report, children, path) };
  }
  return { kind: 'server' };
}

// ------------------------------------------------------------------ one review for every way

export interface ReviewFacts {
  mode: AddMode;
  planId: string;
  /** Null when the machine won't go ahead as planned. */
  confirmation: string | null;
  name: string;
  /** Software id for the mark, and its display name. */
  softwareKind: string | null;
  software: string | null;
  /** "0.16.9" or "130": the loader or build on top of Minecraft, when there is one. */
  softwareVersion: string | null;
  minecraftVersion: string | null;
  gamePort: number;
  memoryMiB: number;
  javaMajor: number | null;
  /** Where the server will live on the machine. */
  destinationPath: string;
  freeBytes: number | null;
  /** Import only: the folder being copied and how big it is. */
  sourcePath: string | null;
  bytes: number | null;
  files: number | null;
  pack: { name: string; provider: string | null } | null;
  packIssues: PackIssue[];
  restore: { label: string; createdAt: string } | null;
  blockers: string[];
  warnings: string[];
  missing: string[];
  nearby: NearbyFolder[];
}

const isImportReview = (review: ImportReview | CreateReview): review is ImportReview => 'source' in review && !('summary' in review);

/** An import review or a create review, as the one set of facts the review step shows. */
export function reviewFacts(mode: AddMode, review: ImportReview | CreateReview, fallbackName = ''): ReviewFacts {
  const blockers = [...new Set(codes(review.blockers))];
  const warnings = [...new Set(codes(review.warnings))];
  if (isImportReview(review)) {
    const summary = reviewSummary(review);
    const detected = record(review.detected);
    const kind = text(detected.loader) ?? text(detected.software) ?? (summary.minecraftVersion ? 'vanilla' : null);
    return {
      mode: 'import', planId: review.planId, confirmation: review.confirmation, name: fallbackName || summary.instanceName || folderName(review.source.displayPath),
      softwareKind: kind?.toLowerCase() ?? null, software: summary.software, softwareVersion: text(detected.loaderVersion),
      minecraftVersion: summary.minecraftVersion, gamePort: summary.gamePort, memoryMiB: summary.memoryMiB, javaMajor: summary.javaMajor,
      destinationPath: review.destination.displayPath, freeBytes: count(review.destination.freeBytes),
      sourcePath: review.source.displayPath, bytes: count(review.source.bytes), files: count(review.source.files),
      pack: null, packIssues: [], restore: null, blockers, warnings,
      missing: readNotServer(review).missing, nearby: readNearby(review),
    };
  }
  const summary = review.summary;
  const software = summary.software;
  const pack = summary.pack;
  const kind = software?.kind ?? pack?.loader ?? null;
  return {
    mode, planId: review.planId, confirmation: review.confirmation, name: summary.name || fallbackName,
    softwareKind: kind?.toLowerCase() ?? null, software: softwareLabel(kind),
    softwareVersion: software ? buildLabel(software) : null,
    minecraftVersion: summary.minecraftVersion ?? pack?.minecraftVersion ?? null,
    gamePort: summary.resources.gamePort, memoryMiB: summary.resources.memoryMiB, javaMajor: count(summary.runtime?.requiredMajor),
    destinationPath: summary.destination.displayPath, freeBytes: count(summary.destination.freeBytes),
    sourcePath: null, bytes: null, files: null,
    pack: pack ? { name: pack.name, provider: pack.provider } : null,
    packIssues: list(pack?.issues).filter((issue): issue is PackIssue => !!text(record(issue).message)),
    restore: summary.restore ? { label: summary.restore.label, createdAt: summary.restore.createdAt } : null,
    blockers, warnings, missing: [], nearby: [],
  };
}

// ------------------------------------------------------------------ problems

/** The one thing that fixes a problem, shown on its line. Nothing means "Check again" is the fix. */
export type ProblemFix =
  | { kind: 'field'; field: 'name' | 'port' | 'memory' }
  | { kind: 'command'; command: string }
  /** Go back and choose something else: another folder, pack, backup or version. */
  | { kind: 'back' };

export interface Problem {
  code: string;
  /** A friendly line for the code, or the machine's own words for a pack notice. */
  message: MessageId | null;
  text?: string;
  fix: ProblemFix | null;
}

const blockerLines: Record<string, MessageId> = {
  // import.md
  source_unreadable: 'server-add.blocker.permission',
  source_running: 'vesta-server.blocker.source-running',
  source_state_unknown: 'vesta-server.blocker.source-unknown',
  source_port_listening: 'vesta-server.blocker.source-listening',
  source_recently_active: 'vesta-server.blocker.source-active',
  source_changed: 'vesta-server.blocker.changed',
  unsafe_path: 'vesta-server.blocker.unsafe',
  world_outside_source: 'vesta-server.blocker.world-outside',
  launch_unresolved: 'vesta-server.blocker.launch',
  launch_arguments_unsupported: 'vesta-server.blocker.launch-arguments',
  not_minecraft_server: 'vesta-server.blocker.not-minecraft',
  // shared by import.md and create.md
  game_port_in_use: 'server-add.blocker.port-in-use',
  port_unresolved: 'server-add.blocker.port-none',
  port_state_unknown: 'server-add.blocker.port-state',
  memory_budget_exceeded: 'server-add.blocker.memory',
  memory_invalid: 'server-add.blocker.memory-small',
  memory_unresolved: 'vesta-server.blocker.memory-unknown',
  insufficient_space: 'vesta-server.blocker.disk',
  software_unresolved: 'vesta-server.blocker.software',
  java_unresolved: 'vesta-server.blocker.java',
  source_too_large: 'vesta-server.blocker.too-large',
  // create.md
  name_in_use: 'server-add.blocker.name',
  provider_unavailable: 'server-add.blocker.provider',
  pack_invalid: 'server-add.blocker.pack-invalid',
  pack_client_only: 'server-add.blocker.pack-client',
  pack_review_blocked: 'server-add.blocker.pack-blocked',
  restore_source_unavailable: 'server-add.blocker.restore-gone',
  unsafe_archive: 'server-add.blocker.archive',
};
/** Every blocker code import.md and create.md document; each has its own line. */
export const ADD_BLOCKERS = Object.keys(blockerLines);

/** Creating has no folder of files yet, so a few lines read differently. */
const createLines: Partial<Record<string, MessageId>> = {
  software_unresolved: 'server-add.blocker.software',
  insufficient_space: 'server-add.blocker.disk',
  source_too_large: 'server-add.blocker.archive-large',
};

const FIELD_FIX: Record<string, 'name' | 'port' | 'memory'> = {
  name_in_use: 'name', game_port_in_use: 'port', port_unresolved: 'port', port_state_unknown: 'port',
  memory_budget_exceeded: 'memory', memory_invalid: 'memory',
};
const BACK_FIX = ['not_minecraft_server', 'world_outside_source', 'unsafe_path', 'source_too_large', 'pack_invalid', 'pack_client_only',
  'restore_source_unavailable', 'unsafe_archive', 'launch_arguments_unsupported'];

/** Blockers that only repeat a root cause already on the list. */
const EXPLAINED_BY: Record<string, string[]> = {
  java_unresolved: ['software_unresolved'],
  launch_unresolved: ['software_unresolved'],
  port_state_unknown: ['game_port_in_use', 'port_unresolved'],
  source_state_unknown: ['source_running'],
  source_port_listening: ['source_running'],
  memory_unresolved: ['memory_budget_exceeded'],
};
/** Root causes that make every other check meaningless: only these are shown. */
const ROOT_CAUSES = ['source_unreadable', 'not_minecraft_server', 'restore_source_unavailable', 'pack_invalid', 'pack_client_only'];

/**
 * The problems worth showing, one line each with its fix. A root cause hides what follows from
 * it: an unreadable folder shows only the permission step, never a size or Java guess made
 * without the files.
 */
export function reviewProblems(facts: ReviewFacts): Problem[] {
  const create = facts.mode !== 'import';
  const root = ROOT_CAUSES.find((code) => facts.blockers.includes(code));
  let shown = root ? [root] : facts.blockers.filter((code) => !EXPLAINED_BY[code]?.some((cause) => facts.blockers.includes(cause)));
  // The machine needs the files to know their size: no size, or room to spare, is not a space problem.
  if (!create) shown = shown.filter((code) => code !== 'insufficient_space' || (!!facts.bytes && (facts.freeBytes ?? 0) < facts.bytes));

  const blocking = root ? [] : facts.packIssues.filter((issue) => issue.blocking);
  if (blocking.length) shown = shown.filter((code) => code !== 'pack_review_blocked');

  const problems = shown.map((code): Problem => {
    const message = (create ? createLines[code] : undefined) ?? blockerLines[code] ?? 'vesta-server.blocker.other';
    if (code === 'not_minecraft_server' && facts.missing.length) {
      const use = folderUse({ missing: facts.missing });
      if (use && !use.usable) return { code, message: use.reason, fix: { kind: 'back' } };
    }
    if (code === 'source_unreadable') return { code, message, fix: { kind: 'command', command: importRootCommand(facts.sourcePath ?? '') } };
    if (FIELD_FIX[code]) return { code, message, fix: { kind: 'field', field: FIELD_FIX[code]! } };
    if (BACK_FIX.includes(code) || (create && code === 'software_unresolved')) return { code, message, fix: { kind: 'back' } };
    return { code, message, fix: null };
  });
  for (const issue of blocking) problems.push({ code: `pack:${issue.code}`, message: null, text: issue.message, fix: { kind: 'back' } });
  // Blocked without saying why: still one honest line, fixed by checking again.
  if (!problems.length && !facts.confirmation) problems.push({ code: 'unknown', message: 'vesta-server.blocker.other', fix: null });
  return problems;
}

/** Pack notices that don't stop anything: listed for reading, acknowledged with one tick. */
export const packNotices = (facts: ReviewFacts): PackIssue[] => facts.packIssues.filter((issue) => !issue.blocking);

// ------------------------------------------------------------------ before the machine starts

export interface Acknowledgement {
  /** A warning code, `source-stopped` or `eula`. */
  id: string;
  message: MessageId;
}

const warningLines: Record<string, MessageId> = {
  experimental_software: 'server-add.warning.experimental',
  legacy_checksum: 'server-add.warning.checksum',
  pack_review_warning: 'server-add.warning.pack',
  restore_version_unknown: 'server-add.warning.restore-version',
  unsupported_upstream: 'server-add.warning.upstream',
};
/** Every warning code create.md documents. */
export const CREATE_WARNINGS = Object.keys(warningLines);
export const acknowledgementLine = (code: string): MessageId => warningLines[code] ?? warningMessage(code);

/** Promises the "original server is stopped and won't restart" tick already makes: never asked twice. */
const COVERED_BY_STOPPED = ['source_process_unknown', 'disable_amp_auto_restart'];

/** What the person ticks, in order: the machine's warnings, the stopped source (import), then the EULA. */
export function acknowledgements(facts: ReviewFacts): Acknowledgement[] {
  const importing = facts.mode === 'import';
  const rows: Acknowledgement[] = facts.warnings
    .filter((code) => !(importing && COVERED_BY_STOPPED.includes(code)))
    .map((code) => ({ id: code, message: acknowledgementLine(code) }));
  if (importing) rows.push({ id: 'source-stopped', message: 'vesta-server.import.stopped' });
  rows.push({ id: 'eula', message: 'vesta-server.import.eula' });
  return rows;
}

/** The warning codes to send once everything is ticked. */
export const acknowledgedWarnings = (facts: ReviewFacts) => [...facts.warnings];

/** Why the main button is off, as a line next to it; null when it can be pressed. */
export function waitingFor(rows: readonly Acknowledgement[], ticked: readonly string[]): MessageId | null {
  const open = rows.filter((row) => !ticked.includes(row.id));
  if (!open.length) return null;
  return open.length === 1 && open[0]!.id === 'eula' ? 'server-add.review.need-eula' : 'server-add.review.need-ticks';
}

export const primaryLabel = (mode: AddMode): MessageId =>
  (mode === 'import' ? 'vesta-server.import.copy' : mode === 'restore' ? 'server-add.restore.action' : 'server-add.new.action');

// ------------------------------------------------------------------ progress

export interface PhaseStep { id: string; label: MessageId; phases: readonly string[] }

const importSteps: PhaseStep[] = [
  { id: 'check', label: 'vesta-server.import.phase-check', phases: ['inspect', 'conflicts', 'java', 'snapshot'] },
  { id: 'copy', label: 'vesta-server.import.phase-copy', phases: ['copy'] },
  { id: 'finish', label: 'vesta-server.import.phase-finish', phases: ['configure', 'register'] },
  { id: 'start', label: 'server-add.phase.start', phases: ['start'] },
];
const installLabel: Record<Exclude<AddMode, 'import'>, MessageId> = {
  new: 'server-add.phase.install', restore: 'server-add.phase.install-restore',
};
const createSteps = (mode: Exclude<AddMode, 'import'>): PhaseStep[] => [
  { id: 'prepare', label: 'server-add.phase.prepare', phases: ['resolving'] },
  { id: 'java', label: 'server-add.phase.java', phases: ['downloading_java'] },
  { id: 'software', label: mode === 'restore' ? 'server-add.phase.software-restore' : 'server-add.phase.software', phases: ['downloading_software'] },
  { id: 'install', label: installLabel[mode], phases: ['installing'] },
  { id: 'finish', label: 'vesta-server.import.phase-finish', phases: ['registering'] },
  { id: 'start', label: 'server-add.phase.start', phases: ['starting'] },
];

/** What the machine works through, in order, for this way of adding a server. Every way ends by starting it. */
export const phaseSteps = (mode: AddMode): PhaseStep[] => (mode === 'import' ? importSteps : createSteps(mode));

/**
 * Which step the machine is on. Once installed (`ready`) the server starts on its own, so
 * `ready` and `starting` are the last step and only `online` counts every step as done.
 */
export function phaseAt(mode: AddMode, phase: string | null | undefined, state: ImportJob['state'] | undefined): number {
  const steps = phaseSteps(mode);
  if (state === 'online') return steps.length;
  if (state === 'ready' || state === 'starting') return steps.length - 1;
  const at = steps.findIndex((step) => step.phases.includes(phase ?? ''));
  return at < 0 ? 0 : at;
}

/**
 * Installed and not started yet, with no start failure. Newer machines move on to `starting`
 * by themselves; older ones wait here for a start, which the launcher then sends once.
 */
export const awaitingStart = (job: Pick<ImportJob, 'state' | 'error'> | null | undefined) => job?.state === 'ready' && !job.error;

/** Progress within the current step, when the machine reports any. */
export function phaseProgress(progress: ImportJob['progress'] | null | undefined): { percent: number | null; bytes: boolean; files: boolean } {
  const bytes = !!progress && progress.bytesTotal > 0;
  const files = !!progress && progress.filesTotal > 0;
  const percent = bytes ? (progress!.bytesDone / progress!.bytesTotal) * 100 : files ? (progress!.filesDone / progress!.filesTotal) * 100 : null;
  return { percent: percent === null ? null : Math.max(0, Math.min(100, percent)), bytes, files };
}

/** The whole job as one number, for a banner: finished steps plus the share of the current one. */
export function overallPercent(mode: AddMode, job: Pick<ImportJob, 'phase' | 'state' | 'progress'> | null | undefined): number {
  if (!job) return 0;
  const steps = phaseSteps(mode).length;
  const at = phaseAt(mode, job.phase, job.state);
  if (at >= steps) return 100;
  return Math.floor(((at + (phaseProgress(job.progress).percent ?? 0) / 100) / steps) * 100);
}

// ------------------------------------------------------------------ errors

// Shown without review details, so none of these lines take arguments.
const createErrors: Record<string, MessageId> = {
  create_job_not_found: 'server-add.error.gone',
  creates_unavailable: 'server-add.error.unavailable',
  create_jobs_saturated: 'server-add.error.busy',
  not_supported_yet: 'server-add.error.not-yet',
  request_too_large: 'server-add.error.too-large',
  name_in_use: 'server-add.blocker.name',
  download_failed: 'server-add.error.download',
  integrity_conflict: 'server-add.error.integrity',
  install_failed: 'server-add.error.install',
  java_unresolved: 'vesta-server.blocker.java',
  provider_unavailable: 'server-add.blocker.provider',
  invalid_request: 'server-add.error.invalid',
  idempotency_key_required: 'server-add.error.invalid',
  replan_required: 'vesta-server.import.out-of-date',
  cancelled: 'server-add.error.cancelled',
  interrupted: 'server-add.error.interrupted',
  failed: 'server-add.error.step',
};
/** Every job and route error create.md documents beyond the ones import.md shares. */
export const CREATE_ERRORS = Object.keys(createErrors);

/** Lines worded for copying a folder that read better for a new server. */
const CREATE_INSTEAD: Partial<Record<MessageId, MessageId>> = {
  'vesta-server.import.failed': 'server-add.error.step',
  'vesta-server.import.busy': 'server-add.error.busy',
  'vesta-server.import.gone': 'server-add.error.gone',
  'vesta-server.import.unavailable': 'server-add.error.unavailable',
};

/** A job error or command failure as one friendly line, for any way of adding a server. */
export function addProblem(reason: unknown, mode: AddMode = 'import'): MessageId {
  const code = typeof reason === 'string' ? reason : toServerError(reason).reason;
  if (code && createErrors[code]) return createErrors[code]!;
  const line = importProblem(reason);
  return mode !== 'import' ? CREATE_INSTEAD[line] ?? line : line;
}

/** A failed apply that a fresh check fixes: the plan aged out or something changed. */
export const needsFreshPlan = (reason: unknown) => {
  const code = typeof reason === 'string' ? reason : toServerError(reason).reason;
  return ['plan_expired', 'confirmation_invalid', 'plan_blocked', 'source_changed', 'idempotency_conflict', 'conflict', 'replan_required'].includes(code ?? '');
};
