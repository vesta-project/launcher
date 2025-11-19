import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { showToast, tryRemoveToast } from "@ui/toast/toast";
import { JSX, createSignal } from "solid-js";

const [notifications, setNotifications] = createSignal<Notification[]>([]);

type AlertType = "Info" | "Success" | "Warning" | "Error";
type DismissType = "Close" | "Hide";

interface Notification {
	id: number;
	dismiss_type: DismissType;
	type: AlertType;
	title?: string;
	description?: string;
	progress?: number | null; // -1 for pulsing, 0-100 for percentage, null for none
	current_step?: number | null;
	total_steps?: number | null;
	client_key?: string | null;
}

// Backend notification structure from Rust
interface BackendNotification {
	id: number;
	client_key: string | null;
	title: string | null;
	description: string | null;
	severity: string;
	persist: boolean;
	progress: number | null;
	current_step: number | null;
	total_steps: number | null;
	read: boolean;
	metadata: string | null;
	created_at: string;
	updated_at: string;
	expires_at: string | null;
}

function showAlert(
	type: AlertType,
	title?: string,
	description?: string,
	dismiss_type: DismissType = "Hide",
	progress?: number | null,
	current_step?: number | null,
	total_steps?: number | null,
) {
	let id = showToast({
		title,
		description,
		duration: 5000,
		onToastForceClose: (id: number) => closeAlert(id),
		severity: type,
		progress,
		current_step,
		total_steps,
	});

	setNotifications((notifications) => [
		...notifications,
		{
			id,
			dismiss_type,
			type,
			title,
			description,
			progress,
			current_step,
			total_steps,
		},
	]);
	return id;
}

function removeAllAlerts() {
	setNotifications([]);
}

function closeAlert(id: number) {
	console.log(`Closing Alert ${id}`);
	setNotifications((notifications) => notifications.filter((n) => n.id !== id));
	tryRemoveToast(id);
}

// Tauri command wrappers
async function createNotification(params: {
	title?: string;
	description?: string;
	severity: "info" | "success" | "warning" | "error";
	persist?: boolean;
	progress?: number;
	current_step?: number;
	total_steps?: number;
	client_key?: string;
	metadata?: string;
}): Promise<number> {
	return await invoke<number>("create_notification", { payload: params });
}

async function updateNotificationProgress(params: {
	id?: number;
	client_key?: string;
	progress?: number;
	current_step?: number;
	total_steps?: number;
}): Promise<void> {
	await invoke("update_notification_progress", { payload: params });
}

async function listNotifications(filters?: {
	severity?: string;
	read?: boolean;
	persist?: boolean;
}): Promise<BackendNotification[]> {
	return await invoke<BackendNotification[]>("list_notifications", {
		filters: filters || null,
	});
}

async function markNotificationRead(id: number): Promise<void> {
	await invoke("mark_notification_read", { id });
}

async function deleteNotification(id: number): Promise<void> {
	await invoke("delete_notification", { id });
}

async function cleanupNotifications(): Promise<number> {
	// Get retention days from config, default to 30
	const config = await invoke<{ notification_retention_days: number }>(
		"get_config",
	);
	const retentionDays = config?.notification_retention_days || 30;
	return await invoke<number>("cleanup_notifications", { retentionDays });
}

// Event listener setup
let unsubscribeFns: Array<() => void> = [];

// Signal to trigger refetch of persistent notifications
const [persistentNotificationTrigger, setPersistentNotificationTrigger] =
	createSignal(0);

function triggerPersistentNotificationRefetch() {
	setPersistentNotificationTrigger((prev) => prev + 1);
}

async function subscribeToBackendNotifications() {
	// Listen for new/updated notifications
	const unsubNotif = await listen<BackendNotification>(
		"core://notification",
		(event) => {
			const notif = event.payload;

			// Always show toast for immediate visibility
			showAlert(
				severityToAlertType(notif.severity),
				notif.title || undefined,
				notif.description || undefined,
				notif.progress == null || notif.progress >= 100 ? "Hide" : "Close",
				notif.progress,
				notif.current_step,
				notif.total_steps,
			);

			// If persistent, also trigger refetch to update sidebar
			if (notif.persist) {
				triggerPersistentNotificationRefetch();
			}
		},
	);

	// Listen for progress updates
	const unsubProgress = await listen<BackendNotification>(
		"core://notification-progress",
		(event) => {
			const notif = event.payload;
			// Update existing toast if it's ephemeral
			if (!notif.persist && notif.client_key) {
				const existing = notifications().find(
					(n) => n.client_key && n.client_key === notif.client_key,
				);
				if (existing) {
					console.debug(
						`Progress update for ${notif.client_key}: ${notif.progress}%`,
					);
					// TODO: Update the toast UI directly (requires toast refactor)
				}
			} else if (notif.persist) {
				// Trigger refetch for persistent notifications with progress updates
				triggerPersistentNotificationRefetch();
			}
		},
	);

	// Listen for notification updates (read/delete)
	const unsubUpdated = await listen<{ id_or_client_key: string }>(
		"core://notification-updated",
		() => {
			triggerPersistentNotificationRefetch();
		},
	);

	unsubscribeFns = [unsubNotif, unsubProgress, unsubUpdated];
}

function unsubscribeFromBackendNotifications() {
	for (const unsub of unsubscribeFns) {
		unsub();
	}
	unsubscribeFns = [];
}

function severityToAlertType(severity: string): AlertType {
	switch (severity.toLowerCase()) {
		case "error":
			return "Error";
		case "warning":
			return "Warning";
		case "success":
			return "Success";
		default:
			return "Info";
	}
}

export {
	type Notification,
	type BackendNotification,
	type AlertType,
	notifications,
	showAlert,
	closeAlert,
	removeAllAlerts,
	createNotification,
	updateNotificationProgress,
	listNotifications,
	markNotificationRead,
	deleteNotification,
	cleanupNotifications,
	subscribeToBackendNotifications,
	unsubscribeFromBackendNotifications,
	persistentNotificationTrigger,
};
