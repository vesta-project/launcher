import { chordFromKeyboardEvent } from "./chords";
import type { CommandDefinition, PersistedCommand } from "./types";

export function isEditableTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	return Boolean(
		target.closest(
			'input, textarea, select, [contenteditable="true"], [contenteditable="plaintext-only"]',
		),
	);
}

export function dispatchKeybinding(
	event: KeyboardEvent,
	commands: readonly PersistedCommand[],
	handlers: ReadonlyMap<string, CommandDefinition>,
): boolean {
	if (event.defaultPrevented || event.repeat || isEditableTarget(event.target)) {
		return false;
	}

	const chord = chordFromKeyboardEvent(event);
	if (!chord) return false;
	const persisted = commands.find(
		(command) => command.available && command.currentChord === chord,
	);
	if (!persisted) return false;

	const definition = handlers.get(persisted.handlerId);
	if (!definition || definition.canExecute?.() === false) return false;

	event.preventDefault();
	void definition.execute();
	return true;
}
