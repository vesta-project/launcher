import { invoke, isTauri } from '@tauri-apps/api/core';
import { createSignal } from 'solid-js';

/**
 * Library order and groups, ported from the old launcher's library-layout store.
 *
 * The saved document is the old one, so both launchers read each other's layout:
 *   { version: 1, sort, order: (instanceId | "group:<uuid>")[], groups: { id, name, color, instances }[] }
 * The host stores numeric instance ids; inside the rewrite every id is a string. Groups
 * nest one level, empty groups are dropped on save, and new instances join at the end.
 */
export const librarySorts = ['recent', 'name', 'newest', 'playtime', 'custom'] as const;
export type LibrarySort = (typeof librarySorts)[number];
/** An instance id, or a group id starting with `group:`. */
export type LibraryEntry = string;
export interface LibraryGroup {
  id: string;
  name: string;
  /** Hue in degrees. */
  color: number;
  instances: string[];
}
export interface LibraryLayout {
  version: 1;
  sort: LibrarySort;
  order: LibraryEntry[];
  groups: LibraryGroup[];
}

export const GROUP_NAME_MAX = 60;
export const groupColors = [205, 265, 150, 35, 330] as const;
export const isGroupEntry = (entry: LibraryEntry) => entry.startsWith('group:');
export const emptyLayout = (): LibraryLayout => ({ version: 1, sort: 'recent', order: [], groups: [] });

/** Host ids are numbers; the browser fixture uses strings. Anything else is dropped. */
function readInstanceId(value: unknown): string | undefined {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? String(value) : undefined;
  if (typeof value === 'string' && value && !isGroupEntry(value)) return value;
  return undefined;
}

/** Normalises a saved document: unknown versions, duplicates and dangling ids are dropped. */
export function parseLayout(raw: string | null | undefined): LibraryLayout {
  let saved: Record<string, unknown> | null;
  try {
    saved = JSON.parse(raw || 'null');
  } catch {
    return emptyLayout();
  }
  if (!saved || typeof saved !== 'object' || saved.version !== 1) return emptyLayout();
  const used = new Set<string>();
  const groupIds = new Set<string>();
  const groups: LibraryGroup[] = [];
  for (const group of Array.isArray(saved.groups) ? saved.groups : []) {
    if (!group || typeof group.id !== 'string' || !isGroupEntry(group.id) || groupIds.has(group.id)
      || typeof group.name !== 'string') continue;
    groupIds.add(group.id);
    const instances: string[] = [];
    for (const value of Array.isArray(group.instances) ? group.instances : []) {
      const id = readInstanceId(value);
      if (id === undefined || used.has(id)) continue;
      used.add(id);
      instances.push(id);
    }
    groups.push({
      id: group.id,
      name: group.name.trim().slice(0, GROUP_NAME_MAX) || 'Group',
      color: typeof group.color === 'number' && Number.isFinite(group.color) && group.color >= 0 && group.color <= 360
        ? group.color : groupColors[0],
      instances,
    });
  }
  const order = new Set<LibraryEntry>();
  for (const value of Array.isArray(saved.order) ? saved.order : []) {
    if (typeof value === 'string' && isGroupEntry(value)) {
      if (groupIds.has(value)) order.add(value);
      continue;
    }
    const id = readInstanceId(value);
    if (id !== undefined && !used.has(id)) order.add(id);
  }
  for (const group of groups) order.add(group.id);
  return {
    version: 1,
    sort: librarySorts.includes(saved.sort as LibrarySort) ? saved.sort as LibrarySort : 'recent',
    order: [...order],
    groups,
  };
}

/** Back to the host's document: numeric-looking instance ids become numbers again. */
export function serializeLayout(layout: LibraryLayout): string {
  const out = (id: string) => (/^\d+$/.test(id) && Number.isSafeInteger(Number(id)) ? Number(id) : id);
  return JSON.stringify({
    version: 1,
    sort: layout.sort,
    order: layout.order.map((entry) => (isGroupEntry(entry) ? entry : out(entry))),
    groups: layout.groups.map((group) => ({ ...group, instances: group.instances.map(out) })),
  });
}

/** Empty groups disappear, along with their place in the order. */
export function pruneLayout(layout: LibraryLayout): LibraryLayout {
  if (layout.groups.every((group) => group.instances.length > 0)) return layout;
  const groups = layout.groups.filter((group) => group.instances.length > 0);
  const kept = new Set(groups.map((group) => group.id));
  return { ...layout, groups, order: layout.order.filter((entry) => !isGroupEntry(entry) || kept.has(entry)) };
}

