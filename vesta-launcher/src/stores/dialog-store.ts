import { createStore } from "solid-js/store";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

export type DialogSeverity = "info" | "warning" | "error" | "success" | "question";

export interface DialogAction {
	id: string;
	label: string;
	color?: "primary" | "secondary" | "destructive" | "warning" | "none";
	variant?: "solid" | "outline" | "ghost" | "shadow";
}

export interface DialogInputConfig {
	placeholder?: string;
	defaultValue?: string;
	isPassword?: boolean;
}

export interface DialogInstance {
	id: string;
	title: string;
	description?: string;
	severity: DialogSeverity;
	actions: DialogAction[];
	input?: DialogInputConfig;
	resolve: (response: DialogResponse) => void;
	isBackendGenerated?: boolean;
}

export interface DialogResponse {
	id: string;
	action_id: string;
	input_value?: string;
}

interface BackendDialogRequest {
	id: string;
	title: string;
	description?: string;
	severity: DialogSeverity;
	actions: DialogAction[];
	input?: {
		placeholder?: string;
		default_value?: string;
		is_password: boolean;
	};
}

const [dialogs, setDialogs] = createStore<DialogInstance[]>([]);

const _pushDialog = (dialog: DialogInstance) => setDialogs((d) => [...d, dialog]);
const _removeDialog = (id: string) => setDialogs((d) => d.filter((item) => item.id !== id));

// Global unlisten function for dialog system to handle HMR cleanup
let dialogSystemUnlisten: (() => void) | null = null;

export const dialogStore = {
	dialogs,

	/**
	 * Internal function to add a dialog to the stack.
	 */
	_pushDialog,

	/**
	 * Internal function to remove a dialog from the stack.
	 */
	_removeDialog,

	/**
	 * Shows a generic dialog and returns a promise that resolves with the response.
	 */
	show(options: Omit<DialogInstance, "id" | "resolve">): Promise<DialogResponse> {
		return new Promise((resolve) => {
			const id = Math.random().toString(36).substring(2, 9);
			const instance: DialogInstance = {
				...options,
				id,
				resolve: (response) => {
					_removeDialog(id);
					resolve(response);
				},
			};
			_pushDialog(instance);
		});
	},

	/**
	 * Shows a simple alert dialog.
	 */
	async alert(title: string, description?: string, severity: DialogSeverity = "info"): Promise<void> {
		await dialogStore.show({
			title,
			description,
			severity,
			actions: [{ id: "ok", label: "OK", color: "primary", variant: "solid" }],
		});
	},

	/**
	 * Shows a confirmation dialog. Returns true if confirmed.
	 */
	async confirm(
		title: string,
		description?: string,
		options?: { okLabel?: string; cancelLabel?: string; severity?: DialogSeverity; isDestructive?: boolean },
	): Promise<boolean> {
		const result = await dialogStore.show({
			title,
			description,
			severity: options?.severity ?? (options?.isDestructive ? "warning" : "question"),
			actions: [
				{ id: "cancel", label: options?.cancelLabel ?? "Cancel", variant: "ghost" },
				{
					id: "confirm",
					label: options?.okLabel ?? "Confirm",
					color: options?.isDestructive ? "destructive" : "primary",
					variant: "solid",
				},
			],
		});
		return result.action_id === "confirm";
	},

	/**
	 * Shows a prompt dialog for text input. Returns the string or null if cancelled.
	 */
	async prompt(
		title: string,
		description?: string,
		options?: { placeholder?: string; defaultValue?: string; isPassword?: boolean; okLabel?: string },
	): Promise<string | null> {
		const result = await dialogStore.show({
			title,
			description,
			severity: "question",
			input: {
				placeholder: options?.placeholder,
				defaultValue: options?.defaultValue,
				isPassword: options?.isPassword,
			},
			actions: [
				{ id: "cancel", label: "Cancel", variant: "ghost" },
				{ id: "confirm",	label: options?.okLabel ?? "Submit", color: "primary", variant: "solid" },
			],
		});

		if (result.action_id === "confirm") {
			return result.input_value ?? "";
		}
		return null;
	},

	/**
	 * Submit a response to a dialog.
	 */
	async submit(id: string, action_id: string, input_value?: string) {
		const dialog = dialogs.find((d) => d.id === id);
		if (!dialog) return;

		const response: DialogResponse = { id, action_id, input_value };

		if (dialog.isBackendGenerated) {
			try {
				await invoke("submit_dialog_response", { response });
				// Only resolve after successful backend submission to prevent deadlock
				dialog.resolve(response);
			} catch (e) {
				console.error("Failed to submit dialog response to backend:", e);
				// Keep dialog open on failure to allow retry
			}
		} else {
			// For frontend dialogs, always resolve immediately
			dialog.resolve(response);
		}
	},
};

/**
 * Initialize backend dialog listeners.
 * Automatically handles cleanup of previous listeners.
 */
export async function initializeDialogSystem(): Promise<void> {
	// Clean up any existing listener (important for HMR)
	if (dialogSystemUnlisten) {
		console.log("[DialogSystem] Cleaning up existing listener before re-initialization");
		dialogSystemUnlisten();
		dialogSystemUnlisten = null;
	}

	const unlisten = await listen<BackendDialogRequest>("core://dialog-request", (event) => {
		const request = event.payload;

		const instance: DialogInstance = {
			id: request.id,
			title: request.title,
			description: request.description,
			severity: request.severity,
			actions: request.actions,
			input: request.input
				? {
						placeholder: request.input.placeholder,
						defaultValue: request.input.default_value,
						isPassword: request.input.is_password,
				  }
				: undefined,
			isBackendGenerated: true,
			resolve: () => {
				_removeDialog(request.id);
			},
		};

		dialogStore._pushDialog(instance);
	});

	// Store the unlisten function globally
	dialogSystemUnlisten = unlisten;

	// No longer return unlisten since cleanup is handled internally
}

/**
 * Cleanup dialog system listeners
 */
export function cleanupDialogSystem(): void {
	if (dialogSystemUnlisten) {
		console.log("[DialogSystem] Cleaning up dialog system listener");
		dialogSystemUnlisten();
		dialogSystemUnlisten = null;
	}
}
