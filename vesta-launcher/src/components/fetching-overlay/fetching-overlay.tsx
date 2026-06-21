import { Show } from "solid-js";
import styles from "./fetching-overlay.module.css";

export interface FetchingOverlayProps {
	isVisible: boolean;
	title: string;
	message?: string;
	error?: string;
	variant?: "loading" | "warning" | "error";
	onRetry?: () => void;
	onChooseAnother?: () => void;
	secondaryAction?: { label: string; onClick: () => void };
}

export function FetchingOverlay(props: FetchingOverlayProps) {
	return (
		<Show when={props.isVisible}>
			<div class={styles["fetching-metadata-container"]}>
				<div
					class={styles["fetching-overlay"]}
					classList={{
						[styles["is-warning"]]: props.variant === "warning",
						[styles["is-error"]]: props.variant === "error",
					}}
				>
					<Show when={props.variant !== "error"} fallback={<div class={styles["error-mark"]}>!</div>}>
						<div class={styles.spinner} />
					</Show>
					<p>{props.title}</p>
					<Show when={props.message}>
						<span class={styles["fetching-subtext"]}>{props.message}</span>
					</Show>
					<Show when={props.error}>
						<span class={styles["fetching-error-text"]}>{props.error}</span>
					</Show>
					<Show when={props.onRetry || props.onChooseAnother || props.secondaryAction}>
						<div class={styles["fetching-actions"]}>
							<Show when={props.onRetry}>
								<button type="button" class={styles["fetching-action"]} onClick={props.onRetry}>
									Retry
								</button>
							</Show>
							<Show when={props.onChooseAnother}>
								<button type="button" class={styles["fetching-action"]} onClick={props.onChooseAnother}>
									Choose another file
								</button>
							</Show>
							<Show when={props.secondaryAction}>
								<button
									type="button"
									class={styles["fetching-action"]}
									onClick={props.secondaryAction!.onClick}
								>
									{props.secondaryAction!.label}
								</button>
							</Show>
						</div>
					</Show>
				</div>
			</div>
		</Show>
	);
}
