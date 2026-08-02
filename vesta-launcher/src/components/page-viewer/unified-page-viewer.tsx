import BackArrowIcon from "@assets/back-arrow.svg";
import CloseIcon from "@assets/close.svg";
import OpenIcon from "@assets/open.svg";
import RefreshIcon from "@assets/refresh.svg";
import ForwardsArrowIcon from "@assets/right-arrow.svg";
import { PageOptionsMenu } from "@components/page-root/titlebar/page-options-menu";
import type { MiniRouter } from "@components/page-viewer/mini-router";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ui/tooltip/tooltip";
import {
	handleNavigationBack,
	handleNavigationForward,
} from "@utils/flat-shell-navigation";
import {
	children,
	createMemo,
	type JSX,
	Show,
} from "solid-js";
import styles from "./unified-page-viewer.module.css";

interface NavbarButtonProps {
	children: JSX.Element;
	onClick?: () => void;
	text?: string;
	disabled?: boolean;
	class?: string;
	loading?: boolean;
}

function NavbarButton(props: NavbarButtonProps) {
	const c = children(() => props.children);
	return (
		<Tooltip placement={"top"}>
			<TooltipTrigger>
				<button
					class={`${styles["page-viewer-navbar-button"]} ${props.class || ""} ${props.loading ? styles["is-loading"] : ""}`}
					onClick={props.onClick}
					aria-label={props.text}
					disabled={props.disabled || props.loading}
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

interface UnifiedPageViewerProps {
	router: MiniRouter;
	onClose?: () => void;
	onPopOut?: () => void;
	showWindowControls?: boolean;
	hideCloseButton?: boolean;
	hideNavbar?: boolean;
	titleSuffix?: string;
	extraNavbarActions?: JSX.Element;
	windowControls?: JSX.Element;
	os?: string;
	macosFullscreen?: boolean;
	children?: JSX.Element;
}

export function UnifiedPageViewer(props: UnifiedPageViewerProps) {
	const canGoBack = createMemo(() => {
		props.router.currentPath.get();
		return props.router.canGoBackReactive();
	});
	const canGoForward = createMemo(() => {
		props.router.currentPath.get();
		return props.router.canGoForwardReactive();
	});
	const isReloading = createMemo(() => props.router.isReloading());
	const isMac = createMemo(() => props.os === "macos");

	const handleBack = async () => {
		await handleNavigationBack(props.router);
	};

	const handleClose = async () => {
		const canExit = props.router.getCanExit();
		if (canExit) {
			const ok = await canExit();
			if (!ok) return;
			// If we confirmed here, tell the router to skip the next native check (to avoid double prompt)
			props.router.skipNextExitCheck = true;
		}
		if (props.onClose) props.onClose();
	};

	return (
		<div class={styles["unified-page-viewer-root"]} data-os={props.os}>
			<Show when={!props.hideNavbar}>
				<header
					class={`${styles["page-viewer-navbar"]} grain-overlay`}
					data-tauri-drag-region={props.showWindowControls}
				>
					<Show when={isMac()}>
						<div
							classList={{
								[styles["page-viewer-window-controls-wrapper"]]: true,
								[styles["page-viewer-controls-wrapper--mac"]]: true,
								[styles["page-viewer-controls-wrapper--macos-fullscreen"]]:
									props.macosFullscreen === true,
							}}
						>
							{props.windowControls}
						</div>
					</Show>
					<div class={styles["page-viewer-navbar-left"]}>
						<NavbarButton
							onClick={handleBack}
							text="Back"
							disabled={!canGoBack()}
						>
							<BackArrowIcon />
						</NavbarButton>
						<NavbarButton
							onClick={() => handleNavigationForward(props.router)}
							text="Forward"
							disabled={!canGoForward()}
						>
							<ForwardsArrowIcon />
						</NavbarButton>
						<Show when={props.router.getRefetch()}>
							<NavbarButton
								onClick={() => props.router.reload()}
								text="Reload"
								loading={isReloading()}
							>
								<RefreshIcon />
							</NavbarButton>
						</Show>
					</div>

					<div
						class={styles["page-viewer-navbar-center"]}
						data-tauri-drag-region={props.showWindowControls}
					>
						<span
							class={styles["page-viewer-title"]}
							data-tauri-drag-region={props.showWindowControls}
						>
							{props.router.customName.get() ||
								props.router.currentElement().name}
							{props.titleSuffix && ` - ${props.titleSuffix}`}
						</span>
					</div>

					<div class={styles["page-viewer-navbar-right"]}>
						{props.extraNavbarActions}

						<PageOptionsMenu router={props.router} />

						<Show when={props.onPopOut}>
							<NavbarButton onClick={props.onPopOut} text="Open in new window">
								<OpenIcon />
							</NavbarButton>
						</Show>

						<Show
							when={
								props.onClose && !props.windowControls && !props.hideCloseButton
							}
						>
							<NavbarButton onClick={handleClose} text="Close">
								<CloseIcon />
							</NavbarButton>
						</Show>

						<Show when={!isMac()}>
							<div class={styles["page-viewer-window-controls-wrapper"]}>
								{props.windowControls}
							</div>
						</Show>

						{props.children}
					</div>
				</header>
			</Show>

			<main class={styles["page-viewer-content"]} data-page-scroll-container>
				<Show when={isReloading()}>
					<div class={styles["page-viewer-reload-overlay"]}>
						<div class={styles["page-viewer-reload-spinner"]} />
					</div>
				</Show>
				{props.router.getRouterView({
					close: props.onClose,
					router: props.router,
				})}
			</main>
		</div>
	);
}
