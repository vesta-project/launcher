import Button from "@ui/button/button";
import { Show } from "solid-js";
import styles from "./floating-save-footer.module.css";

interface FloatingSaveFooterProps {
	/** Whether to show the footer */
	show: boolean;
	/** Custom message for the footer (default: "You have unsaved changes.") */
	message?: string;
	/** Label for the save button (default: "Save Changes") */
	saveText?: string;
	/** Label for the cancel button (default: "Cancel") */
	cancelText?: string;
	/** Callback for when the save button is clicked */
	onSave: () => void;
	/** Callback for when the cancel button is clicked */
	onCancel: () => void;
	/** Whether the footer is in a saving state (disables buttons and shows loader) */
	isSaving?: boolean;
}

/**
 * A reusable floating footer for pages with unsaved changes.
 * Standardizes the "Unsaved changes" UI across Account Settings and Instance Details.
 */
export default function FloatingSaveFooter(props: FloatingSaveFooterProps) {
	return (
		<Show when={props.show}>
			<div class={styles["floating-save-footer"]}>
				<div class={styles["save-footer-content"]}>
					<p>{props.message || "You have unsaved changes."}</p>
				</div>
				<div class={styles["save-footer-actions"]}>
					<Button onClick={() => props.onCancel()} variant="ghost" size="sm" disabled={props.isSaving}>
						{props.cancelText || "Cancel"}
					</Button>
					<Button onClick={() => props.onSave()} variant="solid" size="sm" disabled={props.isSaving}>
						{props.saveText || "Save Changes"}
					</Button>
				</div>
			</div>
		</Show>
	);
}
