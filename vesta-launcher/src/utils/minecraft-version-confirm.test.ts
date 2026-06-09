import { dialogStore } from "@stores/dialog-store";
import { confirmMinecraftVersionChange } from "@utils/minecraft-version-confirm";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@stores/dialog-store", () => ({
	dialogStore: {
		confirm: vi.fn(),
	},
}));

describe("confirmMinecraftVersionChange", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns true without prompting when the version is unchanged", async () => {
		const result = await confirmMinecraftVersionChange({
			instanceName: "Test Instance",
			currentVersion: "1.20.1",
			nextVersion: "1.20.1",
			context: "manual",
		});

		expect(result).toBe(true);
		expect(dialogStore.confirm).not.toHaveBeenCalled();
	});

	it("prompts and returns true when the user confirms", async () => {
		vi.mocked(dialogStore.confirm).mockResolvedValue(true);

		const result = await confirmMinecraftVersionChange({
			instanceName: "Test Instance",
			currentVersion: "1.20.1",
			nextVersion: "1.21.1",
			context: "manual",
		});

		expect(result).toBe(true);
		expect(dialogStore.confirm).toHaveBeenCalledWith(
			"Change Minecraft Version?",
			expect.stringContaining('from 1.20.1 to 1.21.1'),
			{
				severity: "warning",
				okLabel: "Change Version",
				isDestructive: true,
			},
		);
		expect(dialogStore.confirm).toHaveBeenCalledWith(
			"Change Minecraft Version?",
			expect.stringContaining("Existing worlds may become incompatible"),
			expect.any(Object),
		);
	});

	it("uses modpack-specific wording for modpack updates", async () => {
		vi.mocked(dialogStore.confirm).mockResolvedValue(true);

		await confirmMinecraftVersionChange({
			instanceName: "Sky Factory",
			currentVersion: "1.12.2",
			nextVersion: "1.20.1",
			context: "modpack-update",
		});

		expect(dialogStore.confirm).toHaveBeenCalledWith(
			"Change Minecraft Version?",
			expect.stringContaining("Updating this modpack will change the Minecraft version"),
			expect.any(Object),
		);
	});

	it("returns false when the user cancels", async () => {
		vi.mocked(dialogStore.confirm).mockResolvedValue(false);

		const result = await confirmMinecraftVersionChange({
			instanceName: "Test Instance",
			currentVersion: "1.20.1",
			nextVersion: "1.21.1",
			context: "manual",
		});

		expect(result).toBe(false);
	});
});
