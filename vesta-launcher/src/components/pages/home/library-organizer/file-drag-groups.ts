import type {
	DragObservation,
	DropController,
} from "@utils/file-drop/drop-controller";

/** How long a file must be held over a group before it opens. */
export const FILE_DRAG_GROUP_DWELL_MS = 450;

export interface FileDragGroupOptions {
	controller: Pick<DropController, "observe">;
	getOpenGroup: () => string | null;
	setOpenGroup: (id: string | null) => void;
	/** False while the library is being rearranged: native file drops are off then. */
	isEnabled: () => boolean;
	/** The group a file is currently being held over, for the tile highlight. */
	onHoverGroup: (id: string | null) => void;
	/** A file was released on a group tile that had not opened yet. */
	onDropOnClosedGroup?: (id: string) => void;
	dwellMs?: number;
}

type GroupHit = { kind: "tile" | "popup"; id: string };

/**
 * Only the topmost element counts. Anything above a group, such as the dialog
 * backdrop, means the pointer is not over that group.
 */
function groupAt(hits: Element[]): GroupHit | null {
	const top = hits[0];
	if (!top) {
		return null;
	}
	const popupId = top.closest<HTMLElement>("[data-folder-popup]")?.dataset
		.folderPopup;
	if (popupId) {
		return { kind: "popup", id: popupId };
	}
	const tileId =
		top.closest<HTMLElement>("[data-folder-tile]")?.dataset.folderTile;
	return tileId ? { kind: "tile", id: tileId } : null;
}

/**
 * Lets a file dragged in from the OS open a library group by hovering it, and
 * closes that group again when the pointer leaves it.
 *
 * - Holding a file over a group tile opens it after a short dwell.
 * - A group opened this way closes after the same dwell once the pointer has been
 *   inside it and then moves out (moving back in cancels that), or straight away
 *   when the drag is cancelled.
 * - A group the user opened themselves is never closed by a drag.
 * - After a drop the group stays open: the user chose to be there.
 *
 * Returns a function that stops watching and clears any pending dwell.
 */
export function watchFileDragOverGroups(
	options: FileDragGroupOptions,
): () => void {
	const dwellMs = options.dwellMs ?? FILE_DRAG_GROUP_DWELL_MS;
	let dwellTimer: ReturnType<typeof setTimeout> | undefined;
	let dwellGroup: string | null = null;
	let closeTimer: ReturnType<typeof setTimeout> | undefined;
	let autoOpened: string | null = null;
	// The pointer must reach the opened group before leaving it can close it,
	// because the group opens under a pointer that is still over the tile.
	let entered = false;

	const clearDwell = () => {
		clearTimeout(dwellTimer);
		dwellTimer = undefined;
		if (dwellGroup !== null) {
			dwellGroup = null;
			options.onHoverGroup(null);
		}
	};

	const clearCloseTimer = () => {
		clearTimeout(closeTimer);
		closeTimer = undefined;
	};

	/** Stops treating the open group as drag-owned, without closing it. */
	const releaseAutoOpened = () => {
		clearCloseTimer();
		autoOpened = null;
		entered = false;
	};

	const closeAutoOpened = () => {
		if (autoOpened !== null && options.getOpenGroup() === autoOpened) {
			options.setOpenGroup(null);
		}
		releaseAutoOpened();
	};

	const startDwell = (id: string) => {
		if (dwellGroup === id) {
			return;
		}
		clearTimeout(dwellTimer);
		dwellGroup = id;
		options.onHoverGroup(id);
		dwellTimer = setTimeout(() => {
			dwellTimer = undefined;
			dwellGroup = null;
			options.onHoverGroup(null);
			options.setOpenGroup(id);
			autoOpened = id;
			entered = false;
			clearCloseTimer();
		}, dwellMs);
	};

	const onMove = (observation: DragObservation) => {
		if (!options.isEnabled()) {
			clearDwell();
			return;
		}
		// The user closed the group we opened, or opened another one.
		if (autoOpened !== null && options.getOpenGroup() !== autoOpened) {
			releaseAutoOpened();
		}
		const hit = groupAt(observation.hits);

		if (autoOpened !== null) {
			if (hit?.kind === "popup" && hit.id === autoOpened) {
				entered = true;
				clearCloseTimer();
			} else if (entered && closeTimer === undefined) {
				// Same dwell as opening, so skimming past the edge does not snap it shut.
				closeTimer = setTimeout(closeAutoOpened, dwellMs);
			}
			return;
		}
		if (options.getOpenGroup() !== null) {
			// A group the user opened: leave it alone.
			clearDwell();
			return;
		}
		if (hit?.kind === "tile") {
			startDwell(hit.id);
		} else {
			clearDwell();
		}
	};

	const stop = options.controller.observe((observation) => {
		switch (observation.type) {
			case "move":
				onMove(observation);
				return;
			case "drop": {
				const hit = groupAt(observation.hits);
				clearDwell();
				if (hit?.kind === "tile" && options.getOpenGroup() !== hit.id) {
					options.onDropOnClosedGroup?.(hit.id);
				}
				// The user is now in this group on purpose.
				releaseAutoOpened();
				return;
			}
			case "end":
				clearDwell();
				closeAutoOpened();
				return;
		}
	});

	return () => {
		stop();
		clearDwell();
		releaseAutoOpened();
	};
}
