import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { createRoot, createSignal, onMount } from "solid-js";

export type NetworkStatus = "online" | "offline";

function createNetworkStore() {
	const [status, setStatus] = createSignal<NetworkStatus>("online");
	const [isRefreshing, setIsRefreshing] = createSignal(false);

	invoke<NetworkStatus>("get_network_status").then((s) => setStatus(s));

	window.addEventListener("offline", () => {
		invoke("set_network_status", { status: "offline" });
	});
	window.addEventListener("online", () => {
		invoke("set_network_status", { status: "online" });
	});

	window.addEventListener("focus", () => {
		if (status() !== "online") {
			refresh();
		}
	});

	// Periodic check while the window is visible to catch silent
	// connectivity loss (e.g. router loses internet but Wi-Fi stays up)
	onMount(() => {
		let interval: ReturnType<typeof setInterval> | null = null;

		const start = () => {
			if (interval) return;
			interval = setInterval(() => {
				invoke<NetworkStatus>("refresh_network_status").then((s) => {
					if (s !== status()) setStatus(s);
				});
			}, 60000);
		};

		const stop = () => {
			if (interval) {
				clearInterval(interval);
				interval = null;
			}
		};

		const handleVisibility = () => {
			if (document.hidden) {
				stop();
			} else {
				start();
			}
		};

		document.addEventListener("visibilitychange", handleVisibility);

		if (!document.hidden) start();

		return () => {
			stop();
			document.removeEventListener("visibilitychange", handleVisibility);
		};
	});

	listen<NetworkStatus>("core://network-status-changed", (event) => {
		setStatus(event.payload);
	});

	const refresh = async () => {
		if (isRefreshing()) return;
		setIsRefreshing(true);
		try {
			const s = await invoke<NetworkStatus>("refresh_network_status");
			setStatus(s);
		} catch (e) {
			console.error("Failed to refresh network status:", e);
		} finally {
			setIsRefreshing(false);
		}
	};

	return {
		status,
		setStatus,
		refresh,
		isRefreshing,
		isOnline: () => status() === "online",
		isOffline: () => status() === "offline",
	};
}

export default createRoot(createNetworkStore);
