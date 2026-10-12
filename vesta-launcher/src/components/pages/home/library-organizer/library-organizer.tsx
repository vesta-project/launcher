import CloseIcon from "@assets/icons/actions/close.svg";
import EllipsisIcon from "@assets/icons/controls/ellipsis-horizontal.svg";
import { pageViewerOpen } from "@components/page-viewer/page-viewer";
import InstanceCard from "@components/pages/home/instance-card/instance-card";
import * as DialogPrimitive from "@kobalte/core/dialog";
import { instances } from "@stores/instances";
import {
	createLibraryGroup,
	customLibraryOrder,
	endLibraryEdit,
	type LibraryEntry,
	type LibraryGroup,
	type LibraryLayout,
	libraryEditing,
	libraryLayout,
	librarySaveError,
	moveLibraryEntry,
	renameLibraryGroup,
	restoreLibraryLayout,
	setLibraryGroupColor,
	sortLibraryInstances,
} from "@stores/library-layout";
import {
	type CollisionDetector,
	createDraggable,
	createDroppable,
	DragDropProvider,
	DragDropSensors,
	type DragEvent,
	type Draggable,
	type Droppable,
	useDragDropContext,
} from "@thisbeyond/solid-dnd";
import {
	type DropTarget,
	DropTargetHint,
	dropTargetForZoneState,
} from "@ui/drop-target/drop-target";
import { DropZone } from "@ui/drop-zone/drop-zone";
import { Popover, PopoverContent, PopoverTrigger } from "@ui/popover/popover";
import { showToast } from "@ui/toast/toast";
import { resolveResourceUrl } from "@utils/assets";
import {
	addDroppedMods,
	canAcceptDroppedMods,
	DROPPED_MOD_EXTENSIONS,
	notifyDroppedModsRejected,
} from "@utils/dropped-mods";
import type { DropZoneState } from "@utils/file-drop/drop-controller";
import { getDropController } from "@utils/file-drop/native-bridge";
import {
	createIconPosterFrame,
	isAnimatedIconSource,
} from "@utils/icon-animation";
import { type Instance, resolveInstanceDisplayIcon } from "@utils/instances";
import {
	createEffect,
	createMemo,
	createSignal,
	For,
	on,
	onCleanup,
	Show,
} from "solid-js";
import { Portal } from "solid-js/web";
import { watchFileDragOverGroups } from "./file-drag-groups";
import styles from "./library-organizer.module.css";

// How long a card must be held over another's middle before it becomes a folder,
// and how long the grid is left to finish animating after a live reorder.
const GROUP_DWELL_MS = 160;
const SETTLE_MS = 240;
// Preview size while carried, and once held over a card that would form a folder.
const CARRY_SCALE = 0.9;
const GROUP_SCALE = 0.55;

const reduceMotion = () =>
	window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
	document.documentElement.dataset.reducedMotion === "true";

