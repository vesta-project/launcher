import type { MessageId } from '../../localization/messages';

/** Pure browse helpers: types, source capabilities, query normalisation and version choice. */

export type ResourceType = 'mod' | 'modpack' | 'resourcepack' | 'shader' | 'datapack' | 'world';
export type SourceId = 'modrinth' | 'curseforge' | 'smithed';
export type SortOrder = 'asc' | 'desc';
export type ReleaseType = 'release' | 'beta' | 'alpha';

export const resourceTypes: ResourceType[] = ['mod', 'modpack', 'resourcepack', 'shader', 'datapack', 'world'];
export const loaderIds = ['fabric', 'forge', 'neoforge', 'quilt'] as const;
export const pageSizes = [20, 50, 100] as const;
/** CurseForge refuses result windows past 10 000 entries. */
export const maxResultWindow = 10_000;

export interface Creator {
  kind: 'author' | 'organization';
  id: string;
  name: string;
  icon_url: string | null;
}

export interface ResourceProject {
  id: string;
  source: SourceId;
  resource_type: ResourceType;
  name: string;
  summary: string;
  description: string | null;
  icon_url: string | null;
  author: string;
  authors: string[];
  author_details?: { id: string; username: string; avatar_url: string | null; is_owner?: boolean }[];
  organization?: { id: string; slug: string; name: string; icon_url: string | null } | null;
  download_count: number;
  follower_count: number;
  categories: string[];
  web_url: string;
  gallery: string[];
  featured_gallery?: string | null;
  published_at: string | null;
  updated_at: string | null;
  [field: string]: unknown;
}

export interface ResourceVersion {
  id: string;
  project_id: string;
  version_number: string;
  game_versions: string[];
  loaders: string[];
  download_url: string;
  file_name: string;
  release_type: ReleaseType;
  published_at?: string | null;
  files?: { url: string; role: string }[];
  [field: string]: unknown;
}

export interface ResourceCategory {
  id: string;
  name: string;
  icon_url: string | null;
  project_type: ResourceType | null;
  parent_id: string | null;
  display_index: number | null;
}

export interface SearchResponse {
  hits: ResourceProject[];
  total_hits: number;
}

export interface SortOption {
  value: string;
  label: MessageId;
}

export interface SourceDescriptor {
  id: SourceId;
  label: string;
  /** Icon path understood by `<Icon>`. */
  icon: string;
  types: ResourceType[];
  defaultSort: string;
  sortOptions: SortOption[];
  /** Whether the host honours `sort_order` for this source. */
  sortOrder: boolean;
  /** Types that offer the client/server environment filter. */
  environmentTypes: ResourceType[];
}

const everything: ResourceType[] = ['mod', 'modpack', 'resourcepack', 'shader', 'datapack', 'world'];

/** Mirrors the old launcher's source catalogue (and the Rust `SourceCapabilities`). */
export const sources: SourceDescriptor[] = [
  {
    id: 'modrinth',
    label: 'Modrinth',
    icon: 'branding/sources/modrinth',
    types: everything,
    defaultSort: 'relevance',
    sortOptions: [
      { value: 'relevance', label: 'browse.sort-relevance' },
      { value: 'downloads', label: 'browse.sort-downloads' },
      { value: 'follows', label: 'browse.sort-follows' },
      { value: 'newest', label: 'browse.sort-newest' },
      { value: 'updated', label: 'browse.sort-updated' },
    ],
    sortOrder: false,
    environmentTypes: ['mod', 'modpack'],
  },
  {
    id: 'curseforge',
    label: 'CurseForge',
    icon: 'branding/sources/curseforge',
    types: everything,
    defaultSort: 'featured',
    sortOptions: [
      { value: 'featured', label: 'browse.sort-featured' },
      { value: 'popularity', label: 'browse.sort-popularity' },
      { value: 'updated', label: 'browse.sort-updated' },
      { value: 'newest', label: 'browse.sort-newest' },
      { value: 'rating', label: 'browse.sort-rating' },
      { value: 'name', label: 'browse.sort-name' },
      { value: 'author', label: 'browse.sort-author' },
      { value: 'total_downloads', label: 'browse.sort-total-downloads' },
    ],
    sortOrder: true,
    environmentTypes: [],
  },
  {
    id: 'smithed',
    label: 'Smithed',
    icon: 'branding/sources/smithed',
    types: ['datapack'],
    defaultSort: 'trending',
    sortOptions: [
      { value: 'trending', label: 'browse.sort-trending' },
      { value: 'downloads', label: 'browse.sort-downloads' },
      { value: 'alphabetically', label: 'browse.sort-name' },
      { value: 'newest', label: 'browse.sort-newest' },
    ],
    sortOrder: false,
    environmentTypes: [],
  },
];

