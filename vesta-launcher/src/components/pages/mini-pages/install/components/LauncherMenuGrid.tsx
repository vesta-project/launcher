import { For } from "solid-js";
import styles from "../install-page.module.css";
import type { LauncherOption } from "../types";

interface LauncherMenuGridProps {
	launchers: LauncherOption[];
	onSelect: (kind: LauncherOption["kind"]) => void;
}

export function LauncherMenuGrid(props: LauncherMenuGridProps) {
	return (
		<div class={styles["import-stage-surface"]}>
			<div class={`${styles["modpack-import-container"]} ${styles["launcher-menu-grid"]}`}>
				<For each={props.launchers}>
					{(launcher) => (
						<div
							class={`${styles["modpack-import-card"]} ${styles[`launcher-card--${launcher.tone}`]}`}
							onClick={() => props.onSelect(launcher.kind)}
						>
							{launcher.icon && (
								<div
									class={styles["card-icon"]}
									classList={{ [styles["icon-mono"]]: !!launcher.iconMonochrome }}
								>
									<launcher.icon />
								</div>
							)}
							<div class={styles["card-content"]}>
								<div class={styles.title}>{launcher.label}</div>
							</div>
						</div>
					)}
				</For>
			</div>
		</div>
	);
}
