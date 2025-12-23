import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { showToast, tryRemoveToast, updateToast } from "@ui/toast/toast";
import { createSignal, JSX } from "solid-js";

const [notifications, setNotifications] = createSignal<Notification[]>([]);
let _notificationCache: Notification[] = [];

// New notification type system
type NotificationType = "alert" | "progress" | "immediate" | "patient";
type NotificationSeverity = "info" | "success" | "warning" | "error";
type NotificationActionType = "primary" | "secondary" | "destructive";

interface NotificationAction {
	id: string;
	label: string;
	type: NotificationActionType;
	payload?: any;
}

// Frontend notification structure (for toast/ephemeral display)
interface Notification {
	id: number;
	type: NotificationSeverity;
	title?: string;
	description?: string;
	progress?: number | null; // -1 for pulsing, 0-100 for percentage, null for none
	current_step?: number | null;
	total_steps?: number | null;
	client_key?: string | null;
	notification_type?: NotificationType;
	dismissible?: boolean;
	actions?: NotificationAction[];
	metadata?: string | null;
	show_on_completion?: boolean | null;
}

// Backend notification structure from Rust (matches Rust Notification struct)
interface BackendNotification {
	id: number;
	client_key: string | null;
	title: string;
	description: string | null;
	severity: NotificationSeverity;
	notification_type: NotificationType;
	dismissible: boolean;
	progress: number | null;
	current_step: number | null;
	total_steps: number | null;
	actions: NotificationAction[];
	read: boolean;
	metadata: string | null;
	created_at: string;
	updated_at: string;
	expires_at: string | null;
	show_on_completion?: boolean | null;
}

function showAlert(
	severity: NotificationSeverity,
	title?: string,
	description?: string,
	progress?: number | null,
	current_step?: number | null,
	total_steps?: number | null,
	client_key?: string | null,
	notification_type?: NotificationType,
	dismissible?: boolean,
	actions?: NotificationAction[],
	metadata?: string | null,
) {
	console.log(
		`[Notification] showAlert: ${title}, Key: ${client_key}, Type: ${notification_type}, Actions:`,
		actions,
	);
	// If progress is 0, treat it as indeterminate (-1) and hide steps to show a pulsing bar
	let displayProgress = progress;
	let displayCurrentStep = current_step;
	let displayTotalSteps = total_steps;

	if (progress === 0) {
		displayProgress = -1;
		displayCurrentStep = undefined; // Hide steps text
		displayTotalSteps = undefined; // Hide steps text
	}

	// Determine if cancellable based on actions (for backward compatibility)
	const cancellable = actions?.some((a) => a.id === "cancel_task") ?? false;

	let id = showToast({
		title,
		description,
		duration: 5000,
		onToastForceClose: (id: number) => closeAlert(id),
		severity: capitalizeFirstLetter(severity) as
			| "Info"
			| "Success"
			| "Warning"
			| "Error",
		progress: displayProgress,
		current_step: displayCurrentStep,
		total_steps: displayTotalSteps,
		cancellable: cancellable,
		onCancel: client_key ? () => cancelTask(client_key) : undefined,
	});

	const newNotif: Notification = {
		id,
		type: severity,
		title,
		description,
		progress,
		current_step,
		total_steps,
		client_key,
		notification_type,
		dismissible,
		actions,
		metadata,
	};

	_notificationCache.push(newNotif);
	setNotifications([..._notificationCache]);
	return id;
}

function removeAllAlerts() {
	_notificationCache = [];
	setNotifications([]);
}

function closeAlert(id: number) {
	console.log(`Closing Alert ${id}`);
	_notificationCache = _notificationCache.filter((n) => n.id !== id);
	setNotifications([..._notificationCache]);
	tryRemoveToast(id);
}

// Helper function to capitalize first letter
function capitalizeFirstLetter(str: string): string {
	return str.charAt(0).toUpperCase() + str.slice(1);
}

