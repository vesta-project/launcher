import { invoke } from "@tauri-apps/api/core";
import type { Instance } from "@utils/instances";
import { createSignal } from "solid-js";

export const librarySorts = {
	recent: "Last played",
	name: "Name",
	newest: "Newest",
	playtime: "Most played",
	custom: "Custom",
} as const;
export type LibrarySort = keyof typeof librarySorts;
export type LibraryEntry = number | string;
export interface LibraryGroup {
	id: string;
	name: string;
	color: number;
	instances: number[];
}
export interface LibraryLayout {
	version: 1;
	sort: LibrarySort;
	order: LibraryEntry[];
	groups: LibraryGroup[];
}
const emptyLayout = (): LibraryLayout => ({
	version: 1,
	sort: "recent",
	order: [],
	groups: [],
});

function parseLayout(raw: string | null | undefined): LibraryLayout {
	try {
		const saved = JSON.parse(raw || "null");
		if (!saved || saved.version !== 1) return emptyLayout();
		const used = new Set<number>();
		const groupIds = new Set<string>();
		const groups: LibraryGroup[] = [];
		for (const group of Array.isArray(saved.groups) ? saved.groups : []) {
			if (
				!group ||
				typeof group.id !== "string" ||
				!group.id.startsWith("group:") ||
				groupIds.has(group.id) ||
				typeof group.name !== "string"
			)
				continue;
			groupIds.add(group.id);
			groups.push({
				id: group.id,
				name: group.name.trim().slice(0, 60) || "Group",
				color:
					typeof group.color === "number" &&
					Number.isFinite(group.color) &&
					group.color >= 0 &&
					group.color <= 360
						? group.color
						: 205,
				instances: (Array.isArray(group.instances)
					? group.instances
					: []
				).filter((id: unknown): id is number => {
					if (!Number.isSafeInteger(id) || used.has(id as number)) return false;
					used.add(id as number);
					return true;
				}),
			});
		}
		const order = [
			...new Set<LibraryEntry>(
				(Array.isArray(saved.order) ? saved.order : []).filter((id: unknown) =>
					typeof id === "number"
						? Number.isSafeInteger(id) && !used.has(id)
						: typeof id === "string" && groupIds.has(id),
				),
			),
		];
		for (const group of groups)
			if (!order.includes(group.id)) order.push(group.id);
		return {
			version: 1,
			sort: Object.hasOwn(librarySorts, saved.sort) ? saved.sort : "recent",
			order,
			groups,
		};
	} catch {
		return emptyLayout();
	}
}

const [layout, setLibraryLayout] = createSignal(emptyLayout());
const [saveError, setLibrarySaveError] = createSignal(false);
const [loaded, setLoaded] = createSignal(false);
export const libraryLayout = layout;
export const librarySaveError = saveError;
/** False until the saved layout has been read; nothing may be saved or reconciled before. */
export const libraryLayoutLoaded = loaded;

// Writes run one at a time so an older layout can never land after a newer one.
let writeChain: Promise<void> = Promise.resolve();

function persist(layout: LibraryLayout) {
	if (!loaded()) return;
	const document = JSON.stringify(layout);
	writeChain = writeChain.then(async () => {
		try {
			await invoke("set_library_layout", { layout: document });
			setLibrarySaveError(false);
		} catch (error) {
			console.error("Failed to save library layout:", error);
			setLibrarySaveError(true);
		}
	});
}

/** Resolves once every queued write has finished. */
export function flushLibraryLayout() {
	return writeChain;
}

/** Load the saved layout from the backend. */
export async function initializeLibraryLayout() {
	if (loaded()) return;
	try {
		const raw = await invoke<string | null>("get_library_layout");
		setLibraryLayout(parseLayout(raw));
		setLibrarySaveError(false);
		setLoaded(true);
	} catch (error) {
		// Stay unloaded: saving an empty layout now would overwrite the real one.
		console.error("Failed to load library layout:", error);
		setLibrarySaveError(true);
	}
}

function save(layout: LibraryLayout) {
	const groups = layout.groups.filter((group) => group.instances.length > 0);
	const groupIds = new Set(groups.map((group) => group.id));
	layout = {
		...layout,
		groups,
		order: layout.order.filter(
			(entry) => typeof entry === "number" || groupIds.has(entry),
		),
	};
	setLibraryLayout(layout);
	persist(layout);
}

/** Reconcile only after an authoritative instance list has finished loading. */
export function reconcileLibraryGroups(instanceIds: number[]) {
	if (!loaded()) return;
	const ids = new Set(instanceIds);
	const layout = libraryLayout();
	const groups = layout.groups.map((group) => ({
		...group,
		instances: group.instances.filter((id) => ids.has(id)),
	}));
	if (
		groups.some(
			(group, index) =>
				group.instances.length === 0 ||
				group.instances.length !== layout.groups[index].instances.length,
		)
	)
		save({ ...layout, groups });
}