export const sourceById = (id: SourceId): SourceDescriptor => sources.find((source) => source.id === id) ?? sources[0];
export const sourcesForType = (type: ResourceType) => sources.filter((source) => source.types.includes(type));
export const firstSourceForType = (type: ResourceType) => sourcesForType(type)[0] ?? sources[0];
export const supportsEnvironment = (source: SourceId, type: ResourceType) =>
  sourceById(source).environmentTypes.includes(type);
/** Mods and modpacks are the only types the host filters by loader. */
export const typeUsesLoader = (type: ResourceType) => type === 'mod' || type === 'modpack';
export const isResourceType = (value: unknown): value is ResourceType => resourceTypes.includes(value as ResourceType);
export const isSourceId = (value: unknown): value is SourceId => sources.some((source) => source.id === value);

/* ---- Query ---- */

export interface BrowseQuery {
  type: ResourceType;
  source: SourceId;
  text: string;
  gameVersion: string | null;
  loader: string | null;
  client: boolean;
  server: boolean;
  creator: Creator | null;
  categories: string[];
  sort: string;
  sortOrder: SortOrder;
  pageSize: number;
  page: number;
}

const blank = (value: string | null | undefined) => {
  const trimmed = value?.replace(/\s+/g, ' ').trim();
  return trimmed ? trimmed : null;
};

/** Drops everything the host would ignore so equivalent searches share one cache entry. */
export function normalizeQuery(query: BrowseQuery): BrowseQuery {
  const source = sourceById(query.source);
  const sortKnown = source.sortOptions.some((option) => option.value === query.sort);
  const environment = supportsEnvironment(query.source, query.type);
  return {
    type: query.type,
    source: query.source,
    text: blank(query.text) ?? '',
    gameVersion: blank(query.gameVersion),
    loader: typeUsesLoader(query.type) ? (blank(query.loader)?.toLowerCase() ?? null) : null,
    client: environment && query.client,
    server: environment && query.server,
    creator: query.creator,
    categories: [...new Set(query.categories)].sort(),
    sort: sortKnown ? query.sort : source.defaultSort,
    sortOrder: source.sortOrder ? query.sortOrder : 'desc',
    pageSize: query.pageSize,
    page: Math.max(1, Math.floor(query.page) || 1),
  };
}

/** Key for everything that changes the result set; `withPage` adds the page window. */
export function queryKey(query: BrowseQuery, withPage = true): string {
  const q = normalizeQuery(query);
  return JSON.stringify([
    q.source,
    q.type,
    q.text,
    q.gameVersion,
    q.loader,
    q.client,
    q.server,
    q.creator ? [q.creator.kind, q.creator.id] : null,
    q.categories,
    q.sort,
    q.sortOrder,
    q.pageSize,
    withPage ? q.page : 0,
  ]);
}

/** Snake-case payload for `search_resources`. */
export function hostQuery(query: BrowseQuery) {
  const q = normalizeQuery(query);
  return {
    text: q.text || null,
    resource_type: q.type,
    offset: (q.page - 1) * q.pageSize,
    limit: q.pageSize,
    game_version: q.gameVersion,
    loader: q.loader,
    client: q.client,
    server: q.server,
    creator: q.creator,
    categories: q.categories.length ? q.categories : null,
    sort_by: q.sort,
    sort_order: q.sortOrder,
  };
}

