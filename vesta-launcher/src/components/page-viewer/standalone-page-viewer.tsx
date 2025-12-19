import BackArrowIcon from "@assets/back-arrow.svg";
import LinkIcon from "@assets/link.svg";
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
import { Show, createSignal, createMemo, onMount } from "solid-js";
import "./standalone-page-viewer.css";

function StandalonePageViewer() {
	const [searchParams] = useSearchParams();
	const [router, setRouter] = createSignal<MiniRouter>();
	const [osType, setOsType] = createSignal<string>("windows");
	const [refetchFn, setRefetchFn] = createSignal<(() => Promise<void>) | undefined>();

	onMount(async () => {
		const os = await ensureOsType();
		setOsType(os || "windows");

		const initialPath = searchParams.path || "/config";
		
		// Separate route params (like slug) from component props (like activeTab)
		const initialParams: Record<string, unknown> = {};
		const initialProps: Record<string, unknown> = {};
		
		// Parse history if it was passed from the main window
		let historyPast: Array<{ path: string; params: Record<string, unknown>; props?: Record<string, unknown> }> = [];
		let historyFuture: Array<{ path: string; params: Record<string, unknown>; props?: Record<string, unknown> }> = [];
		
		const historyData = (searchParams as any).history;
		console.log("History data from searchParams:", historyData ? "Found" : "Not found");
		if (historyData && typeof historyData === 'string') {
			try {
				const parsed = JSON.parse(historyData);
				historyPast = parsed.past || [];
				historyFuture = parsed.future || [];
				console.log("Successfully parsed history - Past entries:", historyPast.length, "Future entries:", historyFuture.length);
			} catch (e) {
				console.warn("Failed to parse history data:", e, "Raw data:", historyData?.substring?.(0, 100));
			}
		}
		
		for (const [key, value] of Object.entries(searchParams)) {
			if (key !== "path" && key !== "history" && value !== undefined) {
				// Route params: slug, id, etc
				if (["slug", "id"].includes(key)) {
					initialParams[key] = value;
				} else {
					// Everything else is component state
					initialProps[key] = value;
				}
			}
		}

		const mini_router = new MiniRouter({
			paths: miniRouterPaths,
			invalid: miniRouterInvalidPage,
			currentPath: initialPath,
			initialProps: Object.keys(initialProps).length > 0 ? initialProps : undefined,
		});
		
		// Set initial route params
		if (Object.keys(initialParams).length > 0) {
			mini_router.currentParams.set(initialParams);
		}
		
		// Restore history stacks from main window
		if (historyPast.length > 0 || historyFuture.length > 0) {
			console.log("Restoring history - Past:", historyPast.length, "Future:", historyFuture.length);
			mini_router.history.past = historyPast.map(entry => ({
				path: entry.path,
				params: entry.params || {},
				props: entry.props,
			}));
			mini_router.history.future = historyFuture.map(entry => ({
				path: entry.path,
				params: entry.params || {},
				props: entry.props,
			}));
			console.log("History restored. Can go back:", mini_router.canGoBack(), "Can go forward:", mini_router.canGoForward());
		} else {
			console.log("No history data received");
		}

		setRouter(mini_router);
	});

	const copyUrl = async () => {
		const url = router()?.generateUrl();
		if (!url) return;
		
		try {
			await navigator.clipboard.writeText(url);
			console.log("URL copied to clipboard:", url);
		} catch (e) {
			console.error("Failed to copy URL:", e);
		}
	};

	const reloadCurrentView = async () => {
		const fn = refetchFn();
		if (fn) {
			try {
				await fn();
				console.log("Page reloaded successfully");
			} catch (error) {
				console.error("Failed to reload page:", error);
			}
		} else {
			console.warn("No refetch callback available for reload");
		}
	};

	const canGoBack = createMemo(() => router()?.canGoBack() ?? false);
	const canGoForward = createMemo(() => router()?.canGoForward() ?? false);

	return (
		<div class="standalone-page-viewer">
			<div class="standalone-page-viewer__header">
				<div class="standalone-page-viewer__nav-left">
					<button
						class="standalone-page-viewer__nav-button"
						onClick={() => router()?.backwards()}
						title="Back"
						disabled={!canGoBack()}
					>
						<BackArrowIcon />
					</button>
					<button
						class="standalone-page-viewer__nav-button forward"
						onClick={() => router()?.forwards()}
						title="Forward"
						disabled={!canGoForward()}
					>
						<BackArrowIcon />
					</button>
					<button
						class="standalone-page-viewer__nav-button"
						onClick={reloadCurrentView}
						title="Refresh"
					>
						<RefreshIcon />
					</button>
				</div>
				<div class="standalone-page-viewer__title" data-tauri-drag-region>
					{router()?.currentElement().name || "Page Viewer"}
				</div>
				<div class="standalone-page-viewer__nav-right">
					<button
						class="standalone-page-viewer__nav-button"
						onClick={copyUrl}
						title="Copy URL"
					>
						<LinkIcon />
					</button>
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
			<div class="standalone-page-viewer__content">
				{router()?.getRouterView({ setRefetch: setRefetchFn })}
			</div>
		</div>
	);
}

export default StandalonePageViewer;
