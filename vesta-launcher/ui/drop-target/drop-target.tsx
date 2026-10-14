import { type JSX, Show } from "solid-js";
import "./drop-target.css";

/** See drop-target.css. The value of the `data-drop-target` attribute. */
export type DropTargetState = "pending" | "ready" | "rejected";

export interface DropTarget {
	state: DropTargetState;
	/** Short text for the hint pill. Omit for no pill. */
	label?: string;
}

/**
 * Maps a drop zone's highlight state onto the shared drop-target look.
 * "idle" means no feedback.
 */
export function dropTargetForZoneState(
	state: "idle" | "active" | "rejected",
): DropTargetState | undefined {
	if (state === "active") return "ready";
	if (state === "rejected") return "rejected";
	return undefined;
}

/**
 * The hint pill for a drop target. Place it inside the element that carries
 * `data-drop-target`, which must be positioned.
 */
export function DropTargetHint(props: {
	target: DropTarget | undefined;
}): JSX.Element {
	return (
		<Show when={props.target?.label}>
			<span class="drop-target-hint" data-state={props.target?.state}>
				{props.target?.label}
			</span>
		</Show>
	);
}
