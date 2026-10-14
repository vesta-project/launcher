import type { RecognizedSource } from "@stores/resources";
import { Show } from "solid-js";
import { t } from "~/localization";
import styles from "./manual-source-label.module.css";

export function ManualSourceLabel(props: {
	source?: RecognizedSource;
	originalArtifact?: boolean;
}) {
	return (
		<Show when={props.source}>
			{(source) => (
				<span
					class={styles.label}
					title={t("resource-drop-source-explanation")}
				>
					{t(
						props.originalArtifact
							? "resource-drop-source-archive"
							: "resource-drop-source-match",
						{
							name: source().displayName,
							platform: source().platform,
							version: source().versionNumber,
						},
					)}
				</span>
			)}
		</Show>
	);
}
