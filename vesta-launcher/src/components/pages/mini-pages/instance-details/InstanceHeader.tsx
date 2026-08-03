import ErrorIcon from "@assets/error.svg";
import PinIcon from "@assets/pin.svg";
import PinOffIcon from "@assets/pin-off.svg";
import PlayIcon from "@assets/play.svg";
import KillIcon from "@assets/rounded-square.svg";
import { ResourceAvatar } from "@ui/avatar";
import Button from "@ui/button/button";
import { formatRelativeTime } from "@utils/date";
import { createAnimatedIconPreview } from "@utils/icon-animation";
import { Show } from "solid-js";
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

const FolderIcon = () => (
	<svg
		viewBox="0 0 24 24"
		width="18"
		height="18"
		fill="none"
		stroke="currentColor"
		stroke-width="2"
	>
		<path d="M3 6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
	</svg>
);

const RecoveryIcon = () => (
	<svg
		viewBox="0 0 24 24"
		width="16"
		height="16"
		fill="none"
		stroke="currentColor"
		stroke-width="2"
	>
		<path d="M3 12a9 9 0 1 0 3-6.7" />
		<path d="M3 4v6h6" />
	</svg>
);

export function InstanceHeader(props: InstanceHeaderProps) {
	const icon = () =>
		props.instance.iconPath || props.instance.modpackIconUrl || "";
	const texturePreview = createAnimatedIconPreview(() => icon());
	const played = () => formatRelativeTime(props.instance.lastPlayed);
	const playtime = () => {
		const minutes = props.instance.totalPlaytimeMinutes ?? 0;
		return `${Math.floor(minutes / 60)}h ${minutes % 60}m total`;
	};
	return (
		<>
			<header
				ref={props.setRef}
				class={styles.header}
				classList={{ [styles.compact]: props.compact }}
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
							<span>{props.instance.modloader || "Vanilla"}</span>
							<Show when={props.instance.modpackId}>
								<button
									type="button"
									class={styles.linked}
									onClick={props.onOpenVersion}
									title="Manage linked modpack"
									aria-label="Manage linked modpack"
								>
									<svg
										viewBox="0 0 24 24"
										width="14"
										height="14"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
									>
										<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
										<path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
									</svg>
								</button>
							</Show>
						</div>
						<div class={styles.lower}>
							<div class={styles.facts}>
								<span>{played() ? `Played ${played()}` : "Never played"}</span>
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
									title="Open instance folder"
									aria-label="Open instance folder"
								>
									<FolderIcon />
								</Button>
								<Button
									variant="ghost"
									size="md"
									icon_only
									onClick={props.onTogglePin}
									title={props.isPinned ? "Unpin instance" : "Pin instance"}
									aria-label={
										props.isPinned ? "Unpin instance" : "Pin instance"
									}
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
											<RecoveryIcon />
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
				<div
					class={styles.statusNotice}
					role="alert"
					title={
						props.failureReason ||
						"The previous version could not be fully restored"
					}
				>
					<ErrorIcon />
					<span>
						{props.failureReason
							? `Installation failed · ${props.failureReason}`
							: "Update recovery required · The previous version could not be fully restored"}
					</span>
				</div>
			</Show>
		</>
	);
}