export function pageCount(total: number, pageSize: number): number {
  const window = Math.min(total, maxResultWindow);
  return Math.max(1, Math.ceil(window / pageSize));
}

/** Number of active filters shown on the Filters button (text and sort are not filters). */
export function filterCount(query: BrowseQuery, hasTarget: boolean): number {
  const q = normalizeQuery(query);
  return (
    (hasTarget ? 1 : 0) +
    (q.gameVersion ? 1 : 0) +
    (q.loader ? 1 : 0) +
    (q.client ? 1 : 0) +
    (q.server ? 1 : 0) +
    (q.creator ? 1 : 0) +
    q.categories.length
  );
}

/* ---- Search operators ---- */

const loaderAliases: Record<string, string> = {
  forge: 'forge',
  fabric: 'fabric',
  quilt: 'quilt',
  neoforge: 'neoforge',
  neo: 'neoforge',
};
const completeVersion = /^\d+\.\d+(\.\d+)*([-+][\w.]+)?$/i;
const versionRange = /^\d+(\.\d+)+-\d+(\.\d+)+$/;

export interface ParsedOperators {
  remainder: string;
  gameVersion?: string;
  loader?: string;
  didExtract: boolean;
}

/**
 * Extracts `mc:1.21.1` (alias `version:`) and `loader:fabric|neo` from search text.
 * A token commits once whitespace follows it, or at the end of the text with `commitTrailing`
 * (Enter). Version ranges and unknown loaders stay in the text.
 */
export function parseOperators(input: string, options: { commitTrailing?: boolean } = {}): ParsedOperators {
  const pattern = /\b(mc|version|loader):(\S+)/gi;
  const result: ParsedOperators = { remainder: input, didExtract: false };
  const removals: [number, number][] = [];
  for (let match = pattern.exec(input); match; match = pattern.exec(input)) {
    const key = match[1].toLowerCase();
    const value = match[2];
    const start = match.index;
    const end = start + match[0].length;
    const atEnd = input.slice(end).trim() === '';
    const spaced = end < input.length && /\s/.test(input.charAt(end));
    if (!(spaced || (options.commitTrailing && atEnd))) continue;
    if (key === 'loader') {
      const loader = loaderAliases[value.toLowerCase()];
      if (!loader) continue;
      result.loader = loader;
    } else {
      if (versionRange.test(value) || !completeVersion.test(value)) continue;
      result.gameVersion = value;
    }
    removals.push([start, end]);
  }
  if (!removals.length) return result;
  let remainder = input;
  for (const [start, end] of removals.reverse()) remainder = remainder.slice(0, start) + remainder.slice(end);
  return { ...result, remainder: remainder.replace(/\s+/g, ' ').trim(), didExtract: true };
}

/* ---- Project URLs ---- */

export interface ProjectUrl {
  platform: SourceId;
  id: string;
}

function unwrapLinkout(url: string): string {
  try {
    const parsed = new URL(url);
    const remote = parsed.pathname === '/linkout' ? parsed.searchParams.get('remoteUrl') : null;
    if (!remote) return url;
    let decoded = decodeURIComponent(remote);
    if (decoded.includes('%')) {
      try {
        decoded = decodeURIComponent(decoded);
      } catch {
        // Keep the once-decoded value.
      }
    }
    return decoded;
  } catch {
    return url;
  }
}

