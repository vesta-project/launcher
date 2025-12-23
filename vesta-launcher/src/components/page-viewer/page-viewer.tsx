import BackArrowIcon from "@assets/back-arrow.svg";
import CloseIcon from "@assets/close.svg";
import LinkIcon from "@assets/link.svg";
import OpenIcon from "@assets/open.svg";
import RefreshIcon from "@assets/refresh.svg";
import { MiniRouter } from "@components/page-viewer/mini-router";
import {
	miniRouterInvalidPage,
	miniRouterPaths,
} from "@components/page-viewer/mini-router-config";

import { Polymorphic } from "@kobalte/core";
import { invoke } from "@tauri-apps/api/core";
import LauncherButton from "@ui/button/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ui/tooltip/tooltip";
import {
	children,
	createEffect,
	createMemo,
	createSignal,
	lazy,
	onCleanup,
	onMount,
	Show,
} from "solid-js";
import { Dynamic } from "solid-js/web";
import "./page-viewer.css";

function PageViewerNavbarButton(props: {
	children: import("solid-js/types/jsx").JSX.Element;
	onClick?: () => void;
	text?: string;
	disabled?: boolean;
	class?: string;
}) {
	const c = children(() => props.children);
	return (
		<Tooltip placement={"top"}>
			<TooltipTrigger>
				<button
					class={`page-viewer-navbar-button ${props.class || ""}`}
					onClick={props.onClick}
					aria-label={props.text}
					disabled={props.disabled}
				>
					{c()}
				</button>
			</TooltipTrigger>
			<Show when={props.text}>
				<TooltipContent>{props.text}</TooltipContent>
			</Show>
		</Tooltip>
	);
}

function PageViewerNavbar(props: { closeClicked?: () => void }) {
	const openWindow = () => {
		const currentPath = router()?.currentPath.get();
		const currentParams = router()?.currentParams.get();
		const currentProps = router()?.currentPathProps();
		const historyPast = router()?.history.past || [];
		const historyFuture = router()?.history.future || [];

		// Convert params and props to string values for URL serialization
		const stringParams: Record<string, string> | undefined = currentParams
			? Object.fromEntries(
					Object.entries(currentParams).map(([k, v]) => [k, String(v)]),
				)
			: undefined;

		const stringProps: Record<string, string> | undefined = currentProps
			? Object.fromEntries(
					Object.entries(currentProps).map(([k, v]) => [k, String(v)]),
				)
			: undefined;

		// Merge params and props for passing to new window
		const allData = { ...stringParams, ...stringProps };

		// Serialize history for passing to new window
		const historyData = {
			path: currentPath,
			past: historyPast.map((entry) => ({
				path: entry.path,
				params: entry.params
					? Object.fromEntries(
							Object.entries(entry.params).map(([k, v]) => [k, String(v)]),
						)
					: {},
				props: entry.props
					? Object.fromEntries(
							Object.entries(entry.props).map(([k, v]) => [k, String(v)]),
						)
					: undefined,
			})),
			future: historyFuture.map((entry) => ({
				path: entry.path,
				params: entry.params
					? Object.fromEntries(
							Object.entries(entry.params).map(([k, v]) => [k, String(v)]),
						)
					: {},
				props: entry.props
					? Object.fromEntries(
							Object.entries(entry.props).map(([k, v]) => [k, String(v)]),
						)
					: undefined,
			})),
		};

		const historyJsonString = JSON.stringify(historyData);
		console.log(
			"Opening new window with history - Past:",
			historyPast.length,
			"Future:",
			historyFuture.length,
			"JSON length:",
			historyJsonString.length,
		);

		invoke("launch_new_window", {
			path: currentPath,
			props: allData,
			history: historyJsonString,
		});
		props.closeClicked?.();
	};

	const copyUrl = async () => {
		const url = router()?.generateUrl();
		if (!url) return;

		try {
			await navigator.clipboard.writeText(url);
			console.log("URL copied to clipboard:", url);
			// TODO: Show toast notification "URL copied!"
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
		<div class={"page-viewer-navbar-root"}>
			<div class={"page-viewer-navbar-left"}>
				<PageViewerNavbarButton
					onClick={() => router()?.backwards()}
					text={"Backwards"}
					disabled={!canGoBack()}
				>
					<BackArrowIcon />
				</PageViewerNavbarButton>
				<PageViewerNavbarButton
					onClick={() => router()?.forwards()}
					text={"Forwards"}
					disabled={!canGoForward()}
					class="forward"
				>
					<BackArrowIcon />
				</PageViewerNavbarButton>
				<PageViewerNavbarButton text={"Reload"} onClick={reloadCurrentView}>
					<RefreshIcon />
				</PageViewerNavbarButton>
			</div>
			<div class={"page-viewer-navbar-center"}>
				<div class={"page-viewer-location"}>
					{router()?.currentElement().name}
				</div>
			</div>
			<div class={"page-viewer-navbar-right"}>
				<PageViewerNavbarButton
					onClick={props.closeClicked}
					text={"Close (esc)"}
				>
					<CloseIcon />
				</PageViewerNavbarButton>
				<PageViewerNavbarButton text={"Copy URL"} onClick={copyUrl}>
					<LinkIcon />
				</PageViewerNavbarButton>
				<PageViewerNavbarButton
					text={"Open in new window"}
					onClick={openWindow}
				>
					<OpenIcon />
				</PageViewerNavbarButton>
			</div>
		</div>
	);
}

interface PageViewerProps {
	open?: boolean;
	viewChanged?: (value: boolean) => void;
}

const [router, setRouter] = createSignal<MiniRouter>();
const [refetchFn, setRefetchFn] = createSignal<
	(() => Promise<void>) | undefined
>();

function PageViewer(props: PageViewerProps) {
	const mini_router = new MiniRouter({
		paths: miniRouterPaths,
		invalid: miniRouterInvalidPage,
	});

	setRouter(mini_router);

	const handleKeyDown = (event: KeyboardEvent) => {
		if (event.key === "Escape") {
			props.viewChanged?.(false);
		}
	};

	onMount(() => {
		document.addEventListener("keydown", handleKeyDown);
	});

	onCleanup(() => {
		document.removeEventListener("keydown", handleKeyDown);
	});

	return (
		<Show when={props.open}>
			<div class={"page-viewer-wrapper"}>
				<div class={"page-viewer-root"}>
					<PageViewerNavbar closeClicked={() => props.viewChanged?.(false)} />
					<div class={"page-viewer-content"}>
						{router()?.getRouterView({ setRefetch: setRefetchFn })}
					</div>
				</div>
			</div>
		</Show>
	);
}

export { PageViewer, router };
