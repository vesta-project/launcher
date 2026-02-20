import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { showToast, tryRemoveToast, updateToast } from "@ui/toast/toast";
import { createSignal, JSX } from "solid-js";

const [notifications, setNotifications] = createSignal<Notification[]>([]);
let _notificationCache: Notification[] = [];
/** Track client keys that are currently being 'shown' to prevent duplicates due to race conditions */
const _pendingShowKeys = new Set<string>();

/** Promise-based queue to prevent race conditions in showAlert focus checks */
let _showAlertQueue: Promise<any> = Promise.resolve();

/** Value returned when a notification toast is not shown (e.g. window not focused) */
export const NOTIFICATION_NOT_SHOWN = -1;
/** Value used to indicate indeterminate/pulsing progress */
export const PROGRESS_INDETERMINATE = -1;

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
	id: number; // Toast ID
	backend_id?: number | null; // Rust Database ID
	type: NotificationSeverity;
	title?: string;
	description?: string;
	progress?: number | null; // PROGRESS_INDETERMINATE for pulsing, 0-100 for percentage, null for none
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
	backend_id?: number | null,
): Promise<number> {
	// Chain onto the showAlertQueue to prevent race conditions during focus checks
	const ownPromise = _showAlertQueue.then(async () => {
		// Only show toasts in the focused window
		const isFocused = await getCurrentWebviewWindow().isFocused();
		if (!isFocused) return NOTIFICATION_NOT_SHOWN;

		// If progress is null/undefined, treat it as indeterminate (PROGRESS_INDETERMINATE)
		let displayProgress = progress;
		if (progress == null && notification_type === "progress") {
			displayProgress = PROGRESS_INDETERMINATE;
		}

		const id = showToast({
			title,
			description,
			duration:
				notification_type === "progress" && (progress ?? 0) < 100 ? 0 : 5000,
			severity,
			notification_type,
			progress: displayProgress,
			current_step,
			total_steps,
			dismissible,
			actions,
			onAction: (actionId, payload) => {
				invokeNotificationAction(actionId, client_key || undefined, payload);
			},
			onToastDismiss: (id) => {
				closeAlert(id, true);
			},
			onToastForceClose: (id: number) => {
				// If user manually closes the toast via swipe/escape, we keep it in sidebar
				closeAlert(id, false);
			},
		});

		const newNotif: Notification = {
			id,
			backend_id,
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
	});

	// Update the queue to wait for this one, but catch errors to avoid breaking the chain
	_showAlertQueue = ownPromise.catch(() => {
		/* ignore */
	});

	return ownPromise;
}

function removeAllAlerts() {
	_notificationCache = [];
	setNotifications([]);
}

function closeAlert(id: number, deleteFromBackend = false) {
	const notif = _notificationCache.find((n) => n.id === id);

	// Only delete from backend if explicitly requested AND the notification is dismissible
	const shouldDelete = deleteFromBackend && notif?.dismissible !== false;

	if (shouldDelete && notif?.backend_id) {
		deleteNotification(notif.backend_id).catch(console.error);
	}

	_notificationCache = _notificationCache.filter((n) => n.id !== id);
	setNotifications([..._notificationCache]);
	tryRemoveToast(id);
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
	metadata?: any;
	show_on_completion?: boolean;
}): Promise<number> {
	// Backend expects actions and metadata as JSON strings
	const payload = {
		...params,
		actions: params.actions ? JSON.stringify(params.actions) : undefined,
		metadata: params.metadata ? JSON.stringify(params.metadata) : undefined,
	};
	return await invoke<number>("create_notification", { payload });
}

async function invokeNotificationAction(
	actionId: string,
	clientKey?: string,
	payload?: any,
): Promise<void> {
	await invoke("invoke_notification_action", { actionId, clientKey, payload });
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

let subscriptionPromise: Promise<void> | null = null;

async function subscribeToBackendNotifications() {
	if (subscriptionPromise) return subscriptionPromise;

	subscriptionPromise = (async () => {
		// Listen for new/updated notifications
		const unsubNotif = await listen<BackendNotification>(
			"core://notification",
			async (event) => {
				const notif = event.payload;

				// Check if we already have this notification in our ephemeral list
				let updated = false;
				if (notif.client_key) {
					if (_pendingShowKeys.has(notif.client_key)) {
						return;
					}

					const existing = _notificationCache.find(
						(n) => n.client_key === notif.client_key,
					);
					if (existing) {
						updated = true;
						// Update existing toast and notification state
						const clientKey = notif.client_key;

						updateToast(existing.id, {
							title: notif.title,
							description: notif.description || undefined,
							progress: notif.progress,
							current_step: notif.current_step,
							total_steps: notif.total_steps,
							severity: notif.severity,
							notification_type: notif.notification_type,
							duration:
								notif.notification_type === "progress" &&
								(notif.progress ?? 0) < 100
									? 0
									: 5000,
							dismissible: notif.dismissible,
							actions: notif.actions,
							onAction: (actionId, payload) => {
								invokeNotificationAction(
									actionId,
									clientKey || undefined,
									payload,
								);
							},
							onToastDismiss: (id) => closeAlert(id, true),
							onToastForceClose: (id) => closeAlert(id, false),
						});

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
					// Show toast for Progress and Immediate notifications
					if (
						notif.notification_type === "immediate" ||
						notif.notification_type === "progress"
					) {
						if (notif.client_key) _pendingShowKeys.add(notif.client_key);
						try {
							await showAlert(
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
								notif.id,
							);
						} finally {
							if (notif.client_key) _pendingShowKeys.delete(notif.client_key);
						}
					}
				}

				// Trigger refetch for sidebar to show all notification types
				triggerPersistentNotificationRefetch();
			},
		);

		// Listen for progress updates
		const unsubProgress = await listen<BackendNotification>(
			"core://notification-progress",
			async (event) => {
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

						updateToast(existing.id, {
							title: notif.title || existing.title,
							description: notif.description || existing.description,
							progress: notif.progress,
							current_step: notif.current_step,
							total_steps: notif.total_steps,
							severity: notif.severity || existing.type,
							notification_type:
								notif.notification_type || existing.notification_type,
							duration: isNowComplete ? 5000 : 0, // Auto-dismiss after 5s on completion
							dismissible: notif.dismissible ?? existing.dismissible,
							actions: currentActions,
							onAction: (actionId, payload) => {
								invokeNotificationAction(
									actionId,
									clientKey || undefined,
									payload,
								);
							},
							onToastDismiss: (id) => closeAlert(id, true),
							onToastForceClose: (id) => closeAlert(id, false),
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
					} else {
						// If we don't have a matching ephemeral toast for this client_key (race / missed event),
						// create one now so progress updates are visible in the UI.

						if (notif.client_key && _pendingShowKeys.has(notif.client_key)) {
							return;
						}

						if (
							notif.notification_type === "immediate" ||
							notif.notification_type === "progress"
						) {
							if (notif.client_key) _pendingShowKeys.add(notif.client_key);
							try {
								await showAlert(
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
									notif.id,
								);
							} finally {
								if (notif.client_key) _pendingShowKeys.delete(notif.client_key);
							}
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
	})();

	await subscriptionPromise;
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
