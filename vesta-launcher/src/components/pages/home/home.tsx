import BellIcon from "@assets/bell.svg";
import GearIcon from "@assets/gear.svg";
import logo from "@assets/logo.svg";
import PlusIcon from "@assets/plus.svg";
import SearchIcon from "@assets/search.svg";
import ConnectionStatus from "@components/page-root/connection-status/connection-status";
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
} from "solid-js";
import { getOsType } from "../../../utils/os";
import "./home.css";
import Sidebar from "./sidebar/sidebar";
const [pageViewerOpen, setPageViewerOpen] = createSignal(false);
const [sidebarOpen, setSidebarOpen] = createSignal(false);

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
	const [ready, setReady] = createSignal(false);

	onMount(() => {
		// Defer rendering of heavy instance cards to allow initial paint
		setTimeout(() => setReady(true), 50);
	});

	return (
		<div class={"main-menu"}>
			<div class={"instance-wrapper"}>
				<div class={"instance-container"}>
					<Show when={ready()}>
						<InstanceCard modloader={"forge"} />
						<InstanceCard modloader={"fabric"} />
						<InstanceCard modloader={"neoforge"} />
						<InstanceCard modloader={"quilt"} />
						<InstanceCard />
						<InstanceCard />
						<InstanceCard />
						<InstanceCard />
						<InstanceCard />
						<InstanceCard />
						<InstanceCard />
						<InstanceCard />
						<InstanceCard />
						<InstanceCard />
						<InstanceCard />
						<InstanceCard />
					</Show>
				</div>
			</div>
		</div>
	);
}

export default HomePage;
