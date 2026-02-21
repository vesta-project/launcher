import { invoke } from "@tauri-apps/api/core";
import { createStore } from "solid-js/store";
import { resources } from "./resources";

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

		// Background refresh
		refreshPinnedMetadata();
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

export async function updatePinnedMetadata(
	pinId: number,
	newLabel?: string,
	newIconUrl?: string,
) {
	try {
		await invoke("update_pinned_metadata", {
			pinId,
			newLabel,
			newIconUrl,
		});

		// Update local state
		setPinningState("pins", (p) => p.id === pinId, {
			label: newLabel ?? undefined,
			icon_url: newIconUrl ?? undefined,
		});
	} catch (e) {
		console.error("Failed to update pinned metadata:", e);
	}
}

/**
 * Background sync for pinned resources to ensure they have the latest names and icons.
 */
export async function refreshPinnedMetadata() {
	const resourcePins = pinningState.pins.filter(
		(p) => p.page_type === "resource" && p.platform,
	);

	for (const pin of resourcePins) {
		try {
			// This will check cache first
			const project = await resources.getProject(
				pin.platform as any,
				pin.target_id,
			);
			if (!project) continue;

			const needsLabelUpdate = project.name !== pin.label;
			const needsIconUpdate = project.icon_url !== pin.icon_url;

			if (needsLabelUpdate || needsIconUpdate) {
				console.log(`[Pinning] Updating metadata for ${pin.target_id}`);
				await updatePinnedMetadata(
					pin.id,
					needsLabelUpdate ? project.name : undefined,
					needsIconUpdate ? project.icon_url || undefined : undefined,
				);
			}
		} catch (e) {
			console.warn(`[Pinning] Failed to refresh metadata for ${pin.target_id}:`, e);
		}
	}
}
