import ErrorIcon from "@assets/icons/status/error.svg";
import PinIcon from "@assets/icons/actions/pin.svg";
import PinOffIcon from "@assets/icons/actions/unpin.svg";
import PlayIcon from "@assets/icons/actions/play.svg";
import KillIcon from "@assets/icons/actions/stop.svg";
import FolderIcon from "@assets/icons/content/folder.svg";
import LinkIcon from "@assets/icons/content/link.svg";
import RecoveryIcon from "@assets/icons/actions/reload.svg";
import { ResourceAvatar } from "@ui/avatar";
import Button from "@ui/button/button";
import { formatRelativeTime } from "@utils/date";
import { createAnimatedIconPreview } from "@utils/icon-animation";
import { Show } from "solid-js";
import { t } from "~/localization";
import type { ReturnTypeOfPrimaryAction } from "./instance-header-types";
import styles from "./InstanceHeader.module.css";

interface InstanceHeaderProps {
	instance: any;
	compact: boolean;
	action: ReturnTypeOfPrimaryAction;
	busy: boolean;
	isPinned: boolean;
	failureReason?: string | null;
	updateRecovery: boolean;
	onPrimaryAction: () => void;
	onOpenFolder: () => void;
	onTogglePin: () => void;
	onOpenVersion: () => void;
	setRef: (element: HTMLElement) => void;
}

export function InstanceHeader(props: InstanceHeaderProps) {
	const icon = () =>
		props.instance.iconPath || props.instance.modpackIconUrl || "";
	const texturePreview = createAnimatedIconPreview(() => icon());
	const played = () => formatRelativeTime(props.instance.lastPlayed);
	const playtime = () => {
		const minutes = props.instance.totalPlaytimeMinutes ?? 0;
		return t("instances-details-header-playtime-total", {
			hours: Math.floor(minutes / 60),
			minutes: minutes % 60,
		});
	};
	const failureSummary = () => {
		const reason = props.failureReason?.replace(/\s+/g, " ").trim();
		if (!reason) return t("instances-details-header-install-failed-default");
		const withoutUrl = reason.replace(
			/https?:\/\/\S+/g,
			t("instances-details-header-requested-resource"),
		);
		return withoutUrl.length > 150
			? `${withoutUrl.slice(0, 147).trimEnd()}…`
			: withoutUrl;
	};
	const pinLabel = () =>
		props.isPinned
			? t("instances-details-header-unpin")
			: t("instances-details-header-pin");
	return (
		<>
			<header
				ref={props.setRef}
				class={styles.header}
				classList={{
					[styles.compact]: props.compact,
					[styles.hasNotice]: Boolean(
						props.failureReason || props.updateRecovery,
					),
				}}
			>
				<div
					class={styles.texture}
					style={{
						"background-image": texturePreview.posterSource()
							? `url('${texturePreview.posterSource()}')`
							: "none",
					}}
				/>
				<div class={styles.identity}>
					<ResourceAvatar
						name={props.instance.name}
						icon={icon()}
						size={76}
						class={styles.icon}
					/>
					<div class={styles.copy}>
						<h1>{props.instance.name}</h1>
						<div class={styles.meta}>
							<span>{props.instance.minecraftVersion}</span>
							<span aria-hidden="true">·</span>
							<span>
								{props.instance.modloader ||
									t("instances-details-modloader-vanilla")}
							</span>
							<Show when={props.instance.modpackId}>
								<button
									type="button"
									class={styles.linked}
									onClick={props.onOpenVersion}
									title={t("instances-details-header-manage-modpack")}
									aria-label={t("instances-details-header-manage-modpack")}
								>
									<LinkIcon width="14" height="14" />
								</button>
							</Show>
						</div>
						<div class={styles.lower}>
							<div class={styles.facts}>
								<span>
									{played()
										? t("instances-details-header-played", { time: played()! })
										: t("instances-details-header-never-played")}
								</span>
								<Show when={(props.instance.totalPlaytimeMinutes ?? 0) > 0}>
									<span>{playtime()}</span>
								</Show>
							</div>
							<div class={styles.actions}>
								<Button
									variant="ghost"
									size="md"
									icon_only
									onClick={props.onOpenFolder}
									title={t("instances-details-header-open-folder")}
									aria-label={t("instances-details-header-open-folder")}
								>
									<FolderIcon width="18" height="18" />
								</Button>
								<Button
									variant="ghost"
									size="md"
									icon_only
									onClick={props.onTogglePin}
									title={pinLabel()}
									aria-label={pinLabel()}
								>
									<Show when={props.isPinned} fallback={<PinIcon />}>
										<PinOffIcon />
									</Show>
								</Button>
								<Button
									class={styles.primary}
									variant="solid"
									color={
										props.action.tone === "destructive"
											? "destructive"
											: "primary"
									}
									onClick={props.onPrimaryAction}
									disabled={props.busy}
									aria-label={props.action.label}
									title={props.action.label}
								>
									<span
										class={styles.actionIcon}
										classList={{
											[styles.actionIconFilled]:
												props.action.icon === "play" ||
												props.action.icon === "stop" ||
												props.action.icon === "error",
										}}
									>
										<Show when={props.action.icon === "spinner"}>
											<span class={styles.spinner} />
										</Show>
										<Show when={props.action.icon === "play"}>
											<PlayIcon />
										</Show>
										<Show when={props.action.icon === "stop"}>
											<KillIcon />
										</Show>
										<Show when={props.action.icon === "error"}>
											<ErrorIcon />
										</Show>
										<Show when={props.action.icon === "recovery"}>
											<RecoveryIcon width="16" height="16" />
										</Show>
									</span>
									<span class={styles.actionLabel}>{props.action.label}</span>
								</Button>
							</div>
						</div>
					</div>
				</div>
			</header>
			<Show when={props.failureReason || props.updateRecovery}>
				<div class={styles.statusNotice} role="alert">
					<ErrorIcon class={styles.statusNoticeIcon} />
					<div class={styles.statusNoticeContent}>
						<div class={styles.statusNoticeHeading}>
							<strong>
								{props.failureReason
									? t("instances-installation-failed")
									: t("instances-details-header-update-recovery")}
							</strong>
							<span class={styles.statusNoticeDescription}>
								{props.failureReason
									? failureSummary()
									: t("instances-details-header-update-recovery-description")}
							</span>
						</div>
						<Show when={props.failureReason}>
							<details class={styles.statusNoticeDetails}>
								<summary>
									{t("instances-details-header-show-error-details")}
								</summary>
								<code>{props.failureReason}</code>
							</details>
						</Show>
					</div>
				</div>
			</Show>
		</>
	);
}
