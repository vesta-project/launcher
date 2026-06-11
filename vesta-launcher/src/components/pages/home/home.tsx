import TitleBar from "@components/page-root/titlebar/titlebar";
import {
	PageViewer,
	pageViewerOpen,
	resetLibraryNavigationState,
	router,
	setPageViewerOpen,
} from "@components/page-viewer/page-viewer";
import InstanceCard from "@components/pages/home/instance-card/instance-card";
import FlatNavigationControls from "@components/pages/home/flat-navigation-controls/flat-navigation-controls";
import {
	initializeInstances,
	instancesError,
	instancesInitialized,
	instancesLoading,
	instances as instancesStore,
} from "@stores/instances";
import {
	homeIntroShowDemoCards,
	homeIntroSidebarVisible,
	homeIntroVisible,
	setHomeIntroVisible,
} from "@stores/home-intro";
import { initializePinning } from "@stores/pinning";
import { invoke } from "@tauri-apps/api/core";
import { Skeleton } from "@ui/skeleton/skeleton";
import { clearToasts, Toaster } from "@ui/toast/toast";
import { uiChromeModeEnabled } from "@utils/config-sync";
import { createFlatShellNavigation, isLibraryPath } from "@utils/flat-shell-navigation";
import { useOs } from "@utils/os";
import { createEffect, createMemo, createSignal, For, onMount, Show, untrack } from "solid-js";
import styles from "./home.module.css";
import { DemoInstanceCards } from "./home-intro/demo-instance-cards";
import HomeIntro from "./home-intro/home-intro";
import Sidebar from "./sidebar/sidebar";

// Module-level signals for sidebar state
const [sidebarOpen, setSidebarOpen] = createSignal(false);
let shellEffectPriorFlatChrome: boolean | undefined;

function HomePage() {
	const os = useOs();
	const isFlatChrome = createMemo(() => !uiChromeModeEnabled());
	const flatShellNavigation = createFlatShellNavigation(pageViewerOpen, setPageViewerOpen);
	const sectionTitle = createMemo(() => {
		if (!isFlatChrome()) return undefined;
		if (!pageViewerOpen()) return "Library";

		const r = router();
		const path = r?.currentPath.get() ?? "";
		const params = r?.currentParams.get() ?? {};
		if (path.startsWith("/config")) {
			const settingsTabs: Record<string, string> = {
				general: "Settings",
				account: "Account",
				appearance: "Appearance",
				java: "Java",
				notifications: "Notifications",
				defaults: "Defaults",
				developer: "Developer",
				help: "Help",
			};
			return settingsTabs[String(params.activeTab ?? "general")] ?? "Settings";
		}

		return r?.customName.get() || r?.currentElement().name || "Library";
	});

	function ensureLibrarySlot() {
		const flat = isFlatChrome();
		const viewerOpen = pageViewerOpen();
		if (!flat || viewerOpen) return;

		const r = router();
		if (!r) return;

		const path = r.currentPath.get();
		// Only bootstrap an uninitialized router. A real route with the viewer
		// closed is a navigateFromLibrary transition — do not reset to __library__.
		if (path !== "" && !isLibraryPath(path)) return;

		if (!r.isOnLibrarySlot()) {
			r.setLibrarySlot();
		}
	}

	onMount(async () => {
		ensureLibrarySlot();

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
			setTimeout(() => {
				setHomeIntroVisible(true);
			}, 1000);
		}
	});

	createEffect(() => {
		sidebarOpen();
		clearToasts();
	});

	createEffect(() => {
		const r = router();
		if (!r) return;

		const flat = isFlatChrome();
		if (flat) {
			r.setShellNavigation(flatShellNavigation);
		} else {
			r.setShellNavigation(null);
			// Only strip flat library state when leaving flat mode — not on every windowed run.
			if (shellEffectPriorFlatChrome) {
				resetLibraryNavigationState();
			}
		}
		shellEffectPriorFlatChrome = flat;
	});

	// Re-run only when the viewer closes — do not subscribe to router path/history.
	createEffect(() => {
		if (!isFlatChrome()) return;
		if (pageViewerOpen()) return;
		untrack(ensureLibrarySlot);
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
			<TitleBar os={os()} sectionTitle={sectionTitle()} />
			<Show when={isFlatChrome()}>
				<FlatNavigationControls />
			</Show>
			<Sidebar
				os={os()}
				setPageViewerOpen={setPageViewerOpen}
				openChanged={setSidebarOpen}
				open={sidebarOpen()}
				uiChromeMode={isFlatChrome() ? "flat" : "windowed"}
				introForcedHidden={sidebarForcedHidden()}
			/>
			<Show
				when={isFlatChrome()}
				fallback={
					<>
						<MainMenu />
						<PageViewer open={pageViewerOpen()} viewChanged={() => setPageViewerOpen(false)} />
					</>
				}
			>
				<Show
					when={!pageViewerOpen()}
					fallback={
						<PageViewer open={pageViewerOpen()} embedded />
					}
				>
					<MainMenu />
				</Show>
			</Show>
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
