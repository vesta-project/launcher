import { chordFromKeyboardEvent, displayChord } from "~/keybindings/chords";
import {
	dispatchKeybinding,
	isEditableTarget,
} from "~/keybindings/dispatcher-core";
import type {
	CommandDefinition,
	PersistedCommand,
} from "~/keybindings/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

function setPlatform(platform: string): void {
	Object.defineProperty(navigator, "platform", {
		configurable: true,
		value: platform,
	});
}

function persisted(chord = "Mod+KeyR"): PersistedCommand {
	return {
		commandId: "app.reload",
		handlerId: "app.reload",
		label: "Reload",
		description: "Reload",
		category: "Application",
		defaultChord: "Mod+KeyR",
		currentChord: chord,
		customized: false,
		available: true,
		sortOrder: 0,
	};
}

describe("keybinding chords", () => {
	beforeEach(() => setPlatform("MacIntel"));

	it("normalizes the platform primary modifier", () => {
		const mac = new KeyboardEvent("keydown", {
			code: "KeyR",
			key: "r",
			metaKey: true,
		});
		expect(chordFromKeyboardEvent(mac)).toBe("Mod+KeyR");

		setPlatform("Win32");
		const windows = new KeyboardEvent("keydown", {
			code: "KeyR",
			key: "r",
			ctrlKey: true,
		});
		expect(chordFromKeyboardEvent(windows)).toBe("Mod+KeyR");
	});

	it("formats browser-style shortcuts for the current platform", () => {
		expect(displayChord("Mod+Digit1")).toBe("⌘1");
		setPlatform("Win32");
		expect(displayChord("Mod+Digit1")).toBe("Ctrl+1");
	});
});

describe("keybinding dispatch", () => {
	beforeEach(() => setPlatform("MacIntel"));

	it("executes one matching command and prevents the native shortcut", () => {
		const execute = vi.fn();
		const definition: CommandDefinition = {
			commandId: "app.reload",
			handlerId: "app.reload",
			label: "Reload",
			description: "Reload",
			category: "Application",
			defaultChord: "Mod+KeyR",
			sortOrder: 0,
			execute,
		};
		const event = new KeyboardEvent("keydown", {
			code: "KeyR",
			key: "r",
			metaKey: true,
			cancelable: true,
		});

		expect(
			dispatchKeybinding(
				event,
				[persisted()],
				new Map([["app.reload", definition]]),
			),
		).toBe(true);
		expect(execute).toHaveBeenCalledTimes(1);
		expect(event.defaultPrevented).toBe(true);
	});

	it("does not consume disabled commands or repeated keys", () => {
		const execute = vi.fn();
		const definition: CommandDefinition = {
			commandId: "app.reload",
			handlerId: "app.reload",
			label: "Reload",
			description: "Reload",
			category: "Application",
			defaultChord: "Mod+KeyR",
			sortOrder: 0,
			canExecute: () => false,
			execute,
		};
		const disabled = new KeyboardEvent("keydown", {
			code: "KeyR",
			key: "r",
			metaKey: true,
			cancelable: true,
		});
		expect(
			dispatchKeybinding(
				disabled,
				[persisted()],
				new Map([["app.reload", definition]]),
			),
		).toBe(false);

		const repeated = new KeyboardEvent("keydown", {
			code: "KeyR",
			key: "r",
			metaKey: true,
			repeat: true,
		});
		expect(
			dispatchKeybinding(
				repeated,
				[persisted()],
				new Map([["app.reload", definition]]),
			),
		).toBe(false);
		expect(execute).not.toHaveBeenCalled();
	});

	it("ignores shortcuts originating from editable controls", () => {
		const input = document.createElement("input");
		expect(isEditableTarget(input)).toBe(true);

		const event = new KeyboardEvent("keydown", {
			code: "KeyR",
			key: "r",
			metaKey: true,
			bubbles: true,
			cancelable: true,
		});
		input.dispatchEvent(event);
		expect(dispatchKeybinding(event, [persisted()], new Map())).toBe(false);
		expect(event.defaultPrevented).toBe(false);
	});
});
