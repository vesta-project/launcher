import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { createRoot, createSignal, onMount } from "solid-js";

export type NetworkStatus = "online" | "weak" | "offline";

function createNetworkStore() {
	const [status, setStatus] = createSignal<NetworkStatus>("online");
	const [isRefreshing, setIsRefreshing] = createSignal(false);

	// Initial status fetch
	invoke<NetworkStatus>("get_network_status").then((s) => setStatus(s));

	// Listen for browser events and sync to backend
	window.addEventListener("offline", () => {
		invoke("set_network_status", { status: "offline" });
	});
	window.addEventListener("online", () => {
		invoke("set_network_status", { status: "online" });
	});

	let lastFocusCheck = 0;
	// Re-verify when app regained focus
	window.addEventListener("focus", () => {
		const now = Date.now();
		// If offline or weak, check immediately on focus
		const isNotOnline = status() !== "online";
		if (isNotOnline || now - lastFocusCheck > 30000) {
			lastFocusCheck = now;
			refresh();
		}
	});

	// Periodic background check
	onMount(() => {
		let interval: ReturnType<typeof setInterval> | null = null;

		const startInterval = () => {
			if (interval) return;
			interval = setInterval(() => {
				invoke<NetworkStatus>("refresh_network_status").then((s) => {
					if (s !== status()) setStatus(s);
				});
			}, 45000); // Check every 45s when active
		};

		const stopInterval = () => {
			if (interval) {
				clearInterval(interval);
				interval = null;
			}
		};

		// Start initially
		startInterval();

		// Handle visibility changes to save resources
		const handleVisibility = () => {
			if (document.hidden) {
				stopInterval();
			} else {
				startInterval();
				refresh(); // Check immediately when coming back
			}
		};

		document.addEventListener("visibilitychange", handleVisibility);

		return () => {
			stopInterval();
			document.removeEventListener("visibilitychange", handleVisibility);
		};
	});

	// Listen for backend events
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
		isWeak: () => status() === "weak",
		isOffline: () => status() === "offline",
	};
}

export default createRoot(createNetworkStore);
