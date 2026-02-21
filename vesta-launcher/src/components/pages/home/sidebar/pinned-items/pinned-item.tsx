import PlayIcon from "@assets/play.svg";
import StopIcon from "@assets/rounded-square.svg";
import { router, setPageViewerOpen } from "@components/page-viewer/page-viewer";
import { instancesState, setLaunching } from "@stores/instances";
import { type PinnedPage, pinning, unpinPage } from "@stores/pinning";
import { invoke } from "@tauri-apps/api/core";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuPortal,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from "@ui/context-menu/context-menu";
import { showToast } from "@ui/toast/toast";
import * as HoverCard from "@kobalte/core/hover-card";
import { resolveResourceUrl } from "@utils/assets";
import { getInstanceSlug, killInstance } from "@utils/instances";
import { clsx } from "clsx";
import { createMemo, createSignal, onCleanup, onMount, Show } from "solid-js";
import { SidebarButton } from "../sidebar-buttons/sidebar-buttons";
import styles from "./pinned-item.module.css";

const ACTIONS_ENABLED = false;

export interface PinnedItemProps {
	pin: PinnedPage;
}

export function PinnedItem(props: PinnedItemProps) {
	let containerRef: HTMLDivElement | undefined;
	const [isFullyVisible, setIsFullyVisible] = createSignal(true);
	const [isHovered, setIsHovered] = createSignal(false);

	const instance = createMemo(() => {
		if (props.pin.page_type !== "instance") return null;
		return instancesState.instances.find(
			(i) => getInstanceSlug(i) === props.pin.target_id,
		);
	});

	onMount(() => {
		if (!containerRef) return;

		// Handle scroll to close hover card
		const scrollParent = containerRef.closest(`[class*="sidebar__pins"]`);
		const handleScroll = () => {
			setIsHovered(false);
		};

		if (scrollParent) {
			scrollParent.addEventListener("scroll", handleScroll, { passive: true });
		}

		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					// We use a high threshold to hide the button as soon as it starts entering the mask/overflow area
					const visible = entry.intersectionRatio > 0.9;
					setIsFullyVisible(visible);
					if (!visible) setIsHovered(false);
				}
			},
			{
				threshold: [0, 0.1, 0.9, 1.0],
			},
		);

		observer.observe(containerRef);
		onCleanup(() => {
			observer.disconnect();
			if (scrollParent) scrollParent.removeEventListener("scroll", handleScroll);
		});
	});

	const isLaunching = createMemo(
		() => instancesState.launchingIds[props.pin.target_id],
	);
	const isRunning = createMemo(
		() => instancesState.runningIds[props.pin.target_id],
	);
	const isCrashed = createMemo(() => instance()?.crashed);

	// Derived live metadata (falls back to pin snapshot if instance not found)
	const displayName = createMemo(() => instance()?.name ?? props.pin.label);
	const displayIcon = createMemo(
		() => instance()?.iconPath ?? props.pin.icon_url,
	);

	const handleClick = () => {
		if (props.pin.page_type === "instance") {
			router()?.navigate("/instance", { slug: props.pin.target_id });
		} else if (props.pin.page_type === "settings") {
			router()?.navigate("/config", {});
		} else {
			router()?.navigate("/resource-details", {
				projectId: props.pin.target_id,
				platform: props.pin.platform,
				name: props.pin.label,
				iconUrl: props.pin.icon_url,
			});
		}
		setPageViewerOpen(true);
	};

	const handleLaunch = async (e: MouseEvent) => {
		e.stopPropagation();
		const inst = instance();
		if (!inst || isLaunching() || isRunning()) return;

		try {
			setLaunching(props.pin.target_id, true);
			await invoke("launch_instance", { instanceData: inst });
		} catch (err) {
			console.error("Failed to launch instance from sidebar:", err);
			setLaunching(props.pin.target_id, false);
			showToast({
				title: "Launch Failed",
				description: String(err),
				severity: "error",
			});
		}
	};

	const handleKill = async (e: MouseEvent) => {
		e.stopPropagation();
		const inst = instance();
		if (!inst || !isRunning()) return;

		try {
			await killInstance(inst);
		} catch (err) {
			console.error("Failed to kill instance from sidebar:", err);
			showToast({
				title: "Kill Failed",
				description: String(err),
				severity: "error",
			});
		}
	};

	const handleCreateShortcut = async (quickLaunch = false) => {
		try {
			let args = "";
			const suffix = quickLaunch ? " (Launch)" : " (Open Page)";
			if (props.pin.page_type === "instance") {
				args = quickLaunch
					? `--launch-instance ${props.pin.target_id}`
					: `--open-instance ${props.pin.target_id}`;
			} else {
				args = `--open-resource ${props.pin.platform} ${props.pin.target_id}`;
			}

			const name = props.pin.label + suffix;

			await invoke("create_desktop_shortcut", {
				name: name,
				targetArgs: args,
				iconPath: props.pin.icon_url,
			});

			showToast({
				title: "Shortcut Created",
				description: `Added ${name} to your desktop`,
				severity: "success",
			});
		} catch (e) {
			console.error("Failed to create shortcut:", e);
		}
	};

	const handleCopyLink = async () => {
		let path = "";
		let params: Record<string, string> = {};

		if (props.pin.page_type === "instance") {
			path = "/instance";
			params = { slug: props.pin.target_id };
		} else if (props.pin.page_type === "settings") {
			path = "/config";
		} else {
			path = "/resource-details";
			params = {
				projectId: props.pin.target_id,
				platform: props.pin.platform || "",
				name: props.pin.label,
				iconUrl: props.pin.icon_url || "",
			};
		}

		const searchParams = new URLSearchParams();
		searchParams.set("path", path);
		for (const [key, value] of Object.entries(params)) {
			searchParams.set(key, value);
		}

		const url = `vesta://${path}?${searchParams.toString()}`;
		try {
			await navigator.clipboard.writeText(url);
			showToast({
				title: "Link Copied",
				description: "Page link copied to clipboard",
				severity: "success",
			});
		} catch (e) {
			console.error("Failed to copy link:", e);
		}
	};

	return (
		<ContextMenu>
			<ContextMenuTrigger>
				<div
					ref={containerRef}
					class={clsx(styles["pinned-item-container"], {
						[styles["item-hidden"]]: !isFullyVisible(),
					})}
					onMouseEnter={() => setIsHovered(true)}
					onMouseLeave={() => setIsHovered(false)}
				>
					<HoverCard.Root
						open={isHovered() && isFullyVisible()}
						openDelay={0}
						closeDelay={150}
						gutter={-12}
						placement="right"
					>
						<HoverCard.Trigger
							as="div"
							class={styles["pinned-button-trigger"]}
							onClick={handleClick}
						>
							<SidebarButton
								tooltip_text={displayName()}
								tooltip_placement="right"
								tooltip_gutter={props.pin.page_type === "instance" ? 44 : 8}
								class={styles["pinned-button"]}
							>
								<div class={styles["icon-wrapper"]}>
									<Show
										when={displayIcon()}
										fallback={
											<div class={styles["icon-placeholder"]}>
												{displayName()[0]}
											</div>
										}
									>
										<div class={styles["icon-bg-blur"]} />
										<img
											src={resolveResourceUrl(displayIcon() as string)}
											alt=""
											class={styles["pin-icon"]}
										/>
									</Show>

									<Show when={isLaunching()}>
										<div
											class={`${styles["status-dot"]} ${styles["status--launching"]}`}
										/>
									</Show>
									<Show when={isRunning() && !isLaunching()}>
										<div
											class={`${styles["status-dot"]} ${styles["status--running"]}`}
										/>
									</Show>
									<Show when={isCrashed()}>
										<div class={styles["status-crashed"]} />
									</Show>
								</div>
							</SidebarButton>
						</HoverCard.Trigger>

						<Show when={ACTIONS_ENABLED && props.pin.page_type === "instance"}>
							<HoverCard.Portal>
								<HoverCard.Content class={styles["slide-out-portal"]}>
									<button
										class={
											isRunning() || isLaunching()
												? styles["action-button-stop"]
												: styles["action-button-play"]
										}
										onClick={
											isRunning() || isLaunching() ? handleKill : handleLaunch
										}
										title={
											isRunning() || isLaunching()
												? "Kill Instance"
												: "Quick Launch"
										}
									>
										<Show
											when={isRunning() || isLaunching()}
											fallback={<PlayIcon />}
										>
											<StopIcon />
										</Show>
									</button>
								</HoverCard.Content>
							</HoverCard.Portal>
						</Show>
					</HoverCard.Root>
				</div>
			</ContextMenuTrigger>
			<ContextMenuPortal>
				<ContextMenuContent>
					<ContextMenuItem onClick={handleClick}>
						<span>Open Page</span>
					</ContextMenuItem>
					<ContextMenuItem onClick={handleCopyLink}>
						<span>Copy Link</span>
					</ContextMenuItem>
					<Show when={props.pin.page_type === "instance"}>
						<ContextMenuItem
							onClick={(e) =>
								isRunning() || isLaunching()
									? handleKill(e as any)
									: handleLaunch(e as any)
							}
							class={
								isRunning() || isLaunching() ? styles["menu-item--danger"] : ""
							}
						>
							<span>
								{isRunning() || isLaunching()
									? "Kill Instance"
									: "Launch Instance"}
							</span>
						</ContextMenuItem>
					</Show>
					<ContextMenuSeparator />
					<Show when={props.pin.page_type === "instance"}>
						<ContextMenuItem onClick={() => handleCreateShortcut(true)}>
							<span>Add Quick Launch to Desktop</span>
						</ContextMenuItem>
					</Show>
					<ContextMenuItem onClick={() => handleCreateShortcut(false)}>
						<span>Add to Desktop</span>
					</ContextMenuItem>
					<ContextMenuSeparator />
					<ContextMenuItem
						onClick={() => unpinPage(props.pin.id)}
						class={styles["menu-item--danger"]}
					>
						<span>Unpin</span>
					</ContextMenuItem>
				</ContextMenuContent>
			</ContextMenuPortal>
		</ContextMenu>
	);
}