/** The top-level order for these instances: remembered entries first, new instances appended. */
export function customOrder(layout: LibraryLayout, instanceIds: readonly string[]): LibraryEntry[] {
  const present = new Set(instanceIds);
  const grouped = new Set<string>();
  const groupIds = new Set<string>();
  for (const group of layout.groups) {
    groupIds.add(group.id);
    for (const id of group.instances) grouped.add(id);
  }
  const order: LibraryEntry[] = [];
  const placed = new Set<LibraryEntry>();
  for (const entry of layout.order) {
    if (placed.has(entry)) continue;
    if (isGroupEntry(entry) ? groupIds.has(entry) : present.has(entry) && !grouped.has(entry)) {
      order.push(entry);
      placed.add(entry);
    }
  }
  for (const id of instanceIds) if (!grouped.has(id) && !placed.has(id)) order.push(id);
  return order;
}

/** Members of a group that still exist, in the group's order. */
export function groupMembers(group: LibraryGroup, instanceIds: ReadonlySet<string>) {
  return group.instances.filter((id) => instanceIds.has(id));
}

/** Which group an instance sits in, or null for the top level. */
export function containerOf(layout: LibraryLayout, entry: LibraryEntry): string | null {
  if (isGroupEntry(entry)) return null;
  return layout.groups.find((group) => group.instances.includes(entry))?.id ?? null;
}

/**
 * Moves an entry into a container (null for the top level) before another entry, or to the
 * end. Groups never go inside groups. Returns the same layout when nothing changes.
 */
export function moveEntry(
  layout: LibraryLayout,
  instanceIds: readonly string[],
  entry: LibraryEntry,
  groupId: string | null,
  before: LibraryEntry | null,
): LibraryLayout {
  if (entry === before || (isGroupEntry(entry) && groupId !== null)) return layout;
  const order = customOrder(layout, instanceIds).filter((id) => id !== entry);
  const groups = layout.groups.map((group) => (group.instances.includes(entry)
    ? { ...group, instances: group.instances.filter((id) => id !== entry) }
    : group));
  let destination: LibraryEntry[] | undefined = order;
  if (groupId !== null) {
    const index = groups.findIndex((group) => group.id === groupId);
    if (index < 0) return layout;
    groups[index] = { ...groups[index]!, instances: [...groups[index]!.instances] };
    destination = groups[index]!.instances;
  }
  const at = before === null ? -1 : destination.indexOf(before);
  destination.splice(at < 0 ? destination.length : at, 0, entry);
  return pruneLayout({ ...layout, sort: 'custom', order, groups });
}

/** A new group holding these instances, placed where the first of them was. */
export function createGroup(
  layout: LibraryLayout,
  instanceIds: readonly string[],
  members: readonly string[],
  id: string,
  name: string,
): LibraryLayout {
  if (members.length === 0) return layout;
  const joining = new Set(members);
  const order = customOrder(layout, instanceIds);
  const first = order.findIndex((entry) => joining.has(entry));
  const remaining = order.filter((entry) => !joining.has(entry));
  remaining.splice(first < 0 ? remaining.length : first, 0, id);
  const groups = layout.groups.map((group) => (group.instances.some((member) => joining.has(member))
    ? { ...group, instances: group.instances.filter((member) => !joining.has(member)) }
    : group));
  groups.push({
    id,
    name: name.trim().slice(0, GROUP_NAME_MAX) || 'Group',
    color: groupColors[groups.length % groupColors.length]!,
    instances: [...joining],
  });
  return pruneLayout({ ...layout, sort: 'custom', order: remaining, groups });
}

/** Drops instances that no longer exist from groups. Null when nothing changed. */
export function reconcileLayout(layout: LibraryLayout, instanceIds: readonly string[]): LibraryLayout | null {
  const present = new Set(instanceIds);
  let changed = false;
  const groups = layout.groups.map((group) => {
    const instances = group.instances.filter((id) => present.has(id));
    if (instances.length === group.instances.length) return group;
    changed = true;
    return { ...group, instances };
  });
  return changed ? pruneLayout({ ...layout, groups }) : null;
}

export function renameGroup(layout: LibraryLayout, id: string, name: string): LibraryLayout {
  const trimmed = name.trim().slice(0, GROUP_NAME_MAX);
  if (!trimmed) return layout;
  return { ...layout, groups: layout.groups.map((group) => (group.id === id ? { ...group, name: trimmed } : group)) };
}

