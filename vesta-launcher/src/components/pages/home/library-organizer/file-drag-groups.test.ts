/**
 * Group hover tests. A fake controller feeds hand-built hit lists, so they check
 * the open/close rules only. They are NOT proof of native OS drag behaviour.
 */
import type {
	DragObservation,
	DragObserver,
} from "@utils/file-drop/drop-controller";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	FILE_DRAG_GROUP_DWELL_MS,
	type FileDragGroupOptions,
	watchFileDragOverGroups,
} from "./file-drag-groups";

function tile(id: string): HTMLElement {
	const section = document.createElement("section");
	section.dataset.folderTile = id;
	const button = document.createElement("button");
	section.append(button);
	document.body.append(section);
	return button;
}

function popup(id: string): HTMLElement {
	const content = document.createElement("div");
	content.dataset.folderPopup = id;
	const card = document.createElement("div");
	content.append(card);
	document.body.append(content);
	return card;
}

function backdrop(): HTMLElement {
	const overlay = document.createElement("div");
	document.body.append(overlay);
	return overlay;
}

function harness(overrides: Partial<FileDragGroupOptions> = {}) {
	let observer: DragObserver | undefined;
	let open: string | null = null;
	const hovered: Array<string | null> = [];
	const dropsOnClosed: string[] = [];
	const options: FileDragGroupOptions = {
		controller: {
			observe: (next) => {
				observer = next;
				return () => {
					observer = undefined;
				};
			},
		},
		getOpenGroup: () => open,
		setOpenGroup: (id) => {
			open = id;
		},
		isEnabled: () => true,
		onHoverGroup: (id) => hovered.push(id),
		onDropOnClosedGroup: (id) => dropsOnClosed.push(id),
		...overrides,
	};
	const stop = watchFileDragOverGroups(options);
	const emit = (observation: DragObservation) => observer?.(observation);
	return {
		stop,
		hovered,
		dropsOnClosed,
		get open() {
			return open;
		},
		set open(value: string | null) {
			open = value;
		},
		get watching() {
			return observer !== undefined;
		},
		move: (...hits: Element[]) => emit({ type: "move", point: null, hits }),
		drop: (...hits: Element[]) => emit({ type: "drop", point: null, hits }),
		end: () => emit({ type: "end", point: null, hits: [] }),
	};
}

