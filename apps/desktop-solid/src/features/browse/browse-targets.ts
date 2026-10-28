// Pure model for the Browse target dropdown: which instances and servers it offers, what
// choosing a server does to the filters and type tabs, and how the server's content inventory
// marks results as installed. No IO or reactivity here; the store and the dropdown hold that.
import {
  pluginLoaderIds,
  projectCompatibility,
  projectKey,
  type ResourceProject,
  type ResourceType,
} from './browse-model';
import {
  pluginLoadersFor,
  serverTargets,
  softwareFamily,
  type ServerFamily,
  type ServerTarget,
} from './install-targets';
import type { ServerSnapshot } from '../servers/native';
import type { ServerContentEntry, ServerContentInventory } from '../servers/native-content';

/* ---- Target references ---- */

export type TargetKind = 'instance' | 'server';
export interface BrowseTargetRef {
  kind: TargetKind;
  id: string;
}

/** Option values: `instance:<id>` or `server:<connection id>`; empty for "no target". */
export const targetValue = (ref: BrowseTargetRef | undefined) => (ref ? `${ref.kind}:${ref.id}` : '');

export function parseTargetValue(value: string | null | undefined): BrowseTargetRef | undefined {
  const match = /^(instance|server):(.+)$/.exec(value ?? '');
  return match ? { kind: match[1] as TargetKind, id: match[2]! } : undefined;
}

/** The Browse route for a target; it is what keeps the choice for the session. */
export function targetPath(ref: BrowseTargetRef | undefined): string {
  if (!ref) return '/browse';
  return ref.kind === 'server' ? `/browse/server/${encodeURIComponent(ref.id)}` : `/browse/for/${ref.id}`;
}

/* ---- Dropdown options ---- */

export interface InstanceEntry {
  id: string;
  name: string;
  image?: string;
  minecraftVersion: string;
  modloader: string;
}

export interface InstanceOption extends InstanceEntry {
  kind: 'instance';
  value: string;
}

export interface ServerOption extends ServerTarget {
  kind: 'server';
  value: string;
  /** Not online: still selectable for filtering, but shown as such. */
  unreachable: boolean;
}

export interface TargetOptions {
  instances: InstanceOption[];
  servers: ServerOption[];
  /** Whether the dropdown should offer its own search field. */
  searchable: boolean;
  /** Entries before the search narrowed them; drives `searchable` and empty states. */
  total: number;
}

/** More entries than this and the dropdown grows a search field. */
export const SEARCH_THRESHOLD = 7;

const normalize = (value: string | null | undefined) => (value ?? '').toLowerCase();
const matches = (needle: string, ...fields: (string | null | undefined)[]) =>
  !needle || fields.some((field) => normalize(field).includes(needle));

/**
 * Instances and servers the dropdown offers. Servers follow the install picker's permission
 * gate (content install or pack edit), and are kept when offline so they still scope results.
 * Modpacks always create a new instance, so their dropdown lists servers only.
 */
export function buildTargetOptions(input: {
  instances: readonly InstanceEntry[];
  snapshots: readonly ServerSnapshot[];
  software: (id: string) => string | null | undefined;
  /** The inventory's Minecraft version when known; it outranks the snapshot's. */
  minecraftVersion?: (id: string) => string | null | undefined;
  kind: ResourceType;
  query?: string;
}): TargetOptions {
  const needle = normalize(input.query).trim();
  const instances = input.kind === 'modpack' ? [] : input.instances;
  const servers = serverTargets(input.snapshots, input.software).map((target) => ({
    ...target,
    minecraftVersion: input.minecraftVersion?.(target.id) || target.minecraftVersion,
  }));
  const total = instances.length + servers.length;
  return {
    instances: instances
      .filter((entry) => matches(needle, entry.name, entry.minecraftVersion, entry.modloader))
      .map((entry) => ({ ...entry, kind: 'instance', value: targetValue({ kind: 'instance', id: entry.id }) })),
    servers: servers
      .filter((target) => matches(needle, target.name, target.minecraftVersion, target.software))
      .map((target) => ({
        ...target,
        kind: 'server',
        value: targetValue({ kind: 'server', id: target.id }),
        unreachable: target.connection !== 'online',
      })),
    searchable: total > SEARCH_THRESHOLD,
    total,
  };
}

/* ---- The chosen server ---- */

/**
 * What Browse knows about the chosen server: the picker's target plus the inventory's
 * authoritative Minecraft version and software. `failed` means the inventory cannot be read
 * (offline, no permission to list), so software is unknown instead of still loading.
 */
export function serverTargetInfo(
  snapshot: ServerSnapshot | undefined,
  inventory: Pick<ServerContentInventory, 'software' | 'minecraftVersion'> | undefined,
  failed: boolean,
): ServerTarget | undefined {
  if (!snapshot) return undefined;
  const [target] = serverTargets([snapshot], () => (inventory ? inventory.software : failed ? null : undefined));
  if (!target) return undefined;
  return { ...target, minecraftVersion: inventory?.minecraftVersion || target.minecraftVersion };
}

export const sameServerTarget = (a: ServerTarget | undefined, b: ServerTarget | undefined) =>
  a === b ||
  (!!a &&
    !!b &&
    a.id === b.id &&
    a.name === b.name &&
    a.minecraftVersion === b.minecraftVersion &&
    a.software === b.software &&
    a.connection === b.connection &&
    a.canInstall === b.canInstall &&
    a.canEditPack === b.canEditPack);

