import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	runtimeAvailable: false,
	invoke: vi.fn(),
	listen: vi.fn(),
}));

vi.mock("@utils/tauri-runtime", () => ({
	hasTauriRuntime: () => mocks.runtimeAvailable,
}));

vi.mock("@tauri-apps/api/core", () => ({
	invoke: mocks.invoke,
}));

vi.mock("@tauri-apps/api/event", () => ({
	listen: mocks.listen,
}));

vi.mock("~/keybindings/catalog", () => ({
	commandDefinitions: [
		{
			commandId: "app.reload",
			handlerId: "app.reload",
			label: "Reload",
			description: "Reload",
			category: "Application",
			defaultChord: "Mod+KeyR",
			sortOrder: 0,
			execute: vi.fn(),
		},
	],
}));

describe("keybinding initialization", () => {
	beforeEach(() => {
		vi.resetModules();
		mocks.runtimeAvailable = false;
		mocks.invoke.mockReset();
		mocks.listen.mockReset();
		mocks.listen.mockResolvedValue(vi.fn());
		mocks.invoke.mockResolvedValue([]);
	});

	it("can initialize after Tauri becomes available", async () => {
		const { initializeKeybindings } = await import("~/keybindings/store");

		await initializeKeybindings();
		expect(mocks.listen).not.toHaveBeenCalled();
		expect(mocks.invoke).not.toHaveBeenCalled();

		mocks.runtimeAvailable = true;
		await initializeKeybindings();

		expect(mocks.listen).toHaveBeenCalledOnce();
		expect(mocks.invoke).toHaveBeenCalledWith(
			"reconcile_keybinding_catalog",
			expect.objectContaining({
				definitions: [
					expect.objectContaining({
						commandId: "app.reload",
					}),
				],
			}),
		);
	});
});
