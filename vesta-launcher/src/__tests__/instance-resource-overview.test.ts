import {
	getCachedInstanceResourceOverview,
	invalidateInstanceResourceOverview,
	loadInstanceResourceOverview,
	projectRecordMap,
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
		const records = projectRecordMap(overview.projectRecords);
		expect(records["modrinth:sodium"]?.name).toBe("Sodium");
	});
});
