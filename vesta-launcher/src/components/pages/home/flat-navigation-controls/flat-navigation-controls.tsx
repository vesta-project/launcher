import BackArrowIcon from "@assets/back-arrow.svg";
import ForwardsArrowIcon from "@assets/right-arrow.svg";
import { router } from "@components/page-viewer/page-viewer";
import { createMemo } from "solid-js";
import styles from "./flat-navigation-controls.module.css";

function FlatNavigationControls() {
	const canGoBack = createMemo(() => router()?.canGoBack() ?? false);
	const canGoForward = createMemo(() => router()?.canGoForward() ?? false);

	const handleBackClick = async () => {
		const r = router();
		if (!r || !canGoBack()) return;

		const canExit = r.getCanExit();
		if (canExit) {
			const ok = await canExit();
			if (!ok) return;
		}

		r.backwards();
	};

	const handleForwardClick = () => {
		const r = router();
		if (!r || !canGoForward()) return;

		r.forwards();
	};

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
