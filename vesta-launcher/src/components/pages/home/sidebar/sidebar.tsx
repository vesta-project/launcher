import BellIcon from "@assets/bell.svg";
import GearIcon from "@assets/gear.svg";
import PlusIcon from "@assets/plus.svg";
import SearchIcon from "@assets/search.svg";
import { router } from "@components/page-viewer/page-viewer";
import { AccountList } from "@components/pages/home/sidebar/account-list/account-list";
import {
	SidebarActionButton,
	SidebarPageButton,
	SidebarProfileButton,
} from "@components/pages/home/sidebar/sidebar-buttons/sidebar-buttons";
import { SidebarNotifications } from "@components/pages/home/sidebar/sidebar-notifications/sidebar-notifications";
import { invoke } from "@tauri-apps/api/core";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ui/tooltip/tooltip";
import {
	closeAlert,
	createNotification,
	listNotifications,
	notifications,
	persistentNotificationTrigger,
	showAlert,
} from "@utils/notifications";
import {
	createEffect,
	createResource,
	createSignal,
	For,
	onCleanup,
	onMount,
} from "solid-js";
// Transition and getOsType are unused in this file; remove imports to clean code.
import "./sidebar.css";

interface SidebarProps {
	setPageViewerOpen: (value: boolean) => void;
	open: boolean;
	openChanged: (value: boolean) => void;
	os: string;
}

function Sidebar(props: SidebarProps) {
	let ref: HTMLDivElement | ((el: HTMLDivElement) => void) | undefined;
	const [accountMenuOpen, setAccountMenuOpen] = createSignal(false);
	const [ready, setReady] = createSignal(false);

	onMount(() => {
		// Defer notification check to avoid blocking initial render
		setTimeout(() => setReady(true), 1000);
	});

	const openPage = (path: string) => {
		router()?.navigate(path);
		props.setPageViewerOpen(true);
	};

	const onExploreClicked = () => {
		openPage("/resources");
	};

	// Check for notification counts and active tasks - refetch when trigger changes
	const [notifData] = createResource(
		() => (ready() ? persistentNotificationTrigger() : false),
		async (isReady) => {
			if (!isReady) return { totalCount: 0, hasActiveTask: false };
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
						(n.progress === -1 || (n.progress >= 0 && n.progress < 100)),
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
			id={"sidebar"}
			classList={{ macos: props.os === "macos", "sidebar--open": props.open }}
		>
			<div class={"sidebar__root"}>
				<div class={"sidebar__section"}>
					<SidebarProfileButton
						id={"profile-selector"}
						tooltip_text={"Profile"}
						open={accountMenuOpen()}
						onAccountMenuToggle={(open) => setAccountMenuOpen(open)}
					/>
					<div class={"sidebar__section actions"}>
						<SidebarActionButton
							id={"sidebar-new"}
							tooltip_text={"New"}
							onClick={() => openPage("/install")}
						>
							<PlusIcon />
						</SidebarActionButton>

						<SidebarActionButton
							id={"sidebar-explore"}
							tooltip_text={"Explore"}
							onClick={onExploreClicked}
						>
							<SearchIcon />
						</SidebarActionButton>
						<SidebarPageButton
							tooltip_text={"Instance Name"}
							onClick={() =>
								createNotification({
									title: "SomeTitle",
									description: "SomeDescription",
									severity: "info",
									notification_type: "immediate",
									dismissible: true,
								})
							}
						/>
					</div>
				</div>
				<div class={"sidebar__section"}>
					<SidebarActionButton
						onClick={() => props.openChanged(!props.open)}
						tooltip_text={"Notifications"}
					>
						<div style={{ position: "relative", display: "flex" }}>
							<BellIcon />
							{notifData().hasActiveTask && (
								<Tooltip placement="top">
									<TooltipTrigger>
										<div class="notification-spinner" />
									</TooltipTrigger>
									<TooltipContent>Task in progress</TooltipContent>
								</Tooltip>
							)}
							{notifData().totalCount > 0 && (
								<Tooltip placement="top">
									<TooltipTrigger>
										<div class="notification-badge">
											{notifData().totalCount}
										</div>
									</TooltipTrigger>
									<TooltipContent>{`${notifData().totalCount} notification${notifData().totalCount === 1 ? "" : "s"}`}</TooltipContent>
								</Tooltip>
							)}
						</div>
					</SidebarActionButton>
					<SidebarActionButton
						id={"sidebar-settings"}
						tooltip_text={"Settings"}
						onClick={() => openPage("/config")}
					>
						<GearIcon />
					</SidebarActionButton>
				</div>
			</div>
			<SidebarNotifications open={props.open} openChanged={props.openChanged} />

			{/* Account List Menu */}
			<AccountList
				open={accountMenuOpen()}
				onClose={() => setAccountMenuOpen(false)}
				onAddAccount={() => {
					setAccountMenuOpen(false);
					openPage("/login");
				}}
			/>
		</div>
	);
}

export default Sidebar;
