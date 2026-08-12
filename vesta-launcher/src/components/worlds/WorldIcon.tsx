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
				<svg viewBox="0 0 48 48" role="presentation">
					<path d="m24 5 17 9.5v19L24 43 7 33.5v-19L24 5Z" />
					<path d="m7 14.5 17 9.7 17-9.7M24 24.2V43" />
				</svg>
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
