import { MiniRouter } from "@components/page-viewer/mini-router";
import { miniRouterInvalidPage, miniRouterPaths } from "@components/page-viewer/mini-router-config";
import { popOutMiniRouter } from "@components/page-viewer/standalone-launcher";
import { UnifiedPageViewer } from "@components/page-viewer/unified-page-viewer";

import { uiChromeModeEnabled } from "@utils/config-sync";
import { futureEntryMatchesTarget, isLibraryPath } from "@utils/flat-shell-navigation";
import { createRoot, createSignal, Show } from "solid-js";
import styles from "./page-viewer.module.css";

const [pageViewerOpen, setPageViewerOpen] = createSignal(false);

function dismissToLibrary() {
	const miniRouter = router();
	if (miniRouter && !uiChromeModeEnabled()) {
		miniRouter.navigateToLibrary();
		return;
	}
	setPageViewerOpen(false);
}

function resetLibraryNavigationState() {
	router()?.resetLibrarySlot();
}

function openMiniPage(
	path: string,
	params?: Record<string, unknown>,
	props?: Record<string, unknown>,
) {
	const miniRouter = router();
	if (!miniRouter) {
		if (import.meta.env.DEV) {
			console.warn("[openMiniPage] MiniRouter not ready; navigation dropped:", path);
		}
		return;
	}

	const isFlatChrome = !uiChromeModeEnabled();
	const targetParams = params ?? {};

	if (!isFlatChrome) {
		miniRouter.navigate(path, targetParams, props);
		setPageViewerOpen(true);
		return;
	}

	const openingFromLibrary = !pageViewerOpen();

	if (openingFromLibrary) {
		const [nextFuture] = miniRouter.history.future;
		// After stepping back to library, future may hold the page to redo; resume via
		// forward when the sidebar target matches. Library-tab dismiss uses past instead.
		if (nextFuture && futureEntryMatchesTarget(nextFuture, path, targetParams)) {
			miniRouter.forwards();
		} else {
			miniRouter.navigateFromLibrary(path, targetParams, props);
		}

		if (!pageViewerOpen() && !isLibraryPath(miniRouter.currentPath.get())) {
			setPageViewerOpen(true);
		}
		return;
	}

	miniRouter.navigate(path, targetParams, props);
	setPageViewerOpen(true);
}

const [router, setRouter] = createRoot(() =>
	createSignal<MiniRouter>(
		new MiniRouter({
			paths: miniRouterPaths,
			invalid: miniRouterInvalidPage,
		}),
	),
);

interface PageViewerProps {
	open?: boolean;
	/**
	 * Notifies the parent when viewer visibility changes (close, pop-out).
	 * Windowed and other non-flat callers use this to sync local open state.
	 * Flat embedded mode omits this: close syncs via dismissToLibrary and the
	 * shell delegate (pageViewerOpen + onEnterLibrary/onLeaveLibrary).
	 */
	viewChanged?: (value: boolean) => void;
	embedded?: boolean;
}

function PageViewer(props: PageViewerProps) {
	const mini_router = router();

	const onPopOut = () => {
		void popOutMiniRouter(mini_router);

		setPageViewerOpen(false);
		props.viewChanged?.(false);
	};

	return (
		<Show when={props.open !== undefined ? props.open : pageViewerOpen()}>
			<div
				class={styles["page-viewer-wrapper"]}
				classList={{ [styles["page-viewer-wrapper--embedded"]]: props.embedded }}
			>
				<div
					class={`${styles["page-viewer-root"]}${props.embedded ? "" : " liquid-glass"}`}
				>
					<UnifiedPageViewer
						router={mini_router}
						onClose={() => {
							if (props.embedded && !uiChromeModeEnabled()) {
								dismissToLibrary();
							} else {
								setPageViewerOpen(false);
							}
							props.viewChanged?.(false);
						}}
						hideCloseButton={props.embedded}
						hideNavbar={props.embedded}
						onPopOut={props.embedded ? undefined : onPopOut}
					/>
				</div>
			</div>
		</Show>
	);
}

export {
	PageViewer,
	dismissToLibrary,
	openMiniPage,
	pageViewerOpen,
	resetLibraryNavigationState,
	router,
	setPageViewerOpen,
	setRouter,
};
