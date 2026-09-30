import { t } from "~/localization";
import BackArrowIcon from "@assets/icons/navigation/arrow-back.svg";
import ForwardsArrowIcon from "@assets/icons/navigation/arrow-forward.svg";
import RefreshIcon from "@assets/icons/actions/refresh.svg";
import { pageViewerOpen, router } from "@components/page-viewer/page-viewer";
import { createShellHistoryControls } from "@utils/flat-shell-navigation";
import { Show } from "solid-js";
import styles from "./flat-navigation-controls.module.css";

function FlatNavigationControls() {
	const history = createShellHistoryControls(router, {
		track: pageViewerOpen,
	});

	return (
		<div class={styles["flat-navigation-controls"]}>
			<button
				type="button"
				class={styles["flat-navigation-controls__button"]}
				onClick={() => void history.back()}
				disabled={!history.canGoBack()}
				aria-label={t("app-shell-back")}
				title={t("app-shell-back")}
			>
				<BackArrowIcon />
			</button>
			<button
				type="button"
				class={styles["flat-navigation-controls__button"]}
				onClick={history.forward}
				disabled={!history.canGoForward()}
				aria-label={t("app-shell-forward")}
				title={t("app-shell-forward")}
			>
				<ForwardsArrowIcon />
			</button>
			<Show when={history.canReload()}>
				<button
					type="button"
					class={`${styles["flat-navigation-controls__button"]} ${history.isReloading() ? styles["flat-navigation-controls__button--loading"] : ""}`}
					onClick={history.reload}
					disabled={history.isReloading()}
					aria-label={t("app-shell-reload")}
					title={t("app-shell-reload")}
				>
					<RefreshIcon />
				</button>
			</Show>
		</div>
	);
}

export default FlatNavigationControls;
