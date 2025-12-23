import { getDropZoneManager } from "@utils/file-drop";
import {
	children as accessChildren,
	createEffect,
	JSX,
	onCleanup,
	onMount,
} from "solid-js";
import "./drop-zone.css";

export interface DropZoneProps {
	onFileDrop: (files: string[]) => void;
	children: JSX.Element;
	accept?: "files" | "folders" | "all"; // Type of drops to accept
	allowedExtensions?: string[]; // e.g. [".png", ".jpg", ".zip"]
}

export function DropZone(props: DropZoneProps) {
	const resolved = accessChildren(() => props.children);

	let childElement: HTMLElement | undefined;
	const dropZoneManager = getDropZoneManager();

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

		// Add data attribute for identification for visual purposes only
		element.setAttribute("data-drop-zone", "true");

		// Watch for prop changes and update drop zone registration
		createEffect(() => {
			// Update data attributes for visual purposes
			if (props.accept) {
				element.setAttribute("data-drop-zone-accept", props.accept);
			} else {
				element.removeAttribute("data-drop-zone-accept");
			}
			if (props.allowedExtensions?.length) {
				element.setAttribute(
					"data-drop-zone-extensions",
					props.allowedExtensions.join(","),
				);
			} else {
				element.removeAttribute("data-drop-zone-extensions");
			}

			// Re-register the zone with updated options
			dropZoneManager.registerZone(element, props.onFileDrop, {
				accept: props.accept,
				allowedExtensions: props.allowedExtensions,
			});
		});

		onCleanup(() => {
			if (element) {
				element.removeAttribute("data-drop-zone");
				element.removeAttribute("data-drop-zone-accept");
				element.removeAttribute("data-drop-zone-extensions");
				element.classList.remove("drop-zone--active");
			}
			dropZoneManager.unregisterZone(element);
		});
	});

	return resolved();
}
