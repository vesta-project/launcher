import { Motion, Presence } from "@motionone/solid";
import { children, createSignal, onMount, Show } from "solid-js";
import { DURATION, EASE } from "../utils/motion";
import type { JSX } from "solid-js";

interface StepTransitionProps {
	children: JSX.Element;
	direction?: "forward" | "backward";
}

function StepTransition(props: StepTransitionProps) {
	const dir = () => props.direction ?? "forward";
	const xOffset = () => (dir() === "forward" ? 30 : -30);

	return (
		<Presence exitBeforeEnter>
			<Motion
				initial={{ opacity: 0, x: xOffset() }}
				animate={{ opacity: 1, x: 0 }}
				exit={{ opacity: 0, x: -xOffset() }}
				transition={{
					duration: DURATION.normal,
					easing: EASE.smooth,
				}}
				style={{ "will-change": "transform, opacity" }}
			>
				{props.children}
			</Motion>
		</Presence>
	);
}

export default StepTransition;
