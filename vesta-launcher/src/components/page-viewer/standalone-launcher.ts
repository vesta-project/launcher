import type { MiniRouter } from "@components/page-viewer/mini-router";
import { invoke } from "@tauri-apps/api/core";

function serializeRecord(rec: Record<string, unknown> | undefined) {
	if (!rec) return {};
	return Object.fromEntries(
		Object.entries(rec)
			.filter(([key]) => key !== "router" && key !== "close" && key !== "setRefetch")
			.map(([key, value]) => [
				key,
				typeof value === "object" ? JSON.stringify(value) : String(value),
			]),
	);
}

export async function openStandaloneMiniPage(
	path: string,
	params?: Record<string, unknown>,
	props?: Record<string, unknown>,
) {
	await invoke("launch_window", {
		path,
		props: {
			...serializeRecord(params),
			...serializeRecord(props),
		},
	});
}

export async function popOutMiniRouter(miniRouter: MiniRouter) {
	const currentPath = miniRouter.currentPath.get();
	const currentParams = miniRouter.currentParams.get();
	const currentProps = miniRouter.getSnapshot();
	const historyPast = miniRouter.history.past || [];
	const historyFuture = miniRouter.history.future || [];

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

	const handoffId = `handoff_${Date.now()}`;
	localStorage.setItem(
		handoffId,
		JSON.stringify({
			props: allData,
			history: JSON.stringify(historyData),
		}),
	);

	await openStandaloneMiniPage(currentPath, { handoffId });
}
