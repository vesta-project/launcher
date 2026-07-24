import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { hasTauriRuntime } from "@utils/tauri-runtime";
import { createSignal } from "solid-js";
import { commandDefinitions } from "./catalog";
import type {
	BindingMutationResult,
	PersistedCommand,
} from "./types";

function fallbackCommands(): PersistedCommand[] {
	return commandDefinitions.map((definition) => ({
		commandId: definition.commandId,
		handlerId: definition.handlerId,
		label: definition.label,
		description: definition.description,
		category: definition.category,
		defaultChord: definition.defaultChord,
		currentChord: definition.defaultChord,
		customized: false,
		available: true,
		sortOrder: definition.sortOrder,
	}));
}

const [commands, setCommands] = createSignal<PersistedCommand[]>(
	fallbackCommands(),
);
const [loading, setLoading] = createSignal(false);
const [persistenceError, setPersistenceError] = createSignal<string>();
let initializationPromise: Promise<void> | undefined;
let subscribedToUpdates = false;

function replaceCommand(updated: PersistedCommand): void {
	setCommands((current) =>
		current.map((command) =>
			command.commandId === updated.commandId ? updated : command,
		),
	);
}

function applyMutation(result: BindingMutationResult): BindingMutationResult {
	replaceCommand(result.command);
	if (result.applied && result.conflict) {
		replaceCommand({
			...result.conflict,
			currentChord: null,
			customized: true,
		});
	}
	return result;
}

export function initializeKeybindings(): Promise<void> {
	if (initializationPromise) return initializationPromise;
	initializationPromise = (async () => {
		if (!hasTauriRuntime()) return;
		setLoading(true);
		try {
			if (!subscribedToUpdates) {
				await listen<BindingMutationResult>(
					"core://keybindings-updated",
					(event) => applyMutation(event.payload),
				);
				subscribedToUpdates = true;
			}
			const reconciled = await invoke<PersistedCommand[]>(
				"reconcile_keybinding_catalog",
				{
					definitions: commandDefinitions.map(
						({ execute: _execute, canExecute: _canExecute, ...definition }) =>
							definition,
					),
				},
			);
			setCommands(reconciled);
			setPersistenceError(undefined);
		} catch (error) {
			console.error("Failed to initialize keybindings:", error);
			setPersistenceError(String(error));
		} finally {
			setLoading(false);
		}
	})();
	return initializationPromise;
}

export async function assignKeybinding(
	commandId: string,
	chord: string,
	replaceConflict = false,
): Promise<BindingMutationResult> {
	if (!hasTauriRuntime()) {
		const command = commands().find((item) => item.commandId === commandId);
		if (!command) throw new Error(`Unknown command ${commandId}`);
		const conflict =
			commands().find(
				(item) =>
					item.commandId !== commandId && item.currentChord === chord,
			) ?? null;
		if (conflict && !replaceConflict) {
			return { command, conflict, applied: false };
		}
		return applyMutation({
			command: { ...command, currentChord: chord, customized: true },
			conflict,
			applied: true,
		});
	}
	return applyMutation(
		await invoke<BindingMutationResult>("set_keybinding", {
			commandId,
			chord,
			replaceConflict,
		}),
	);
}

export async function clearKeybinding(
	commandId: string,
): Promise<BindingMutationResult> {
	if (!hasTauriRuntime()) {
		const command = commands().find((item) => item.commandId === commandId);
		if (!command) throw new Error(`Unknown command ${commandId}`);
		return applyMutation({
			command: { ...command, currentChord: null, customized: true },
			conflict: null,
			applied: true,
		});
	}
	return applyMutation(
		await invoke<BindingMutationResult>("clear_keybinding", { commandId }),
	);
}

export async function resetKeybinding(
	commandId: string,
	replaceConflict = false,
): Promise<BindingMutationResult> {
	if (!hasTauriRuntime()) {
		const command = commands().find((item) => item.commandId === commandId);
		if (!command) throw new Error(`Unknown command ${commandId}`);
		const conflict = command.defaultChord
			? (commands().find(
					(item) =>
						item.commandId !== commandId &&
						item.currentChord === command.defaultChord,
				) ?? null)
			: null;
		if (conflict && !replaceConflict) {
			return { command, conflict, applied: false };
		}
		return applyMutation({
			command: {
				...command,
				currentChord: command.defaultChord,
				customized: false,
			},
			conflict,
			applied: true,
		});
	}
	return applyMutation(
		await invoke<BindingMutationResult>("reset_keybinding", {
			commandId,
			replaceConflict,
		}),
	);
}

export function keybindingFor(commandId: string): string | null {
	return (
		commands().find((command) => command.commandId === commandId)
			?.currentChord ?? null
	);
}

export {
	commands as keybindingCommands,
	loading as keybindingsLoading,
	persistenceError as keybindingsPersistenceError,
};
