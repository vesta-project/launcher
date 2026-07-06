import CubeIcon from "@assets/cube.svg";
import CurseForgeIcon from "@assets/curseforge.svg";
import PlusIcon from "@assets/plus.svg";
import PrismLauncherIcon from "@assets/prism-launcher.svg";
import SearchIcon from "@assets/search.svg";
import type { JSX } from "solid-js";
import styles from "../install-page.module.css";

interface SourceOptionsGridProps {
	onStandard: () => void;
	onLocalImport: () => void;
	onExplore: () => void;
	onLauncher: () => void;
}

export function SourceOptionsGrid(props: SourceOptionsGridProps): JSX.Element {
	return (
		<div class={styles["import-stage-surface"]}>
			<div class={styles["modpack-import-container"]}>
				<button
					class={styles["modpack-import-card"]}
					onClick={props.onStandard}
					type="button"
				>
					<div class={styles["card-icon"]}>
						<PlusIcon />
					</div>
					<div class={styles["card-content"]}>
						<div class={styles.title}>Blank Instance</div>
						<div class={styles.description}>Pure vanilla or custom</div>
					</div>
				</button>
				<button
					class={styles["modpack-import-card"]}
					onClick={props.onLocalImport}
					type="button"
				>
					<div class={styles["card-icon"]}>
						<CubeIcon />
					</div>
					<div class={styles["card-content"]}>
						<div class={styles.title}>Local File</div>
						<div class={styles.description}>Upload .zip or .mrpack</div>
					</div>
				</button>
				<button
					class={styles["modpack-import-card"]}
					onClick={props.onExplore}
					type="button"
				>
					<div class={styles["card-icon"]}>
						<SearchIcon />
					</div>
					<div class={styles["card-content"]}>
						<div class={styles.title}>Explore</div>
						<div class={styles.description}>Browse Modrinth & CF</div>
					</div>
				</button>
				<button
					class={styles["modpack-import-card"]}
					onClick={props.onLauncher}
					type="button"
				>
					<div
						class={`${styles["card-icon"]} ${styles["import-launcher-icon-stack"]}`}
					>
						<PrismLauncherIcon class={styles["stack-icon"]} />
						<CurseForgeIcon class={styles["stack-icon"]} />
					</div>
					<div class={styles["card-content"]}>
						<div class={styles.title}>Import Launcher</div>
						<div class={styles.description}>Prism, CF, GD, etc.</div>
					</div>
				</button>
			</div>
		</div>
	);
}
