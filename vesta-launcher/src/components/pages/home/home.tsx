import BellIcon from "@assets/bell.svg";
import GearIcon from "@assets/gear.svg";
import logo from "@assets/logo.svg";
import PlusIcon from "@assets/plus.svg";
import SearchIcon from "@assets/search.svg";
import ConnectionStatus from "@components/page-root/connection-status";
import TitleBar from "@components/page-root/titlebar/titlebar";
import { PageViewer, router } from "@components/page-viewer/page-viewer";
import InstanceCard from "@components/pages/home/instance-card/instance-card";
import { invoke } from "@tauri-apps/api/core";
import { attachConsole, info } from "@tauri-apps/plugin-log";
import { WindowControls, WindowTitlebar } from "@tauri-controls/solid";
import { Toaster, clearToasts, showToast } from "@ui/toast/toast";
import {
	Show,
	createEffect,
	createMemo,
	createSignal,
	onCleanup,
	onMount,
	For,
	createResource,
} from "solid-js";
import { getOsType } from "@utils/os";
import { listInstances, subscribeToInstanceUpdates, unsubscribeFromInstanceUpdates } from "@utils/instances";
import "./home.css";
import Sidebar from "./sidebar/sidebar";

// Module-level signals for page viewer state - exported so child components can open pages
const [pageViewerOpen, setPageViewerOpen] = createSignal(false);
const [sidebarOpen, setSidebarOpen] = createSignal(false);

export { setPageViewerOpen };

const os = getOsType() ?? "windows";

function HomePage() {
	createEffect(() => {
		sidebarOpen();
		clearToasts();
	});

	return (
		<div id={"home__root"} draggable={false}>
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
	// createResource returns [resource, { refetch, loading, error, mutate }]
	// The status signals (loading, error) live on the second item — not
	// as properties on the resource signal itself. Destructure loading/error
	// and use them correctly (call them) in JSX.
	const [instances, { refetch, loading, error }] = createResource(listInstances);

	onMount(() => {
		// Subscribe to instance updates to refetch when instances change
		subscribeToInstanceUpdates(() => {
			refetch();
		});
	});

	onCleanup(() => {
		unsubscribeFromInstanceUpdates();
	});

	return (
		<div class={"main-menu"}>
			<div class={"instance-wrapper"}>
				<div class={"instance-container"}>
					<Show when={typeof loading === "function" ? loading() : !!loading}>
						<p style={{ color: "#888", padding: "20px" }}>Loading instances...</p>
					</Show>
					<Show when={typeof error === "function" ? error() : !!error}>
						<p style={{ color: "#ff4444", padding: "20px" }}>
							Failed to load instances: {String(typeof error === "function" ? error() : error)}
						</p>
					</Show>
					<Show when={instances() && instances().length === 0}>
						<p style={{ color: "#888", padding: "20px" }}>
							No instances found. Create one to get started!
						</p>
					</Show>
					<For each={instances()}>
						{(instance) => <InstanceCard instance={instance} />}
					</For>
				</div>
			</div>
		</div>
	);
}

export default HomePage;
