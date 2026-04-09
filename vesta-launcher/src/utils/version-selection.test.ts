import type { PistonMetadata } from "@utils/instances";
import {
	getAllModloaders,
	getNotifiableSelectionAdjustments,
	resolveCompatibleVersionSelection,
} from "@utils/version-selection";
import { describe, expect, it } from "vitest";

const METADATA: PistonMetadata = {
	last_updated: "2026-04-06T00:00:00Z",
	latest: {
		release: "1.20.1",
		snapshot: "24w14a",
	},
	game_versions: [
		{
			id: "1.20.1",
			version_type: "release",
			release_time: "2023-06-12T12:00:00Z",
			stable: true,
			loaders: {
				fabric: [
					{ version: "0.15.10", stable: true },
					{ version: "0.15.9", stable: false },
				],
				forge: [{ version: "47.3.0", stable: true }],
			},
		},
		{
			id: "1.20.4",
			version_type: "release",
			release_time: "2023-12-07T12:00:00Z",
			stable: true,
			loaders: {
				fabric: [{ version: "0.15.11", stable: true }],
			},
		},
	],
};

describe("version-selection", () => {
	it("switches minecraft version when selected loader is unsupported", () => {
		const resolved = resolveCompatibleVersionSelection({
			metadata: METADATA,
			minecraftVersion: "1.20.4",
			modloader: "forge",
			modloaderVersion: "",
		});

		expect(resolved.minecraftVersion).toBe("1.20.1");
		expect(resolved.modloader).toBe("forge");
		expect(resolved.modloaderVersion).toBe("47.3.0");
		expect(resolved.adjustments.length).toBeGreaterThan(0);
	});

	it("switches to latest available loader version when current one is invalid", () => {
		const resolved = resolveCompatibleVersionSelection({
			metadata: METADATA,
			minecraftVersion: "1.20.1",
			modloader: "fabric",
			modloaderVersion: "0.0.1",
		});

		expect(resolved.minecraftVersion).toBe("1.20.1");
		expect(resolved.modloader).toBe("fabric");
		expect(resolved.modloaderVersion).toBe("0.15.10");
		expect(resolved.adjustments.some((adjustment) => adjustment.code === "modloaderVersion")).toBe(
			true,
		);
	});

	it("clears loader version when vanilla is selected", () => {
		const resolved = resolveCompatibleVersionSelection({
			metadata: METADATA,
			minecraftVersion: "1.20.1",
			modloader: "vanilla",
			modloaderVersion: "47.3.0",
		});

		expect(resolved.modloader).toBe("vanilla");
		expect(resolved.modloaderVersion).toBe("");
	});

	it("returns sorted loader catalog with vanilla first", () => {
		const loaders = getAllModloaders(METADATA);
		expect(loaders[0]).toBe("vanilla");
		expect(loaders).toContain("fabric");
		expect(loaders).toContain("forge");
	});

	it("does not notify when loader switch auto-selects latest", () => {
		const resolved = resolveCompatibleVersionSelection({
			metadata: METADATA,
			minecraftVersion: "1.20.1",
			modloader: "fabric",
			modloaderVersion: "",
		});

		const notifiable = getNotifiableSelectionAdjustments(resolved.adjustments);
		expect(notifiable).toHaveLength(0);
	});

	it("notifies when current loader version becomes invalid", () => {
		const resolved = resolveCompatibleVersionSelection({
			metadata: METADATA,
			minecraftVersion: "1.20.4",
			modloader: "fabric",
			modloaderVersion: "0.15.10",
		});

		const notifiable = getNotifiableSelectionAdjustments(resolved.adjustments);
		expect(notifiable.some((adjustment) => adjustment.code === "modloaderVersion")).toBe(true);
	});

	it("keeps major compatibility adjustments for notifications", () => {
		const resolved = resolveCompatibleVersionSelection({
			metadata: METADATA,
			minecraftVersion: "1.20.4",
			modloader: "forge",
			modloaderVersion: "47.3.0",
		});

		const notifiable = getNotifiableSelectionAdjustments(resolved.adjustments);
		expect(notifiable.some((adjustment) => adjustment.code === "minecraftVersion")).toBe(true);
	});
});
