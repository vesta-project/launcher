import {
	type DropAccept,
	type DropZoneRegistration,
	type DropZoneState,
	type RejectedDropItem,
} from "@utils/file-drop/drop-controller";
import { getDropController } from "@utils/file-drop/native-bridge";
import {
	children as accessChildren,
	type JSX,
	onCleanup,
	onMount,
} from "solid-js";
import { dropTargetForZoneState } from "../drop-target/drop-target";
import styles from "./drop-zone.module.css";

export interface DropZoneProps {
	onFileDrop: (files: string[]) => void;
	children: JSX.Element;
	accept?: DropAccept; // Type of drops to accept
	allowedExtensions?: string[]; // e.g. [".png", ".jpg", ".zip"]
	disabled?: boolean; // Disabled zones are never highlighted or delivered to
	onFilesRejected?: (items: RejectedDropItem[]) => void;
	/**
	 * Skip the shared drop-target look (`data-drop-target`, see ui/drop-target). The
	 * element still gets `data-drop-state` ("active" | "rejected"), so a host that
	 * combines this with other drop feedback can set `data-drop-target` itself.
	 */
	unstyled?: boolean;
	/** Called whenever the zone's highlight state changes, including back to "idle". */
	onStateChange?: (state: DropZoneState) => void;
}

let zoneCounter = 0;

/**
 * Drop target for native file drops. Drops arrive through the native bridge
 * (utils/file-drop/native-bridge), and the shared controller routes them here.
 *
 * DOM dragenter/dragover/drop handling is deliberately absent, so a drop is never
 * processed twice.
 *
 * Known limitation: there is no browser-dev fallback. Outside the Tauri desktop
 * build, or when the bridge is not running, this zone never receives drops.
 */
export function DropZone(props: DropZoneProps) {
	const resolved = accessChildren(() => props.children);
	const id = `drop-zone-${++zoneCounter}`;
	let appliedElement: HTMLElement | null = null;
	let unregister: (() => void) | undefined;

	const resolveElement = (): HTMLElement | null => {
		const child = resolved();
		if (child instanceof HTMLElement) {
			return child;
		}
		if (Array.isArray(child) && child[0] instanceof HTMLElement) {
			return child[0];
		}
		return null;
	};

	const clearState = (element: HTMLElement) => {
		element.classList.remove(
			styles["drop-zone--active"],
			styles["drop-zone--rejected"],
		);
		element.removeAttribute("data-drop-state");
		element.removeAttribute("data-drop-target");
	};

	const applyState = (state: DropZoneState) => {
		const next = state === "idle" ? null : resolveElement();
		if (appliedElement && appliedElement !== next) {
			clearState(appliedElement);
		}
		if (next) {
			const styled = !props.unstyled;
			next.classList.toggle(
				styles["drop-zone--active"],
				styled && state === "active",
			);
			next.classList.toggle(
				styles["drop-zone--rejected"],
				styled && state === "rejected",
			);
			next.setAttribute("data-drop-state", state);
			const target = styled ? dropTargetForZoneState(state) : undefined;
			if (target) {
				next.setAttribute("data-drop-target", target);
			} else {
				next.removeAttribute("data-drop-target");
			}
		}
		appliedElement = next;
		props.onStateChange?.(state);
	};

	onMount(() => {
		if (!resolveElement()) {
			console.error("DropZone: No valid HTML element found as child");
		}

		// Accessors read the current props on every call, so prop changes apply to the next drag.
		const registration: DropZoneRegistration = {
			id,
			getElement: resolveElement,
			getAccept: () => props.accept ?? "all",
			getAllowedExtensions: () => props.allowedExtensions ?? [],
			isDisabled: () => props.disabled === true,
			onFileDrop: (files) => props.onFileDrop(files),
			onRejected: (items) => props.onFilesRejected?.(items),
			onStateChange: applyState,
		};
		unregister = getDropController().register(registration);
	});

	onCleanup(() => {
		unregister?.();
		unregister = undefined;
		applyState("idle");
	});

	return resolved();
}
