import { createMemo, createRoot, createSignal, untrack } from 'solid-js';
import { t } from '../../localization';
import { navigate } from '../../app/router';
import { RequestCache, CacheInvalidatedError } from '../../platform/cache/request-cache';
import { findInstance } from '../instances/catalog';
import {
  fetchCategories,
  fetchInstalled,
  installResource,
  onInstallEvents,
  searchResources,
  type InstalledRow,
} from './browse-api';
import {
  buildCategoryGroups,
  categoriesForType,
  creatorOf,
  categoryDisplayName,
  filterCount as countFilters,
  firstSourceForType,
  hostQuery,
  isResourceType,
  isSourceId,
  normalizeQuery,
  pageCount,
  projectCompatibility,
  projectKey,
  queryKey,
  quickCategories,
  selectInstallVersion,
  sourceById,
  taskMatchesInstall,
  typeUsesLoader,
  updateAvailable,
  hasDownloadableArtifact,
  requiresWorldTarget,
  type BrowseQuery,
  type Creator,
  type InstallTarget,
  type ResourceCategory,
  type ResourceProject,
  type ResourceType,
  type ResourceVersion,
  type SortOrder,
  type SourceId,
} from './browse-model';
import { loadVersions, seedProjects } from './browse-projects';
import {
  sameServerTarget,
  serverInstallState,
  serverScope,
  targetPath,
  type BrowseTargetRef,
} from './browse-targets';
import type { ServerTarget } from './install-targets';

/**
 * The one Browse store. It is module-level on purpose: leaving the page and coming back
 * restores filters, results and scroll position. Only type, source, banners and page size are
 * persisted (non-sensitive UI preferences).
 */

const hasWindow = typeof window !== 'undefined';
const prefsKey = 'vesta:browse:prefs';

interface Prefs {
  type: ResourceType;
  source: SourceId;
  /** Cards show the project's banner image (off: compact cards). */
  banners: boolean;
  pageSize: number;
}

function readPrefs(): Prefs {
  const fallback: Prefs = { type: 'mod', source: 'modrinth', banners: true, pageSize: 20 };
  if (!hasWindow) return fallback;
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(prefsKey) ?? 'null');
    if (!saved || typeof saved !== 'object') return fallback;
    const value = saved as Partial<Prefs>;
    const type = isResourceType(value.type) ? value.type : fallback.type;
    const source =
      isSourceId(value.source) && sourceById(value.source).types.includes(type)
        ? value.source
        : firstSourceForType(type).id;
    return {
      type,
      source,
      banners: value.banners !== false,
      pageSize: [20, 50, 100].includes(value.pageSize as number) ? (value.pageSize as number) : 20,
    };
  } catch {
    return fallback;
  }
}

const prefs = readPrefs();

const [type, setTypeSignal] = createSignal<ResourceType>(prefs.type, { name: 'browseType' });
const [source, setSourceSignal] = createSignal<SourceId>(prefs.source, { name: 'browseSource' });
const [text, setTextSignal] = createSignal('', { name: 'browseText' });
const [committedText, setCommittedText] = createSignal('', { name: 'browseCommittedText' });
const [gameVersion, setGameVersionSignal] = createSignal<string | null>(null, { name: 'browseGameVersion' });
const [loader, setLoaderSignal] = createSignal<string | null>(null, { name: 'browseLoader' });
const [client, setClientSignal] = createSignal(false, { name: 'browseClient' });
const [server, setServerSignal] = createSignal(false, { name: 'browseServer' });
const [creator, setCreatorSignal] = createSignal<Creator | null>(null, { name: 'browseCreator' });
const [categories, setCategoriesSignal] = createSignal<string[]>([], { name: 'browseCategories' });
const [sort, setSortSignal] = createSignal(sourceById(prefs.source).defaultSort, { name: 'browseSort' });
const [sortOrder, setSortOrderSignal] = createSignal<SortOrder>('desc', { name: 'browseSortOrder' });
const [banners, setBannersSignal] = createSignal(prefs.banners, { name: 'browseBanners' });
const [pageSize, setPageSizeSignal] = createSignal(prefs.pageSize, { name: 'browsePageSize' });
const [page, setPageSignal] = createSignal(1, { name: 'browsePage' });
const [targetId, setTargetId] = createSignal<string | undefined>(undefined, { name: 'browseTarget' });
const [expandedGroups, setExpandedGroups] = createSignal<ReadonlySet<string>>(new Set(), {
  name: 'browseExpandedGroups',
});

