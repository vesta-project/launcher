import BellIcon from "@assets/bell.svg";
import LibraryIcon from "@assets/cube.svg";
import GearIcon from "@assets/gear.svg";
import PlusIcon from "@assets/plus.svg";
import SearchIcon from "@assets/search.svg";
import {
	dismissToLibrary,
	openMiniPage,
	pageViewerOpen,
	router,
} from "@components/page-viewer/page-viewer";
import { AccountPopover } from "@components/pages/home/sidebar/account-popover/account-popover";
import {
	SidebarActionButton,
	SidebarProfileButton,
} from "@components/pages/home/sidebar/sidebar-buttons/sidebar-buttons";
import { SidebarNotifications } from "@components/pages/home/sidebar/sidebar-notifications/sidebar-notifications";
import { type PinnedPage, pinning } from "@stores/pinning";
import { Popover, PopoverAnchor } from "@ui/popover/popover";
import { Separator } from "@ui/separator/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ui/tooltip/tooltip";
import { ACCOUNT_TYPE_GUEST, getActiveAccount } from "@utils/auth";
import {
	listNotifications,
	PROGRESS_INDETERMINATE,
	persistentNotificationTrigger,
} from "@utils/notifications";
import {
	createEffect,
	createMemo,
	createResource,
	createSignal,
	For,
	onCleanup,
	onMount,
	Show,
} from "solid-js";
import type { UiChromeMode } from "~/themes/presets";
import { ariaShortcut, displayChord } from "~/keybindings/chords";
import { keybindingFor } from "~/keybindings/store";
import { PinnedItem } from "./pinned-items";
import styles from "./sidebar.module.css";

interface SidebarProps {
	setPageViewerOpen: (value: boolean) => void;
	open: boolean;
	openChanged: (value: boolean) => void;
	os: string;
	introForcedHidden?: boolean;
	uiChromeMode: UiChromeMode;
	macosFullscreen?: boolean;
}

