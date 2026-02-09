import { createStore } from "solid-js/store";
import { invoke } from "@tauri-apps/api/core";

export interface PinnedPage {
	id: number;
	page_type: "instance" | "resource" | "settings";
	target_id: string;
	platform: string | null;
	label: string;
	icon_url: string | null;
	order_index: number;
}

export interface NewPinnedPage {
	page_type: "instance" | "resource" | "settings";
	target_id: string;
	platform: string | null;
	label: string;
	icon_url: string | null;
	order_index: number;
}

type PinningState = {
	pins: PinnedPage[];
	loading: boolean;
};

const [pinningState, setPinningState] = createStore<PinningState>({
	pins: [],
	loading: false,
});

export const pinning = pinningState;

export async function initializePinning() {
	setPinningState({ loading: true });
	try {
		const pins = await invoke<PinnedPage[]>("get_pinned_pages");
		setPinningState({ pins, loading: false });
	} catch (e) {
		console.error("Failed to initialize pinning:", e);
		setPinningState({ loading: false });
	}
}

export async function pinPage(newPin: NewPinnedPage) {
	try {
		const pin = await invoke<PinnedPage>("add_pinned_page", { newPin });
		setPinningState("pins", (pins) => [...pins, pin]);
		return pin;
	} catch (e) {
		console.error("Failed to pin page:", e);
		throw e;
	}
}

export async function unpinPage(pinId: number) {
	try {
		await invoke("remove_pinned_page", { pinId });
		setPinningState("pins", (pins) => pins.filter((p) => p.id !== pinId));
	} catch (e) {
		console.error("Failed to unpin page:", e);
		throw e;
	}
}

export async function reorderPins(pinIds: number[]) {
	try {
		await invoke("reorder_pinned_pages", { pinIds });
		// Locally reorder
		const newPins = [...pinningState.pins].sort(
			(a, b) => pinIds.indexOf(a.id) - pinIds.indexOf(b.id),
		);
		setPinningState("pins", newPins);
	} catch (e) {
		console.error("Failed to reorder pins:", e);
	}
}

export function isPinned(type: string, targetId: string) {
	return pinningState.pins.some(
		(p) => p.page_type === type && p.target_id === targetId,
	);
}