/** Recognises Modrinth, CurseForge and Smithed project pages; anything else is `undefined`. */
export function parseProjectUrl(input: string): ProjectUrl | undefined {
  const text = input.trim();
  if (!/^https?:\/\//i.test(text) || /\s/.test(text)) return undefined;
  try {
    const url = new URL(unwrapLinkout(text));
    const host = url.hostname.toLowerCase();
    const parts = url.pathname.split('/').filter(Boolean);
    if (host === 'modrinth.com' || host.endsWith('.modrinth.com')) {
      const valid = ['mod', 'resourcepack', 'shader', 'datapack', 'modpack', 'plugin'];
      if (parts.length >= 2 && valid.includes(parts[0])) return { platform: 'modrinth', id: parts[1] };
    }
    if (host === 'www.curseforge.com' || host === 'curseforge.com') {
      if (parts.length >= 3 && parts[0] === 'minecraft') return { platform: 'curseforge', id: parts[2] };
    }
    if (host === 'minecraft.curseforge.com' && parts[0] === 'projects' && parts[1])
      return { platform: 'curseforge', id: parts[1] };
    if (
      (host === 'smithed.dev' ||
        host.endsWith('.smithed.dev') ||
        host === 'smithed.net' ||
        host.endsWith('.smithed.net')) &&
      parts[0] === 'packs' &&
      parts[1]
    )
      return { platform: 'smithed', id: parts[1] };
  } catch {
    // Not a URL after all.
  }
  return undefined;
}

export const projectPath = (platform: string, id: string) =>
  `/browse/project/${encodeURIComponent(platform)}/${encodeURIComponent(id)}`;

/* ---- Categories ---- */

export interface CategoryItem {
  id: string;
  name: string;
  icon: string | null;
  index: number;
}
export interface CategoryGroup {
  /** Selectable parent id (CurseForge) or undefined for the flat/general group. */
  id?: string;
  name: string;
  icon: string | null;
  items: CategoryItem[];
}

const byIndex = (a: CategoryItem, b: CategoryItem) => a.index - b.index || a.name.localeCompare(b.name);
const asItem = (category: ResourceCategory): CategoryItem => ({
  id: category.id,
  name: category.name,
  icon: category.icon_url,
  index: category.display_index ?? 0,
});

/** Modrinth lists loaders among its categories; they are loader filters, not facets. */
export const isLoaderCategory = (id: string) => (loaderIds as readonly string[]).includes(id.toLowerCase());

export function categoriesForType(all: ResourceCategory[], type: ResourceType): ResourceCategory[] {
  return all.filter(
    (category) => (!category.project_type || category.project_type === type) && !isLoaderCategory(category.id),
  );
}

/** CurseForge nests categories under parents; Modrinth is one flat, alphabetical group. */
export function buildCategoryGroups(all: ResourceCategory[], source: SourceId): CategoryGroup[] {
  if (!all.length) return [];
  if (source !== 'curseforge') {
    const items = all.map(asItem).sort((a, b) => a.name.localeCompare(b.name));
    return [{ name: '', icon: null, items }];
  }
  const ids = new Set(all.map((category) => category.id));
  const top = all.filter((category) => !category.parent_id || !ids.has(category.parent_id));
  const groups: (CategoryGroup & { index: number })[] = [];
  const general: CategoryItem[] = [];
  for (const parent of top) {
    const children = all.filter((category) => category.parent_id === parent.id);
    if (children.length)
      groups.push({
        id: parent.id,
        name: parent.name,
        icon: parent.icon_url,
        index: parent.display_index ?? 0,
        items: children.map(asItem).sort(byIndex),
      });
    else general.push(asItem(parent));
  }
  groups.sort((a, b) => a.index - b.index || a.name.localeCompare(b.name));
  const result: CategoryGroup[] = groups;
  if (general.length) result.unshift({ name: '', icon: null, items: general.sort(byIndex) });
  return result;
}

/** The most useful categories for the quick row: top-level entries, host order, capped. */
export function quickCategories(all: ResourceCategory[], selected: string[], limit = 24): CategoryItem[] {
  const ids = new Set(all.map((category) => category.id));
  const top = all
    .filter((category) => !category.parent_id || !ids.has(category.parent_id))
    .map(asItem)
    .sort(byIndex)
    .slice(0, limit);
  const have = new Set(top.map((item) => item.id));
  const extra = selected
    .filter((id) => !have.has(id))
    .map((id) => {
      const found = all.find((category) => category.id === id);
      return found ? asItem(found) : { id, name: id, icon: null, index: 0 };
    });
  return [...extra, ...top];
}

/** A readable label for a category id carried on a project hit. */
export function categoryLabel(id: string, names: ReadonlyMap<string, string>): string {
  const known = names.get(id) ?? names.get(id.toLowerCase());
  if (known) return known;
  return id.charAt(0).toUpperCase() + id.slice(1).replace(/[-_]+/g, ' ');
}

/* ---- Compatibility and version selection ---- */

export interface InstallTarget {
  minecraftVersion: string;
  modloader: string;
}

export type Compatibility =
  | { kind: 'compatible' }
  | { kind: 'warning'; reason: 'fabric-on-quilt' | 'forge-on-neoforge' }
  | { kind: 'incompatible'; reason: 'vanilla' | 'loader' };

const loaderOf = (target: InstallTarget) => (target.modloader || 'vanilla').toLowerCase();

/** Cheap check from the project's own categories; versions refine it at install time. */
export function projectCompatibility(
  project: Pick<ResourceProject, 'categories'>,
  type: ResourceType,
  target: InstallTarget,
): Compatibility {
  const loader = loaderOf(target);
  if (loader === 'vanilla') {
    return type === 'mod' || type === 'shader' ? { kind: 'incompatible', reason: 'vanilla' } : { kind: 'compatible' };
  }
  if (type !== 'mod') return { kind: 'compatible' };
  const declared = new Set(project.categories.map((category) => category.toLowerCase()));
  if (!loaderIds.some((id) => declared.has(id)) || declared.has(loader)) return { kind: 'compatible' };
  if (loader === 'quilt' && declared.has('fabric')) return { kind: 'warning', reason: 'fabric-on-quilt' };
  if (loader === 'neoforge' && declared.has('forge')) return { kind: 'warning', reason: 'forge-on-neoforge' };
  return { kind: 'incompatible', reason: 'loader' };
}

const normalizeMinecraft = (version: string) =>
  version.trim().endsWith('.0') ? version.trim().slice(0, -2) : version.trim();

export function gameVersionMatches(supported: readonly string[], target: string): boolean {
  const wanted = normalizeMinecraft(target);
  const line = wanted.split('.').slice(0, 2).join('.');
  return supported.some((version) => {
    const candidate = normalizeMinecraft(version);
    return candidate === wanted || candidate === `${line}.x`;
  });
}

function loaderMatches(version: ResourceVersion, type: ResourceType, target: InstallTarget): boolean {
  const loader = loaderOf(target);
  const loaders = version.loaders.map((item) => item.toLowerCase());
  // Only mods are bound to the instance's loader; packs, shaders, worlds and data are not.
  if (type !== 'mod') return true;
  if (loader === 'vanilla') return false;
  if (loaders.includes(loader)) return true;
  if (loader === 'quilt') return loaders.includes('fabric');
  if (loader === 'neoforge') return loaders.includes('forge');
  return false;
}

const rank: Record<ReleaseType, number> = { release: 0, beta: 1, alpha: 2 };

export interface VersionChoice {
  version: ResourceVersion;
  /** The loader was taken from a compatible sibling (Fabric on Quilt, Forge on NeoForge). */
  borrowedLoader: boolean;
}

/**
 * The version to install into a target: the newest release matching its Minecraft version
 * (and loader for mods), falling back to beta then alpha builds. Prefers exact version tags
 * over `1.21.x` ranges within one stability tier.
 */
export function selectInstallVersion(
  versions: readonly ResourceVersion[],
  target: InstallTarget,
  type: ResourceType,
  source?: SourceId,
): VersionChoice | undefined {
  const compatible = versions.filter((version) => {
    if (
      type === 'datapack' &&
      source === 'modrinth' &&
      !version.loaders.some((item) => item.toLowerCase() === 'datapack')
    )
      return false;
    return gameVersionMatches(version.game_versions, target.minecraftVersion) && loaderMatches(version, type, target);
  });
  const exact = (version: ResourceVersion) => version.game_versions.includes(target.minecraftVersion);
  const time = (version: ResourceVersion) => String(version.published_at ?? '');
  const best = [...compatible].sort(
    (a, b) =>
      rank[a.release_type] - rank[b.release_type] ||
      Number(exact(b)) - Number(exact(a)) ||
      time(b).localeCompare(time(a)),
  )[0];
  if (!best) return undefined;
  const loader = loaderOf(target);
  return {
    version: best,
    borrowedLoader: type === 'mod' && !best.loaders.some((item) => item.toLowerCase() === loader),
  };
}

/** Mirrors the host artifact target rule, including companion datapack files. */
export function requiresWorldTarget(version: ResourceVersion, kind: ResourceType): boolean {
  return kind === 'datapack' || !!version.files?.some((file) =>
    ['datapack', 'data-pack'].includes(file.role.trim().toLowerCase()));
}

/** Whether the installed row differs from what would be installed now. */
export function updateAvailable(
  installed: { remote_version_id: string } | undefined,
  choice: VersionChoice | undefined,
): boolean {
  return !!installed && !!choice && installed.remote_version_id !== choice.version.id;
}

/** Providers sometimes withhold the file (third-party downloads off); only the website can serve it. */
export const hasDownloadableArtifact = (version: Pick<ResourceVersion, 'download_url' | 'files'>) =>
  version.files?.length
    ? version.files.every((file) => !!file.url?.trim())
    : !!version.download_url?.trim();

export const projectKey = (platform: string, id: string) => `${platform}:${id}`;

/** Creator filter for a hit's owner (organisation first), as the old launcher did. */
export function creatorOf(project: ResourceProject): Creator | undefined {
  if (project.organization)
    return {
      kind: 'organization',
      id: project.organization.id,
      name: project.organization.name,
      icon_url: project.organization.icon_url,
    };
  const owner = project.author_details?.find((author) => author.is_owner) ?? project.author_details?.[0];
  if (!owner?.id) return undefined;
  return { kind: 'author', id: owner.id, name: owner.username, icon_url: owner.avatar_url };
}

export const ownerName = (project: ResourceProject) =>
  project.organization?.name ||
  project.author_details?.find((author) => author.is_owner)?.username ||
  project.author ||
  project.authors[0] ||
  '';

/* ---- Formatting ---- */

export function formatCompact(value: number, locale?: string): string {
  return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

const units: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 86_400_000],
  ['month', 30 * 86_400_000],
  ['week', 7 * 86_400_000],
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
];

