import { dialogStore } from "@stores/dialog-store";
import {
	buildDatapackCompatibilityDescription,
	confirmDatapackWorldCompatibility,
	summarizeProviderMinecraftVersions,
} from "@utils/datapack-compatibility-confirm";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@stores/dialog-store", () => ({
	dialogStore: { confirm: vi.fn() },
}));

describe("datapack compatibility confirmation", () => {
	beforeEach(() => vi.clearAllMocks());

	it("does not prompt for an exact saved Minecraft version", async () => {
		expect(
			await confirmDatapackWorldCompatibility({
				projectName: "VeinMiner",
				version: { version_number: "2.3.1", game_versions: ["1.21.4"] },
				world: {
					displayName: "New World",
					gameVersion: "1.21.4",
					dataVersion: 4189,
				},
			}),
		).toEqual({ compatibility: "exact", acknowledged: true });
		expect(dialogStore.confirm).not.toHaveBeenCalled();
	});

	it("identifies the datapack release, declared range, and target world", async () => {
		vi.mocked(dialogStore.confirm).mockResolvedValue(true);
		await confirmDatapackWorldCompatibility({
			projectName: "VeinMiner",
			version: {
				version_number: "2.3.1",
				game_versions: [
					"1.20.1",
					"1.20.2",
					"1.20.4",
					"1.21",
					"1.21.1",
					"1.21.3",
				],
			},
			world: {
				displayName: "New World",
				gameVersion: "1.21.4",
				dataVersion: 4189,
			},
		});

		expect(dialogStore.confirm).toHaveBeenCalledWith(
			"Confirm datapack compatibility",
			expect.stringContaining("Datapack release: 2.3.1"),
			expect.objectContaining({ severity: "warning" }),
		);
		const description = vi.mocked(dialogStore.confirm).mock.calls[0][1] ?? "";
		expect(description).toContain(
			"Provider-listed Minecraft versions: 1.20.1–1.21.3 (6 versions listed)",
		);
		expect(description).toContain("Target world: New World");
		expect(description).toContain("Target saved version: 1.21.4");
	});

	it("uses a DataVersion fallback when the saved version name is unknown", () => {
		const description = buildDatapackCompatibilityDescription({
			projectName: "Pack",
			version: { version_number: "1.0", game_versions: [] },
			world: {
				displayName: "Legacy",
				gameVersion: null,
				dataVersion: 19133,
			},
			compatibility: "unknown",
		});
		expect(description).toContain(
			"Provider-listed Minecraft versions: Not specified by provider",
		);
		expect(description).toContain("Target saved version: DataVersion 19133");
	});

	it("filters environment labels and lists short version sets exactly", () => {
		expect(
			summarizeProviderMinecraftVersions([
				"Server",
				"1.21.4",
				"client",
				"1.21.1",
				"1.21.4",
			]),
		).toBe("1.21.1, 1.21.4");
	});
});
