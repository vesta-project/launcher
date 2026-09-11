import FabricIcon from "@assets/branding/modloaders/fabric-logo.svg";
import ForgeIcon from "@assets/branding/modloaders/forge-logo.svg";
import NeoForgeIcon from "@assets/branding/modloaders/neoforge-logo.svg";
import QuiltIcon from "@assets/branding/modloaders/quilt-logo.svg";
import VestaIcon from "@assets/branding/vesta-mark.svg";
import CloseIcon from "@assets/icons/actions/close.svg";
import CubeIcon from "@assets/icons/content/cube.svg";
import GlobeIcon from "@assets/icons/content/globe.svg";
import ModpackIcon from "@assets/icons/content/modpack.svg";
import InfoIcon from "@assets/icons/status/bell.svg";
import ErrorIcon from "@assets/icons/status/error.svg";
import { instancesState } from "@stores/instances";
import Button from "@ui/button/button";
import { Progress } from "@ui/progress/progress";
import { resolveResourceUrl } from "@utils/assets";
import { resolveInstanceDisplayIcon } from "@utils/instances";
import type {
	NotificationAction,
	NotificationSeverity,
	NotificationType,
} from "@utils/notifications";
import { getNotificationContext } from "@utils/notifications";
import clsx from "clsx";
import {
	createEffect,
	createMemo,
	createSignal,
	For,
	onCleanup,
	onMount,
	Show,
	splitProps,
} from "solid-js";
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
	metadata?: string | null;
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
		"metadata",
		"created_at",
		"onAction",
		"onDismiss",
		"class",
		"isToast",
	]);

	const severity = () => local.severity || "info";
	const isDismissible = () => local.dismissible !== false || local.isToast;
	const context = createMemo(() => getNotificationContext(local.metadata));
	const [imageFailed, setImageFailed] = createSignal(false);
	const [descriptionExpanded, setDescriptionExpanded] = createSignal(false);
	const [descriptionOverflows, setDescriptionOverflows] = createSignal(false);
	let descriptionRef: HTMLParagraphElement | undefined;

	const subjectImage = createMemo(() => {
		const value = context();
		if (!value || imageFailed()) return undefined;
		if (value.iconUrl) return resolveResourceUrl(value.iconUrl);
		if (!value.id) return undefined;
		if (value.kind === "instance") {
			const instance = instancesState.instances.find(
				(item) => String(item.id) === value.id,
			);
			return instance
				? resolveResourceUrl(resolveInstanceDisplayIcon(instance))
				: undefined;
		}
		return undefined;
	});

	createEffect(() => {
		local.metadata;
		setImageFailed(false);
	});

	const measureDescription = () => {
		if (!descriptionRef || descriptionExpanded()) return;
		setDescriptionOverflows(
			descriptionRef.scrollHeight > descriptionRef.clientHeight + 1,
		);
	};

	onMount(() => {
		queueMicrotask(measureDescription);
		if (!descriptionRef || typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(measureDescription);
		observer.observe(descriptionRef);
		onCleanup(() => observer.disconnect());
	});

	createEffect(() => {
		local.description;
		setDescriptionExpanded(false);
		queueMicrotask(measureDescription);
	});

	const SeverityIcon = () => {
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

	const SubjectIcon = () => {
		const value = context();
		const source = value?.source?.toLowerCase();
		if (subjectImage()) {
			return (
				<img
					class={styles.subjectImage}
					src={subjectImage()}
					alt=""
					onError={() => setImageFailed(true)}
				/>
			);
		}
		if (value?.kind === "instance")
			return <CubeIcon class={styles.contextIcon} />;
		if (value?.kind === "resource" || source === "resource") {
			return <ModpackIcon class={styles.contextIcon} />;
		}
		switch (source) {
			case "fabric":
				return <FabricIcon class={styles.contextIcon} />;
			case "forge":
				return <ForgeIcon class={styles.contextIcon} />;
			case "neoforge":
				return <NeoForgeIcon class={styles.contextIcon} />;
			case "quilt":
				return <QuiltIcon class={styles.contextIcon} />;
			case "patch_notes":
			case "news":
			case "rss":
			case "game":
				return <GlobeIcon class={styles.contextIcon} />;
			case "launcher":
				return <VestaIcon class={styles.contextIcon} />;
			default:
				return <SeverityIcon />;
		}
	};

	const StatusBadge = () => {
		switch (severity()) {
			case "error":
				return (
					<span
						class={clsx(styles.statusBadge, styles.statusBadgeError)}
						aria-hidden="true"
					/>
				);
			case "warning":
				return (
					<span
						class={clsx(styles.statusBadge, styles.statusBadgeWarning)}
						aria-hidden="true"
					>
						<span class={styles.statusBadgeWarningMark}>!</span>
					</span>
				);
			default:
				return null;
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
					<SubjectIcon />
					<Show
						when={
							context() && (severity() === "warning" || severity() === "error")
						}
					>
						<StatusBadge />
					</Show>
				</div>

				<div class={styles.content}>
					<div class={styles.header}>
						<span class={clsx(styles.title, "selectable")}>
							{local.title ||
								(local.notification_type === "progress"
									? "Working..."
									: "Notification")}
						</span>
						<div class={styles.headerActions}>
							<Show when={local.created_at}>
								<span class={clsx(styles.timestamp, "selectable")}>
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
						<div
							class={clsx(
								styles.descriptionRegion,
								!descriptionExpanded() &&
									descriptionOverflows() &&
									styles.descriptionRegionCollapsed,
							)}
						>
							<p
								ref={descriptionRef}
								class={clsx(
									styles.description,
									!descriptionExpanded() && styles.descriptionCollapsed,
									"selectable",
								)}
							>
								{local.description}
							</p>
							<Show when={descriptionOverflows() || descriptionExpanded()}>
								<button
									type="button"
									class={styles.descriptionToggle}
									aria-expanded={descriptionExpanded()}
									onClick={() => setDescriptionExpanded((value) => !value)}
								>
									{descriptionExpanded() ? "Less" : "More"}
								</button>
							</Show>
						</div>
					</Show>

					<Show when={local.progress !== undefined && local.progress !== null}>
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
