import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
	const reload = {
		commandId: "app.reload",
		handlerId: "app.reload",
		label: "Reload current page",
		description: "Reload the current page.",
		category: "Application",
		defaultChord: "Mod+KeyR",
		currentChord: "Mod+KeyR",
		customized: false,
		available: true,
		sortOrder: 10,
	};
	const close = {
		commandId: "app.close",
		handlerId: "app.close",
		label: "Close current page",
		description: "Close the current page.",
		category: "Application",
		defaultChord: "Mod+KeyW",
		currentChord: "Mod+KeyW",
		customized: false,
		available: true,
		sortOrder: 20,
	};
	return {
		reload,
		close,
		assign: vi.fn(),
		clear: vi.fn(),
		reset: vi.fn(),
	};
});

vi.mock("~/keybindings/store", () => ({
	keybindingCommands: () => [mocks.reload, mocks.close],
	keybindingsLoading: () => false,
	keybindingsPersistenceError: () => undefined,
	assignKeybinding: mocks.assign,
	clearKeybinding: mocks.clear,
	resetKeybinding: mocks.reset,
}));

import { KeyboardSettingsTab } from "@components/pages/mini-pages/settings/keyboard/KeyboardTab";

describe("Keyboard settings", () => {
	beforeEach(() => {
		Object.defineProperty(navigator, "platform", {
			configurable: true,
			value: "MacIntel",
		});
		mocks.assign.mockReset();
		mocks.clear.mockReset();
		mocks.reset.mockReset();
	});

	afterEach(() => cleanup());

	it("records a shortcut entirely from the keyboard", async () => {
		mocks.assign.mockResolvedValue({
			command: {
				...mocks.reload,
				currentChord: "Mod+KeyK",
				customized: true,
			},
			conflict: null,
			applied: true,
		});
		render(() => <KeyboardSettingsTab />);

		fireEvent.click(
			screen.getByRole("button", {
				name: "Change shortcut for Reload current page",
			}),
		);
		fireEvent.keyDown(window, {
			key: "k",
			code: "KeyK",
			metaKey: true,
		});

		await waitFor(() =>
			expect(mocks.assign).toHaveBeenCalledWith(
				"app.reload",
				"Mod+KeyK",
			),
		);
	});

	it("requires confirmation before moving a conflicting shortcut", async () => {
		mocks.assign
			.mockResolvedValueOnce({
				command: mocks.reload,
				conflict: mocks.close,
				applied: false,
			})
			.mockResolvedValueOnce({
				command: {
					...mocks.reload,
					currentChord: "Mod+KeyW",
					customized: true,
				},
				conflict: mocks.close,
				applied: true,
			});
		render(() => <KeyboardSettingsTab />);

		fireEvent.click(
			screen.getByRole("button", {
				name: "Change shortcut for Reload current page",
			}),
		);
		fireEvent.keyDown(window, {
			key: "w",
			code: "KeyW",
			metaKey: true,
		});

		expect(await screen.findByText("Replace existing shortcut?")).toBeTruthy();
		fireEvent.click(
			screen.getByRole("button", { name: "Replace shortcut" }),
		);

		await waitFor(() =>
			expect(mocks.assign).toHaveBeenLastCalledWith(
				"app.reload",
				"Mod+KeyW",
				true,
			),
		);
	});
});
