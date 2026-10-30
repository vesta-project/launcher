// Pure model for Browse install targets beyond instances: which servers can receive a
// project, where on the server it goes (server files, client modpack or both), and why a
// choice is unavailable. No IO here; `server-install.ts` holds the effectful glue.
import { canInstallServerModpack, gate } from '../servers/capabilities';
import type { ConnectionId, ServerSnapshot } from '../servers/native';
import {
  gameVersionMatches,
  projectCompatibility,
  selectInstallVersion,
  type ResourceProject,
  type ResourceType,
  type ResourceVersion,
  type SourceId,
} from './browse-model';
import type { ContentProvider, ServerContentKind, ServerDependencyPreview } from '../servers/native-content';
import type { PackWorkspace } from '../servers/native-pack';

/* ---- Project sides ---- */

export type Side = 'required' | 'optional' | 'unsupported' | 'unknown';
export interface ProjectSides {
  client: Side;
  server: Side;
}

const isSide = (value: unknown): value is Exclude<Side, 'unknown'> =>
  value === 'required' || value === 'optional' || value === 'unsupported';

function side(requirement: unknown, raw: unknown, flag: unknown): Side {
  if (isSide(requirement)) return requirement;
  if (isSide(raw)) return raw;
  // The booleans only say "runs there", not whether it is needed there.
  if (flag === true) return 'optional';
  if (flag === false) return 'unsupported';
  return 'unknown';
}

/**
 * Where a project runs. Reads the normalized `environment.client_requirement` /
 * `server_requirement` when present, then provider `client_side` / `server_side`
 * strings, then the `environment` booleans every source fills today.
 */
export function projectSides(project: Pick<ResourceProject, 'environment'> & Record<string, unknown>): ProjectSides {
  const environment = (project.environment ?? null) as Record<string, unknown> | null;
  return {
    client: side(environment?.client_requirement, project.client_side, environment?.client),
    server: side(environment?.server_requirement, project.server_side, environment?.server),
  };
}

const runs = (value: Side) => value !== 'unsupported';

/* ---- Server software ---- */

export type ServerFamily = 'modded' | 'plugin' | 'vanilla' | 'unknown';
const MOD_SOFTWARE = ['fabric', 'quilt', 'forge', 'neoforge'];
const PLUGIN_SOFTWARE = ['paper', 'folia', 'purpur', 'spigot', 'bukkit'];

export function softwareFamily(software: string | null | undefined): ServerFamily {
  const id = (software ?? '').toLowerCase();
  if (MOD_SOFTWARE.includes(id)) return 'modded';
  if (PLUGIN_SOFTWARE.includes(id)) return 'plugin';
  if (id === 'vanilla') return 'vanilla';
  return 'unknown';
}

/** Plugin loaders a server family runs: Paper runs Bukkit/Spigot plugins, Purpur also Paper ones. */
export function pluginLoadersFor(software: string | null | undefined): string[] {
  switch ((software ?? '').toLowerCase()) {
    case 'folia':
      return ['folia'];
    case 'purpur':
      return ['purpur', 'paper', 'spigot', 'bukkit'];
    case 'paper':
      return ['paper', 'spigot', 'bukkit'];
    case 'spigot':
      return ['spigot', 'bukkit'];
    case 'bukkit':
      return ['bukkit'];
    default:
      return [];
  }
}

/* ---- Server targets ---- */

export type ServerConnectionState = 'online' | 'connecting' | 'offline' | 'access';
export type ClientPackState = 'checking' | 'unconfigured' | 'ready' | 'unavailable';

/** Merely reading an untouched draft must not opt a server into client-pack installs. */
export function clientPackState(workspace: Pick<PackWorkspace, 'draft' | 'publishedRevision'>): ClientPackState {
  const saved = (revision: string) => /^\d+$/.test(revision) && /[1-9]/.test(revision);
  return saved(workspace.draft.revision) || saved(workspace.publishedRevision) ? 'ready' : 'unconfigured';
}

export function canTargetClientPack(project: Pick<ResourceProject, 'resource_type' | 'environment'> & Record<string, unknown>): boolean {
  return ['mod', 'resourcepack', 'shader'].includes(project.resource_type) && projectSides(project).client !== 'unsupported';
}

/** Datapacks proceed to the instance's world chooser; plugins never create client instances. */
export function canTargetInstance(project: Pick<ResourceProject, 'resource_type' | 'environment'> & Record<string, unknown>): boolean {
  return project.resource_type !== 'plugin' && (project.resource_type !== 'mod' || projectSides(project).client !== 'unsupported');
}

