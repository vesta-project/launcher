import { type JSX, Show } from "solid-js";
import styles from "../install-page.module.css";

interface InstallStageHeaderProps {
	title: string;
	description?: string;
	actionLabel?: string;
	onAction?: () => void;
	prefixIcon?: JSX.Element;
	label?: string;
	iconUrl?: string | null;
	minecraftVersion?: string;
	modloader?: string;
	analyzing?: boolean;
}

export function InstallStageHeader(props: InstallStageHeaderProps) {
	return (
		<div class={styles["install-header-shell"]}>
			<header class={styles["stage-header"]}>
				<div class={styles["stage-header-main"]}>
					<Show when={props.iconUrl || props.prefixIcon}>
						<span class={styles["stage-header-icon"]}>
							<Show when={props.iconUrl} fallback={props.prefixIcon}>
								<img src={props.iconUrl ?? undefined} alt="" />
							</Show>
						</span>
					</Show>
					<div class={styles["stage-header-copy"]}>
						<Show when={props.label}>
							<span class={styles["stage-header-label"]}>{props.label}</span>
						</Show>
						<div class={styles["stage-header-title-row"]}>
							<h2 classList={{ [styles["is-analyzing"]]: !!props.analyzing }}>{props.title}</h2>
							<Show when={props.minecraftVersion || props.modloader}>
								<div class={styles["stage-header-tags"]}>
									<Show when={props.minecraftVersion}>
										<span>{props.minecraftVersion}</span>
									</Show>
									<Show when={props.modloader}>
										<span class={styles.capitalize}>{props.modloader}</span>
									</Show>
								</div>
							</Show>
						</div>
						<Show when={props.description}>
							<p>{props.description}</p>
						</Show>
					</div>
				</div>
				<Show when={props.actionLabel && props.onAction}>
					<div class={styles["stage-header-actions"]}>
						<button type="button" class={styles["header-link-action"]} onClick={props.onAction}>
							{props.actionLabel}
						</button>
					</div>
				</Show>
			</header>
		</div>
	);
}
