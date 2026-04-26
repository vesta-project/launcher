import styles from "../install-page.module.css";

interface UrlSourcePanelProps {
	value: string;
	onInput: (value: string) => void;
	onSubmit: () => void;
}

export function UrlSourcePanel(props: UrlSourcePanelProps) {
	return (
		<div class={styles["url-input-container"]}>
			<div class={styles["url-input-row"]}>
				<input
					type="text"
					placeholder="https://example.com/pack.zip"
					value={props.value}
					onInput={(e) => props.onInput(e.currentTarget.value)}
					onKeyDown={(e) => e.key === "Enter" && props.onSubmit()}
					autofocus
				/>
				<button class={styles["import-button"]} onClick={props.onSubmit} disabled={!props.value.trim()}>
					Continue
				</button>
			</div>
		</div>
	);
}