export interface ServerTarget {
  id: ConnectionId;
  /** Seed for generated art when the server has no icon. */
  serverId: string;
  name: string;
  minecraftVersion: string | null;
  /** Managed software id; `null` when unidentified, `undefined` while still loading. */
  software: string | null | undefined;
  connection: ServerConnectionState;
  /** May install into the server's files (`content.install`). */
  canInstall: boolean;
  canInstallModpack?: boolean;
  /** May edit the client modpack draft (`pack.edit`). */
  canEditPack: boolean;
  /** Per-server setup, independent from global API support and edit permission. */
  clientPack?: ClientPackState;
}

export const SERVER_INSTALL_CAPABILITY = 'content.install';
export const PACK_EDIT_CAPABILITY = 'pack.edit';

/** Unknown capability sets count as allowed; the server authorizes the request itself. */
export function serverPermissions(snapshot: Pick<ServerSnapshot, 'capabilities'>) {
  return {
    server: gate(snapshot.capabilities, SERVER_INSTALL_CAPABILITY) !== 'denied',
    modpack: gate(snapshot.capabilities, PACK_EDIT_CAPABILITY) !== 'denied',
  };
}

export function connectionState(snapshot: Pick<ServerSnapshot, 'state'>): ServerConnectionState {
  if (snapshot.state.access !== 'paired') return 'access';
  if (snapshot.state.phase === 'online') return 'online';
  if (snapshot.state.phase === 'connecting' || snapshot.state.phase === 'backoff') return 'connecting';
  return 'offline';
}

/** Servers the user may install to or edit the pack of. Others are left out entirely. */
export function serverTargets(
  snapshots: readonly ServerSnapshot[],
  software: (id: ConnectionId) => string | null | undefined,
  clientPack: (id: ConnectionId) => ClientPackState = () => 'checking',
): ServerTarget[] {
  return snapshots.flatMap((snapshot) => {
    const allowed = serverPermissions(snapshot);
    if (!allowed.server && !allowed.modpack) return [];
    const { connection } = snapshot;
    return [
      {
        id: connection.id,
        serverId: connection.serverId || connection.id,
        name: connection.name,
        minecraftVersion: snapshot.info?.minecraftVersion || null,
        software: software(connection.id),
        connection: connectionState(snapshot),
        canInstall: allowed.server,
        canInstallModpack: canInstallServerModpack(snapshot.capabilities, connection.role),
        canEditPack: allowed.modpack,
        clientPack: clientPack(connection.id),
      },
    ];
  });
}

/* ---- Destinations ---- */

export type Destination = 'server' | 'modpack' | 'both';
export const destinations: Destination[] = ['server', 'modpack', 'both'];

/** The Browse destination uses the same readiness flag as the pack workspace contract. */
export { MODPACK_TARGET_READY } from '../servers/native-pack';
import { MODPACK_TARGET_READY } from '../servers/native-pack';

export type TargetReason =
  | 'offline'
  | 'connecting'
  | 'access'
  | 'no-permission'
  | 'unknown-version'
  | 'checking'
  | 'not-server-content'
  | 'not-client-content'
  | 'client-only'
  | 'server-only'
  | 'needs-mod-loader'
  | 'needs-plugin-server'
  | 'unknown-software'
  | 'loader'
  | 'no-version'
  | 'modpack-coming'
  | 'modpack-not-configured'
  | 'modpack-unavailable';

export type DestinationState = { available: true } | { available: false; reason: TargetReason };
const ok: DestinationState = { available: true };
const no = (reason: TargetReason): DestinationState => ({ available: false, reason });

export interface TargetInput {
  project: Pick<ResourceProject, 'categories' | 'environment' | 'source'> & Record<string, unknown>;
  kind: ResourceType;
  /** Undefined while loading or when the list could not be read; checks then stay optimistic. */
  versions?: readonly ResourceVersion[];
  /** A version page installs exactly this version. */
  pinned?: ResourceVersion;
  /** Overrides MODPACK_TARGET_READY; for checks. */
  modpackReady?: boolean;
}

