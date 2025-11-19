import BackArrowIcon from "@assets/back-arrow.svg";
import CloseIcon from "@assets/close.svg";
import OpenIcon from "@assets/open.svg";
import RefreshIcon from "@assets/refresh.svg";
import ForwardsArrowIcon from "@assets/right-arrow.svg";
import { MiniRouter } from "@components/page-viewer/mini-router";
import {
	miniRouterInvalidPage,
	miniRouterPaths,
} from "@components/page-viewer/mini-router-config";

import { Polymorphic } from "@kobalte/core";
import { invoke } from "@tauri-apps/api/core";
import LauncherButton from "@ui/button/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ui/tooltip/tooltip";
import { Show, children, createEffect, createSignal, lazy } from "solid-js";
import { Dynamic } from "solid-js/web";
import "./page-viewer.css";

function PageViewerNavbarButton(props: {
	children: import("solid-js/types/jsx").JSX.Element;
	onClick?: () => void;
	text?: string;
}) {
	const c = children(() => props.children);
	return (
		<Tooltip placement={"top"}>
			<TooltipTrigger>
				<button
					class={"page-viewer-navbar-button"}
					onClick={props.onClick}
					aria-label={props.text}
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
		invoke("launch_new_window", { path: currentPath });
		props.closeClicked?.();
	};

	const reloadCurrentView = () => {
		const path = router()?.currentPath.get();
		if (path) {
			router()?.navigate(path);
		}
	};

	return (
		<div class={"page-viewer-navbar-root"}>
			<div class={"page-viewer-navbar-left"}>
				<PageViewerNavbarButton
					onClick={() => router()?.backwards()}
					text={"Backwards"}
				>
					<BackArrowIcon />
				</PageViewerNavbarButton>
				<PageViewerNavbarButton
					onClick={() => router()?.forwards()}
					text={"Forwards"}
				>
					<ForwardsArrowIcon />
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
				<PageViewerNavbarButton onClick={props.closeClicked} text={"Close"}>
					<CloseIcon />
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

function PageViewer(props: PageViewerProps) {
	const mini_router = new MiniRouter({
		paths: miniRouterPaths,
		invalid: miniRouterInvalidPage,
	});

	setRouter(mini_router);

	return (
		<Show when={props.open}>
			<div class={"page-viewer-wrapper"}>
				<div class={"page-viewer-root"}>
					<PageViewerNavbar closeClicked={() => props.viewChanged?.(false)} />
					<div class={"page-viewer-content"}>{router()?.router}</div>
				</div>
			</div>
		</Show>
	);
}

export { PageViewer, router };
