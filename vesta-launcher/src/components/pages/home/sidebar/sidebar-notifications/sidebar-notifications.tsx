import CloseIcon from "@assets/close.svg";
import { SidebarActionButton } from "@components/pages/home/sidebar/sidebar-buttons/sidebar-buttons";
import Button from "@ui/button/button";
import { Progress } from "@ui/progress/progress";
import {
	type BackendNotification,
	closeAlert,
	deleteNotification,
	listNotifications,
	markNotificationRead,
	notifications,
	persistentNotificationTrigger,
	removeAllAlerts,
} from "@utils/notifications";
import { For, Show, createResource, createSignal, onMount } from "solid-js";
import styles from "./sidebar-notifications.module.css";

interface SidebarNotificationProps {
	open: boolean;
	openChanged: (value: boolean) => void;
}

// TODO: Make sidebar resizeable
function SidebarNotifications(props: SidebarNotificationProps) {
	// Load persistent notifications from backend - refetch when trigger changes
	const [persistentNotifs] = createResource(
		persistentNotificationTrigger,
		async () => {
			try {
				return await listNotifications({ persist: true });
			} catch (_error) {
				// Silently handle errors (table might not exist yet during first startup)
				return [];
			}
		},
	);

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
				>
					<CloseIcon />
				</Button>
			</div>

			<Show
				when={
					notifications().length > 0 ||
					(persistentNotifs() && persistentNotifs()?.length > 0)
				}
				fallback={<div>Wooo! No Notifications!</div>}
			>
				<div class={styles.sidebar__notifications__wrapper}>
					{/* Persistent notifications from backend */}
					<For each={persistentNotifs()}>
						{(notification) => (
							<NotificationCard
								id={notification.id}
								title={notification.title || undefined}
								description={notification.description || undefined}
								progress={notification.progress || undefined}
								current_step={notification.current_step || undefined}
								total_steps={notification.total_steps || undefined}
								persistent={true}
								read={notification.read}
								severity={notification.severity}
							/>
						)}
					</For>
					{/* Ephemeral notifications (in-memory) */}
					<For each={notifications()}>
						{(notification) => (
							<NotificationCard
								id={notification.id}
								title={notification.title}
								description={notification.description}
								progress={notification.progress}
								current_step={notification.current_step}
								total_steps={notification.total_steps}
								persistent={false}
							/>
						)}
					</For>
				</div>
			</Show>
			<Show when={notifications().length > 0}>
				<div>
					<Button onClick={removeAllAlerts}>Clear Ephemeral</Button>
				</div>
			</Show>
		</div>
	);
}

function NotificationCard(props: {
	id: number;
	title?: string;
	description?: string;
	progress?: number | null;
	current_step?: number | null;
	total_steps?: number | null;
	persistent: boolean;
	read?: boolean;
	severity?: string;
}) {
	const handleMarkRead = async () => {
		if (!props.persistent) return;
		try {
			await markNotificationRead(props.id);
		} catch (error) {
			console.error("Failed to mark notification as read:", error);
		}
	};

	const handleDelete = async () => {
		if (props.persistent) {
			try {
				await deleteNotification(props.id);
			} catch (error) {
				console.error("Failed to delete notification:", error);
			}
		} else {
			closeAlert(props.id);
		}
	};

	const severityColor = () => {
		if (!props.severity) return "#3498db";
		switch (props.severity.toLowerCase()) {
			case "error":
				return "#e74c3c";
			case "warning":
				return "#f39c12";
			case "success":
				return "#27ae60";
			default:
				return "#3498db";
		}
	};

	return (
		<div
			class={styles.sidebar__notification}
			style={{
				...(props.persistent && props.severity
					? { "border-left": `4px solid ${severityColor()}` }
					: {}),
				...(props.persistent && props.read ? { opacity: 0.6 } : {}),
			}}
		>
			<div>
				{props.persistent && props.severity && (
					<div style={{ display: "flex", gap: "8px", "align-items": "center" }}>
						<span
							style={{
								"font-size": "12px",
								"font-weight": "bold",
								color: severityColor(),
							}}
						>
							{props.severity.toUpperCase()}
						</span>
						{!props.read && (
							<span
								style={{
									width: "8px",
									height: "8px",
									"border-radius": "50%",
									background: "#e74c3c",
								}}
							/>
						)}
					</div>
				)}
				<h1>{props.title || "Notification"}</h1>
				<p>{props.description}</p>
				{props.progress !== null && props.progress !== undefined && (
					<div style={{ "margin-top": "8px" }}>
						<Progress
							progress={props.progress}
							current_step={props.current_step}
							total_steps={props.total_steps}
							severity={
								props.severity
									? (props.severity.toLowerCase() as any)
									: undefined
							}
							class={styles["sidebar__notification__progress"]}
							size="sm"
						/>
					</div>
				)}
			</div>
			<div style={{ display: "flex", gap: "4px" }}>
				{props.persistent && !props.read && (
					<button
						class={styles["sidebar__notification__action-btn"]}
						onClick={handleMarkRead}
						title="Mark as read"
					>
						✓
					</button>
				)}
				<button
					class={styles["sidebar__notification__close-btn"]}
					onClick={handleDelete}
					title="Delete"
				>
					<CloseIcon />
				</button>
			</div>
		</div>
	);
}

export { SidebarNotifications };
