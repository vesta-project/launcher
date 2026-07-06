import { HelpTrigger } from "@ui/help-trigger/help-trigger";
import { type Component, type JSX, Show } from "solid-js";
import styles from "./settings.module.css";

export interface SettingsCardProps {
	header?: string;
	subHeader?: string;
	destructive?: boolean;
	helpTopic?: string;
	variant?: "default" | "compact" | "transparent" | "bordered";
	children: JSX.Element;
}

export const SettingsCard: Component<SettingsCardProps> = (props) => {
	const variant = () => props.variant || "default";

	return (
		<section
			class={`${styles["settings-card"]}`}
			classList={{
				[styles["settings-card--destructive"]]: props.destructive,
				[styles[`settings-card--${variant()}`]]: true,
			}}
		>
			<Show when={props.header}>
				<div
					class={styles["settings-card-header"]}
					classList={{
						[styles["settings-card-header--compact"]]: variant() === "compact",
					}}
				>
					<div class={styles["settings-card-header--top"]}>
						<h2 class={styles["settings-card-title"]}>{props.header}</h2>
						<Show when={props.helpTopic}>
							{(helpTopic) => <HelpTrigger topic={helpTopic()} />}
						</Show>
					</div>
					<Show when={props.subHeader}>
						<p class={styles["settings-card-subheader"]}>{props.subHeader}</p>
					</Show>
				</div>
			</Show>
			<div class={styles["settings-card-content"]}>{props.children}</div>
		</section>
	);
};
