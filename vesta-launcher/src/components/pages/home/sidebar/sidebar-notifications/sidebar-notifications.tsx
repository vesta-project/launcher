import CloseIcon from "@assets/close.svg";
import { SidebarActionButton } from "@components/pages/home/sidebar/sidebar-buttons/sidebar-buttons";
import { invoke } from "@tauri-apps/api/core";
import Button from "@ui/button/button";
import { Progress } from "@ui/progress/progress";
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
				await Promise.all(
					unread.map(async (n) => {
						try {
							await markNotificationRead(n.id);
						} catch (err) {
							console.error("Failed to mark notification read:", err);
						}
					}),
				);
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
					<For each={persistentNotifs()}>
						{(notification) => {
							console.log(
								`Rendering notification: ${notification.title} - type: ${notification.notification_type}, dismissible: ${notification.dismissible}`,
							);
							return (
								<NotificationCard
									id={notification.id}
									title={notification.title}
									description={notification.description || undefined}
									progress={notification.progress || undefined}
									current_step={notification.current_step || undefined}
									total_steps={notification.total_steps || undefined}
									persistent={true}
									read={notification.read}
									severity={notification.severity}
									notification_type={notification.notification_type}
									dismissible={notification.dismissible}
									actions={notification.actions}
									client_key={notification.client_key}
									metadata={notification.metadata}
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

function NotificationCard(props: {
	id: number;
	title?: string;
	description?: string;
	progress?: number | null;
	current_step?: number | null;
	total_steps?: number | null;
	persistent: boolean;
	read?: boolean;
	severity?: NotificationSeverity;
	notification_type?: NotificationType;
	dismissible?: boolean;
	actions?: NotificationAction[];
	metadata?: string | null;
	client_key?: string | null;
}) {
	// Debug logging
	console.log(
		`NotificationCard: ${props.title} - type: ${props.notification_type}, dismissible: ${props.dismissible}, progress: ${props.progress}`,
	);

	const handleAction = async (actionId: string) => {
		try {
			await invokeNotificationAction(actionId, props.client_key || undefined);
		} catch (error) {
			console.error(`Failed to invoke action ${actionId}:`, error);
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
		if (!props.severity) return "hsl(210 70% 50%)"; // Info blue
		switch (props.severity.toLowerCase()) {
			case "error":
				return "hsl(0 70% 50%)";
			case "warning":
				return "hsl(45 90% 50%)";
			case "success":
				return "hsl(140 70% 50%)";
			default:
				return "hsl(210 70% 50%)";
		}
	};

	return (
		<div
			class={styles.sidebar__notification}
			style={{
				"border-left": `4px solid ${severityColor()}`,
			}}
		>
			<div style={{ width: "100%", "min-width": "0", overflow: "hidden" }}>
				<div
					style={{
						display: "flex",
						gap: "8px",
						"align-items": "center",
						"margin-bottom": "4px",
					}}
				>
					{props.persistent && props.severity && (
						<span
							style={{
								"font-size": "10px",
								"font-weight": "bold",
								color: severityColor(),
								"text-transform": "uppercase",
								"letter-spacing": "0.5px",
							}}
						>
							{props.severity}
						</span>
					)}
				</div>
				<h1
					style={{
						"font-size": "14px",
						"font-weight": "600",
						margin: "0 0 4px 0",
					}}
				>
					{props.title || "Notification"}
				</h1>
				<p
					style={{
						"font-size": "13px",
						color: "hsl(var(--color__primary-hue) 5% 80%)",
						margin: 0,
						"word-break": "break-word",
					}}
				>
					{props.description}
				</p>
				<Show when={props.metadata}>
					<div
						style={{
							margin: "6px 0 0 0",
							"font-size": "12px",
							color: "hsl(var(--color__primary-hue) 5% 70%)",
						}}
					>
						<small>
							<pre style={{ whiteSpace: "pre-wrap", margin: 0 }}>
								{(() => {
									try {
										return JSON.stringify(
											JSON.parse(props.metadata as string),
											null,
											2,
										);
									} catch {
										return (props.metadata as string) || "";
									}
								})()}
							</pre>
						</small>
					</div>
				</Show>
				{props.progress !== null && props.progress !== undefined && (
					<div style={{ "margin-top": "8px", "max-width": "100%" }}>
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
			<div
				style={{
					display: "flex",
					gap: "6px",
					"flex-direction": "column",
					"flex-shrink": "0",
					"align-items": "stretch",
					"min-width": "60px",
				}}
			>
				{/* Action buttons */}
				<Show when={props.actions && props.actions.length > 0}>
					<For each={props.actions}>
						{(action) => (
							<button
								class={styles["sidebar__notification__action-btn"]}
								onClick={() => handleAction(action.id)}
								title={action.label}
								style={{
									background:
										action.type === "destructive"
											? "hsl(0deg 70% 40% / 25%)"
											: action.type === "primary"
												? "hsl(210deg 80% 50% / 25%)"
												: "hsl(var(--color__primary-hue) 15% 60% / 30%)",
									"border-color":
										action.type === "destructive"
											? "hsl(0deg 70% 40% / 40%)"
											: action.type === "primary"
												? "hsl(210deg 80% 50% / 40%)"
												: "hsl(var(--color__primary-hue) 5% 50% / 30%)",
								}}
							>
								{action.label}
							</button>
						)}
					</For>
				</Show>

				{/* Delete/Close button - show for dismissible notifications */}
				<Show when={props.dismissible}>
					<button
						class={styles["sidebar__notification__close-btn"]}
						onClick={handleDelete}
						title="Delete"
					>
						<CloseIcon />
					</button>
				</Show>
			</div>
		</div>
	);
}

export { SidebarNotifications };
