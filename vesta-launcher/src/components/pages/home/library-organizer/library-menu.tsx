import { pageViewerOpen } from "@components/page-viewer/page-viewer";
import { instances } from "@stores/instances";
import {
	beginLibraryEdit,
	endLibraryEdit,
	type LibrarySort,
	libraryEditing,
	libraryLayout,
	librarySorts,
	setLibrarySort,
} from "@stores/library-layout";
import Button from "@ui/button/button";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuGroup,
	ContextMenuGroupLabel,
	ContextMenuItem,
	ContextMenuRadioGroup,
	ContextMenuRadioItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from "@ui/context-menu/context-menu";
import clsx from "clsx";
import { createSignal, For, type ParentProps, Show } from "solid-js";
import styles from "./library-organizer.module.css";

/** Sort and arrange actions, shared by the background and instance-card menus. */
export function LibraryMenuItems() {
	return (
		<>
			<ContextMenuGroup>
				<ContextMenuGroupLabel>Sort by</ContextMenuGroupLabel>
				<ContextMenuRadioGroup
					value={libraryLayout().sort}
					onChange={(mode) => setLibrarySort(mode as LibrarySort, instances())}
				>
					<For each={Object.entries(librarySorts)}>
						{([mode, label]) => (
							<ContextMenuRadioItem value={mode}>{label}</ContextMenuRadioItem>
						)}
					</For>
				</ContextMenuRadioGroup>
			</ContextMenuGroup>
			<ContextMenuSeparator />
			<ContextMenuItem onSelect={() => beginLibraryEdit(instances())}>
				<span>Arrange library</span>
			</ContextMenuItem>
		</>
	);
}

/**
 * Wraps the library's scroll area so right-click (or long-press) on empty
 * space opens the library menu. Cards and folders keep their own menus.
 */
export function LibraryBackgroundMenu(props: ParentProps<{ class?: string }>) {
	// A touch long-press on a card also bubbles here; the card's own menu wins.
	const [pressedItem, setPressedItem] = createSignal(false);
	return (
		<ContextMenu>
			<ContextMenuTrigger
				class={props.class}
				data-library-scroll
				disabled={pageViewerOpen() || libraryEditing() || pressedItem()}
				onPointerDown={(event: PointerEvent) => {
					setPressedItem(
						!!(event.target as Element).closest("[data-library-item]"),
					);
				}}
			>
				{props.children}
			</ContextMenuTrigger>
			<ContextMenuContent>
				<LibraryMenuItems />
			</ContextMenuContent>
		</ContextMenu>
	);
}

/** The only persistent chrome: a floating pill that appears while arranging. */
export function LibraryDoneButton() {
	return (
		<Show when={libraryEditing()}>
			<div class={styles.editBarAnchor}>
				<div class={clsx(styles.editBar, "liquid-glass")}>
					<span class={styles.editHint}>Drag to reorder</span>
					<Button color="primary" size="sm" onClick={endLibraryEdit}>
						Done
					</Button>
				</div>
			</div>
		</Show>
	);
}
