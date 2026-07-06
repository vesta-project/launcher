import { type JSX, Show } from "solid-js";
import styles from "../init.module.css";

interface StepTransitionProps {
	children: JSX.Element;
	direction?: "forward" | "backward";
}

function StepTransition(props: StepTransitionProps) {
	return (
		<Show when={props.children} keyed>
			{(child) => <div class={styles["step-transition--enter"]}>{child}</div>}
		</Show>
	);
}

export default StepTransition;
