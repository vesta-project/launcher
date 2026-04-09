import Button from "@ui/button/button";
import { Show } from "solid-js";
import styles from "./floating-save.module.css";

export interface FloatingSaveProps {
	message?: string;
	onSave: () => void;
	onCancel?: () => void;
	saveText?: string;
	cancelText?: string;
	isSaving?: boolean;
	class?: string;
	position?: "fixed" | "absolute";
}

export function FloatingSave(props: FloatingSaveProps) {
	return (
		<div
			class={`${styles["floating-save-footer"]} ${props.position === "absolute" ? styles.absolute : ""} ${props.class || ""}`}
		>
			<div class={styles["save-footer-content"]}>
				<p>{props.message || "You have unsaved changes"}</p>
				<div class={styles["save-footer-actions"]}>
					<Show when={props.onCancel}>
						<Button variant="ghost" onClick={props.onCancel!} disabled={props.isSaving}>
							{props.cancelText || "Cancel"}
						</Button>
					</Show>
					<Button variant="solid" onClick={props.onSave} disabled={props.isSaving}>
						{props.saveText || "Save"}
					</Button>
				</div>
			</div>
		</div>
	);
}