beforeEach(() => {
	document.body.innerHTML = "";
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

describe("opening a group", () => {
	it("opens a group after the pointer dwells on its tile", () => {
		const h = harness();
		h.move(tile("g1"));
		expect(h.open).toBeNull();
		expect(h.hovered).toEqual(["g1"]);

		vi.advanceTimersByTime(FILE_DRAG_GROUP_DWELL_MS);
		expect(h.open).toBe("g1");
		expect(h.hovered).toEqual(["g1", null]);
	});

	it("keeps one timer while the pointer moves within the same tile", () => {
		const h = harness();
		const button = tile("g1");
		h.move(button);
		vi.advanceTimersByTime(FILE_DRAG_GROUP_DWELL_MS - 50);
		h.move(button);
		vi.advanceTimersByTime(50);
		expect(h.open).toBe("g1");
	});

	it("does not open when the pointer leaves the tile before the dwell ends", () => {
		const h = harness();
		h.move(tile("g1"));
		vi.advanceTimersByTime(FILE_DRAG_GROUP_DWELL_MS - 1);
		h.move(backdrop());
		vi.advanceTimersByTime(1000);
		expect(h.open).toBeNull();
		expect(h.hovered).toEqual(["g1", null]);
	});

	it("restarts the dwell when the pointer moves to a different tile", () => {
		const h = harness();
		h.move(tile("g1"));
		vi.advanceTimersByTime(300);
		h.move(tile("g2"));
		vi.advanceTimersByTime(300);
		expect(h.open).toBeNull();
		vi.advanceTimersByTime(150);
		expect(h.open).toBe("g2");
	});

	it("does nothing while disabled, such as in edit mode", () => {
		const h = harness({ isEnabled: () => false });
		h.move(tile("g1"));
		vi.advanceTimersByTime(5000);
		expect(h.open).toBeNull();
		expect(h.hovered).toEqual([]);
	});

	it("only looks at the topmost element, so a backdrop over a tile blocks it", () => {
		const h = harness();
		h.move(backdrop(), tile("g1"));
		vi.advanceTimersByTime(5000);
		expect(h.open).toBeNull();
	});
});

describe("closing an auto-opened group", () => {
	function openedByDrag() {
		const h = harness();
		h.move(tile("g1"));
		vi.advanceTimersByTime(FILE_DRAG_GROUP_DWELL_MS);
		return h;
	}

	it("stays open until the pointer has been inside it", () => {
		const h = openedByDrag();
		// The group opens under a pointer that is still over the backdrop.
		h.move(backdrop());
		h.move(backdrop());
		expect(h.open).toBe("g1");
	});

	it("closes after the dwell once the pointer moves out after having been inside", () => {
		const h = openedByDrag();
		h.move(popup("g1"));
		expect(h.open).toBe("g1");
		h.move(backdrop());
		expect(h.open).toBe("g1");

		vi.advanceTimersByTime(FILE_DRAG_GROUP_DWELL_MS - 1);
		expect(h.open).toBe("g1");
		vi.advanceTimersByTime(1);
		expect(h.open).toBeNull();
	});

	it("does not restart the close delay while the pointer stays outside", () => {
		const h = openedByDrag();
		h.move(popup("g1"));
		h.move(backdrop());
		vi.advanceTimersByTime(300);
		h.move(backdrop());
		vi.advanceTimersByTime(150);
		expect(h.open).toBeNull();
	});

	it("stays open if the pointer comes back before the delay ends", () => {
		const h = openedByDrag();
		const inside = popup("g1");
		h.move(inside);
		h.move(backdrop());
		vi.advanceTimersByTime(FILE_DRAG_GROUP_DWELL_MS - 100);
		h.move(inside);
		vi.advanceTimersByTime(5000);
		expect(h.open).toBe("g1");
	});

	it("starts a fresh delay each time the pointer leaves again", () => {
		const h = openedByDrag();
		const inside = popup("g1");
		h.move(inside);
		h.move(backdrop());
		vi.advanceTimersByTime(300);
		h.move(inside);
		h.move(backdrop());
		vi.advanceTimersByTime(300);
		expect(h.open).toBe("g1");
		vi.advanceTimersByTime(150);
		expect(h.open).toBeNull();
	});

	it("a drop during the close delay keeps the group open", () => {
		const h = openedByDrag();
		h.move(popup("g1"));
		h.move(backdrop());
		h.drop(backdrop());
		vi.advanceTimersByTime(5000);
		expect(h.open).toBe("g1");
	});

	it("a group the user switched away from is not closed by a pending delay", () => {
		const h = openedByDrag();
		h.move(popup("g1"));
		h.move(backdrop());
		h.open = "g2";
		h.move(backdrop());
		vi.advanceTimersByTime(5000);
		expect(h.open).toBe("g2");
	});

	it("stays open while the pointer moves between elements inside the group", () => {
		const h = openedByDrag();
		const inside = popup("g1");
		h.move(inside);
		h.move(inside.parentElement as HTMLElement);
		h.move(inside);
		expect(h.open).toBe("g1");
	});

	it("closes when the drag is cancelled or leaves the window", () => {
		const h = openedByDrag();
		h.move(popup("g1"));
		h.end();
		expect(h.open).toBeNull();
	});

	it("closes on cancel even if the pointer never entered the group", () => {
		const h = openedByDrag();
		h.end();
		expect(h.open).toBeNull();
	});

	it("keeps the group open after a drop", () => {
		const h = openedByDrag();
		const inside = popup("g1");
		h.move(inside);
		h.drop(inside);
		expect(h.open).toBe("g1");
		// A later drag does not close it either: it is no longer drag-owned.
		h.move(backdrop());
		h.end();
		expect(h.open).toBe("g1");
	});

	it("never closes a group the user opened themselves", () => {
		const h = harness();
		h.open = "g1";
		h.move(popup("g1"));
		h.move(backdrop());
		h.end();
		expect(h.open).toBe("g1");
	});

	it("does not start opening another group while a user-opened one is showing", () => {
		const h = harness();
		h.open = "g1";
		h.move(tile("g2"));
		vi.advanceTimersByTime(5000);
		expect(h.open).toBe("g1");
	});

	it("forgets a group the user closed by hand, so it is not closed again later", () => {
		const h = openedByDrag();
		h.move(popup("g1"));
		h.open = null;
		h.move(popup("g1"));
		h.open = "g2";
		h.move(backdrop());
		expect(h.open).toBe("g2");
	});
});

describe("drops and cleanup", () => {
	it("reports a drop on a tile that has not opened yet and cancels its dwell", () => {
		const h = harness();
		const button = tile("g1");
		h.move(button);
		h.drop(button);
		vi.advanceTimersByTime(5000);
		expect(h.dropsOnClosed).toEqual(["g1"]);
		expect(h.open).toBeNull();
	});

	it("does not report a drop that lands inside an open group", () => {
		const h = harness();
		h.open = "g1";
		h.drop(popup("g1"));
		expect(h.dropsOnClosed).toEqual([]);
	});

	it("stop unsubscribes and cancels a pending dwell", () => {
		const h = harness();
		h.move(tile("g1"));
		h.stop();
		vi.advanceTimersByTime(5000);
		expect(h.open).toBeNull();
		expect(h.watching).toBe(false);
	});
});
