import TitleBar from "@components/page-root/titlebar/titlebar";
import { PageViewer, pageViewerOpen, setPageViewerOpen } from "@components/page-viewer/page-viewer";
import InstanceCard from "@components/pages/home/instance-card/instance-card";
import {
	initializeInstances,
	instancesError,
	instancesInitialized,
	instancesLoading,
	instances as instancesStore,
} from "@stores/instances";
import { initializePinning } from "@stores/pinning";
import { invoke } from "@tauri-apps/api/core";
import { Skeleton } from "@ui/skeleton/skeleton";
import { clearToasts, Toaster } from "@ui/toast/toast";
import { useOs } from "@utils/os";
import { createEffect, createSignal, For, onMount, Show } from "solid-js";
import { homeIntroShowDemoCards, homeIntroSidebarVisible, homeIntroVisible, setHomeIntroVisible } from "@stores/home-intro";
import styles from "./home.module.css";
import { DemoInstanceCards } from "./home-intro/demo-instance-cards";
import HomeIntro from "./home-intro/home-intro";
import Sidebar from "./sidebar/sidebar";

// Module-level signals for sidebar state
const [sidebarOpen, setSidebarOpen] = createSignal(false);

function HomePage() {
	const os = useOs();

	onMount(async () => {
		void initializePinning();

		if (!instancesInitialized()) {
			void initializeInstances().catch((error) => {
				console.error("Failed to initialize instances from HomePage:", error);
			});
		}

		void invoke("preload_account_heads").catch((error) => {
			console.error("Failed to preload account heads:", error);
		});

		const config = await invoke<any>("get_config");
		if (!config.tutorial_completed) {
			// Small delay to ensure UI is ready
			setTimeout(() => {
				setHomeIntroVisible(true);
			}, 1000);
		}
	});

	createEffect(() => {
		sidebarOpen();
		clearToasts();
	});

	const introActive = () => homeIntroVisible();
	const sidebarForcedHidden = () => introActive() && !homeIntroSidebarVisible();

	return (
		<div
			class={styles["home__root"]}
			classList={{
				[styles["home__root--intro-no-sidebar"]]: sidebarForcedHidden(),
			}}
			draggable={false}
		>
			<TitleBar os={os()} />
			<Sidebar
				os={os()}
				setPageViewerOpen={setPageViewerOpen}
				openChanged={setSidebarOpen}
				open={sidebarOpen()}
				introForcedHidden={sidebarForcedHidden()}
			/>
			<MainMenu />
			<PageViewer open={pageViewerOpen()} viewChanged={() => setPageViewerOpen(false)} />
			<Toaster
				class={styles["home__toaster"]}
				style={{ visibility: sidebarOpen() ? "hidden" : "visible" }}
			/>
			<Show when={homeIntroVisible()}>
				<HomeIntro onComplete={() => setHomeIntroVisible(false)} />
			</Show>
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
				<Skeleton style={{ width: "32px", height: "32px", "border-radius": "5px" }} />
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
					<Show when={!instancesLoading() && instancesStore().length === 0 && !homeIntroShowDemoCards()}>
						<p style={{ color: "#888", padding: "20px" }}>
							No instances found. Create one to get started!
						</p>
					</Show>
					<For each={instancesStore()}>{(instance) => <InstanceCard instance={instance} />}</For>
					<Show when={homeIntroShowDemoCards()}>
						<DemoInstanceCards />
					</Show>
				</div>
			</div>
		</div>
	);
}

export default HomePage;
