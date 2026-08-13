import type { Component } from "solid-js";
import { Show } from "solid-js";
import styles from "./worlds.module.css";

export const WorldIcon: Component<{
	src?: string | null;
	name: string;
	class?: string;
}> = (props) => (
	<Show
		when={props.src}
		fallback={
			<div
				class={`${styles["world-icon"]} ${styles["world-icon--fallback"]} ${props.class ?? ""}`}
				aria-hidden="true"
			>
				<CubeIcon role="presentation" />
			</div>
		}
	>
		<img
			src={props.src ?? ""}
			alt={`${props.name} world icon`}
			class={`${styles["world-icon"]} ${props.class ?? ""}`}
			loading="lazy"
			decoding="async"
		/>
	</Show>
);
import CubeIcon from "@assets/icons/content/cube.svg";
