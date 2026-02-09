import BellIcon from "@assets/bell.svg";
import GearIcon from "@assets/gear.svg";
import logo from "@assets/logo.svg";
import PlusIcon from "@assets/plus.svg";
import SearchIcon from "@assets/search.svg";
import ConnectionStatus from "@components/page-root/connection-status";
import TitleBar from "@components/page-root/titlebar/titlebar";
import {
	PageViewer,
	router,
	pageViewerOpen,
	setPageViewerOpen,
} from "@components/page-viewer/page-viewer";
import InstanceCard from "@components/pages/home/instance-card/instance-card";
import { invoke } from "@tauri-apps/api/core";
import { attachConsole, info } from "@tauri-apps/plugin-log";
import { WindowControls, WindowTitlebar } from "@tauri-controls/solid";
import { showToast, Toaster, clearToasts } from "@ui/toast/toast";
import { getOsType } from "@utils/os";
import {
	createEffect,
	createMemo,
	createSignal,
	For,
	onCleanup,
	onMount,
	Show,
} from "solid-js";
import styles from "./home.module.css";
import { Skeleton } from "@ui/skeleton/skeleton";
import Sidebar from "./sidebar/sidebar";
import { startAppTutorial } from "@utils/tutorial";
import { initializePinning } from "@stores/pinning";
import {
	instances as instancesStore,
	instancesLoading,
	instancesError,
} from "@stores/instances";

// Module-level signals for sidebar state
const [sidebarOpen, setSidebarOpen] = createSignal(false);

const os = getOsType() ?? "windows";

function HomePage() {
	onMount(async () => {
		void initializePinning();
		const config = await invoke<any>("get_config");
		if (!config.tutorial_completed) {
			// Small delay to ensure UI is ready
			setTimeout(() => {
				startAppTutorial();
			}, 1000);
		}
	});

	createEffect(() => {
		sidebarOpen();
		clearToasts();
	});

	return (
		<div class={styles["home__root"]} draggable={false}>
			<TitleBar os={os} />
			<Sidebar
				os={os}
				setPageViewerOpen={setPageViewerOpen}
				openChanged={setSidebarOpen}
				open={sidebarOpen()}
			/>
			<MainMenu />
			<PageViewer
				open={pageViewerOpen()}
				viewChanged={() => setPageViewerOpen(false)}
			/>
			<Toaster style={{ visibility: sidebarOpen() ? "hidden" : "visible" }} />
		</div>
	);
}

function MainMenu() {
	const InstanceCardSkeleton = () => (
		<div
			class={"instance-card"}
			style={{
				display: "flex",
				"flex-direction": "column",
				gap: "8px",
				"--instance-bg-image": "none",
			}}
		>
			<div style={{ display: "flex", "justify-content": "flex-end" }}>
				<Skeleton
					style={{ width: "32px", height: "32px", "border-radius": "5px" }}
				/>
			</div>
			<div style={{ display: "flex", "flex-direction": "column", gap: "6px" }}>
				<Skeleton style={{ width: "70%", height: "16px" }} />
				<div
					style={{
						display: "flex",
						"justify-content": "space-between",
						"align-items": "center",
					}}
				>
					<Skeleton style={{ width: "40%", height: "12px" }} />
					<div style={{ display: "flex", gap: "6px", "align-items": "center" }}>
						<Skeleton style={{ width: "28px", height: "12px" }} />
						<Skeleton style={{ width: "18px", height: "12px" }} />
					</div>
				</div>
			</div>
		</div>
	);

	return (
		<div class={styles["main-menu"]}>
			<div class={styles["instance-wrapper"]}>
				<div class={styles["instance-container"]}>
					<Show when={instancesLoading() && instancesStore().length === 0}>
						<>
							{Array.from({ length: 8 }).map(() => (
								<InstanceCardSkeleton />
							))}
						</>
					</Show>
					<Show when={instancesError()}>
						<p style={{ color: "#ff4444", padding: "20px" }}>
							Failed to load instances: {String(instancesError())}
						</p>
					</Show>
					<Show when={!instancesLoading() && instancesStore().length === 0}>
						<p style={{ color: "#888", padding: "20px" }}>
							No instances found. Create one to get started!
						</p>
					</Show>
					<For each={instancesStore()}>
						{(instance) => <InstanceCard instance={instance} />}
					</For>
				</div>
			</div>
		</div>
	);
}

export default HomePage;
