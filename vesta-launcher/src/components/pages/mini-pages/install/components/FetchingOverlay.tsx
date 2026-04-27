import { Show } from "solid-js";
import styles from "../install-page.module.css";

interface FetchingOverlayProps {
	isVisible: boolean;
	title: string;
	message?: string;
}

export function FetchingOverlay(props: FetchingOverlayProps) {
	return (
		<Show when={props.isVisible}>
			<div class={styles["fetching-metadata-container"]}>
				<div class={styles["fetching-overlay"]}>
					<div class={styles.spinner} />
					<p>{props.title}</p>
					<Show when={props.message}>
						<span class={styles["fetching-subtext"]}>{props.message}</span>
					</Show>
				</div>
			</div>
		</Show>
	);
}
