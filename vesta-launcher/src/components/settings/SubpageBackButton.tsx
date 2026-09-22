import BackArrowIcon from "@assets/icons/navigation/arrow-back.svg";
import type { JSX } from "solid-js";
import styles from "./subpage-back-button.module.css";

export function SubpageBackButton(props: {
	label?: string;
	onClick?: () => void;
	disabled?: boolean;
	class?: string;
}) {
	return (
		<button
			type="button"
			class={`${styles.button} ${props.class ?? ""}`}
			aria-label={props.label ?? "Back"}
			title={props.label ?? "Back"}
			disabled={props.disabled}
			onClick={props.onClick}
		>
			<BackArrowIcon aria-hidden="true" />
		</button>
	);
}

export function SubpageHeading(props: {
	title: string;
	onBack?: () => void;
	backLabel?: string;
	children?: JSX.Element;
	class?: string;
}) {
	return (
		<div class={`${styles.heading} ${props.class ?? ""}`}>
			{props.onBack ? (
				<SubpageBackButton label={props.backLabel} onClick={props.onBack} />
			) : null}
			<h2 class={styles.title}>{props.title}</h2>
			{props.children}
		</div>
	);
}
