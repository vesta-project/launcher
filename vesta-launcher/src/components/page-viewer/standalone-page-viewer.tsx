import { MiniRouter } from "@components/page-viewer/mini-router";
import {
	miniRouterInvalidPage,
	miniRouterPaths,
} from "@components/page-viewer/mini-router-config";
import { router, setRouter } from "@components/page-viewer/page-viewer";
import { UnifiedPageViewer } from "@components/page-viewer/unified-page-viewer";
import { useSearchParams } from "@solidjs/router";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { WindowControls } from "@tauri-controls/solid";
import { getOsType } from "@utils/os";
import { createMemo, createSignal, onCleanup, onMount, Show } from "solid-js";
import styles from "./standalone-page-viewer.module.css";

function StandalonePageViewer() {
	const [searchParams] = useSearchParams();
	const osType = getOsType() ?? "windows";

	const tryParse = (val: string) => {
		if (typeof val !== "string") return val;
		if (val === "true") return true;
		if (val === "false") return false;
		if (val === "null") return null;
		if (val === "undefined") return undefined;
		if (/^-?\d+$/.test(val)) return parseInt(val, 10);
		if (/^-?\d*\.\d+$/.test(val)) return parseFloat(val);
		if (val.startsWith("{") || val.startsWith("[")) {
			try {
				return JSON.parse(val);
			} catch {
				return val;
			}
		}
		return val;
	};

	onMount(() => {
		const initialPath = (searchParams.path as string) || "/config";
		console.log("[Standalone] Initial currentPath from URL:", initialPath);

		// Separate route params (like slug) from component props
		let initialParams: Record<string, unknown> = {};
		let initialProps: Record<string, unknown> = {};
		let historyPast: any[] = [];
		let historyFuture: any[] = [];

		// Check for handoff data in localStorage
		const handoffId = searchParams.handoffId as string;
		if (handoffId) {
			const rawHandoff = localStorage.getItem(handoffId);
			if (rawHandoff) {
				try {
					const handoff = JSON.parse(rawHandoff);
					localStorage.removeItem(handoffId); // Clean up

					// Categorize handoff props into params and component props
					if (handoff.props) {
						for (const [k, v] of Object.entries(handoff.props)) {
							const parsed = tryParse(v as string);
							if (
								[
									"slug",
									"id",
									"projectId",
									"platform",
									"activeTab",
									"query",
									"resourceType",
									"activeSource",
									"gameVersion",
									"loader",
									"mode",
									"source",
								].includes(k)
							) {
								initialParams[k] = parsed;
							} else {
								initialProps[k] = parsed;
							}
						}
					}

					if (handoff.history) {
						const hist = JSON.parse(handoff.history);
						historyPast = hist.past || [];
						historyFuture = hist.future || [];
					}
				} catch (e) {
					console.error("Failed to parse handoff data:", e);
				}
			}
		}

		// Fallback/Legacy: Parse directly from searchParams if no handoff or handoff failed
		if (Object.keys(initialProps).length === 0) {
			const historyData = searchParams.history as string;
			if (historyData) {
				try {
					const parsed = JSON.parse(historyData);
					historyPast = parsed.past || [];
					historyFuture = parsed.future || [];
				} catch (e) {
					console.error("Failed to parse history data:", e);
				}
			}

			for (const [key, value] of Object.entries(searchParams)) {
				if (key === "path" || key === "history" || key === "handoffId")
					continue;
				const parsed = tryParse(String(value));
				if (
					["slug", "id", "projectId", "platform", "activeTab"].includes(key)
				) {
					initialParams[key] = parsed;
				} else {
					initialProps[key] = parsed;
				}
			}
		}

		const mini_router = new MiniRouter({
			paths: miniRouterPaths,
			invalid: miniRouterInvalidPage,
			currentPath: initialPath,
			initialProps:
				Object.keys(initialProps).length > 0 ? initialProps : undefined,
		});

		if (Object.keys(initialParams).length > 0) {
			mini_router.currentParams.set(initialParams);
		}

		if (historyPast.length > 0 || historyFuture.length > 0) {
			const mapHistory = (entries: any[]) =>
				entries.map((entry) => ({
					path: entry.path,
					params: entry.params
						? Object.fromEntries(
								Object.entries(entry.params).map(([k, v]) => [
									k,
									tryParse(v as string),
								]),
							)
						: {},
					props: entry.props
						? Object.fromEntries(
								Object.entries(entry.props).map(([k, v]) => [
									k,
									tryParse(v as string),
								]),
							)
						: undefined,
				}));

			mini_router.history.past = mapHistory(historyPast);
			mini_router.history.future = mapHistory(historyFuture);
		}

		setRouter(mini_router);

		// Handle native window close button
		const unlistenCloseRequested = getCurrentWindow().onCloseRequested(
			async (event) => {
				if (mini_router.skipNextExitCheck) return;

				const canExit = mini_router.getCanExit();
				if (canExit) {
					event.preventDefault();
					const ok = await canExit();
					if (ok) {
						mini_router.skipNextExitCheck = true;
						getCurrentWindow().close();
					}
				}
			},
		);

		onCleanup(() => {
			unlistenCloseRequested.then((unlisten) => unlisten());
		});
	});

	return (
		<Show when={router()}>
			{(r) => (
				<UnifiedPageViewer
					router={r()}
					showWindowControls={true}
					titleSuffix="Standalone"
					os={osType}
					onClose={() => getCurrentWindow().close()}
					windowControls={
						<WindowControls
							class={
								styles["standalone-page-viewer__controls"] +
								(osType === "macos"
									? ` ${styles["standalone-page-viewer__controls--macos"]}`
									: "")
							}
							platform={
								osType === "linux"
									? "gnome"
									: osType === "macos"
										? "macos"
										: "windows"
							}
						/>
					}
				/>
			)}
		</Show>
	);
}

export default StandalonePageViewer;