export {
  type,
  source,
  text,
  gameVersion,
  loader,
  client,
  server,
  creator,
  categories,
  sort,
  sortOrder,
  banners,
  pageSize,
  page,
  targetId,
  expandedGroups,
};

function savePrefs() {
  if (!hasWindow) return;
  try {
    localStorage.setItem(
      prefsKey,
      JSON.stringify({ type: type(), source: source(), banners: banners(), pageSize: pageSize() } satisfies Prefs),
    );
  } catch {
    // Preferences are session-only when storage is unavailable.
  }
}

/** Everything that selects a result set, normalised. Read inside a memo. */
export const query = (): BrowseQuery =>
  normalizeQuery({
    type: type(),
    source: source(),
    text: committedText(),
    gameVersion: gameVersion(),
    loader: loader(),
    client: client(),
    server: server(),
    creator: creator(),
    categories: categories(),
    sort: sort(),
    sortOrder: sortOrder(),
    pageSize: pageSize(),
    page: page(),
  });

/* ---- Setters (every filter change returns to page 1 and never touches history) ---- */

const firstPage = () => setPageSignal(1);

export function setType(next: ResourceType) {
  if (next === type()) return;
  setTypeSignal(next);
  // Category ids belong to one type; filters that no longer apply are dropped by normalisation.
  setCategoriesSignal([]);
  if (!sourceById(source()).types.includes(next)) {
    const fallback = firstSourceForType(next);
    setSourceSignal(fallback.id);
    setSortSignal(fallback.defaultSort);
    setCreatorSignal(null);
  }
  firstPage();
  savePrefs();
}

export function setSource(next: SourceId) {
  if (next === source()) return;
  const descriptor = sourceById(next);
  setSourceSignal(next);
  setSortSignal(descriptor.defaultSort);
  setCategoriesSignal([]);
  setCreatorSignal(null);
  if (!descriptor.types.includes(type())) setTypeSignal(descriptor.types[0]);
  firstPage();
  savePrefs();
}

let debounce: ReturnType<typeof setTimeout> | undefined;
export function setText(value: string) {
  setTextSignal(value);
  clearTimeout(debounce);
  debounce = setTimeout(commitText, 250);
}
/** Enter and chip conversion apply the text now instead of after the debounce. */
export function commitText() {
  clearTimeout(debounce);
  const value = untrack(text);
  if (value !== untrack(committedText)) {
    setCommittedText(value);
    firstPage();
  }
}
export function replaceText(value: string) {
  setTextSignal(value);
  commitText();
}