/** Add new instances at the end without overwriting the remembered custom order. */
export function customLibraryOrder(
	instances: Instance[],
	layout = libraryLayout(),
): LibraryEntry[] {
	const ids = new Set(instances.map((instance) => instance.id));
	const assigned = new Set(layout.groups.flatMap((group) => group.instances));
	const order = layout.order.filter((entry) =>
		typeof entry === "string"
			? layout.groups.some((group) => group.id === entry)
			: ids.has(entry) && !assigned.has(entry),
	);
	return [
		...order,
		...instances
			.filter(
				(instance) =>
					!assigned.has(instance.id) && !order.includes(instance.id),
			)
			.map((instance) => instance.id),
	];
}

export function sortLibraryInstances(
	instances: Instance[],
	mode = libraryLayout().sort,
): Instance[] {
	const timestamp = (value: string | null) =>
		value ? Date.parse(value) || 0 : 0;
	return [...instances].sort((a, b) => {
		if (mode === "name")
			return (
				a.name.localeCompare(b.name, undefined, {
					numeric: true,
					sensitivity: "base",
				}) || a.id - b.id
			);
		if (mode === "playtime")
			return b.totalPlaytimeMinutes - a.totalPlaytimeMinutes || a.id - b.id;
		if (mode === "newest")
			return timestamp(b.createdAt) - timestamp(a.createdAt) || b.id - a.id;
		return (
			timestamp(b.lastPlayed) - timestamp(a.lastPlayed) ||
			timestamp(b.createdAt) - timestamp(a.createdAt) ||
			b.id - a.id
		);
	});
}

export function setLibrarySort(sort: LibrarySort, instances?: Instance[]) {
	save({
		...libraryLayout(),
		sort,
		order: instances ? customLibraryOrder(instances) : libraryLayout().order,
	});
}

/** Put back a layout captured before a drag that was cancelled. */
export function restoreLibraryLayout(snapshot: LibraryLayout) {
	save(snapshot);
}

const [editing, setEditing] = createSignal(false);
export const libraryEditing = editing;

/** Arranging only makes sense against the custom order, so switch to it first. */
export function beginLibraryEdit(instances: Instance[]) {
	setLibrarySort("custom", instances);
	setEditing(true);
}

export function endLibraryEdit() {
	setEditing(false);
}

export function moveLibraryEntry(
	entry: LibraryEntry,
	groupId: string | null,
	before: LibraryEntry | null,
	instances: Instance[],
) {
	if (entry === before || (typeof entry === "string" && groupId !== null))
		return;
	const layout = libraryLayout();
	const order = customLibraryOrder(instances).filter((id) => id !== entry);
	const groups = layout.groups.map((group) => ({
		...group,
		instances: group.instances.filter((id) => id !== entry),
	}));
	const destination: LibraryEntry[] | undefined = groupId
		? groups.find((group) => group.id === groupId)?.instances
		: order;
	if (!destination) return;
	const index = before === null ? -1 : destination.indexOf(before);
	destination.splice(index < 0 ? destination.length : index, 0, entry);
	save({ ...layout, sort: "custom", order, groups });
}

export function createLibraryGroup(
	instances: Instance[],
	members: number[],
): string {
	if (members.length === 0) return "";
	const layout = libraryLayout();
	const id = `group:${crypto.randomUUID()}`;
	const order = customLibraryOrder(instances);
	const first = order.findIndex((entry) => members.includes(entry as number));
	const remaining = order.filter((entry) => !members.includes(entry as number));
	remaining.splice(first < 0 ? remaining.length : first, 0, id);
	const groups = layout.groups.map((group) => ({
		...group,
		instances: group.instances.filter((entry) => !members.includes(entry)),
	}));
	groups.push({
		id,
		name: "New group",
		color: [205, 265, 150, 35, 330][groups.length % 5],
		instances: [...new Set(members)],
	});
	save({ ...layout, sort: "custom", order: remaining, groups });
	return id;
}

export function renameLibraryGroup(id: string, name: string) {
	const trimmed = name.trim().slice(0, 60);
	if (!trimmed) return;
	save({
		...libraryLayout(),
		groups: libraryLayout().groups.map((group) =>
			group.id === id ? { ...group, name: trimmed } : group,
		),
	});
}

export function setLibraryGroupColor(id: string, color: number) {
	if (!Number.isFinite(color) || color < 0 || color > 360) return;
	save({
		...libraryLayout(),
		groups: libraryLayout().groups.map((group) =>
			group.id === id ? { ...group, color } : group,
		),
	});
}
