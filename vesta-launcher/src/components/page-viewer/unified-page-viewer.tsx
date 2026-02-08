import BackArrowIcon from "@assets/back-arrow.svg";
import CloseIcon from "@assets/close.svg";
import LinkIcon from "@assets/link.svg";
import OpenIcon from "@assets/open.svg";
import RefreshIcon from "@assets/refresh.svg";
import ForwardsArrowIcon from "@assets/right-arrow.svg";
import { MiniRouter } from "@components/page-viewer/mini-router";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ui/tooltip/tooltip";
import {
	children,
	createMemo,
	createSignal,
	Show,
	type JSX,
	onMount,
	onCleanup,
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
	titleSuffix?: string;
	extraNavbarActions?: JSX.Element;
	windowControls?: JSX.Element;
	os?: string;
	children?: JSX.Element;
}

export function UnifiedPageViewer(props: UnifiedPageViewerProps) {
	const canGoBack = createMemo(() => props.router.canGoBack());
	const canGoForward = createMemo(() => props.router.canGoForward());
	const isReloading = createMemo(() => props.router.isReloading());
	const isMac = createMemo(() => props.os === "macos");

	const handleBack = async () => {
		const canExit = props.router.getCanExit();
		if (canExit) {
			const ok = await canExit();
			if (!ok) return;
		}
		props.router.backwards();
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

	const copyUrl = async () => {
		const url = props.router.generateUrl();
		if (!url) return;
		try {
			await navigator.clipboard.writeText(url);
			console.log("URL copied to clipboard:", url);
		} catch (e) {
			console.error("Failed to copy URL:", e);
		}
	};

	const handleKeyDown = (event: KeyboardEvent) => {
		if (event.ctrlKey || event.metaKey) {
			if (event.key === "r") {
				event.preventDefault();
				props.router.reload();
			}
			if (event.key === "w" && props.onClose) {
				event.preventDefault();
				handleClose();
			}
		}
		if (event.altKey) {
			if (event.key === "ArrowLeft") handleBack();
			if (event.key === "ArrowRight") props.router.forwards();
		}
	};

	onMount(() => {
		window.addEventListener("keydown", handleKeyDown);
	});

	onCleanup(() => {
		window.removeEventListener("keydown", handleKeyDown);
	});

	return (
		<div class={styles["unified-page-viewer-root"]} data-os={props.os}>
			<header
				class={styles["page-viewer-navbar"]}
				data-tauri-drag-region={props.showWindowControls}
			>
				<div class={styles["page-viewer-navbar-left"]}>
					<Show when={isMac()}>
						<div class={styles["page-viewer-window-controls-wrapper"]}>
							{props.windowControls}
						</div>
					</Show>

					<NavbarButton
						onClick={handleBack}
						text="Back"
						disabled={!canGoBack()}
					>
						<BackArrowIcon />
					</NavbarButton>
					<NavbarButton
						onClick={() => props.router.forwards()}
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

				<div class={styles["page-viewer-navbar-center"]} data-tauri-drag-region>
					<span class={styles["page-viewer-title"]}>
						{props.router.customName.get() ||
							props.router.currentElement().name}
						{props.titleSuffix && ` - ${props.titleSuffix}`}
					</span>
				</div>

				<div class={styles["page-viewer-navbar-right"]}>
					{props.extraNavbarActions}

					<Show when={props.onPopOut}>
						<NavbarButton onClick={props.onPopOut} text="Open in new window">
							<OpenIcon />
						</NavbarButton>
					</Show>

					<NavbarButton onClick={copyUrl} text="Copy URL">
						<LinkIcon />
					</NavbarButton>

					<Show when={props.onClose && !props.windowControls}>
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

			<main class={styles["page-viewer-content"]}>
				<Show when={isReloading()}>
					<div class={styles["page-viewer-reload-overlay"]}>
						<div class={styles["page-viewer-reload-spinner"]} />
					</div>
				</Show>
				{props.router.getRouterView({ close: props.onClose })}
			</main>
		</div>
	);
}
