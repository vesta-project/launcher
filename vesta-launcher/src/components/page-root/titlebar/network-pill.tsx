import networkStore from "@stores/network";
import { Badge } from "@ui/badge";
import { createMemo, Show } from "solid-js";
import styles from "./network-pill.module.css";

function NetworkPill() {
	const status = networkStore.status;
	const isRefreshing = networkStore.isRefreshing;

	const label = createMemo(() => {
		if (isRefreshing()) return "Checking...";
		switch (status()) {
			case "weak":
				return "Weak Connection";
			case "offline":
				return "Offline";
			default:
				return "";
		}
	});

	const handleRetry = async (e: MouseEvent) => {
		e.stopPropagation();
		if (isRefreshing()) return;
		await networkStore.refresh();
	};

	return (
		<Show when={status() !== "online"}>
			<Badge
				pill={true}
				clickable={!isRefreshing()}
				variant={status() === "offline" ? "error" : "warning"}
				classList={{
					[styles["network-pill"]]: true,
					[styles["network-pill--refreshing"]]: isRefreshing(),
				}}
				title={
					isRefreshing()
						? "Checking connection..."
						: `${label()} - Click to retry`
				}
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
					<Show when={!isRefreshing() && status() === "weak"}>
						<svg
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="3"
							stroke-linecap="round"
							stroke-linejoin="round"
						>
							<path d="M5 9a10 10 0 0 1 14 0" />
							<path d="M8.5 12.5a6 6 0 0 1 7 0" />
							<circle
								cx="12"
								cy="16"
								r="1.2"
								fill="currentColor"
								stroke="none"
							/>
						</svg>
					</Show>
					<Show when={!isRefreshing() && status() === "offline"}>
						<svg
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="3"
							stroke-linecap="round"
							stroke-linejoin="round"
						>
							<path d="M1 1l22 22" />
							<path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.5" />
							<path d="M5 12.5a10.94 10.94 0 0 1 5.17-2.39" />
							<path d="M10.71 5.05A16 16 0 0 1 22.58 9" />
							<path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
							<path d="M12 16h.01" />
						</svg>
					</Show>
				</div>
				<span class={styles["network-pill__label"]}>{label()}</span>
			</Badge>
		</Show>
	);
}

export default NetworkPill;
