import BackArrowIcon from "@assets/back-arrow.svg";
import RefreshIcon from "@assets/refresh.svg";
import ForwardsArrowIcon from "@assets/right-arrow.svg";
import { MiniRouter } from "@components/page-viewer/mini-router";
import {
	miniRouterInvalidPage,
	miniRouterPaths,
} from "@components/page-viewer/mini-router-config";
import { useSearchParams } from "@solidjs/router";
import { WindowControls } from "@tauri-controls/solid";
import { ensureOsType } from "@utils/os";
import { Show, createSignal, onMount } from "solid-js";
import "./standalone-page-viewer.css";

function StandalonePageViewer() {
	const [searchParams] = useSearchParams();
	const [router, setRouter] = createSignal<MiniRouter>();
	const [osType, setOsType] = createSignal<string>("windows");

	onMount(async () => {
		const os = await ensureOsType();
		setOsType(os || "windows");

		const initialPath = searchParams.path || "/config";

		const mini_router = new MiniRouter({
			paths: miniRouterPaths,
			invalid: miniRouterInvalidPage,
			currentPath: initialPath,
		});

		setRouter(mini_router);
	});

	return (
		<div class="standalone-page-viewer">
			<div class="standalone-page-viewer__header">
				<div class="standalone-page-viewer__nav">
					<button
						class="standalone-page-viewer__nav-button"
						onClick={() => router()?.backwards()}
						title="Back"
					>
						<BackArrowIcon />
					</button>
					<button
						class="standalone-page-viewer__nav-button"
						onClick={() => router()?.forwards()}
						title="Forward"
					>
						<ForwardsArrowIcon />
					</button>
					<button
						class="standalone-page-viewer__nav-button"
						onClick={() =>
							router()?.navigate(router()?.currentPath.get() || "")
						}
						title="Refresh"
					>
						<RefreshIcon />
					</button>
				</div>
				<div class="standalone-page-viewer__title" data-tauri-drag-region>
					{router()?.currentElement().name || "Page Viewer"}
				</div>
				<WindowControls
					class={"standalone-page-viewer__controls " + `controls-${osType()}`}
					platform={
						osType() === "linux"
							? "gnome"
							: osType() === "macos"
								? "macos"
								: "windows"
					}
				/>
			</div>
			<div class="standalone-page-viewer__content">{router()?.router}</div>
		</div>
	);
}

export default StandalonePageViewer;
