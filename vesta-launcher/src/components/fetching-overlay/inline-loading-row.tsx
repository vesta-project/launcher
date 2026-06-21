import styles from "./fetching-overlay.module.css";

export function InlineLoadingRow(props: { message: string; class?: string }) {
	return (
		<div class={`${styles["inline-loading"]} ${props.class ?? ""}`}>
			<div class={styles["inline-spinner"]} />
			<span>{props.message}</span>
		</div>
	);
}