/** The version a server receives, or undefined when none fits its Minecraft version and software. */
export function serverVersion(
  versions: readonly ResourceVersion[],
  target: Pick<ServerTarget, 'minecraftVersion' | 'software'>,
  kind: ResourceType,
  source?: SourceId,
): ResourceVersion | undefined {
  const minecraftVersion = target.minecraftVersion ?? '';
  if (kind === 'plugin') {
    const accepted = pluginLoadersFor(target.software);
    return versions.find(
      (version) =>
        gameVersionMatches(version.game_versions, minecraftVersion) &&
        version.loaders.some((loader) => accepted.includes(loader.toLowerCase())),
    );
  }
  return selectInstallVersion(versions, { minecraftVersion, modloader: target.software ?? 'vanilla' }, kind, source)
    ?.version;
}

/** The version the client modpack receives: its loader is free, its Minecraft version is the server's. */
export function modpackVersion(
  versions: readonly ResourceVersion[],
  target: Pick<ServerTarget, 'minecraftVersion'>,
): ResourceVersion | undefined {
  return versions.find((version) => gameVersionMatches(version.game_versions, target.minecraftVersion ?? ''));
}

function serverState(target: ServerTarget, input: TargetInput): DestinationState {
  const { kind, project } = input;
  if (!target.canInstall) return no('no-permission');
  if (kind !== 'mod' && kind !== 'plugin' && kind !== 'datapack') return no('not-server-content');
  // Side flags describe mods. Plugins belong to the server, datapacks to its world.
  if (kind === 'mod' && projectSides(project).server === 'unsupported') return no('client-only');
  if (kind !== 'datapack') {
    if (target.software === undefined) return no('checking');
    const family = softwareFamily(target.software);
    if (kind === 'mod' && family === 'unknown') return no('unknown-software');
    if (kind === 'plugin' && family === 'unknown') return no('unknown-software');
    if (kind === 'mod' && family !== 'modded') return no('needs-mod-loader');
    if (kind === 'plugin' && family !== 'plugin') return no('needs-plugin-server');
    if (
      kind === 'mod' &&
      projectCompatibility(project, 'mod', { minecraftVersion: target.minecraftVersion ?? '', modloader: target.software ?? '' })
        .kind === 'incompatible'
    )
      return no('loader');
  }
  const candidates = input.pinned ? [input.pinned] : input.versions;
  if (candidates && !serverVersion(candidates, target, kind, project.source)) return no('no-version');
  return ok;
}

function modpackState(target: ServerTarget, input: TargetInput): DestinationState {
  const { kind, project } = input;
  if (!target.canEditPack) return no('no-permission');
  if (kind !== 'mod' && kind !== 'resourcepack' && kind !== 'shader') return no('not-client-content');
  if (projectSides(project).client === 'unsupported') return no('server-only');
  if (target.clientPack === 'unconfigured') return no('modpack-not-configured');
  if (target.clientPack === 'unavailable') return no('modpack-unavailable');
  if (target.clientPack !== 'ready') return no('checking');
  const candidates = input.pinned ? [input.pinned] : input.versions;
  if (candidates && !modpackVersion(candidates, target)) return no('no-version');
  if (!(input.modpackReady ?? MODPACK_TARGET_READY)) return no('modpack-coming');
  return ok;
}

export interface TargetStates {
  /** Whether the server row can be chosen at all, and why not. */
  row: DestinationState;
  /** Set when the row can be chosen but only one destination is valid. */
  only?: 'server' | 'modpack';
  server: DestinationState;
  modpack: DestinationState;
  both: DestinationState;
}

export function targetStates(target: ServerTarget, input: TargetInput): TargetStates {
  const server = serverState(target, input);
  const modpack = modpackState(target, input);
  const both = !server.available ? server : !modpack.available ? modpack : ok;
  const blocked = (reason: TargetReason): TargetStates => ({
    row: no(reason),
    server: no(reason),
    modpack: no(reason),
    both: no(reason),
  });
  if (target.connection !== 'online') return blocked(target.connection);
  if (!target.minecraftVersion) return blocked('unknown-version');
  // Like instances: a row with no valid destination is dimmed with the reason that matters most.
  if (!server.available && !modpack.available) {
    const clientDestination = input.kind === 'resourcepack' || input.kind === 'shader'
      || (input.kind === 'mod' && (projectSides(input.project).server === 'unsupported'
        || (server.reason === 'needs-mod-loader' && target.canEditPack)));
    return { row: clientDestination || !target.canInstall ? modpack : server, server, modpack, both };
  }
  const only = server.available && !modpack.available ? 'server' : !server.available ? 'modpack' : undefined;
  return { row: ok, ...(only ? { only } : {}), server, modpack, both };
}

