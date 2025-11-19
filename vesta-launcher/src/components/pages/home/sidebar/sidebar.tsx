import BellIcon from "@assets/bell.svg";
import CloseIcon from "@assets/close.svg";
import GearIcon from "@assets/gear.svg";
import PlusIcon from "@assets/plus.svg";
import SearchIcon from "@assets/search.svg";
import { router } from "@components/page-viewer/page-viewer";
import {
	SidebarActionButton,
	SidebarPageButton,
	SidebarProfileButton,
} from "@components/pages/home/sidebar/sidebar-buttons/sidebar-buttons";
import { SidebarNotifications } from "@components/pages/home/sidebar/sidebar-notifications/sidebar-notifications";
import { invoke } from "@tauri-apps/api/core";
import { For, Show, createEffect, onCleanup, createResource } from "solid-js";
import { Transition } from "solid-transition-group";
import {
	closeAlert,
	notifications,
	showAlert,
	listNotifications,
} from "@utils/notifications";
import { getOsType } from "../../../../utils/os";
import "./sidebar.css";

interface SidebarProps {
	setPageViewerOpen: (value: boolean) => void;
	open: boolean;
	openChanged: (value: boolean) => void;
	os: string;
}

function Sidebar(props: SidebarProps) {
	let ref: HTMLDivElement | ((el: HTMLDivElement) => void) | undefined;

	const openPage = (path: string) => {
		router()?.navigate(path);
		props.setPageViewerOpen(true);
	};

	const onExploreClicked = async () => {
		await invoke("test_command");
	};

	// Check for unread and active notifications
	const [notifData] = createResource(
		async () => {
			try {
				const persistent = await listNotifications({ persist: true });
				const unreadCount = persistent.filter((n) => !n.read).length;
				const hasActiveTask = persistent.some(
					(n) =>
						n.progress !== null &&
						(n.progress === -1 || (n.progress >= 0 && n.progress < 100)),
				);
				return { unreadCount, hasActiveTask };
			} catch (error) {
				// Silently handle errors (table might not exist yet during first startup)
				return { unreadCount: 0, hasActiveTask: false };
			}
		},
		{ initialValue: { unreadCount: 0, hasActiveTask: false } },
	);

	createEffect(() => {
		const checkFocus = (event: FocusEvent) => {
			let target = event.target;
			if (target && ref && !(ref as HTMLDivElement).contains(target as Node)) {
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
					<SidebarProfileButton tooltip_text={"Profile"} />
					<div class={"sidebar__section actions"}>
						<SidebarActionButton
							tooltip_text={"New"}
							onClick={() => openPage("/install")}
						>
							<PlusIcon />
						</SidebarActionButton>

						<SidebarActionButton
							tooltip_text={"Explore"}
							onClick={onExploreClicked}
						>
							<SearchIcon />
						</SidebarActionButton>
						<SidebarPageButton
							tooltip_text={"Instance Name"}
							onClick={() => showAlert("Info", "SomeTitle", "SomeDescription")}
						/>
						<SidebarActionButton
							tooltip_text={"Test Notifications"}
							onClick={() => openPage("/notification-test")}
						>
							<span style={{ "font-size": "20px" }}>🔔</span>
						</SidebarActionButton>
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
								<div
									class="notification-spinner"
									title="Task in progress"
								/>
							)}
							{notifData().unreadCount > 0 && (
								<div
									class="notification-badge"
									title={`${notifData().unreadCount} unread`}
								>
									{notifData().unreadCount}
								</div>
							)}
						</div>
					</SidebarActionButton>
					<SidebarActionButton
						tooltip_text={"Settings"}
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
