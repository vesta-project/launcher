import { getDropZoneManager } from "@utils/file-drop";
import {
	children as accessChildren,
	createEffect,
	JSX,
	onCleanup,
	onMount,
} from "solid-js";
import styles from "./drop-zone.module.css";

export interface DropZoneProps {
	onFileDrop: (files: string[]) => void;
	children: JSX.Element;
	accept?: "files" | "folders" | "all"; // Type of drops to accept
	allowedExtensions?: string[]; // e.g. [".png", ".jpg", ".zip"]
}

export function DropZone(props: DropZoneProps) {
	const resolved = accessChildren(() => props.children);

	let childElement: HTMLElement | undefined;
	const manager = getDropZoneManager();
	let dragCounter = 0;

	createEffect(() => {
		const child = resolved();
		if (child instanceof HTMLElement) {
			childElement = child;
		} else if (Array.isArray(child) && child[0] instanceof HTMLElement) {
			childElement = child[0];
		}
	});

	onMount(() => {
		if (!childElement) {
			console.error("DropZone: No valid HTML element found as child");
			return;
		}

		const element = childElement;

		const handleDragEnter = (e: DragEvent) => {
			e.preventDefault();
			dragCounter++;

			if (dragCounter === 1) {
				// Only highlight if we ALREADY have sniffed paths
				const paths = manager.getSniffedPaths();
				const filtered = manager.filterPaths(paths, props);

				if (paths.length > 0 && filtered.length > 0) {
					element.classList.add(styles["drop-zone--active"]);
				}

				manager.setIsDragActive(true);
			}
		};

		const handleDragOver = (e: DragEvent) => {
			e.preventDefault();

			if (e.dataTransfer) {
				const paths = manager.getSniffedPaths();
				const filtered = manager.filterPaths(paths, props);

				// Only show "copy" cursor and highlight if we have matching paths
				if (paths.length > 0 && filtered.length > 0) {
					e.dataTransfer.dropEffect = "copy";
					if (!element.classList.contains(styles["drop-zone--active"])) {
						element.classList.add(styles["drop-zone--active"]);
					}
				} else {
					e.dataTransfer.dropEffect = "none";
					element.classList.remove(styles["drop-zone--active"]);
				}
			}
		};

		const handleDragLeave = (e: DragEvent) => {
			e.preventDefault();
			dragCounter--;
			if (dragCounter <= 0) {
				dragCounter = 0;
				element.classList.remove(styles["drop-zone--active"]);
			}
		};

		const handleDrop = (e: DragEvent) => {
			e.preventDefault();
			dragCounter = 0;
			element.classList.remove(styles["drop-zone--active"]);

			const paths = manager.getSniffedPaths();
			const filtered = manager.filterPaths(paths, props);

			console.log(
				"[DropZone] Files dropped, paths:",
				paths,
				"filtered:",
				filtered,
			);

			if (filtered.length > 0) {
				props.onFileDrop(filtered.map((p) => p.path));
			}
			manager.clearSniffedPaths();
		};

		element.addEventListener("dragenter", handleDragEnter);
		element.addEventListener("dragover", handleDragOver);
		element.addEventListener("dragleave", handleDragLeave);
		element.addEventListener("drop", handleDrop);

		onCleanup(() => {
			element.removeEventListener("dragenter", handleDragEnter);
			element.removeEventListener("dragover", handleDragOver);
			element.removeEventListener("dragleave", handleDragLeave);
			element.removeEventListener("drop", handleDrop);
			element.classList.remove("drop-zone--active");
		});
	});

	return resolved();
}
