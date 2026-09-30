import { dialogStore } from "@stores/dialog-store";
import { confirmMinecraftVersionChange } from "@utils/minecraft-version-confirm";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@stores/dialog-store", () => ({
	dialogStore: {
		confirm: vi.fn(),
	},
}));

describe("confirmMinecraftVersionChange", () => {
	const withoutBidiIsolation = (value: string) =>
		value.replace(/[\u2068\u2069]/g, "");

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
			expect.any(String),
			{
				severity: "warning",
				okLabel: "Change Version",
				isDestructive: true,
			},
		);
		const description = vi.mocked(dialogStore.confirm).mock.calls[0][1] ?? "";
		expect(withoutBidiIsolation(description)).toContain("from 1.20.1 to 1.21.1");
		expect(dialogStore.confirm).toHaveBeenCalledWith(
			"Change Minecraft Version?",
			expect.any(String),
			expect.any(Object),
		);
		expect(withoutBidiIsolation(description)).toContain("Existing worlds may become incompatible");
	});

	it("uses modpack-specific wording for modpack updates", async () => {
		vi.mocked(dialogStore.confirm).mockResolvedValue(true);

		await confirmMinecraftVersionChange({
			instanceName: "Sky Factory",
			currentVersion: "1.12.2",
			nextVersion: "1.20.1",
			context: "modpack-update",
		});

		const description = vi.mocked(dialogStore.confirm).mock.calls[0][1] ?? "";
		expect(withoutBidiIsolation(description)).toContain(
			"Updating this modpack will change the Minecraft version",
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