export default function LibraryOrganizer() {
	const editing = libraryEditing;
	const [openGroup, setOpenGroup] = createSignal<string | null>(null);
	const [pointerPosition, setPointerPosition] = createSignal({ x: 0, y: 0 });
	const [groupTarget, setGroupTarget] = createSignal<number | null>(null);
	const [groupPending, setGroupPending] = createSignal<number | null>(null);
	const [folderTarget, setFolderTarget] = createSignal<string | null>(null);
	const [announcement, setAnnouncement] = createSignal("");
	let over: Droppable | null = null;
	let dragged: Draggable | null = null;
	let dragSnapshot: LibraryLayout | null = null;
	let dwellTimer: ReturnType<typeof setTimeout> | undefined;
	let settleTimer: ReturnType<typeof setTimeout> | undefined;
	let settling = false;
	let refreshLayouts: (() => void) | undefined;
	let suppressClickUntil = 0;
	let cancelled = false;
	let pointer = { x: 0, y: 0 };
	let scrollFrame = 0;

	const mutate = (action: () => void) => {
		const positions = new Map<
			string,
			{ rect: DOMRect; surface: Element | null }
		>();
		if (!reduceMotion())
			document
				.querySelectorAll<HTMLElement>("[data-library-item]")
				.forEach((node) => {
					if (node.dataset.libraryItem)
						positions.set(node.dataset.libraryItem, {
							rect: node.getBoundingClientRect(),
							surface: node.closest("[data-folder-popup]"),
						});
				});
		action();
		requestAnimationFrame(() => {
			document
				.querySelectorAll<HTMLElement>("[data-library-item]")
				.forEach((node) => {
					const previous = positions.get(node.dataset.libraryItem ?? "");
					// Reorder within a surface; cross-folder drops use the pointer preview.
					if (
						!previous ||
						previous.surface !== node.closest("[data-folder-popup]")
					)
						return;
					const current = node.getBoundingClientRect();
					const deltaX = previous.rect.x - current.x;
					const deltaY = previous.rect.y - current.y;
					if (Math.abs(deltaX) + Math.abs(deltaY) < 1) return;
					node.animate(
						[
							{ transform: `translate(${deltaX}px, ${deltaY}px)` },
							{ transform: "translate(0, 0)" },
						],
						{ duration: 260, easing: "cubic-bezier(.22, 1, .36, 1)" },
					);
				});
		});
	};
	const toggleGroup = (id: string) =>
		setOpenGroup((current) => (current === id ? null : id));
	// Files dragged in from the OS open a group while hovered and close it again
	// when the pointer leaves. Separate from the pointer-driven reordering below.
	const [fileHoverGroup, setFileHoverGroup] = createSignal<string | null>(null);
	onCleanup(
		watchFileDragOverGroups({
			controller: getDropController(),
			getOpenGroup: openGroup,
			setOpenGroup,
			isEnabled: () => !editing(),
			onHoverGroup: setFileHoverGroup,
			onDropOnClosedGroup: () =>
				showToast({
					title: "Open the group first",
					description: "Drop the mod onto an instance inside the group.",
					severity: "info",
				}),
		}),
	);
	createEffect(
		on(
			editing,
			(isEditing) => {
				if (isEditing) {
					setAnnouncement(
						"Edit mode. Drag cards to move them. Hold one over the middle of another to group them. Arrow keys move a focused card.",
					);
					return;
				}
				// Commit a pending group rename before the input turns read-only.
				if (document.activeElement instanceof HTMLInputElement)
					document.activeElement.blur();
				setAnnouncement("Arrangement saved.");
			},
			{ defer: true },
		),
	);
	createEffect(() => {
		const id = openGroup();
		if (id && !libraryLayout().groups.some((group) => group.id === id))
			setOpenGroup(null);
	});
	createEffect(() => {
		if (pageViewerOpen()) {
			setOpenGroup(null);
			endLibraryEdit();
		}
	});

	const clearIntent = () => {
		clearTimeout(dwellTimer);
		setGroupPending(null);
		setGroupTarget(null);
		setFolderTarget(null);
	};
	const clearHover = () => {
		clearIntent();
		clearTimeout(settleTimer);
		settling = false;
		over = null;
		dragged = null;
	};
	// Re-measure only once the reorder animation is over: mid-animation rects
	// include the transform and would point at the wrong cards.
	const settle = () => {
		settling = true;
		clearTimeout(settleTimer);
		settleTimer = setTimeout(
			() => {
				settling = false;
				refreshLayouts?.();
			},
			reduceMotion() ? 60 : SETTLE_MS,
		);
	};
	const pointerWithin = (box: {
		left: number;
		right: number;
		top: number;
		bottom: number;
	}) =>
		pointer.x >= box.left &&
		pointer.x <= box.right &&
		pointer.y >= box.top &&
		pointer.y <= box.bottom;
	// The folder the pointer is over, or null when it is over the library itself.
	const surfaceAt = (): string | null => {
		const popup = document.querySelector<HTMLElement>("[data-folder-popup]");
		return popup && pointerWithin(popup.getBoundingClientRect())
			? popup.dataset.folderPopup || null
			: null;
	};
	// The card or folder closest to the pointer within one container, and which
	// side of it the pointer is on. Used when a drop lands between items.
	const nearestSlot = (container: string | null, exclude: LibraryEntry) => {
		const scroller = container
			? document.querySelector<HTMLElement>("[data-folder-popup]")
			: [
					...document.querySelectorAll<HTMLElement>("[data-library-scroll]"),
				].find((node) => !node.closest("[data-folder-popup]"));
		if (!scroller || !pointerWithin(scroller.getBoundingClientRect()))
			return null;
		let best: { entry: LibraryEntry; after: boolean } | null = null;
		let bestDistance = Number.POSITIVE_INFINITY;
		document
			.querySelectorAll<HTMLElement>("[data-library-item]")
			.forEach((node) => {
				if (!!node.closest("[data-folder-popup]") !== (container !== null))
					return;
				const id = node.dataset.libraryItem ?? "";
				const entry: LibraryEntry = id.startsWith("instance:")
					? Number(id.slice("instance:".length))
					: id;
				if (entry === exclude) return;
				const box = node.getBoundingClientRect();
				const distance = Math.hypot(
					Math.max(box.left - pointer.x, 0, pointer.x - box.right),
					Math.max(box.top - pointer.y, 0, pointer.y - box.bottom),
				);
				if (distance >= bestDistance) return;
				bestDistance = distance;
				best = {
					entry,
					after:
						pointer.y > box.bottom ||
						(pointer.y >= box.top && pointer.x > box.left + box.width / 2),
				};
			});
		return best as { entry: LibraryEntry; after: boolean } | null;
	};
	const reorderLive = (
		entry: LibraryEntry,
		target: LibraryEntry,
		container: string | null,
		after: boolean,
	) => {
		const siblings: LibraryEntry[] = container
			? (libraryLayout().groups.find((group) => group.id === container)
					?.instances ?? [])
			: customLibraryOrder(instances());
		const next = siblings.filter((id) => id !== entry);
		const targetIndex = next.indexOf(target);
		if (targetIndex < 0) return;
		next.splice(targetIndex + (after ? 1 : 0), 0, entry);
		if (next.every((id, index) => id === siblings[index])) return;
		const before = next[next.indexOf(entry) + 1] ?? null;
		settle();
		mutate(() => moveLibraryEntry(entry, container, before, instances()));
	};
	// Like a phone's home screen: the edges of a card reorder immediately, while
	// holding on its middle turns the pair into a folder. Drops across different
	// containers (into or out of a folder) are resolved when released.
	const updateIntent = () => {
		const current = over;
		if (!dragged || settling) {
			clearIntent();
			return;
		}
		const entry: LibraryEntry =
			dragged.data.kind === "group"
				? (dragged.id as string)
				: dragged.data.instanceId;
		const container: string | null =
			dragged.data.kind === "instance" ? (dragged.data.groupId ?? null) : null;
		const overEntry: LibraryEntry | null = !current
			? null
			: current.data.kind === "instance"
				? current.data.instanceId
				: (current.data.folderId ?? null);
		if (!current || overEntry === null) {
			// A gap or empty space: land in the nearest slot of the same container.
			clearIntent();
			if (
				container !== surfaceAt() ||
				pointerWithin(dragged.node.getBoundingClientRect())
			)
				return;
			const slot = nearestSlot(container, entry);
			if (slot) reorderLive(entry, slot.entry, container, slot.after);
			return;
		}
		const overContainer: string | null =
			current.data.kind === "instance" ? (current.data.groupId ?? null) : null;
		if (container !== overContainer) {
			clearIntent();
			return;
		}
		const box = current.layout;
		const middle =
			pointer.x >= box.left + box.width / 4 &&
			pointer.x <= box.right - box.width / 4 &&
			pointer.y >= box.top + box.height / 4 &&
			pointer.y <= box.bottom - box.height / 4;
		const droppingIn = dragged.data.kind === "instance" && container === null;
		if (middle && droppingIn) {
			// An existing folder takes the card straight away; only cards dwell.
			if (current.data.kind !== "instance") {
				const folder = current.data.folderId as string;
				if (folderTarget() === folder) return;
				clearIntent();
				setFolderTarget(folder);
				return;
			}
			const id = current.data.instanceId;
			if (groupPending() === id) return;
			clearIntent();
			setGroupPending(id);
			dwellTimer = setTimeout(() => setGroupTarget(id), GROUP_DWELL_MS);
			return;
		}
		clearIntent();
		reorderLive(entry, overEntry, container, pointer.x > box.center.x);
	};
	const collisionDetector: CollisionDetector = (dragged, targets) => {
		if (!editing()) return null;
		const popup = document
			.querySelector<HTMLElement>("[data-folder-popup]")
			?.getBoundingClientRect();
		const overPopup =
			popup &&
			pointer.x >= popup.left &&
			pointer.x <= popup.right &&
			pointer.y >= popup.top &&
			pointer.y <= popup.bottom;
		return (
			targets
				.filter((target) => {
					if (target.id === dragged.id) return false;
					if (target.data.kind === "end") return false;
					if (overPopup && !target.node.closest("[data-folder-popup]"))
						return false;
					// Dragging out of a folder only ever drops back onto the library.
					if (dragged.data.groupId && !overPopup) return false;
					const scrollBounds = target.node
						.closest<HTMLElement>("[data-library-scroll]")
						?.getBoundingClientRect();
					if (
						scrollBounds &&
						(pointer.y < scrollBounds.top ||
							pointer.y > scrollBounds.bottom ||
							pointer.x < scrollBounds.left ||
							pointer.x > scrollBounds.right)
					)
						return false;
					if (dragged.data.kind === "group" && target.data.groupId)
						return false;
					const box = target.layout;
					return (
						pointer.x >= box.left &&
						pointer.x <= box.right &&
						pointer.y >= box.top &&
						pointer.y <= box.bottom
					);
				})
				.sort(
					(a, b) =>
						a.layout.width * a.layout.height - b.layout.width * b.layout.height,
				)[0] ?? null
		);
	};
	const dragOver = ({ draggable, droppable }: DragEvent) => {
		dragged = draggable;
		over = droppable ?? null;
		updateIntent();
	};
	const dragEnd = ({ draggable, droppable }: DragEvent) => {
		cancelAnimationFrame(scrollFrame);
		suppressClickUntil = Date.now() + 250;
		const createGroup = groupTarget();
		const intoFolder = folderTarget();
		// A live reorder just happened; the cached drop layout is out of date.
		const justReordered = settling;
		const snapshot = dragSnapshot;
		dragSnapshot = null;
		clearHover();
		if (cancelled) {
			if (snapshot) mutate(() => restoreLibraryLayout(snapshot));
			return;
		}
		if (!droppable) {
			const popup = document
				.querySelector<HTMLElement>("[data-folder-popup]")
				?.getBoundingClientRect();
			if (
				draggable.data.groupId &&
				popup &&
				(pointer.x < popup.left ||
					pointer.x > popup.right ||
					pointer.y < popup.top ||
					pointer.y > popup.bottom)
			) {
				const slot = nearestSlot(null, draggable.data.instanceId);
				const order = customLibraryOrder(instances());
				const before = slot
					? (order[order.indexOf(slot.entry) + (slot.after ? 1 : 0)] ?? null)
					: null;
				mutate(() =>
					moveLibraryEntry(
						draggable.data.instanceId,
						null,
						before,
						instances(),
					),
				);
				setAnnouncement("Instance moved out of the folder.");
			}
			return;
		}
		if (justReordered && createGroup === null) return;
		// Dropped on a folder's edge: that was a reorder, which already happened live.
		if (
			draggable.data.kind === "instance" &&
			droppable.data.folderId &&
			droppable.data.folderId !== intoFolder
		)
			return;
		mutate(() => {
			if (createGroup !== null && createGroup === droppable.data.instanceId) {
				const id = createLibraryGroup(instances(), [
					createGroup,
					draggable.data.instanceId,
				]);
				setOpenGroup(id);
				setAnnouncement("Group created.");
			} else {
				const entry: LibraryEntry =
					draggable.data.kind === "group"
						? (draggable.id as string)
						: draggable.data.instanceId;
				const targetGroup =
					draggable.data.kind === "group"
						? null
						: droppable.data.kind === "group"
							? (droppable.data.folderId ??
								droppable.data.groupId ??
								droppable.id)
							: (droppable.data.groupId ?? null);
				let before: LibraryEntry | null =
					droppable.data.kind === "instance"
						? droppable.data.instanceId
						: draggable.data.kind === "group" && droppable.data.kind === "group"
							? (droppable.id as string)
							: null;
				// The right half inserts after the card, the left half before it.
				if (
					droppable.data.kind === "instance" &&
					pointer.x > droppable.layout.center.x
				) {
					const siblings = targetGroup
						? (libraryLayout().groups.find((group) => group.id === targetGroup)
								?.instances ?? [])
						: customLibraryOrder(instances());
					const remaining = siblings.filter((id) => id !== entry);
					before =
						remaining[remaining.indexOf(droppable.data.instanceId) + 1] ?? null;
				}
				moveLibraryEntry(entry, targetGroup, before, instances());
				setAnnouncement("Arrangement saved.");
			}
		});
	};

	onCleanup(() => {
		clearHover();
		cancelAnimationFrame(scrollFrame);
	});

	return (
		<DragDropProvider
			collisionDetector={collisionDetector}
			onDragOver={dragOver}
			onDragEnd={dragEnd}
		>
			<DragDropSensors />
			<DragLifecycle
				onStart={(draggable) => {
					cancelled = false;
					dragSnapshot = libraryLayout();
					dragged = draggable;
					over = null;
				}}
				onReady={(refresh) => {
					refreshLayouts = refresh;
				}}
				onPointer={(point) => {
					pointer = point;
					setPointerPosition(point);
					updateIntent();
				}}
				onScroll={(frame) => {
					scrollFrame = frame;
				}}
				onCancel={() => {
					cancelled = true;
					clearHover();
				}}
				onDone={() => (openGroup() ? setOpenGroup(null) : endLibraryEdit())}
				editing={editing()}
			/>
			<LibraryEntries
				editing={editing()}
				closeFolder={() => setOpenGroup(null)}
				groupTarget={groupTarget()}
				groupPending={groupPending()}
				folderTarget={folderTarget()}
				fileHoverGroup={fileHoverGroup()}
				openGroup={openGroup()}
				toggleGroup={toggleGroup}
				mutate={mutate}
				suppressClick={() => Date.now() < suppressClickUntil}
				announce={setAnnouncement}
			/>
			<Show when={librarySaveError()}>
				<p class={styles.saveError} role="alert">
					Your arrangement could not be saved. Changes may be lost when the
					launcher closes.
				</p>
			</Show>
			<span class={styles.srOnly} role="status" aria-live="polite">
				{announcement()}
			</span>
			<DragPreview
				pointer={pointerPosition()}
				shrink={groupPending() !== null || folderTarget() !== null}
			/>
		</DragDropProvider>
	);
}