/** Dissolve a group in place, retaining its member order and every instance. */
export function ungroup(layout: LibraryLayout, instanceIds: readonly string[], id: string): LibraryLayout {
  const group = layout.groups.find((candidate) => candidate.id === id);
  if (!group) return layout;
  const members = groupMembers(group, new Set(instanceIds));
  return {
    ...layout,
    sort: 'custom',
    order: customOrder(layout, instanceIds).flatMap((entry) => entry === id ? members : [entry]),
    groups: layout.groups.filter((candidate) => candidate.id !== id),
  };
}

export function recolorGroup(layout: LibraryLayout, id: string, color: number): LibraryLayout {
  if (!Number.isFinite(color) || color < 0 || color > 360) return layout;
  return { ...layout, groups: layout.groups.map((group) => (group.id === id ? { ...group, color } : group)) };
}

/** Equal id sequences, for memo `equals` so unchanged orders never notify. */
export function sameEntries(a: readonly string[], b: readonly string[]) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export interface LayoutPersistence {
  load(): Promise<string | null>;
  save(document: string): Promise<void>;
}

/**
 * A layout store. Nothing is saved or reconciled until the saved layout has loaded, since
 * saving before then would overwrite the real one. `preview` changes what is shown without
 * saving, for live reordering while dragging; `commit` saves once when the drag lands.
 */
export function createLibraryLayoutStore(persistence: LayoutPersistence) {
  const [layout, setLayout] = createSignal<LibraryLayout>(emptyLayout(), { name: 'libraryLayout' });
  const [loaded, setLoaded] = createSignal(false, { name: 'libraryLayoutLoaded' });
  const [saveError, setSaveError] = createSignal(false, { name: 'libraryLayoutSaveError' });
  // Writes run one at a time so an older layout can never land after a newer one.
  let writes: Promise<void> = Promise.resolve();
  let loading: Promise<void> | undefined;

  const persist = (next: LibraryLayout) => {
    if (!loaded()) return;
    const document = serializeLayout(next);
    writes = writes.then(async () => {
      try {
        await persistence.save(document);
        setSaveError(false);
      } catch (error) {
        console.error('Failed to save library layout:', error);
        setSaveError(true);
      }
    });
  };

  const store = {
    layout,
    loaded,
    saveError,
    /** Resolves once every queued write has finished. */
    flush: () => writes,
    load(): Promise<void> {
      if (loaded()) return Promise.resolve();
      if (loading) return loading;
      // All callers share one read, so no older response can overwrite a later edit.
      loading = Promise.resolve().then(async () => {
        try {
          setLayout(parseLayout(await persistence.load()));
          setSaveError(false);
          setLoaded(true);
        } catch (error) {
          // Stay unloaded: saving an empty layout now would overwrite the real one.
          console.error('Failed to load library layout:', error);
          setSaveError(true);
        } finally {
          loading = undefined;
        }
      });
      return loading;
    },
    /** Show a layout without saving it. */
    preview(next: LibraryLayout) {
      setLayout(next);
    },
    /** Show and save a layout. */
    commit(next: LibraryLayout = layout()) {
      const pruned = pruneLayout(next);
      setLayout(pruned);
      persist(pruned);
    },
    /** Apply a change and save it. */
    update(change: (current: LibraryLayout) => LibraryLayout) {
      const current = layout();
      const next = change(current);
      if (next !== current) store.commit(next);
    },
    reconcile(instanceIds: readonly string[]) {
      if (!loaded()) return;
      const next = reconcileLayout(layout(), instanceIds);
      if (next) store.commit(next);
    },
  };
  return store;
}

export type LibraryLayoutStore = ReturnType<typeof createLibraryLayoutStore>;

/** The browser fixture keeps its layout for the session only. */
function memoryPersistence(): LayoutPersistence {
  let saved: string | null = null;
  return {
    load: async () => saved,
    save: async (document) => {
      saved = document;
    },
  };
}

const native = typeof window !== 'undefined' && isTauri();
export const libraryLayoutStore = createLibraryLayoutStore(native
  ? {
      load: () => invoke<string | null>('get_library_layout'),
      save: (layout) => invoke('set_library_layout', { layout }),
    }
  : memoryPersistence());

const [arranging, setArranging] = createSignal(false, { name: 'libraryArranging' });
/** True while the library is in arrange mode: cards drag, card drops and opening are off. */
export { arranging as libraryArranging };

/** Arranging works against the custom order, so it switches to it first. */
export function beginLibraryArrange(instanceIds: readonly string[]) {
  const current = libraryLayoutStore.layout();
  if (current.sort !== 'custom') libraryLayoutStore.commit({ ...current, sort: 'custom', order: customOrder(current, instanceIds) });
  setArranging(true);
}

export function endLibraryArrange() {
  setArranging(false);
}