function Sidebar(props: SidebarProps) {
	let ref: HTMLDivElement | ((el: HTMLDivElement) => void) | undefined;
	const [accountMenuOpen, setAccountMenuOpen] = createSignal(false);
	const [ready, setReady] = createSignal(false);

	onMount(() => {
		// Defer notification check to avoid blocking initial render
		setTimeout(() => setReady(true), 1000);
	});

	const isFlatChrome = createMemo(() => props.uiChromeMode === "flat");
	const tooltipWithShortcut = (label: string, commandId: string) => {
		const chord = keybindingFor(commandId);
		return chord ? `${label} (${displayChord(chord)})` : label;
	};

	const openPage = (
		path: string,
		params?: Record<string, any>,
		routeProps?: Record<string, any>,
	) => {
		openMiniPage(path, params ?? {}, routeProps);
		props.openChanged(false);
	};

	const activeSection = createMemo(() => {
		if (!pageViewerOpen()) return isFlatChrome() ? "library" : "";

		const path = router()?.currentPath.get() ?? "";
		if (path.startsWith("/install")) return "create";
		if (path.startsWith("/resources") || path.startsWith("/resource-details"))
			return "explore";
		if (path.startsWith("/config") || path.startsWith("/login"))
			return "settings";
		if (path.startsWith("/instance")) return "library";
		return "";
	});

	const openLibrary = () => {
		if (isFlatChrome()) {
			dismissToLibrary();
		} else {
			props.setPageViewerOpen(false);
		}
		props.openChanged(false);
	};

	const onExploreClicked = () => {
		openPage("/resources");
	};

	// Check for notification counts and active tasks - refetch when trigger changes
	const [notifData] = createResource(
		() => (ready() ? persistentNotificationTrigger() : -1),
		async (trigger) => {
			if (trigger === -1) return { totalCount: 0, hasActiveTask: false };
			try {
				// Fetch all notifications (includes Immediate which are in-memory only)
				const persistent = await listNotifications();
				// Fetch only unread count for the badge
				const unread = await listNotifications({ read: false });
				const totalCount = unread.length;
				const hasActiveTask = persistent.some(
					(n) =>
						n.notification_type === "progress" &&
						n.progress !== null &&
						(n.progress === PROGRESS_INDETERMINATE ||
							(n.progress >= 0 && n.progress < 100)),
				);
				return { totalCount, hasActiveTask };
			} catch (_error) {
				// Silently handle errors (table might not exist yet during first startup)
				return { totalCount: 0, hasActiveTask: false };
			}
		},
		{ initialValue: { totalCount: 0, hasActiveTask: false } },
	);

	createEffect(() => {
		const checkFocus = (event: FocusEvent) => {
			const target = event.target as HTMLElement | null;
			if (!target || !ref) return;

			// Ignore clicks that happen inside a dialog (content or overlay)
			if (
				target.closest(".dialog__portal-container") ||
				target.closest(".dialog__overlay") ||
				target.closest(".dialog__content")
			) {
				return;
			}

			if (!(ref as HTMLDivElement).contains(target as Node)) {
				props.openChanged(false);
			}
		};

		document.addEventListener("mousedown", checkFocus);

		onCleanup(() => {
			document.removeEventListener("mousedown", checkFocus);
		});
	});

	return (
		<div
			ref={ref}
			classList={{
				[styles.sidebar]: true,
				[styles.macos]: props.os === "macos",
				[styles["sidebar--open"]]: props.open,
				[styles["sidebar--intro-hidden"]]: props.introForcedHidden === true,
				[styles["sidebar--intro-visible"]]: props.introForcedHidden === false,
				[styles["sidebar--macos-fullscreen"]]: props.macosFullscreen === true,
			}}
		>
			<div class={styles["sidebar__root"]}>
				<div
					class={`${styles["sidebar__section"]} ${styles["sidebar__section--top"]}`}
				>
					<Popover
						open={accountMenuOpen()}
						onOpenChange={setAccountMenuOpen}
						placement="right-start"
					>
						<PopoverAnchor>
							<SidebarProfileButton
								id={"profile-selector"}
								tooltip_text={"Profile"}
								open={accountMenuOpen()}
								onAccountMenuToggle={(open) => setAccountMenuOpen(open)}
							/>
						</PopoverAnchor>
						<AccountPopover
							onClose={() => setAccountMenuOpen(false)}
							onAddAccount={async () => {
								setAccountMenuOpen(false);

								try {
									const account = await getActiveAccount();
									if (account?.account_type === ACCOUNT_TYPE_GUEST) {
										window.location.href = "/?login=true";
										return;
									}
								} catch (error) {
									console.error(
										"Failed to check guest status for Add Account:",
										error,
									);
								}

								openPage("/login");
							}}
						/>
					</Popover>
					<div class={`${styles["sidebar__section"]} ${styles["actions"]}`}>
						<Show when={isFlatChrome()}>
							<SidebarActionButton
								id={"sidebar-library"}
								tooltip_text={tooltipWithShortcut(
									"Library",
									"navigation.library",
								)}
								aria-keyshortcuts={ariaShortcut(
									keybindingFor("navigation.library"),
								)}
								aria-current={
									activeSection() === "library" ? "page" : undefined
								}
								class={
									activeSection() === "library"
										? styles["sidebar-tab-active"]
										: undefined
								}
								onClick={openLibrary}
							>
								<LibraryIcon />
							</SidebarActionButton>
						</Show>

						<SidebarActionButton
							id={"sidebar-new"}
							tooltip_text={tooltipWithShortcut(
								"New Instance",
								"navigation.new-instance",
							)}
							aria-keyshortcuts={ariaShortcut(
								keybindingFor("navigation.new-instance"),
							)}
							aria-current={activeSection() === "create" ? "page" : undefined}
							class={
								activeSection() === "create"
									? styles["sidebar-tab-active"]
									: undefined
							}
							onClick={() => openPage("/install/source")}
						>
							<PlusIcon />
						</SidebarActionButton>

						<SidebarActionButton
							id={"sidebar-explore"}
							tooltip_text={tooltipWithShortcut(
								"Explore",
								"navigation.explore",
							)}
							aria-keyshortcuts={ariaShortcut(
								keybindingFor("navigation.explore"),
							)}
							aria-current={
								activeSection() === "explore" ? "page" : undefined
							}
							class={
								activeSection() === "explore"
									? styles["sidebar-tab-active"]
									: undefined
							}
							onClick={onExploreClicked}
						>
							<SearchIcon />
						</SidebarActionButton>

						<Show when={pinning.pins.length > 0}>
							<div class={styles["sidebar__pins-container"]}>
								<Separator class={styles["pins-separator"]} />
								<div class={styles["sidebar__pins"]}>
									<For each={pinning.pins}>
										{(pin: PinnedPage, index) => (
											<PinnedItem
												pin={pin}
												shortcutCommandIds={() => {
													const ids: string[] = [];
													if (index() < 5) {
														ids.push(`navigation.pinned.${index() + 1}`);
													}
													if (index() === pinning.pins.length - 1) {
														ids.push("navigation.pinned.last");
													}
													return ids;
												}}
											/>
										)}
									</For>
								</div>
							</div>
						</Show>
					</div>
				</div>
				<div class={styles["sidebar__section"]}>
					<SidebarActionButton
						id={"sidebar-notifications"}
						tooltip_text={tooltipWithShortcut(
							"Notifications",
							"navigation.notifications",
						)}
						aria-keyshortcuts={ariaShortcut(
							keybindingFor("navigation.notifications"),
						)}
						aria-controls="sidebar-notifications-panel"
						aria-expanded={props.open}
						onClick={() => props.openChanged(!props.open)}
					>
						<div
							style={{
								position: "relative",
								display: "flex",
								width: "20px",
								height: "20px",
							}}
						>
							<BellIcon width="20" height="20" />
							<Show when={notifData().hasActiveTask}>
								<Tooltip placement="top">
									<TooltipTrigger>
										<div class={styles["notification-spinner"]} />
									</TooltipTrigger>
									<TooltipContent>Task in progress</TooltipContent>
								</Tooltip>
							</Show>
							<Show when={notifData().totalCount > 0}>
								<Tooltip placement="top">
									<TooltipTrigger>
										<div class={styles["notification-badge"]}>
											{notifData().totalCount}
										</div>
									</TooltipTrigger>
									<TooltipContent>{`${notifData().totalCount} notification${notifData().totalCount === 1 ? "" : "s"}`}</TooltipContent>
								</Tooltip>
							</Show>
						</div>
					</SidebarActionButton>
					<SidebarActionButton
						id={"sidebar-settings"}
						tooltip_text={tooltipWithShortcut(
							"Settings",
							"navigation.settings",
						)}
						aria-keyshortcuts={ariaShortcut(
							keybindingFor("navigation.settings"),
						)}
						aria-current={
							activeSection() === "settings" ? "page" : undefined
						}
						class={
							activeSection() === "settings"
								? styles["sidebar-tab-active"]
								: undefined
						}
						onClick={() => openPage("/config")}
					>
						<GearIcon />
					</SidebarActionButton>
				</div>
			</div>
			<SidebarNotifications open={props.open} openChanged={props.openChanged} />
		</div>
	);
}

export default Sidebar;