/** "3 days ago" style text; empty when the date is missing or invalid. */
export function formatRelative(date: string | null | undefined, now: number, locale?: string): string {
  const time = date ? Date.parse(date) : NaN;
  if (!Number.isFinite(time)) return '';
  const diff = time - now;
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  for (const [unit, size] of units) if (Math.abs(diff) >= size) return format.format(Math.round(diff / size), unit);
  return format.format(0, 'minute');
}

export function initialOf(name: string): string {
  const match = name.match(/[\p{L}\p{N}]/u);
  return (match ? match[0] : name.charAt(0) || '?').toUpperCase();
}

/* ---- Install bookkeeping ---- */

const decodeBase64Url = (value: string): string | undefined => {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return undefined;
  try {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
    return new TextDecoder().decode(Uint8Array.from(atob(padded), (char) => char.charCodeAt(0)));
  } catch {
    return undefined;
  }
};

/**
 * Whether a `resource-install-error` task id belongs to an install. Task ids are
 * `download|v2|<target>|<platform>|<projectB64>|<versionB64>`, the older pipe form, or the
 * legacy `download_<target>_<project>_<version>`; unknown shapes never match.
 */
export function taskMatchesInstall(
  taskId: string,
  install: { instanceId: string; platform: string; projectId: string; versionId: string },
): boolean {
  const target = `instance-${install.instanceId}`;
  if (taskId.startsWith('download|')) {
    const parts = taskId.split('|');
    const v2 = parts[1] === 'v2';
    const fields = v2 ? parts.slice(2) : parts.slice(1);
    // v2: target, platform, project, version. Earlier: target, project, version.
    const [where, platform, project, version] = v2 ? fields : [fields[0], undefined, fields[1], fields[2]];
    const decoded = [project, version].map((field) => (field === undefined ? undefined : decodeBase64Url(field)));
    return (
      where === target &&
      (!platform || platform === install.platform.toLowerCase()) &&
      decoded[0] === install.projectId &&
      decoded[1] === install.versionId
    );
  }
  return taskId === `download_${target}_${install.projectId}_${install.versionId}`;
}
