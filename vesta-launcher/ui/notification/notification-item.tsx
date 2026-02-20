import InfoIcon from "@assets/bell.svg";
import CloseIcon from "@assets/close.svg";
import ErrorIcon from "@assets/error.svg";
import Button from "@ui/button/button";
import { Progress } from "@ui/progress/progress";
import {
	NotificationAction,
	NotificationSeverity,
	NotificationType,
} from "@utils/notifications";
import clsx from "clsx";
import { For, JSX, Show, splitProps } from "solid-js";
import styles from "./notification-item.module.css";

export interface NotificationItemProps {
	id: number;
	title?: string;
	description?: string;
	progress?: number | null;
	current_step?: number | null;
	total_steps?: number | null;
	severity?: NotificationSeverity;
	notification_type?: NotificationType;
	dismissible?: boolean;
	actions?: NotificationAction[];
	created_at?: string;

	// Callbacks
	onAction?: (actionId: string, payload?: any) => void;
	onDismiss?: () => void;

	// Style overrides
	class?: string;
	isToast?: boolean;
}

export function NotificationItem(props: NotificationItemProps) {
	const [local] = splitProps(props, [
		"id",
		"title",
		"description",
		"progress",
		"current_step",
		"total_steps",
		"severity",
		"notification_type",
		"dismissible",
		"actions",
		"created_at",
		"onAction",
		"onDismiss",
		"class",
		"isToast",
	]);

	const severity = () => local.severity || "info";
	const isDismissible = () => local.dismissible !== false || local.isToast;

	const Icon = () => {
		switch (severity()) {
			case "error":
				return <ErrorIcon class={styles.icon} />;
			case "warning":
				return <ErrorIcon class={clsx(styles.icon, styles.iconWarning)} />;
			case "success":
				return <InfoIcon class={clsx(styles.icon, styles.iconSuccess)} />;
			default:
				return <InfoIcon class={styles.icon} />;
		}
	};

	const formatTimestamp = (dateStr?: string) => {
		if (!dateStr) return "";
		try {
			const date = new Date(dateStr);
			return date.toLocaleTimeString([], {
				hour: "2-digit",
				minute: "2-digit",
			});
		} catch {
			return "";
		}
	};

	return (
		<div
			class={clsx(
				styles.container,
				styles[`severity-${severity()}`],
				local.isToast && styles.isToast,
				isDismissible() && styles.isDismissible,
				local.class,
			)}
		>
			<div class={styles.layout}>
				<div class={styles.iconWrapper}>
					<Icon />
				</div>

				<div class={styles.content}>
					<div class={styles.header}>
						<span class={styles.title}>{local.title || "Notification"}</span>
						<div class={styles.headerActions}>
							<Show when={local.created_at}>
								<span class={styles.timestamp}>
									{formatTimestamp(local.created_at)}
								</span>
							</Show>
							<Show when={isDismissible()}>
								<button
									type="button"
									class={styles.dismissBtn}
									onClick={(e) => {
										e.stopPropagation();
										local.onDismiss?.();
									}}
									aria-label="Dismiss"
								>
									<CloseIcon />
								</button>
							</Show>
						</div>
					</div>

					<Show when={local.description}>
						<p class={styles.description}>{local.description}</p>
					</Show>

					<Show
						when={
							local.progress !== undefined &&
							local.progress !== null &&
							local.notification_type === "progress"
						}
					>
						<div class={styles.progressWrapper}>
							<Progress
								progress={local.progress}
								current_step={local.current_step}
								total_steps={local.total_steps}
								severity={severity() as any}
								size="sm"
							/>
						</div>
					</Show>

					<Show when={local.actions && local.actions.length > 0}>
						<div class={styles.actions}>
							<For each={local.actions}>
								{(action) => (
									<Button
										size="sm"
										color={
											action.type === "primary"
												? "primary"
												: action.type === "destructive"
													? "destructive"
													: "secondary"
										}
										variant={action.type === "secondary" ? "solid" : "solid"}
										onClick={() => local.onAction?.(action.id, action.payload)}
									>
										{action.label}
									</Button>
								)}
							</For>
						</div>
					</Show>
				</div>
			</div>
		</div>
	);
}