/** Do not ask for a destination when exactly one of the two workspaces can receive it. */
export function soleDestination(states: TargetStates): 'server' | 'modpack' | undefined {
  return states.row.available ? states.only : undefined;
}

/** The destination the project's sides suggest, before availability is considered. */
export function preferredDestination(sides: ProjectSides, kind: ResourceType): Destination {
  if (kind === 'plugin' || kind === 'datapack') return 'server';
  if (kind === 'resourcepack' || kind === 'shader') return 'modpack';
  const client = runs(sides.client);
  const server = runs(sides.server);
  if (client && server) return 'both';
  if (server) return 'server';
  if (client) return 'modpack';
  return 'server';
}

const fallbacks: Record<Destination, Destination[]> = {
  both: ['both', 'server', 'modpack'],
  server: ['server', 'both'],
  modpack: ['modpack', 'both'],
};

/** The smart default: the preferred destination, else the closest available one. */
export function defaultDestination(
  sides: ProjectSides,
  kind: ResourceType,
  states?: Pick<TargetStates, Destination>,
): Destination {
  const preferred = preferredDestination(sides, kind);
  if (!states) return preferred;
  return fallbacks[preferred].find((destination) => states[destination].available) ?? preferred;
}

/* ---- Dependencies ---- */

export interface DependencyCandidate {
  /** Browse Both reviews each destination independently. Instance rows have no scope. */
  destination?: 'server' | 'modpack';
  project: Pick<ResourceProject, 'id' | 'name' | 'source'> & { icon_url?: string | null };
  /** Null while the resolver only knows the project, not the exact version. */
  version: Pick<ResourceVersion, 'id' | 'version_number'> | null;
  required: boolean;
  /** Already present at the target; shown, never installed again. */
  installed?: boolean;
}

export interface DependencyRow extends DependencyCandidate {
  selected: boolean;
}

/** Required dependencies start ticked, optional ones unticked, installed ones are left alone. */
export function dependencyRows(candidates: readonly DependencyCandidate[]): DependencyRow[] {
  return candidates.map((candidate) => ({ ...candidate, selected: candidate.required && !candidate.installed }));
}

/* ---- Server install requests ---- */

const PROVIDERS: readonly string[] = ['modrinth', 'curseforge'];
export const isContentProvider = (source: string): source is ContentProvider['provider'] => PROVIDERS.includes(source);
const SERVER_KINDS: readonly ResourceType[] = ['mod', 'plugin', 'datapack'];
export const isServerContentKind = (kind: ResourceType): kind is ServerContentKind => SERVER_KINDS.includes(kind);

/** The shared resolver's rows, as the install dialog shows them. */
export function previewCandidates(preview: Pick<ServerDependencyPreview, 'dependencies'>): DependencyCandidate[] {
  return preview.dependencies.map((dependency) => ({
    project: {
      id: dependency.project.id,
      name: dependency.project.name,
      source: dependency.project.source,
      icon_url: dependency.project.icon_url,
    },
    version: { id: dependency.version.id, version_number: dependency.version.version_number },
    required: dependency.required,
    installed: dependency.installed,
  }));
}

export interface ServerInstallItem extends ContentProvider {
  kind: ServerContentKind;
  name: string;
}

/**
 * What `installToServer` sends: the ticked, not yet installed dependencies first (so the root
 * finds them on its first start), then the project. Rows without an exact version are skipped;
 * the agent installs by provider version only. Null when the server cannot take this kind.
 */
export function serverInstallPlan(selection: { project: Pick<ResourceProject, 'id' | 'name' | 'source'>; version: Pick<ResourceVersion, 'id'>; kind: ResourceType; dependencies: readonly DependencyRow[] }): ServerInstallItem[] | null {
  const { project, version, kind } = selection;
  const source = project.source;
  if (!isServerContentKind(kind) || !isContentProvider(source)) return null;
  const dependencies = selection.dependencies.flatMap((row): ServerInstallItem[] => {
    const provider = row.project.source;
    return row.destination !== 'modpack' && row.selected && !row.installed && row.version && isContentProvider(provider)
      ? [{ provider, projectId: row.project.id, versionId: row.version.id, kind, name: row.project.name }]
      : [];
  });
  return [...dependencies, { provider: source, projectId: project.id, versionId: version.id, kind, name: project.name }];
}
