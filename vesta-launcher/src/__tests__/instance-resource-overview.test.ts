import {
	getCachedInstanceResourceOverview,
	instanceOwnedResources,
	invalidateInstanceResourceOverview,
	loadInstanceResourceOverview,
	projectRecordMap,
	refreshInstanceResourceRows,
} from "@stores/instance-resource-overview";
import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
	invoke: vi.fn(),
}));

const overview = {
	instanceId: 7_001,
	resources: [],
	projectRecords: [
		{
			id: "sodium",
			source: "modrinth",
			name: "Sodium",
			summary: "Renderer",
			icon_url: "https://example.invalid/icon.png",
			has_cached_icon: false,
			project_type: "mod",
			last_updated: "2026-07-24T00:00:00Z",
		},
	],
	missingProjectRefs: [],
	updateSnapshot: null,
	metadataStatus: "complete" as const,
	repairStatus: "notChecked" as const,
	revision: "abc",
};

describe("instance resource overview cache", () => {
	beforeEach(() => {
		vi.mocked(invoke).mockReset();
	});

	it("deduplicates concurrent IPC and reuses the cached snapshot", async () => {
		const instanceId = 7_001;
		invalidateInstanceResourceOverview(instanceId);
		vi.mocked(invoke).mockResolvedValue(overview);

		const [first, second] = await Promise.all([
			loadInstanceResourceOverview(instanceId),
			loadInstanceResourceOverview(instanceId),
		]);
		const third = await loadInstanceResourceOverview(instanceId);

		expect(first).toBe(second);
		expect(third).toBe(first);
		expect(invoke).toHaveBeenCalledTimes(1);
		expect(getCachedInstanceResourceOverview(instanceId)).toBe(first);
	});

	it("forces a fresh request only after invalidation", async () => {
		const instanceId = 7_002;
		invalidateInstanceResourceOverview(instanceId);
		vi.mocked(invoke).mockResolvedValue(overview);

		await loadInstanceResourceOverview(instanceId);
		invalidateInstanceResourceOverview(instanceId);
		await loadInstanceResourceOverview(instanceId);

		expect(invoke).toHaveBeenCalledTimes(2);
	});

	it("keys project metadata by provider and project id", () => {
		const records = projectRecordMap([
			...overview.projectRecords,
			{
				...overview.projectRecords[0],
				source: "curseforge",
				name: "Different Sodium",
			},
		]);
		expect(records["modrinth:sodium"]?.name).toBe("Sodium");
		expect(records["curseforge:sodium"]?.name).toBe("Different Sodium");
	});

	it("keeps datapacks out of instance-owned resource state", () => {
		expect(
			instanceOwnedResources([
				{ id: 1, resource_type: "mod" },
				{ id: 2, resource_type: "datapack" },
				{ id: 3, resource_type: "DataPack" },
			] as never),
		).toEqual([{ id: 1, resource_type: "mod" }]);
	});

	it("coalesces rapid row events into one request plus one trailing refresh", async () => {
		const instanceId = 7_003;
		let resolveFirst!: (value: unknown) => void;
		vi.mocked(invoke)
			.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						resolveFirst = resolve;
					}),
			)
			.mockResolvedValueOnce([{ id: 2 }]);

		const first = refreshInstanceResourceRows(instanceId);
		const second = refreshInstanceResourceRows(instanceId);
		const third = refreshInstanceResourceRows(instanceId);
		expect(first).toBe(second);
		expect(second).toBe(third);
		expect(invoke).toHaveBeenCalledTimes(1);

		resolveFirst([{ id: 1 }]);
		await expect(first).resolves.toEqual([{ id: 2 }]);
		expect(invoke).toHaveBeenCalledTimes(2);
	});

	it("returns the complete 500-row local snapshot without truncation", async () => {
		const rows = Array.from({ length: 500 }, (_, index) => ({
			id: index + 1,
			instance_id: 7_004,
		}));
		vi.mocked(invoke).mockResolvedValueOnce(rows);

		await expect(refreshInstanceResourceRows(7_004)).resolves.toHaveLength(500);
		expect(invoke).toHaveBeenCalledTimes(1);
	});

	it("does not treat two consumers of the same event as a trailing event", async () => {
		const rows = [{ id: 1, instance_id: 7_005 }];
		vi.mocked(invoke).mockResolvedValueOnce(rows);

		const first = refreshInstanceResourceRows(7_005, "revision-1");
		const second = refreshInstanceResourceRows(7_005, "revision-1");

		await expect(Promise.all([first, second])).resolves.toEqual([rows, rows]);
		expect(invoke).toHaveBeenCalledTimes(1);
	});

	it("evicts retained rows and revisions with the overview LRU", async () => {
		const oldestId = 8_000;
		invalidateInstanceResourceOverview(oldestId);
		vi.mocked(invoke).mockResolvedValueOnce([{ id: 1, instance_id: oldestId }]);
		await refreshInstanceResourceRows(oldestId, "old-revision");
		vi.mocked(invoke).mockResolvedValue({
			...overview,
			resources: [],
		});
		await loadInstanceResourceOverview(oldestId);
		for (
			let instanceId = oldestId + 1;
			instanceId <= oldestId + 12;
			instanceId++
		) {
			invalidateInstanceResourceOverview(instanceId);
			await loadInstanceResourceOverview(instanceId);
		}

		vi.mocked(invoke).mockClear();
		vi.mocked(invoke).mockResolvedValueOnce([{ id: 2, instance_id: oldestId }]);
		await expect(
			refreshInstanceResourceRows(oldestId, "old-revision"),
		).resolves.toEqual([{ id: 2, instance_id: oldestId }]);
		expect(invoke).toHaveBeenCalledTimes(1);
	});
});