/* ---- Filters and tabs for a server ---- */

const resourceOrder: ResourceType[] = ['mod', 'plugin', 'modpack', 'resourcepack', 'shader', 'datapack', 'world'];
const ordered = (types: Iterable<ResourceType>) => {
  const set = new Set(types);
  return resourceOrder.filter((type) => set.has(type));
};

/**
 * The type tabs Browse shows for a server, or undefined while its software is unknown (all
 * tabs stay). Modded servers take mods, plugin servers (Paper, Spigot, …) plugins, every
 * server datapacks and a modpack. With pack edit rights the client modpack adds resource
 * packs and shaders. Client-only mods for a plugin or vanilla server's modpack are reached
 * from its pack page (which opens Browse on Mods explicitly), so the tabs stay about the
 * software here: Paper shows Plugins, not Mods.
 */
export function serverTypes(target: Pick<ServerTarget, 'software' | 'canEditPack'>): ResourceType[] | undefined {
  const family = softwareFamily(target.software);
  if (family === 'unknown') return undefined;
  const types = new Set<ResourceType>(['datapack', 'modpack']);
  if (family === 'modded') types.add('mod');
  if (family === 'plugin') types.add('plugin');
  if (target.canEditPack) {
    types.add('resourcepack');
    types.add('shader');
  }
  return ordered(types);
}

/** The tab a server opens on: what its software primarily runs. */
export function primaryServerType(family: ServerFamily): ResourceType | undefined {
  switch (family) {
    case 'modded':
      return 'mod';
    case 'plugin':
      return 'plugin';
    case 'vanilla':
      return 'datapack';
    default:
      return undefined;
  }
}

export interface ServerFilters {
  gameVersion: string | null;
  /** Kept for every type; Browse drops it for types without a loader filter. */
  loader: string | null;
}

/**
 * Search filters for a server: its Minecraft version, and its mod loader when it runs one.
 * Plugin servers accept several plugin loaders (Paper also runs Spigot and Bukkit plugins), so
 * that filter stays open and the install state checks the project's loaders instead.
 */
export function serverFilters(target: Pick<ServerTarget, 'minecraftVersion' | 'software'>): ServerFilters {
  const family = softwareFamily(target.software);
  return {
    gameVersion: target.minecraftVersion || null,
    loader: family === 'modded' ? normalize(target.software) : null,
  };
}

/**
 * Everything choosing a server changes at once: the filters, and the type when the current
 * one does not fit (a Paper server opens on Plugins, a vanilla one on Datapacks).
 */
export function serverScope(
  target: Pick<ServerTarget, 'minecraftVersion' | 'software' | 'canEditPack'>,
  current: ResourceType,
): ServerFilters & { type: ResourceType; types: ResourceType[] | undefined } {
  const types = serverTypes(target);
  const primary = primaryServerType(softwareFamily(target.software));
  const type = !types || types.includes(current) || !primary ? current : primary;
  return { ...serverFilters(target), type, types };
}

/* ---- Installed marking ---- */

/** `platform:project` for every inventory item a provider identified; removals are excluded. */
export function serverInstalledKeys(items: readonly Pick<ServerContentEntry, 'provider' | 'pending'>[]): Set<string> {
  const keys = new Set<string>();
  for (const item of items) {
    if (!item.provider || item.pending === 'remove') continue;
    keys.add(projectKey(item.provider.provider, item.provider.projectId));
  }
  return keys;
}

export type ServerInstallState =
  | { kind: 'install' }
  | { kind: 'installed' }
  | { kind: 'unavailable'; reason: 'vanilla' | 'loader' };

/**
 * A result card's state with a server target. Installed comes from the inventory; the rest is
 * a cheap category check, the install picker decides the destination and exact version.
 */
export function serverInstallState(
  project: Pick<ResourceProject, 'source' | 'id' | 'categories' | 'resource_type'>,
  target: Pick<ServerTarget, 'minecraftVersion' | 'software' | 'canEditPack'>,
  installed: ReadonlySet<string>,
): ServerInstallState {
  const kind = project.resource_type;
  if (kind === 'modpack') return { kind: 'install' };
  if (installed.has(projectKey(project.source, project.id))) return { kind: 'installed' };
  const family = softwareFamily(target.software);
  if (family === 'unknown') return { kind: 'install' };
  if (kind === 'plugin') {
    if (family !== 'plugin') return { kind: 'unavailable', reason: 'loader' };
    const declared = project.categories.map(normalize).filter((id) => (pluginLoaderIds as readonly string[]).includes(id));
    const accepted = pluginLoadersFor(target.software);
    return declared.length && !declared.some((id) => accepted.includes(id))
      ? { kind: 'unavailable', reason: 'loader' }
      : { kind: 'install' };
  }
  if (kind === 'mod') {
    // Non-modded servers can still take client mods into their modpack.
    if (family !== 'modded') return target.canEditPack ? { kind: 'install' } : { kind: 'unavailable', reason: 'vanilla' };
    const fit = projectCompatibility(project, 'mod', {
      minecraftVersion: target.minecraftVersion ?? '',
      modloader: target.software ?? '',
    });
    return fit.kind === 'incompatible' ? { kind: 'unavailable', reason: fit.reason } : { kind: 'install' };
  }
  return { kind: 'install' };
}
