import type { Instance } from "@utils/instances";
import { beforeEach, describe, expect, it, vi } from "vitest";

const backend = vi.hoisted(() => ({
	value: null as string | null,
	failLoad: false,
	writes: [] as string[],
}));

vi.mock("@tauri-apps/api/core", () => ({
	invoke: vi.fn((command: string, args?: { layout: string }) => {
		if (command === "get_library_layout") {
			return backend.failLoad
				? Promise.reject(new Error("db unavailable"))
				: Promise.resolve(backend.value);
		}
		if (command === "set_library_layout" && args) {
			backend.value = args.layout;
			backend.writes.push(args.layout);
			return Promise.resolve();
		}
		return Promise.reject(new Error(`unexpected command ${command}`));
	}),
}));

const instance = (id: number, extra: Partial<Instance> = {}) =>
	({
		id,
		name: `Instance ${id}`,
		createdAt: null,
		lastPlayed: null,
		totalPlaytimeMinutes: 0,
		...extra,
	}) as Instance;

async function loadStore(saved?: unknown) {
	vi.resetModules();
	backend.value = saved === undefined ? null : JSON.stringify(saved);
	const store = await import("./library-layout");
	await store.initializeLibraryLayout();
	return store;
}

describe("library layout store", () => {
	beforeEach(() => {
		backend.value = null;
		backend.failLoad = false;
		backend.writes = [];
	});

	it("drops malformed and duplicated saved data", async () => {
		const store = await loadStore({
			version: 1,
			sort: "bogus",
			order: [1, 1, "group:a", "group:missing", 2.5],
			groups: [
				{ id: "group:a", name: "  ", color: 999, instances: [2, 2, 3] },
				{ id: "not-a-group", name: "x", color: 10, instances: [4] },
				{ id: "group:b", name: "B", color: 10, instances: [3, 5] },
			],
		});
		const layout = store.libraryLayout();
		expect(layout.sort).toBe("recent");
		expect(layout.groups).toEqual([
			{ id: "group:a", name: "Group", color: 205, instances: [2, 3] },
			{ id: "group:b", name: "B", color: 10, instances: [5] },
		]);
		expect(layout.order).toEqual([1, "group:a", "group:b"]);
	});

	it("groups instances and removes the group once it is empty", async () => {
		const store = await loadStore();
		const all = [instance(1), instance(2), instance(3)];
		const id = store.createLibraryGroup(all, [1, 2]);

		expect(store.libraryLayout().sort).toBe("custom");
		expect(store.customLibraryOrder(all)).toEqual([id, 3]);

		store.moveLibraryEntry(1, null, null, all);
		store.moveLibraryEntry(2, null, null, all);
		expect(store.libraryLayout().groups).toEqual([]);
		expect(store.customLibraryOrder(all)).toEqual([3, 1, 2]);
	});

	it("inserts before a sibling and keeps folders at the top level", async () => {
		const store = await loadStore();
		const all = [instance(1), instance(2), instance(3)];
		store.moveLibraryEntry(3, null, 1, all);
		expect(store.customLibraryOrder(all)).toEqual([3, 1, 2]);

		const id = store.createLibraryGroup(all, [1]);
		store.moveLibraryEntry(id, "group:other", null, all);
		expect(store.customLibraryOrder(all)).toContain(id);
	});

	it("only reconciles away deleted instances", async () => {
		const store = await loadStore();
		const all = [instance(1), instance(2), instance(3)];
		store.createLibraryGroup(all, [1, 2]);

		store.reconcileLibraryGroups([1, 3]);
		expect(store.libraryLayout().groups[0].instances).toEqual([1]);

		store.reconcileLibraryGroups([3]);
		expect(store.libraryLayout().groups).toEqual([]);
	});

	it("sorts by each mode with stable tie-breaks", async () => {
		const store = await loadStore();
		const all = [
			instance(1, { name: "b", totalPlaytimeMinutes: 5 }),
			instance(2, { name: "A", totalPlaytimeMinutes: 90 }),
			instance(3, {
				name: "a10",
				createdAt: "2026-01-01T00:00:00Z",
				lastPlayed: "2026-02-01T00:00:00Z",
			}),
		];
		const ids = (mode: Parameters<typeof store.sortLibraryInstances>[1]) =>
			store.sortLibraryInstances(all, mode).map((entry) => entry.id);

		expect(ids("name")).toEqual([2, 3, 1]);
		expect(ids("playtime")).toEqual([2, 1, 3]);
		expect(ids("newest")).toEqual([3, 2, 1]);
		expect(ids("recent")).toEqual([3, 2, 1]);
	});

	it("tracks edit mode and switches to custom order when it begins", async () => {
		const store = await loadStore();
		expect(store.libraryEditing()).toBe(false);
		store.beginLibraryEdit([instance(1)]);
		expect(store.libraryEditing()).toBe(true);
		expect(store.libraryLayout().sort).toBe("custom");
		store.endLibraryEdit();
		expect(store.libraryEditing()).toBe(false);
	});

	describe("persistence", () => {
		it("loads the layout saved in the backend", async () => {
			const store = await loadStore({
				version: 1,
				sort: "name",
				order: [4, 2],
				groups: [],
			});
			expect(store.libraryLayoutLoaded()).toBe(true);
			expect(store.libraryLayout().sort).toBe("name");
			expect(store.libraryLayout().order).toEqual([4, 2]);
		});

		it("writes every change to the backend, latest last", async () => {
			const store = await loadStore();
			const all = [instance(1), instance(2)];
			store.moveLibraryEntry(2, null, 1, all);
			store.renameLibraryGroup(store.createLibraryGroup(all, [1]), "Pals");
			await store.flushLibraryLayout();

			expect(backend.writes.length).toBe(3);
			expect(JSON.parse(backend.value as string)).toEqual(
				store.libraryLayout(),
			);
			expect(store.librarySaveError()).toBe(false);
		});

		it("never overwrites the saved layout when it could not be loaded", async () => {
			backend.failLoad = true;
			vi.spyOn(console, "error").mockReturnValue();
			const store = await loadStore({
				version: 1,
				sort: "name",
				order: [],
				groups: [],
			});
			const saved = backend.value;

			expect(store.libraryLayoutLoaded()).toBe(false);
			expect(store.librarySaveError()).toBe(true);

			store.moveLibraryEntry(1, null, null, [instance(1)]);
			store.reconcileLibraryGroups([]);
			await store.flushLibraryLayout();
			expect(backend.writes).toEqual([]);
			expect(backend.value).toBe(saved);
		});
	});
});
