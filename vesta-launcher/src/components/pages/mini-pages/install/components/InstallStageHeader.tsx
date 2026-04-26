import { Show, type JSX } from "solid-js";
import styles from "../install-page.module.css";

interface InstallStageHeaderProps {
	title: string;
	description?: string;
	actionLabel?: string;
	onAction?: () => void;
	prefixIcon?: JSX.Element;
}

export function InstallStageHeader(props: InstallStageHeaderProps) {
	return (
		<header class={styles["stage-header"]}>
			<div class={styles["stage-header-main"]}>
				<Show when={props.prefixIcon}>
					<span class={styles["stage-header-icon"]}>{props.prefixIcon}</span>
				</Show>
				<div class={styles["stage-header-copy"]}>
					<h2>{props.title}</h2>
					<Show when={props.description}>
						<p>{props.description}</p>
					</Show>
				</div>
			</div>
			<Show when={props.actionLabel && props.onAction}>
				<button class={styles["header-link-action"]} onClick={props.onAction}>
					{props.actionLabel}
				</button>
			</Show>
		</header>
	);
}
