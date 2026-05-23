import ConnectionLostSvg from "@assets/connection-lost.svg";
import networkStore from "@stores/network";
import { Badge } from "@ui/badge";
import { createMemo, Show } from "solid-js";
import styles from "./network-pill.module.css";

function NetworkPill() {
	const status = networkStore.status;
	const isRefreshing = networkStore.isRefreshing;

	const label = createMemo(() => {
		if (isRefreshing()) return "Checking...";
		if (status() === "offline") return "Offline";
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
				title={isRefreshing() ? "Checking connection..." : `${label()} - Click to retry`}
				onClick={handleRetry}
			>
				<div class={styles["network-pill__icon"]}>
					<Show when={isRefreshing()}>
						<svg
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2.5"
							stroke-linecap="round"
							stroke-linejoin="round"
						>
							<path d="M21 12a9 9 0 1 1-6.219-8.56" />
						</svg>
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