// Use the library's pointer sensor; native HTML file dragging remains separate.
function DragLifecycle(props: {
	editing: boolean;
	onStart: (draggable: Draggable) => void;
	onReady: (refresh: () => void) => void;
	onPointer: (point: { x: number; y: number }) => void;
	onScroll: (frame: number) => void;
	onCancel: () => void;
	onDone: () => void;
}) {
	const context = useDragDropContext();
	if (!context) return null;
	const [state, actions] = context;
	let frame = 0;
	const scroll = () => {
		if (!state.active.draggable) return;
		const point = state.active.sensor?.coordinates.current;
		const scroller = point
			? document
					.elementsFromPoint(point.x, point.y)
					.map((node) => node.closest<HTMLElement>("[data-library-scroll]"))
					.find((node) => node !== null)
			: null;
		const y = state.active.sensor?.coordinates.current.y;
		if (scroller && y !== undefined) {
			const box = scroller.getBoundingClientRect();
			const delta =
				y < box.top + 60
					? -Math.min(14, (box.top + 60 - y) / 4)
					: y > box.bottom - 60
						? Math.min(14, (y - box.bottom + 60) / 4)
						: 0;
			if (delta) {
				scroller.scrollTop += delta;
				actions.recomputeLayouts();
				actions.detectCollisions();
			}
		}
		frame = requestAnimationFrame(scroll);
		props.onScroll(frame);
	};
	props.onReady(() => {
		actions.recomputeLayouts();
		actions.detectCollisions();
	});
	actions.onDragStart(({ draggable }) => {
		props.onStart(draggable);
		actions.recomputeLayouts();
		frame = requestAnimationFrame(scroll);
		props.onScroll(frame);
	});
	const pointer = (event: PointerEvent) => {
		props.onPointer({ x: event.clientX, y: event.clientY });
	};
	const cancel = () => {
		if (!state.active.draggable) return;
		props.onCancel();
		actions.dragEnd();
		actions.sensorEnd();
		cancelAnimationFrame(frame);
	};
	const key = (event: KeyboardEvent) => {
		if (event.key !== "Escape") return;
		if (state.active.draggable) {
			event.preventDefault();
			cancel();
		} else if (props.editing && !event.defaultPrevented) props.onDone();
	};
	document.addEventListener("pointermove", pointer, true);
	document.addEventListener("pointerdown", pointer, true);
	document.addEventListener("pointercancel", cancel);
	document.addEventListener("keydown", key);
	window.addEventListener("blur", cancel);
	onCleanup(() => {
		cancelAnimationFrame(frame);
		document.removeEventListener("pointermove", pointer, true);
		document.removeEventListener("pointerdown", pointer, true);
		document.removeEventListener("pointercancel", cancel);
		document.removeEventListener("keydown", key);
		window.removeEventListener("blur", cancel);
	});
	return null;
}

