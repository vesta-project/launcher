import Button from "@ui/button/button";
import { Show } from "solid-js";
import styles from "./floating-save.module.css";
import { t } from "~/localization";

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
				<p>{props.message || t("shared-ui-unsaved-changes")}</p>
				<div class={styles["save-footer-actions"]}>
					<Show when={props.onCancel}>
						{(onCancel) => (
							<Button
								variant="ghost"
								onClick={onCancel()}
								disabled={props.isSaving}
							>
								{props.cancelText || t("shared-ui-cancel")}
							</Button>
						)}
					</Show>
					<Button
						variant="solid"
						onClick={props.onSave}
						disabled={props.isSaving}
					>
						{props.saveText || t("shared-ui-save")}
					</Button>
				</div>
			</div>
		</div>
	);
}
