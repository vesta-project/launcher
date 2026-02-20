import CloseIcon from "@assets/close.svg";
import { SidebarActionButton } from "@components/pages/home/sidebar/sidebar-buttons/sidebar-buttons";
import { dialogStore } from "@stores/dialog-store";
import { invoke } from "@tauri-apps/api/core";
import Button from "@ui/button/button";
import { NotificationItem } from "@ui/notification/notification-item";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ui/tooltip/tooltip";
import {
	type BackendNotification,
	clearAllDismissibleNotifications,
	closeAlert,
	deleteNotification,
	invokeNotificationAction,
	listNotifications,
	markNotificationRead,
	type NotificationAction,
	type NotificationSeverity,
	type NotificationType,
	notifications,
	persistentNotificationTrigger,
	removeAllAlerts,
} from "@utils/notifications";
import {
	createEffect,
	createResource,
	createSignal,
	For,
	onMount,
	Show,
} from "solid-js";
import styles from "./sidebar-notifications.module.css";

interface SidebarNotificationProps {
	open: boolean;
	openChanged: (value: boolean) => void;
}

// TODO: Make sidebar resizeable
function SidebarNotifications(props: SidebarNotificationProps) {
	const [ready, setReady] = createSignal(false);

	onMount(() => {
		// Defer fetching notifications to avoid blocking initial render
		setTimeout(() => setReady(true), 1000);
	});

	// Load persistent notifications from backend - refetch when trigger changes
	const [persistentNotifs] = createResource(
		() => (ready() ? persistentNotificationTrigger() : false),
		async () => {
			try {
				// Fetch all notifications (includes Immediate which are in-memory only)
				return await listNotifications();
			} catch (_error) {
				// Silently handle errors (table might not exist yet during first startup)
				return [];
			}
		},
	);

	// When the sidebar becomes open, mark unread persistent notifications as read
	// so the bell's unread indicator clears. We only act on persisted notifications
	// and rely on backend events to refresh the frontend list.
	createEffect(() => {
		if (!props.open) return;
		const notifs = persistentNotifs() || [];
		const unread = notifs.filter((n) => !n.read);
		if (unread.length === 0) return;

		(async () => {
			try {
				for (const n of unread) {
					try {
						await markNotificationRead(n.id);
					} catch (err) {
						console.error("Failed to mark notification read:", err);
					}
				}
			} catch (err) {
				console.error("Failed to mark unread notifications as read:", err);
			}
		})();
	});

	const _allNotifications = () => {
		const ephemeral = notifications();
		const persistent = persistentNotifs() || [];
		return { ephemeral, persistent };
	};

	return (
		<div
			classList={{
				[styles["sidebar__notifications-root"]]: true,
				[styles["sidebar__notifications-root--open"]]: props.open,
			}}
		>
			<div class={styles["sidebar__notifications-titlebar"]}>
				<h1>Notifications</h1>
				<Button
					icon_only={true}
					tooltip_text={"Close"}
					onClick={() => props.openChanged(false)}
					tooltip_placement={"right"}
					size="sm"
					variant="ghost"
				>
					<CloseIcon />
				</Button>
			</div>

			<Show
				when={
					notifications().length > 0 ||
					(persistentNotifs() && (persistentNotifs()?.length ?? 0) > 0)
				}
				fallback={<div>Wooo! No Notifications!</div>}
			>
				<div class={styles.sidebar__notifications__wrapper}>
					{/* All notifications from backend (includes Immediate which won't persist after restart) */}
					<For
						each={(persistentNotifs() || []).sort((a, b) => {
							// Sort by creation time (newest first) but keep dismissible ones at bottom?
							// Actually user wants phone-like feel, so newest first is good.
							const dateA = new Date(a.created_at).getTime();
							const dateB = new Date(b.created_at).getTime();
							return dateB - dateA;
						})}
					>
						{(notification) => {
							return (
								<NotificationItem
									id={notification.id}
									title={notification.title}
									description={notification.description || undefined}
									progress={notification.progress || undefined}
									current_step={notification.current_step || undefined}
									total_steps={notification.total_steps || undefined}
									severity={notification.severity}
									notification_type={notification.notification_type}
									dismissible={notification.dismissible}
									actions={notification.actions}
									created_at={notification.created_at}
									onAction={(actionId, payload) =>
										invokeNotificationAction(
											actionId,
											notification.client_key || undefined,
											payload,
										)
									}
									onDismiss={() => deleteNotification(notification.id)}
								/>
							);
						}}
					</For>
				</div>
			</Show>
			<Show
				when={
					notifications().length > 0 ||
					(persistentNotifs()?.some((n) => n.dismissible) ?? false)
				}
			>
				<div>
					<Button
						onClick={async () => {
							removeAllAlerts();
							const cleared = await clearAllDismissibleNotifications();
							console.log(`Cleared ${cleared} dismissible notifications`);
						}}
					>
						Clear All
					</Button>
				</div>
			</Show>
		</div>
	);
}

export { SidebarNotifications };
