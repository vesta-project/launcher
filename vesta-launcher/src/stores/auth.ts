import { listen } from "@tauri-apps/api/event";
import { Account, getActiveAccount } from "@utils/auth";
import { createRoot, createSignal } from "solid-js";

function createAuthStore() {
	const [expiredAccount, setExpiredAccount] = createSignal<Account | null>(
		null,
	);
	const [activeAccount, setActiveAccount] = createSignal<Account | null>(
		null,
	);

	const refreshState = async () => {
		const active = await getActiveAccount();
		setActiveAccount(active);
		
		if (active?.is_expired) {
			setExpiredAccount(active);
		} else {
			setExpiredAccount(null);
		}
	};

	// Listen for account changes to keep state fresh
	listen("core://accounts-changed", refreshState);
	listen("core://account-heads-updated", refreshState);

	// Check initial state
	refreshState();

	return {
		expiredAccount,
		setExpiredAccount,
		activeAccount,
		refreshState,
	};
}

export const authStore = createRoot(createAuthStore);
