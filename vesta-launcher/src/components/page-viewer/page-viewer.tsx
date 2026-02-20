import { MiniRouter } from "@components/page-viewer/mini-router";
import {
	miniRouterInvalidPage,
	miniRouterPaths,
} from "@components/page-viewer/mini-router-config";
import { UnifiedPageViewer } from "@components/page-viewer/unified-page-viewer";

import { invoke } from "@tauri-apps/api/core";
import {
	createMemo,
	createRoot,
	createSignal,
	onCleanup,
	onMount,
	Show,
} from "solid-js";
import styles from "./page-viewer.module.css";

const [pageViewerOpen, setPageViewerOpen] = createSignal(false);

const [router, setRouter] = createRoot(() =>
	createSignal<MiniRouter>(
		new MiniRouter({
			paths: miniRouterPaths,
			invalid: miniRouterInvalidPage,
		}),
	),
);

function PageViewer(props: {
	open?: boolean;
	viewChanged?: (value: boolean) => void;
}) {
	const mini_router = router();

	const onPopOut = () => {
		const currentPath = mini_router.currentPath.get();
		const currentParams = mini_router.currentParams.get();
		const currentProps = mini_router.getSnapshot(); // Grab latest live state
		const historyPast = mini_router.history.past || [];
		const historyFuture = mini_router.history.future || [];

		// Better serialization: stringify everything
		const serializeRecord = (rec: Record<string, unknown> | undefined) => {
			if (!rec) return {};
			return Object.fromEntries(
				Object.entries(rec)
					.filter(
						([k]) => k !== "router" && k !== "close" && k !== "setRefetch",
					)
					.map(([k, v]) => [
						k,
						typeof v === "object" ? JSON.stringify(v) : String(v),
					]),
			);
		};

		const allData = {
			...serializeRecord(currentParams),
			...serializeRecord(currentProps),
		};

		const historyData = {
			path: currentPath,
			past: historyPast.map((entry) => ({
				path: entry.path,
				params: serializeRecord(entry.params),
				props: serializeRecord(entry.props),
			})),
			future: historyFuture.map((entry) => ({
				path: entry.path,
				params: serializeRecord(entry.params),
				props: serializeRecord(entry.props),
			})),
		};

		// Use localStorage for large handoff data to avoid URL length limits
		const handoffId = `handoff_${Date.now()}`;
		localStorage.setItem(
			handoffId,
			JSON.stringify({
				props: allData,
				history: JSON.stringify(historyData),
			}),
		);

		invoke("launch_window", {
			path: currentPath,
			props: { handoffId }, // Pass the ID instead of full data
		});

		setPageViewerOpen(false);
		props.viewChanged?.(false);
	};

	return (
		<Show when={props.open !== undefined ? props.open : pageViewerOpen()}>
			<div class={styles["page-viewer-wrapper"]}>
				<div class={styles["page-viewer-root"]}>
					<UnifiedPageViewer
						router={mini_router}
						onClose={() => {
							setPageViewerOpen(false);
							props.viewChanged?.(false);
						}}
						onPopOut={onPopOut}
					/>
				</div>
			</div>
		</Show>
	);
}

export { PageViewer, router, setRouter, pageViewerOpen, setPageViewerOpen };