interface EntriesProps {
	editing: boolean;
	closeFolder: () => void;
	groupTarget: number | null;
	groupPending: number | null;
	folderTarget: string | null;
	fileHoverGroup: string | null;
	openGroup: string | null;
	toggleGroup: (id: string) => void;
	mutate: (action: () => void) => void;
	suppressClick: () => boolean;
	announce: (message: string) => void;
}

function LibraryEntries(props: EntriesProps) {
	const instanceMap = createMemo(
		() => new Map(instances().map((instance) => [instance.id, instance])),
	);
	const groupMembers = (group: LibraryGroup) => {
		const members = group.instances
			.map((id) => instanceMap().get(id))
			.filter((instance): instance is Instance => !!instance);
		return libraryLayout().sort === "custom"
			? members
			: sortLibraryInstances(members);
	};
	const entries = createMemo(() => {
		const order = customLibraryOrder(instances());
		if (libraryLayout().sort === "custom") return order;
		const sorted = sortLibraryInstances(instances());
		const rank = new Map(sorted.map((instance, index) => [instance.id, index]));
		const score = (entry: LibraryEntry) =>
			typeof entry === "number"
				? (rank.get(entry) ?? Infinity)
				: Math.min(
						...(libraryLayout()
							.groups.find((group) => group.id === entry)
							?.instances.map((id) => rank.get(id) ?? Infinity) ?? []),
					);
		return [...order].sort((a, b) => {
			if (libraryLayout().sort === "name") {
				const name = (entry: LibraryEntry) =>
					typeof entry === "number"
						? (instanceMap().get(entry)?.name ?? "")
						: (libraryLayout().groups.find((group) => group.id === entry)
								?.name ?? "");
				return name(a).localeCompare(name(b), undefined, {
					numeric: true,
					sensitivity: "base",
				});
			}
			return score(a) - score(b);
		});
	});
	return (
		<For each={entries()}>
			{(entry) =>
				typeof entry === "number" ? (
					<Show when={instanceMap().get(entry)}>
						{(instance) => (
							<MovableCard {...props} instance={instance()} groupId={null} />
						)}
					</Show>
				) : (
					<Show
						when={libraryLayout().groups.find((group) => group.id === entry)}
					>
						{(group) => (
							<Folder
								{...props}
								group={group()}
								members={groupMembers(group())}
							/>
						)}
					</Show>
				)
			}
		</For>
	);
}

