import { t } from "~/localization";
import ConnectionLostSvg from "@assets/icons/status/connection-lost.svg";
import ReloadIcon from "@assets/icons/actions/reload.svg";
import networkStore from "@stores/network";
import { Badge } from "@ui/badge";
import { createMemo, Show } from "solid-js";
import styles from "./network-pill.module.css";

function NetworkPill() {
	const status = networkStore.status;
	const isRefreshing = networkStore.isRefreshing;

	const label = createMemo(() => {
		if (isRefreshing()) return t("app-shell-checking");
		if (status() === "offline") return t("app-shell-offline");
		return "";
	});

	const handleRetry = async (e: MouseEvent) => {
		e.stopPropagation();
		if (isRefreshing()) return;
		await networkStore.refresh();
	};

	return (
		<Show when={status() === "offline"}>
			<Badge
				pill={true}
				clickable={!isRefreshing()}
				variant="error"
				classList={{
					[styles["network-pill"]]: true,
					[styles["network-pill--refreshing"]]: isRefreshing(),
				}}
					title={
						isRefreshing()
							? t("app-shell-checking-connection")
							: t("app-shell-network-click-to-retry", { label: label() })
				}
				onClick={handleRetry}
			>
				<div class={styles["network-pill__icon"]}>
					<Show when={isRefreshing()}>
						<ReloadIcon />
					</Show>
					<Show when={!isRefreshing()}>
						<ConnectionLostSvg />
					</Show>
				</div>
				<span class={styles["network-pill__label"]}>{label()}</span>
			</Badge>
		</Show>
	);
}

export default NetworkPill;
