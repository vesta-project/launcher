import { confirm } from "@tauri-apps/plugin-dialog";
import LauncherButton from "@ui/button/button";
import { HelpTrigger } from "@ui/help-trigger/help-trigger";
import { Component, JSX, Show } from "solid-js";
import styles from "./settings.module.css";

export interface SettingsFieldProps {
	label: string;
	description?: string | JSX.Element;
	helpTopic?: string;

	/**
	 * Layout style:
	 * - 'inline': Control on the right (desktop) or stacked right (mobile)
	 * - 'stack': Control full width below the text (always)
	 */
	layout?: "inline" | "stack";

	/** Manual control Element (Switch, Slider, etc.) */
	control?: JSX.Element;

	/** If providing a simple action button instead of a control */
	actionLabel?: string;
	onAction?: () => void | Promise<void>;
	destructive?: boolean;
	disabled?: boolean;
	confirmationDesc?: string;
	children?: JSX.Element;
}

export const SettingsField: Component<SettingsFieldProps> = (props) => {
	const layout = () => props.layout || "inline";

	const handleAction = async () => {
		if (!props.onAction) return;

		if (props.confirmationDesc) {
			const confirmed = await confirm(props.confirmationDesc, {
				title: "Confirm Action",
				kind: props.destructive ? "error" : "info",
			});
			if (!confirmed) return;
		}

		await props.onAction();
	};

	return (
		<>
			<div
				class={styles["settings-field"]}
				classList={{
					[styles["settings-field--inline"]]: layout() === "inline",
					[styles["settings-field--stack"]]: layout() === "stack",
					[styles["settings-field--disabled"]]: props.disabled,
				}}
			>
				<div class={styles["settings-field-info"]}>
					<div class={styles["settings-field-label-wrapper"]}>
						<span class={styles["settings-field-label"]}>{props.label}</span>
						<Show when={props.helpTopic}>
							<HelpTrigger topic={props.helpTopic!} />
						</Show>
					</div>
					<Show when={props.description}>
						<div class={styles["settings-field-description"]}>
							{props.description}
						</div>
					</Show>
				</div>
				<div class={styles["settings-field-control"]}>
					<Show
						when={props.control || props.children}
						fallback={
							<Show when={props.actionLabel}>
								<LauncherButton
									color={props.destructive ? "destructive" : "secondary"}
									variant={props.destructive ? "shadow" : "solid"}
									onClick={handleAction}
									disabled={props.disabled}
								>
									{props.actionLabel}
								</LauncherButton>
							</Show>
						}
					>
						<div
							class={styles["settings-field-content-wrapper"]}
							classList={{ [styles.disabled]: props.disabled }}
						>
							{props.control || props.children}
						</div>
					</Show>
				</div>
			</div>
		</>
	);
};