function MovableCard(
	props: EntriesProps & { instance: Instance; groupId: string | null },
) {
	const draggable = createDraggable(`instance:${props.instance.id}`, {
		kind: "instance",
		instanceId: props.instance.id,
		get groupId() {
			return props.groupId;
		},
	});
	const droppable = createDroppable(`instance:${props.instance.id}`, {
		kind: "instance",
		instanceId: props.instance.id,
		get groupId() {
			return props.groupId;
		},
	});
	const [open, setOpen] = createSignal(false);
	const [dropState, setDropState] = createSignal<DropZoneState>("idle");
	// One drop-target look for everything dropped on a card: a card being grouped
	// with it, or a file from the OS.
	const dropTarget = (): DropTarget | undefined => {
		if (props.groupTarget === props.instance.id)
			return { state: "ready", label: "Release to group" };
		if (props.groupPending === props.instance.id) return { state: "pending" };
		const state = dropTargetForZoneState(dropState());
		if (state === "ready") return { state, label: "Add mod" };
		if (state === "rejected") return { state, label: "Only .jar files" };
	};
	const move = (groupId: string | null) => {
		props.mutate(() =>
			moveLibraryEntry(props.instance.id, groupId, null, instances()),
		);
		setOpen(false);
		props.announce(`${props.instance.name} moved.`);
	};
	const step = (direction: number) => {
		const siblings = props.groupId
			? (libraryLayout().groups.find((group) => group.id === props.groupId)
					?.instances ?? [])
			: customLibraryOrder(instances());
		const index = siblings.indexOf(props.instance.id);
		if (index + direction < 0 || index + direction >= siblings.length) return;
		props.mutate(() =>
			moveLibraryEntry(
				props.instance.id,
				props.groupId,
				direction < 0 ? siblings[index - 1] : (siblings[index + 2] ?? null),
				instances(),
			),
		);
		props.announce(
			`${props.instance.name} moved ${direction < 0 ? "earlier" : "later"}.`,
		);
	};
	return (
		// Native OS file drops (external). Separate from the pointer-driven
		// reordering, which only reacts to in-app drags. The card draws its own
		// drop state, so the zone's built-in highlight is off.
		<DropZone
			unstyled
			accept="files"
			allowedExtensions={DROPPED_MOD_EXTENSIONS}
			disabled={props.editing || !canAcceptDroppedMods(props.instance)}
			onFileDrop={(paths) => void addDroppedMods(props.instance, paths)}
			onFilesRejected={notifyDroppedModsRejected}
			onStateChange={setDropState}
		>
			<div
				ref={(node) => {
					draggable.ref(node);
					droppable.ref(node);
					const suppress = (event: MouseEvent) => {
						if (props.suppressClick()) {
							event.preventDefault();
							event.stopPropagation();
						}
					};
					node.addEventListener("click", suppress, true);
					onCleanup(() => node.removeEventListener("click", suppress, true));
				}}
				class={styles.card}
				data-library-item={`instance:${props.instance.id}`}
				data-editing={props.editing}
				data-dragging={draggable.isActiveDraggable}
				data-drop-target={dropTarget()?.state}
			>
				<div class={styles.cardContent} inert={props.editing}>
					<InstanceCard
						instance={props.instance}
						onNavigate={props.closeFolder}
					/>
				</div>
				<Show when={props.editing}>
					<button
						type="button"
						class={styles.cardHandle}
						{...draggable.dragActivators}
						aria-label={`Move ${props.instance.name}. Arrow keys reorder.`}
						onKeyDown={(event) => {
							if (
								["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"].includes(
									event.key,
								)
							) {
								event.preventDefault();
								step(["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 1);
							}
						}}
					/>
					<Popover open={open()} onOpenChange={setOpen} placement="bottom">
						<PopoverTrigger
							data-edit-control
							class={styles.cardMore}
							aria-label={`Group options for ${props.instance.name}`}
						>
							<EllipsisIcon />
						</PopoverTrigger>
						<PopoverContent
							class={styles.menu}
							aria-label={`Group options for ${props.instance.name}`}
						>
							<Show when={props.groupId}>
								<button
									type="button"
									class={styles.menuItem}
									onClick={() => move(null)}
								>
									Remove from group
								</button>
							</Show>
							<For
								each={libraryLayout().groups.filter(
									(group) => group.id !== props.groupId,
								)}
							>
								{(group) => (
									<button
										type="button"
										class={styles.menuItem}
										onClick={() => move(group.id)}
									>
										Move to {group.name}
									</button>
								)}
							</For>
							<button
								type="button"
								class={styles.menuItem}
								onClick={() => {
									props.mutate(() =>
										createLibraryGroup(instances(), [props.instance.id]),
									);
									setOpen(false);
								}}
							>
								Add to a new group
							</button>
							<div class={styles.divider} />
							<button
								type="button"
								class={styles.menuItem}
								onClick={() => step(-1)}
							>
								Move earlier
							</button>
							<button
								type="button"
								class={styles.menuItem}
								onClick={() => step(1)}
							>
								Move later
							</button>
						</PopoverContent>
					</Popover>
				</Show>
				<DropTargetHint target={dropTarget()} />
			</div>
		</DropZone>
	);
}

function Folder(
	props: EntriesProps & { group: LibraryGroup; members: Instance[] },
) {
	const draggable = createDraggable(props.group.id, { kind: "group" });
	const droppable = createDroppable(props.group.id, {
		kind: "group",
		folderId: props.group.id,
	});
	// Same drop-target look as a card, without a label: a card released here, or a
	// file held over it long enough to open.
	const dropTarget = (): DropTarget | undefined => {
		if (props.folderTarget === props.group.id) return { state: "ready" };
		if (props.fileHoverGroup === props.group.id) return { state: "pending" };
	};
	const step = (direction: number) => {
		const order = customLibraryOrder(instances());
		const index = order.indexOf(props.group.id);
		if (index + direction < 0 || index + direction >= order.length) return;
		props.mutate(() =>
			moveLibraryEntry(
				props.group.id,
				null,
				direction < 0 ? order[index - 1] : (order[index + 2] ?? null),
				instances(),
			),
		);
	};
	return (
		<>
			<section
				ref={(node) => {
					draggable.ref(node);
					droppable.ref(node);
				}}
				class={styles.folder}
				style={{ "--folder-hue": props.group.color }}
				data-library-item={props.group.id}
				data-folder-tile={props.group.id}
				data-editing={props.editing}
				data-dragging={draggable.isActiveDraggable}
				data-drop-target={dropTarget()?.state}
				aria-label={props.group.name}
			>
				<button
					type="button"
					class={styles.folderTile}
					{...(props.editing ? draggable.dragActivators : {})}
					aria-label={`Open ${props.group.name}, ${props.members.length} instances`}
					aria-haspopup="dialog"
					aria-expanded={props.openGroup === props.group.id}
					onClick={(event) => {
						if (props.suppressClick()) {
							event.preventDefault();
							return;
						}
						props.toggleGroup(props.group.id);
					}}
					onKeyDown={(event) => {
						if (props.editing && event.key.startsWith("Arrow")) {
							event.preventDefault();
							step(["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 1);
						}
					}}
				>
					<div class={styles.folderPreview}>
						<For each={props.members.slice(0, 4)}>
							{(instance) => <FolderMiniCard instance={instance} />}
						</For>
					</div>
					<div class={styles.folderCaption}>
						<strong>{props.group.name}</strong>
					</div>
				</button>
			</section>
			<DialogPrimitive.Root
				open={props.openGroup === props.group.id}
				onOpenChange={(open) => {
					if (!open && props.openGroup === props.group.id)
						props.toggleGroup(props.group.id);
				}}
				modal={!props.editing}
			>
				<DialogPrimitive.Portal>
					<DialogPrimitive.Overlay
						class={styles.popupBackdrop}
						data-editing={props.editing}
						style={{ "pointer-events": props.editing ? "none" : "auto" }}
					/>
					<FolderPopup {...props} />
				</DialogPrimitive.Portal>
			</DialogPrimitive.Root>
		</>
	);
}

function FolderMiniCard(props: { instance: Instance }) {
	const source = createMemo(() =>
		resolveResourceUrl(resolveInstanceDisplayIcon(props.instance)),
	);
	const [poster, setPoster] = createSignal<string>();

	createEffect(() => {
		const current = source();
		let cancelled = false;
		setPoster(undefined);

		if (!current || current.startsWith("linear-gradient")) {
			setPoster(current);
		} else if (
			!isAnimatedIconSource(current) &&
			!/\.gif(?:$|[?#])/i.test(current)
		) {
			setPoster(current);
		} else {
			createIconPosterFrame(current).then((frame) => {
				if (!cancelled && frame) setPoster(frame);
			});
		}

		onCleanup(() => {
			cancelled = true;
		});
	});

	return (
		<div
			class={styles.folderMiniCard}
			aria-hidden="true"
			style={{
				"--mini-bg-image": poster()
					? poster()?.startsWith("linear-gradient")
						? poster()
						: `url(${JSON.stringify(poster())})`
					: undefined,
			}}
		/>
	);
}

function FolderPopup(
	props: EntriesProps & { group: LibraryGroup; members: Instance[] },
) {
	const droppable = createDroppable(`popup:${props.group.id}`, {
		kind: "group",
		groupId: props.group.id,
	});
	const context = useDragDropContext();
	return (
		<DialogPrimitive.Content
			ref={droppable.ref}
			class={styles.folderPopup}
			style={{ "--folder-hue": props.group.color }}
			data-folder-popup={props.group.id}
			data-drop-target={
				props.editing && droppable.isActiveDroppable ? "ready" : undefined
			}
			onInteractOutside={(event) => {
				if (context?.[0].active.draggable || props.suppressClick())
					event.preventDefault();
			}}
			onEscapeKeyDown={(event) => {
				if (context?.[0].active.draggable) event.preventDefault();
			}}
			onCloseAutoFocus={(event) => {
				event.preventDefault();
				const tile = [
					...document.querySelectorAll<HTMLElement>("[data-library-item]"),
				].find((node) => node.dataset.libraryItem === props.group.id);
				tile?.querySelector<HTMLButtonElement>("button")?.focus();
			}}
		>
			<header class={styles.folderHeader}>
				<DialogPrimitive.Title class={styles.srOnly}>
					{props.group.name}
				</DialogPrimitive.Title>
				<input
					class={styles.groupInput}
					aria-label="Group name"
					readOnly={!props.editing}
					tabIndex={props.editing ? 0 : -1}
					maxLength={60}
					value={props.group.name}
					onChange={(event) => {
						renameLibraryGroup(props.group.id, event.currentTarget.value);
						event.currentTarget.value =
							libraryLayout().groups.find(
								(group) => group.id === props.group.id,
							)?.name ?? "";
					}}
					onKeyDown={(event) => {
						if (event.key === "Enter") event.currentTarget.blur();
					}}
				/>
				<Show when={props.editing}>
					<div class={styles.colors} role="group" aria-label="Folder color">
						<For
							each={
								[
									[205, "Blue"],
									[265, "Purple"],
									[150, "Green"],
									[35, "Amber"],
									[330, "Pink"],
								] as const
							}
						>
							{([color, name]) => (
								<button
									type="button"
									class={styles.colorSwatch}
									style={{ "--swatch-hue": color }}
									aria-label={name}
									title={name}
									aria-pressed={props.group.color === color}
									onClick={() => setLibraryGroupColor(props.group.id, color)}
								/>
							)}
						</For>
					</div>
				</Show>
				<span class={styles.count}>{props.members.length}</span>
				<DialogPrimitive.CloseButton
					class={styles.popupClose}
					aria-label="Close folder"
				>
					<CloseIcon />
				</DialogPrimitive.CloseButton>
			</header>
			<div class={styles.popupScroll} data-library-scroll>
				<div class={styles.folderGrid}>
					<For each={props.members}>
						{(instance) => (
							<MovableCard
								{...props}
								instance={instance}
								groupId={props.group.id}
							/>
						)}
					</For>
				</div>
			</div>
		</DialogPrimitive.Content>
	);
}

// Freeze the preview's dimensions and pointer offset for the whole drag. Layout
// measurements during scrolling or reparenting must never move its origin.
function DragPreview(props: {
	pointer: { x: number; y: number };
	shrink: boolean;
}) {
	const context = useDragDropContext();
	if (!context) return null;
	const [state, actions] = context;
	const [preview, setPreview] = createSignal<{
		clone: HTMLElement;
		width: number;
		height: number;
		offsetX: number;
		offsetY: number;
	} | null>(null);
	let ghost: HTMLElement | undefined;
	let swayFrame = 0;
	// The preview hangs from the point you grabbed: horizontal speed swings it
	// like a pendulum and a little extra speed lifts it, both easing back to rest.
	// It is large while carried and shrinks once a drop would make a folder.
	const sway = () => {
		let last = { ...props.pointer };
		let tilt = 0;
		let lift = 0;
		let scale = CARRY_SCALE;
		const step = () => {
			const point = props.pointer;
			const vx = point.x - last.x;
			const speed = Math.hypot(vx, point.y - last.y);
			last = { ...point };
			const rest = props.shrink ? GROUP_SCALE : CARRY_SCALE;
			if (reduceMotion()) {
				scale = rest;
			} else {
				tilt += (Math.max(-14, Math.min(14, vx * 0.5)) - tilt) * 0.18;
				lift += (Math.min(0.05, speed * 0.002) - lift) * 0.18;
				scale += (rest - scale) * 0.22;
			}
			ghost?.style.setProperty("--ghost-tilt", `${1.2 + tilt}deg`);
			ghost?.style.setProperty("--ghost-scale", `${scale + lift}`);
			swayFrame = requestAnimationFrame(step);
		};
		swayFrame = requestAnimationFrame(step);
	};
	actions.onDragStart(({ draggable }) => {
		cancelAnimationFrame(swayFrame);
		sway();
		const rect = draggable.node.getBoundingClientRect();
		const clone = draggable.node.cloneNode(true) as HTMLElement;
		clone.style.opacity = "1";
		clone.removeAttribute("data-library-item");
		clone.removeAttribute("data-dragging");
		clone.removeAttribute("data-editing");
		clone.querySelectorAll("[id]").forEach((node) => {
			node.removeAttribute("id");
		});
		clone.querySelectorAll("[data-edit-control]").forEach((node) => {
			node.remove();
		});
		const origin = state.active.sensor?.coordinates.origin ?? props.pointer;
		setPreview({
			clone,
			width: rect.width,
			height: rect.height,
			offsetX: origin.x - rect.left,
			offsetY: origin.y - rect.top,
		});
	});
	actions.onDragEnd(() => {
		cancelAnimationFrame(swayFrame);
		setPreview(null);
	});
	onCleanup(() => cancelAnimationFrame(swayFrame));
	return (
		<Portal>
			<Show when={preview()}>
				{(snapshot) => (
					<div
						class={styles.dragPreview}
						aria-hidden="true"
						inert
						style={{
							left: `${props.pointer.x - snapshot().offsetX}px`,
							top: `${props.pointer.y - snapshot().offsetY}px`,
							width: `${snapshot().width}px`,
							height: `${snapshot().height}px`,
						}}
					>
						<div
							class={styles.ghost}
							style={{
								"--ghost-origin": `${snapshot().offsetX}px ${snapshot().offsetY}px`,
							}}
							ref={(node) => {
								ghost = node;
								node.appendChild(snapshot().clone);
							}}
						/>
					</div>
				)}
			</Show>
		</Portal>
	);
}
