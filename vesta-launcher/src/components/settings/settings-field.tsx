import { confirm } from "@tauri-apps/plugin-dialog";
import LauncherButton from "@ui/button/button";
import { HelpTrigger } from "@ui/help-trigger/help-trigger";
import { Component, JSX, Show } from "solid-js";
import styles from "./settings.module.css";

export interface SettingsFieldProps {
	label: string;
	description?: string | JSX.Element;
	helpTopic?: string;

	/** Right-side content rendered in the field header. */
	headerRight?: JSX.Element;

	/** Full-width content rendered below the field header. */
	body?: JSX.Element;

	/**
	 * Legacy layout style retained for compatibility.
	 * @deprecated Prefer using `headerRight` and `body`.
	 */
	layout?: "inline" | "stack";

	/**
	 * Legacy control element retained for compatibility.
	 * @deprecated Prefer using `headerRight` and `body`.
	 */
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
	const resolvedBody = () => {
		if (props.body !== undefined) return props.body;
		if (props.children !== undefined) return props.children;
		if (props.layout === "stack" && props.control !== undefined) {
			return props.control;
		}

		return undefined;
	};

	const resolvedHeaderRight = () => {
		if (props.headerRight !== undefined) return props.headerRight;
		if (props.layout !== "stack" && props.control !== undefined) {
			return props.control;
		}

		return undefined;
	};

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

	const resolvedAction = () => {
		if (!props.actionLabel) return undefined;

		return (
			<LauncherButton
				color={props.destructive ? "destructive" : "secondary"}
				variant={props.destructive ? "outline" : "solid"}
				onClick={handleAction}
				disabled={props.disabled}
			>
				{props.actionLabel}
			</LauncherButton>
		);
	};

	const headerContent = () => resolvedHeaderRight() ?? resolvedAction();

	return (
		<div
			class={styles["settings-field"]}
			classList={{
				[styles["settings-field--disabled"]]: props.disabled,
			}}
		>
			<div class={styles["settings-field-header"]}>
				<div class={styles["settings-field-info"]}>
					<div class={styles["settings-field-label-wrapper"]}>
						<span class={styles["settings-field-label"]}>{props.label}</span>
						<Show when={props.helpTopic}>
							<HelpTrigger topic={props.helpTopic ?? ""} />
						</Show>
					</div>
					<Show when={props.description}>
						<div class={styles["settings-field-description"]}>
							{props.description}
						</div>
					</Show>
				</div>
				<Show when={headerContent()}>
					<div
						class={styles["settings-field-header-right"]}
						classList={{ [styles.disabled]: props.disabled }}
					>
						{headerContent()}
					</div>
				</Show>
			</div>
			<Show when={resolvedBody()}>
				<div
					class={styles["settings-field-body"]}
					classList={{ [styles.disabled]: props.disabled }}
				>
					{resolvedBody()}
				</div>
			</Show>
		</div>
	);
};