export function setGameVersion(value: string | null) {
  setGameVersionSignal(value || null);
  firstPage();
}
export function setLoader(value: string | null) {
  setLoaderSignal(value ? value.toLowerCase() : null);
  firstPage();
}
export function setClient(value: boolean) {
  setClientSignal(value);
  firstPage();
}
export function setServer(value: boolean) {
  setServerSignal(value);
  firstPage();
}
export function setCreator(value: Creator | null) {
  setCreatorSignal(value);
  firstPage();
}
export function toggleCategory(id: string) {
  setCategoriesSignal((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  firstPage();
}
export function setSort(value: string) {
  setSortSignal(value);
  firstPage();
}
export function setSortOrder(value: SortOrder) {
  setSortOrderSignal(value);
  firstPage();
}
export function setBanners(value: boolean) {
  setBannersSignal(value);
  savePrefs();
}
export function setPageSize(value: number) {
  setPageSizeSignal(value);
  firstPage();
  savePrefs();
}
export function setPage(value: number) {
  setPageSignal(Math.max(1, value));
}
export function toggleGroup(id: string) {
  setExpandedGroups((current) => {
    const next = new Set(current);
    if (!next.delete(id)) next.add(id);
    return next;
  });
}

/** Filters are cleared together; the target lives in the route so it is navigated away. */
export function clearFilters(options: { keepText?: boolean } = {}) {
  clearTimeout(debounce);
  if (!options.keepText) {
    setTextSignal('');
    setCommittedText('');
  }
  setGameVersionSignal(null);
  setLoaderSignal(null);
  setClientSignal(false);
  setServerSignal(false);
  setCreatorSignal(null);
  setCategoriesSignal([]);
  firstPage();
  if (untrack(targetId) || untrack(serverTargetId)) navigate('/browse', { replace: true });
}

/** Whether a target scopes the results: an instance (not for modpacks) or a server. */
const scoped = () => (!!targetId() && type() !== 'modpack') || !!serverTargetId();

export const hasActiveFilters = () =>
  countFilters(query(), scoped()) > 0 || committedText() !== '' || text() !== '';

/* ---- Target instance ---- */

const targetEntry = () => findInstance(targetId())?.instance;
/** What installs are matched against; undefined without a (usable) target. */
export const target = createRoot(() =>
  createMemo<(InstallTarget & { id: string; name: string }) | undefined>(
    () => {
      const instance = targetEntry();
      return instance
        ? {
            id: instance.id,
            name: instance.name,
            minecraftVersion: instance.minecraftVersion,
            modloader: instance.modloader,
          }
        : undefined;
    },
    {
      name: 'browseTargetInfo',
      equals: (a, b) =>
        a?.id === b?.id &&
        a?.name === b?.name &&
        a?.minecraftVersion === b?.minecraftVersion &&
        a?.modloader === b?.modloader,
    },
  ),
);

let appliedTarget: string | undefined;

/**
 * Called with the route's target id. Entering a new target seeds the game version (and the
 * loader for loader-aware types, unless vanilla), as the old launcher did. A target that is
 * not in the catalogue yet is applied once it appears.
 */
export function syncTarget(id: string | undefined) {
  if (id !== untrack(targetId)) {
    installedSequence++;
    updateSequence++;
    setInstalled(new Map());
    setUpdatable(new Set<string>());
    setBlocked(new Set<string>());
  }
  setTargetId(id);
  if (!id) {
    appliedTarget = undefined;
    return;
  }
  // An instance target replaces a server one.
  dropServerTarget();
  const instance = targetEntry();
  if (!instance || appliedTarget === id) return;
  appliedTarget = id;
  setGameVersionSignal(instance.minecraftVersion);
  const kind = (instance.modloader || 'vanilla').toLowerCase();
  setLoaderSignal(typeUsesLoader(type()) && kind !== 'vanilla' ? kind : null);
  firstPage();
}

/** Removing the instance chip also drops the filters it seeded. */
export function removeTarget() {
  appliedTarget = undefined;
  setGameVersionSignal(null);
  setLoaderSignal(null);
  firstPage();
  navigate('/browse', { replace: true });
}

/* ---- Target server ---- */

/**
 * A server chosen in the target dropdown, or the one Browse was opened for (its Resources
 * tab's Add content). Results follow its Minecraft version and software, cards show what its
 * inventory already has, and Install opens the picker straight at that server.
 */
const [serverTargetId, setServerTargetId] = createSignal<string | undefined>(undefined, { name: 'browseServerTarget' });
/** Fed by the mounted Browse view (`ServerTargetSync`) from the snapshot and inventory. */
const [serverInfo, setServerInfo] = createSignal<ServerTarget | undefined>(undefined, {
  name: 'browseServerInfo',
  equals: sameServerTarget,
});
/** `platform:project` keys in the server's content inventory. */
const [serverInstalled, setServerInstalled] = createSignal<ReadonlySet<string>>(new Set(), {
  name: 'browseServerInstalled',
});
export { serverTargetId, serverInstalled };

/** The chosen server with what is known about it; undefined without one. */
export const serverTarget = () => {
  const info = serverInfo();
  return info && info.id === serverTargetId() ? info : undefined;
};

/** Where Install goes by name: the instance, else the server. */
export const targetName = () => target()?.name ?? serverTarget()?.name;

/** The chosen target as one reference, for the dropdown. */
export const targetRef = (): BrowseTargetRef | undefined => {
  const server = serverTargetId();
  if (server) return { kind: 'server', id: server };
  const id = targetId();
  return id ? { kind: 'instance', id } : undefined;
};

let appliedServer: string | undefined;

/**
 * Where installs for the server target should land by default, when Browse was opened for one
 * (the Modpack area's Add content prefers the modpack). The picker still offers the others.
 */
const [serverDestinationHint, setServerDestinationHint] = createSignal<'server' | 'modpack' | undefined>(undefined, { name: 'browseServerDestination' });
export { serverDestinationHint };

function dropServerTarget() {
  appliedServer = undefined;
  setServerDestinationHint(undefined);
  setServerTargetId(undefined);
  setServerInfo(undefined);
  setServerInstalled(new Set<string>());
}

/** Called with the route's server id (or a project page's choice). */
export function syncServerTarget(id: string | undefined) {
  if (id === untrack(serverTargetId)) return;
  dropServerTarget();
  if (!id) return;
  // A server target replaces an instance one.
  if (untrack(targetId)) syncTarget(undefined);
  setServerTargetId(id);
}

/**
 * The server's latest description. The first one that knows the software applies its scope
 * once: version, loader and a type the server takes. Later updates leave user edits alone.
 */
export function updateServerTarget(info: ServerTarget | undefined, installedKeys?: ReadonlySet<string>) {
  const id = untrack(serverTargetId);
  if (!id || (info && info.id !== id)) return;
  setServerInfo(info);
  if (installedKeys) setServerInstalled(installedKeys);
  if (!info || appliedServer === id || info.software === undefined) return;
  appliedServer = id;
  const scope = serverScope(info, untrack(type));
  if (scope.type !== untrack(type)) setType(scope.type);
  setGameVersionSignal(scope.gameVersion);
  setLoaderSignal(scope.loader);
  firstPage();
}

/**
 * Opens Browse for a server (its Resources tab's Add content, its pack's Browse): the kind it
 * takes, its Minecraft version, and the mod loader when it runs one. The server becomes the
 * dropdown's target; these explicit filters win over the automatic scope.
 */
export function browseForServer(focus: {
  id: string; name: string; type: ResourceType; minecraftVersion: string | null; loader: string | null; destination?: 'server' | 'modpack';
}) {
  setType(focus.type);
  setGameVersionSignal(focus.minecraftVersion || null);
  setLoaderSignal(focus.type === 'mod' && focus.loader ? focus.loader.toLowerCase() : null);
  firstPage();
  syncServerTarget(focus.id);
  setServerDestinationHint(focus.destination);
  appliedServer = focus.id;
  navigate(targetPath({ kind: 'server', id: focus.id }));
}

/** The dropdown's choice. Browse keeps its target in the route. */
export function chooseTarget(ref: BrowseTargetRef | undefined) {
  if (!ref) {
    if (untrack(serverTargetId)) {
      dropServerTarget();
      setGameVersionSignal(null);
      setLoaderSignal(null);
      firstPage();
      navigate('/browse', { replace: true });
      return;
    }
    return untrack(targetId) ? removeTarget() : undefined;
  }
  navigate(targetPath(ref), { replace: true });
}

/**
 * A server row picked for modpacks: `modpack` uses the pick as that server's client pack (the
 * same provider link the client pack's own "Use a modpack" makes), otherwise as its modpack.
 */
export function chooseServerDestination(id: string, destination: 'server' | 'modpack' | undefined, inPlace = false) {
  syncServerTarget(id);
  setServerDestinationHint(destination);
  if (!inPlace) navigate(targetPath({ kind: 'server', id }), { replace: true });
}

/** Where a modpack Install goes, for its hint: the server, or that server's client pack. */
export const modpackTargetName = () => {
  const server = serverTarget();
  if (!server) return undefined;
  return serverDestinationHint() === 'modpack' ? t('browse.target-client-pack-of', { name: server.name }) : server.name;
};

/** A project page's choice: the page stays put, only the store follows. */
export function chooseTargetInPlace(ref: BrowseTargetRef | undefined) {
  if (ref?.kind === 'server') return syncServerTarget(ref.id);
  syncServerTarget(undefined);
  syncTarget(ref?.id);
}

/* ---- Results ---- */

interface ResultSet {
  key: string;
  hits: ResourceProject[];
  total: number;
}

const minute = 60_000;
const searchCache = new RequestCache<ResultSet>({ maxEntries: 60, staleTimeMs: 5 * minute, retentionMs: 60 * minute });
const [results, setResults] = createSignal<ResultSet | undefined>(undefined, { name: 'browseResults' });
const [pending, setPending] = createSignal(false, { name: 'browsePending' });
const [failure, setFailure] = createSignal<string | undefined>(undefined, { name: 'browseFailure' });
const [warning, setWarning] = createSignal(false, { name: 'browseWarning' });
const [generation, setGeneration] = createSignal(0, { name: 'browseGeneration' });
export { results, pending, failure, warning, generation };

let sequence = 0;
const errorText = (reason: unknown) => (reason instanceof Error ? reason.message : String(reason));

const fetchPage = (q: BrowseQuery, key: string) => () =>
  searchResources(q.source, hostQuery(q)).then(
    (response): ResultSet => ({ key, hits: response.hits, total: response.total_hits }),
  );

function publish(set: ResultSet) {
  const previous = untrack(results);
  setResults(set);
  setFailure(undefined);
  if (previous?.key !== set.key) setGeneration((value) => value + 1);
  seedProjects(set.hits);
}

const idle = (work: () => void) =>
  typeof requestIdleCallback === 'function' ? requestIdleCallback(work, { timeout: 2000 }) : setTimeout(work, 200);

/**
 * Shows the cached page for this query immediately (even stale) and revalidates it. Whatever
 * is on screen stays until the new page lands; responses arriving out of order are dropped.
 */
export async function loadResults(q: BrowseQuery, force = false) {
  const key = queryKey(q);
  const mine = ++sequence;
  updateSequence++;
  const cached = searchCache.peek(key);
  if (force) searchCache.invalidate(key);
  if (cached?.hasData && !force) {
    publish(cached.data!);
    setWarning(false);
  }
  setPending(!searchCache.isFresh(key));
  setFailure(undefined);
  try {
    const set = await searchCache.read(key, fetchPage(q, key));
    if (mine !== sequence) return;
    publish(set);
    setWarning(false);
    setPending(false);
    scheduleNextPage(q, set);
    void checkUpdates();
  } catch (reason) {
    if (mine !== sequence || reason instanceof CacheInvalidatedError) return;
    setPending(false);
    const stale = searchCache.peek(key);
    if (stale?.hasData) {
      publish(stale.data!);
      setWarning(true);
    } else {
      setResults(undefined);
      setWarning(false);
      setFailure(errorText(reason));
    }
  }
}

/** Warm the exact upcoming query without changing visible filters, target, results or scroll. */
export function prefetchBrowse(id?: string) {
  const current = untrack(query);
  const instance = id && id !== appliedTarget ? findInstance(id)?.instance : undefined;
  const q = instance ? normalizeQuery({ ...current, page: 1,
    gameVersion: instance.minecraftVersion,
    loader: typeUsesLoader(current.type) && instance.modloader !== 'vanilla' ? instance.modloader : null,
  }) : current;
  const key = queryKey(q);
  ensureCategories(q.source);
  void searchCache.read(key, fetchPage(q, key)).catch(() => undefined);
}

export const retry = () => loadResults(untrack(query), true);

function scheduleNextPage(q: BrowseQuery, set: ResultSet) {
  if (q.page >= pageCount(set.total, q.pageSize)) return;
  const next = { ...q, page: q.page + 1 };
  const key = queryKey(next);
  idle(() => {
    // Stale answers are good enough to prefetch; they are revalidated when actually shown.
    if (searchCache.peek(key)?.hasData) return;
    void searchCache.read(key, fetchPage(next, key)).catch(() => undefined);
  });
}

/* ---- Scroll memory ---- */

const scrollMemory = new Map<string, number>();
export function rememberScroll(key: string, top: number) {
  scrollMemory.delete(key);
  scrollMemory.set(key, top);
  while (scrollMemory.size > 40) scrollMemory.delete(scrollMemory.keys().next().value as string);
}
export const recalledScroll = (key: string) => scrollMemory.get(key);

/* ---- Categories ---- */

const categoryCache = new RequestCache<ResourceCategory[]>({
  maxEntries: 4,
  staleTimeMs: 60 * minute,
  retentionMs: 360 * minute,
});
const [categoryData, setCategoryData] = createSignal<Partial<Record<SourceId, ResourceCategory[]>>>(
  {},
  { name: 'browseCategoryData' },
);

export function ensureCategories(id: SourceId) {
  void categoryCache
    .read(id, () => fetchCategories(id))
    .then((list) => {
      if (untrack(categoryData)[id] !== list) setCategoryData((current) => ({ ...current, [id]: list }));
    })
    .catch(() => undefined);
}

export const derived = createRoot(() => {
  const typeCategories = createMemo(() => categoriesForType(categoryData()[source()] ?? [], type()), {
    name: 'browseTypeCategories',
  });
  const groups = createMemo(() => buildCategoryGroups(typeCategories(), source()), { name: 'browseCategoryGroups' });
  const quick = createMemo(() => quickCategories(typeCategories(), categories()), { name: 'browseQuickCategories' });
  const names = createMemo(() => new Map(typeCategories().map((category) => [category.id, categoryDisplayName(category.name)])), {
    name: 'browseCategoryNames',
  });
  return { typeCategories, groups, quick, names };
});

/* ---- Installed state and installs for the target instance ---- */

const [installed, setInstalled] = createSignal<ReadonlyMap<string, InstalledRow>>(new Map(), {
  name: 'browseInstalled',
});
/** `instance:platform:project` to the version being installed. */
const [installing, setInstalling] = createSignal<ReadonlyMap<string, string>>(new Map(), { name: 'browseInstalling' });
const [updatable, setUpdatable] = createSignal<ReadonlySet<string>>(new Set(), { name: 'browseUpdatable' });
/** Projects known to have no version for the target (`instance:platform:project`). */
const [blocked, setBlocked] = createSignal<ReadonlySet<string>>(new Set(), { name: 'browseBlocked' });
const taskOwners = new Map<string, string>();
export { installed };

const installingKey = (instanceId: string, platform: string, id: string) => `${instanceId}:${projectKey(platform, id)}`;
const rowKey = (row: Pick<InstalledRow, 'platform' | 'remote_id'>) =>
  projectKey(row.platform.toLowerCase(), row.remote_id);

let installedSequence = 0;
let installedTarget: string | undefined;
export async function refreshInstalled() {
  const id = untrack(targetId);
  const mine = ++installedSequence;
  updateSequence++;
  if (installedTarget !== id) {
    installedTarget = id;
    setInstalled(new Map());
    setUpdatable(new Set<string>());
    setBlocked(new Set<string>());
  }
  if (!id) {
    setInstalled(new Map());
    setUpdatable(new Set<string>());
    return;
  }
  try {
    const rows = await fetchInstalled(id);
    if (mine !== installedSequence || id !== untrack(targetId)) return;
    setInstalled(new Map(rows.map((row) => [rowKey(row), row])));
    reconcileInstalling(id, rows);
    void checkUpdates();
  } catch {
    // The installed badges are advisory; the list keeps working without them.
  }
}

function reconcileInstalling(instanceId: string, rows: readonly InstalledRow[]) {
  const done = new Map(rows.map((row) => [rowKey(row), row.remote_version_id]));
  setInstalling((current) => {
    let next: Map<string, string> | undefined;
    for (const [key, versionId] of current) {
      if (!key.startsWith(`${instanceId}:`)) continue;
      if (done.get(key.slice(instanceId.length + 1)) !== versionId) continue;
      next ??= new Map(current);
      next.delete(key);
      for (const [taskId, owner] of taskOwners) if (owner === key) taskOwners.delete(taskId);
    }
    return next ?? current;
  });
}

async function onRowsChanged(instanceId: string) {
  if (instanceId === untrack(targetId)) {
    updateSequence++;
    setUpdatable(new Set<string>());
  }
  setBlocked((current) => new Set([...current].filter((key) => !key.startsWith(`${instanceId}:`))));
  const pendingHere = [...untrack(installing).keys()].some((key) => key.startsWith(`${instanceId}:`));
  if (instanceId === untrack(targetId)) return refreshInstalled();
  if (!pendingHere) return;
  try {
    reconcileInstalling(instanceId, await fetchInstalled(instanceId));
  } catch {
    // The indicator clears on the next rows event or install error.
  }
}

function onInstallError(taskId: string) {
  let matched = false;
  setInstalling((current) => {
    let next: Map<string, string> | undefined;
    for (const [key, versionId] of current) {
      const [instanceId, platform, ...rest] = key.split(':');
      const projectId = rest.join(':');
      const owned = taskOwners.get(taskId) === key;
      if (!owned && !taskMatchesInstall(taskId, { instanceId, platform, projectId, versionId })) continue;
      matched = true;
      if (installRequests.has(key)) failedStartingInstalls.add(key);
      next ??= new Map(current);
      next.delete(key);
    }
    taskOwners.delete(taskId);
    return next ?? current;
  });
  if (matched) setNotice({ tone: 'danger', text: t('browse.install-task-failed') });
}

const receiveRows = (instanceId: string) => void onRowsChanged(instanceId);
let installEventsReady: Promise<void> | undefined;
export function listenForInstalls() {
  installEventsReady = onInstallEvents(receiveRows, onInstallError);
}

/** Checks installed hits against the newest compatible version, a few at a time. */
let updateSequence = 0;
async function checkUpdates() {
  const set = untrack(results);
  const info = untrack(target);
  const rows = untrack(installed);
  const kind = untrack(type);
  const mine = ++updateSequence;
  if (!set || !info || kind === 'datapack' || kind === 'modpack') {
    setUpdatable(new Set<string>());
    return;
  }
  const candidates = set.hits.filter((hit) => rows.has(projectKey(hit.source, hit.id)));
  const found = new Set<string>();
  const missing = new Set<string>();
  for (let index = 0; index < candidates.length; index += 3) {
    await Promise.all(
      candidates.slice(index, index + 3).map(async (hit) => {
        try {
          const versions = await loadVersions(hit.source, hit.id);
          const choice = selectInstallVersion(versions, info, kind, hit.source);
          const key = projectKey(hit.source, hit.id);
          if (!choice) missing.add(installingKey(info.id, hit.source, hit.id));
          else if (updateAvailable(rows.get(key), choice)) found.add(key);
        } catch {
          // Offline or rate limited: no update badge.
        }
      }),
    );
    if (mine !== updateSequence) return;
  }
  if (mine !== updateSequence) return;
  setUpdatable(found);
  if (missing.size) setBlocked((current) => new Set<string>([...current, ...missing]));
}

/* ---- Per-project install state ---- */

export type InstallState =
  | { kind: 'install' }
  | { kind: 'installed' }
  | { kind: 'update' }
  | { kind: 'installing' }
  | { kind: 'unavailable'; reason: 'stop-to-install' | 'vanilla' | 'loader' | 'no-version' | 'game' };

export const sameState = (a: InstallState, b: InstallState) =>
  a.kind === b.kind && (a.kind !== 'unavailable' || (b.kind === 'unavailable' && a.reason === b.reason));

/** Read inside a per-card memo: it depends only on the few signals that can change a card. */
export function installState(project: ResourceProject): InstallState {
  // Old hits remain visible while a different resource type is loading.
  const kind = project.resource_type;
  if (kind === 'modpack') return { kind: 'install' };
  const info = target();
  if (!info) {
    const server = serverTarget();
    return server ? serverInstallState(project, server, serverInstalled()) : { kind: 'install' };
  }
  const key = projectKey(project.source, project.id);
  if (installing().has(installingKey(info.id, project.source, project.id))) return { kind: 'installing' };
  if (installed().has(key)) return updatable().has(key) ? { kind: 'update' } : { kind: 'installed' };
  const compatibility = projectCompatibility(project, kind, info);
  if (compatibility.kind === 'incompatible') return { kind: 'unavailable', reason: compatibility.reason };
  if (blocked().has(installingKey(info.id, project.source, project.id)))
    return { kind: 'unavailable', reason: 'no-version' };
  return { kind: 'install' };
}

/** The version being installed into the target right now, if any. */
export function installingVersion(project: Pick<ResourceProject, 'source' | 'id'>): string | undefined {
  const info = target();
  return info ? installing().get(installingKey(info.id, project.source, project.id)) : undefined;
}

/* ---- Notices ---- */

export interface Notice {
  tone: 'success' | 'warning' | 'danger' | 'neutral';
  text: string;
}
const [notice, setNotice] = createSignal<Notice | undefined>(undefined, { name: 'browseNotice' });
export { notice, setNotice };

/* ---- Installing into an instance ---- */

export type InstallOutcome =
  | { kind: 'started' }
  | { kind: 'no-version' }
  | { kind: 'external' }
  | { kind: 'failed'; message: string };

/** Picks the version for an instance and starts the host install; the card shows it as installing. */
const installRequests = new Map<string, Promise<InstallOutcome>>();
const failedStartingInstalls = new Set<string>();
export async function installInto(
  project: ResourceProject,
  instance: { id: string } & InstallTarget,
  kind: ResourceType,
  /** A specific version (the project page's version view); otherwise the best match is chosen. */
  pinned?: ResourceVersion,
): Promise<InstallOutcome> {
  listenForInstalls();
  const key = installingKey(instance.id, project.source, project.id);
  const existing = installRequests.get(key);
  if (existing) return existing;
  if (untrack(installing).has(key)) return { kind: 'started' };
  const pending = startInstallInto(project, instance, kind, pinned).finally(() => {
    installRequests.delete(key);
    failedStartingInstalls.delete(key);
  });
  installRequests.set(key, pending);
  return pending;
}

async function startInstallInto(
  project: ResourceProject,
  instance: { id: string } & InstallTarget,
  kind: ResourceType,
  pinned?: ResourceVersion,
): Promise<InstallOutcome> {
  const key = installingKey(instance.id, project.source, project.id);
  try {
    await installEventsReady;
    const choice = pinned
      ? { version: pinned, borrowedLoader: false }
      : selectInstallVersion(await loadVersions(project.source, project.id), instance, kind, project.source);
    if (!choice) {
      setBlocked((current) => new Set<string>([...current, key]));
      return { kind: 'no-version' };
    }
    if (!hasDownloadableArtifact(choice.version)) return { kind: 'external' };
    if (requiresWorldTarget(choice.version, kind))
      return { kind: 'failed', message: t('browse.world-required') };
    setBlocked((current) => new Set([...current].filter((entry) => entry !== key)));
    setInstalling((current) => new Map(current).set(key, choice.version.id));
    try {
      const taskId = await installResource({ instanceId: instance.id, project, version: choice.version, type: kind });
      if (failedStartingInstalls.has(key)) return { kind: 'failed', message: t('browse.install-task-failed') };
      if (untrack(installing).has(key)) taskOwners.set(taskId, key);
      void onRowsChanged(instance.id);
      return { kind: 'started' };
    } catch (reason) {
      setInstalling((current) => {
        const next = new Map(current);
        next.delete(key);
        return next;
      });
      throw reason;
    }
  } catch (reason) {
    return { kind: 'failed', message: errorText(reason) };
  }
}

/* ---- Creator filter from a card ---- */

export function filterByCreator(project: ResourceProject) {
  const found = creatorOf(project);
  if (!found) return;
  setSource(project.source);
  setCreator(found);
}

/* ---- Leaving a project page for Browse ---- */

/** A category tag on a project page: its label, from the source's category list when loaded. */
export function categoryName(platform: SourceId, raw: string): string {
  const list = categoryData()[platform] ?? [];
  const found = list.find((category) => category.id === raw) ?? list.find((category) => category.name.toLowerCase() === raw.toLowerCase());
  return categoryDisplayName(found?.name ?? raw);
}

/** Search text, creator and categories go; the target and the filters it seeded stay. */
function browseFresh(project: ResourceProject) {
  clearTimeout(debounce);
  setSource(project.source);
  setType(project.resource_type);
  setTextSignal('');
  setCommittedText('');
  setCreatorSignal(null);
  setCategoriesSignal([]);
  firstPage();
}

/** Browse the project's source and type filtered to one of its categories. */
export function browseCategory(project: ResourceProject, raw: string) {
  const list = untrack(categoryData)[project.source] ?? [];
  const found = list.find((category) => category.id === raw) ?? list.find((category) => category.name.toLowerCase() === raw.toLowerCase());
  browseFresh(project);
  setCategoriesSignal([found?.id ?? raw]);
}

/** Browse the project's source and type filtered to one creator (the owner by default). */
export function browseCreator(project: ResourceProject, creator: Creator | undefined = creatorOf(project)) {
  if (!creator) return;
  browseFresh(project);
  setCreatorSignal(creator);
}

/** Where Browse returns to: the target lives in the route. */
export const browsePath = () => targetPath(untrack(targetRef));

export const activeFilterCount = () => countFilters(query(), scoped());
