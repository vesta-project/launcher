import BackArrowIcon from "@assets/back-arrow.svg";
import ForwardsArrowIcon from "@assets/right-arrow.svg";
import { pageViewerOpen, router } from "@components/page-viewer/page-viewer";
import {
	handleNavigationBack,
	handleNavigationForward,
	handleNavigationKeyDown,
} from "@utils/flat-shell-navigation";
import { createMemo, onCleanup, onMount } from "solid-js";
import styles from "./flat-navigation-controls.module.css";

function FlatNavigationControls() {
	const canGoBack = createMemo(() => {
		pageViewerOpen();
		const r = router();
		if (!r) return false;
		r.currentPath.get();
		return r.canGoBackReactive();
	});

	const canGoForward = createMemo(() => {
		pageViewerOpen();
		const r = router();
		if (!r) return false;
		r.currentPath.get();
		return r.canGoForwardReactive();
	});

	const handleBackClick = async () => {
		const r = router();
		if (!r) return;
		await handleNavigationBack(r);
	};

	const handleForwardClick = () => {
		const r = router();
		if (!r) return;
		handleNavigationForward(r);
	};

	onMount(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			void handleNavigationKeyDown(event, router());
		};
		window.addEventListener("keydown", onKeyDown);
		onCleanup(() => window.removeEventListener("keydown", onKeyDown));
	});

	return (
		<div class={styles["flat-navigation-controls"]}>
			<button
				type="button"
				class={styles["flat-navigation-controls__button"]}
				onClick={handleBackClick}
				disabled={!canGoBack()}
				aria-label="Back"
				title="Back"
			>
				<BackArrowIcon />
			</button>
			<button
				type="button"
				class={styles["flat-navigation-controls__button"]}
				onClick={handleForwardClick}
				disabled={!canGoForward()}
				aria-label="Forward"
				title="Forward"
			>
				<ForwardsArrowIcon />
			</button>
		</div>
	);
}

export default FlatNavigationControls;