// Tauri command wrappers
async function createNotification(params: {
	title?: string;
	description?: string;
	severity?: NotificationSeverity;
	notification_type?: NotificationType;
	dismissible?: boolean;
	actions?: NotificationAction[];
	progress?: number;
	current_step?: number;
	total_steps?: number;
	client_key?: string;
	metadata?: string;
	show_on_completion?: boolean;
}): Promise<number> {
	return await invoke<number>("create_notification", { payload: params });
}

async function cancelTask(clientKey: string): Promise<void> {
	console.log(`Cancelling task: ${clientKey}`);
	await invoke("cancel_task", { clientKey });
}

async function invokeNotificationAction(
	actionId: string,
	clientKey?: string,
): Promise<void> {
	console.log(`Invoking notification action: ${actionId}, key: ${clientKey}`);
	await invoke("invoke_notification_action", { actionId, clientKey });
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
	severity?: NotificationSeverity;
	read?: boolean;
	notification_type?: NotificationType;
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

async function clearAllDismissibleNotifications(): Promise<number> {
	return await invoke<number>("clear_all_dismissible_notifications");
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
			console.log(
				`[Notification] Event: ${notif.title}, Key: ${notif.client_key}, Cache Size: ${_notificationCache.length}`,
			);

			// Check if we already have this notification in our ephemeral list
			let updated = false;
			if (notif.client_key) {
				const existing = _notificationCache.find(
					(n) => n.client_key === notif.client_key,
				);
				if (existing) {
					console.log(`[Notification] Updating existing: ${existing.id}`);
					updated = true;
					// Update existing toast and notification state
					const clientKey = notif.client_key;
					// Determine if cancellable based on actions
					const cancellable =
						notif.actions?.some((a) => a.id === "cancel_task") ?? false;
					updateToast(existing.id, {
						title: notif.title,
						description: notif.description || undefined,
						progress: notif.progress,
						current_step: notif.current_step,
						total_steps: notif.total_steps,
						severity: capitalizeFirstLetter(notif.severity) as
							| "Info"
							| "Success"
							| "Warning"
							| "Error",
						duration: 5000,
						cancellable: cancellable,
						onCancel: clientKey ? () => cancelTask(clientKey) : undefined,
					});

					console.log(
						`[Notification] Updating cache with actions:`,
						notif.actions,
					);
					_notificationCache = _notificationCache.map((n) =>
						n.client_key === notif.client_key
							? {
									...n,
									title: notif.title,
									description: notif.description || undefined,
									progress: notif.progress,
									current_step: notif.current_step,
									total_steps: notif.total_steps,
									type: notif.severity,
									notification_type: notif.notification_type,
									dismissible: notif.dismissible,
									actions: notif.actions,
								}
							: n,
					);
					setNotifications([..._notificationCache]);
				}
			}

			if (!updated) {
				console.log(
					`[Notification] Creating new toast for type: ${notif.notification_type}`,
				);
				// Show toast for Progress and Immediate notifications
				if (
					notif.notification_type === "immediate" ||
					notif.notification_type === "progress"
				) {
					showAlert(
						notif.severity,
						notif.title,
						notif.description || undefined,
						notif.progress,
						notif.current_step,
						notif.total_steps,
						notif.client_key,
						notif.notification_type,
						notif.dismissible,
						notif.actions,
						notif.metadata,
					);
				}
			}

			// Trigger refetch for sidebar to show all notification types
			triggerPersistentNotificationRefetch();
		},
	);

	// Listen for progress updates
	const unsubProgress = await listen<BackendNotification>(
		"core://notification-progress",
		(event) => {
			console.log("Received progress event:", event.payload);
			const notif = event.payload;

			// Always try to update existing toast if we have it in our ephemeral list
			// regardless of whether it's persistent or not
			if (notif.client_key) {
				const existing = _notificationCache.find(
					(n) => n.client_key && n.client_key === notif.client_key,
				);
				if (existing) {
					// Check if task just completed (progress went from <100 to 100)
					const wasIncomplete =
						existing.progress !== null &&
						existing.progress !== undefined &&
						existing.progress < 100;
					const isNowComplete = notif.progress === 100;

					// Update the toast UI
					const clientKey = notif.client_key;
					// Use actions from payload if available, otherwise keep existing
					const currentActions =
						notif.actions && notif.actions.length > 0
							? notif.actions
							: existing.actions;
					const cancellable =
						currentActions?.some((a) => a.id === "cancel_task") ?? false;

					// If task just completed, remove the cancel button
					const shouldShowCancel = !isNowComplete && cancellable;

					updateToast(existing.id, {
						title: notif.title || existing.title,
						description: notif.description || existing.description,
						progress: notif.progress,
						current_step: notif.current_step,
						total_steps: notif.total_steps,
						severity: notif.severity
							? (capitalizeFirstLetter(notif.severity) as
									| "Info"
									| "Success"
									| "Warning"
									| "Error")
							: (capitalizeFirstLetter(existing.type) as
									| "Info"
									| "Success"
									| "Warning"
									| "Error"),
						duration: isNowComplete ? 5000 : 0, // Auto-dismiss after 5s on completion
						cancellable: shouldShowCancel,
						onCancel:
							shouldShowCancel && clientKey
								? () => cancelTask(clientKey)
								: undefined,
					});

					_notificationCache = _notificationCache.map((n) =>
						n.client_key === notif.client_key
							? {
									...n,
									title: notif.title || n.title,
									description: notif.description || n.description,
									progress: notif.progress,
									current_step: notif.current_step,
									total_steps: notif.total_steps,
									type: notif.severity || n.type,
									notification_type:
										notif.notification_type || n.notification_type,
									actions: currentActions,
									dismissible:
										notif.dismissible !== undefined
											? notif.dismissible
											: n.dismissible,
								}
							: n,
					);
					setNotifications([..._notificationCache]);

					// If just completed, log it
					if (wasIncomplete && isNowComplete) {
						console.log(
							`[Notification] Task completed: ${notif.title || existing.title}`,
						);
					}
				} else {
					// If we don't have a matching ephemeral toast for this client_key (race / missed event),
					// create one now so progress updates are visible in the UI.
					console.log(
						"No ephemeral toast found for client_key, creating one from progress event:",
						notif.client_key,
					);

					if (
						notif.notification_type === "immediate" ||
						notif.notification_type === "progress"
					) {
						showAlert(
							notif.severity,
							notif.title,
							notif.description || undefined,
							notif.progress,
							notif.current_step,
							notif.total_steps,
							notif.client_key,
							notif.notification_type,
							notif.dismissible,
							notif.actions,
							notif.metadata,
						);
					}
				}
			}

			// Trigger refetch for sidebar
			triggerPersistentNotificationRefetch();
		},
	);

	// Listen for notification updates (read/delete)
	const unsubUpdated = await listen<any>(
		"core://notification-updated",
		(event) => {
			const payload = event.payload;
			// If a notification was deleted by the backend, remove the ephemeral toast using client_key
			if (payload && payload.deleted) {
				const clientKey = payload.client_key as string | undefined;
				if (clientKey) {
					// Remove any ephemeral toast matching this client_key
					const existing = _notificationCache.find(
						(n) => n.client_key === clientKey,
					);
					if (existing) {
						tryRemoveToast(existing.id);
						_notificationCache = _notificationCache.filter(
							(n) => n.client_key !== clientKey,
						);
						setNotifications([..._notificationCache]);
					}
				}
			}
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

export {
	type Notification,
	type BackendNotification,
	type NotificationType,
	type NotificationSeverity,
	type NotificationAction,
	type NotificationActionType,
	notifications,
	showAlert,
	closeAlert,
	removeAllAlerts,
	createNotification,
	invokeNotificationAction,
	updateNotificationProgress,
	listNotifications,
	markNotificationRead,
	deleteNotification,
	cleanupNotifications,
	clearAllDismissibleNotifications,
	subscribeToBackendNotifications,
	unsubscribeFromBackendNotifications,
	persistentNotificationTrigger,
};
