import CubeIcon from "@assets/cube.svg";
import CurseForgeIcon from "@assets/curseforge.svg";
import GlobeIcon from "@assets/earth-globe.svg";
import PrismLauncherIcon from "@assets/prism-launcher.svg";
import SearchIcon from "@assets/search.svg";
import { JSX } from "solid-js";
import styles from "../install-page.module.css";

interface SourceOptionsGridProps {
	onLocalImport: () => void;
	onExplore: () => void;
	onUrl: () => void;
	onLauncher: () => void;
}

export function SourceOptionsGrid(props: SourceOptionsGridProps): JSX.Element {
	return (
		<div class={styles["import-stage-surface"]}>
			<div class={styles["modpack-import-container"]}>
				<button class={styles["modpack-import-card"]} onClick={props.onLocalImport} type="button">
					<div class={styles["card-icon"]}>
						<CubeIcon />
					</div>
					<div class={styles["card-content"]}>
						<div class={styles.title}>Local File</div>
						<div class={styles.description}>Upload .zip or .mrpack</div>
					</div>
				</button>
				<button class={styles["modpack-import-card"]} onClick={props.onExplore} type="button">
					<div class={styles["card-icon"]}>
						<SearchIcon />
					</div>
					<div class={styles["card-content"]}>
						<div class={styles.title}>Explore</div>
						<div class={styles.description}>Browse Modrinth & CF</div>
					</div>
				</button>
				<button class={styles["modpack-import-card"]} onClick={props.onUrl} type="button">
					<div class={`${styles["card-icon"]} ${styles["is-stroke"]}`}>
						<GlobeIcon />
					</div>
					<div class={styles["card-content"]}>
						<div class={styles.title}>From URL</div>
						<div class={styles.description}>Direct download link</div>
					</div>
				</button>
				<button class={styles["modpack-import-card"]} onClick={props.onLauncher} type="button">
					<div class={`${styles["card-icon"]} ${styles["import-launcher-icon-stack"]}`}>
						<PrismLauncherIcon class={styles["stack-icon"]} />
						<CurseForgeIcon class={styles["stack-icon"]} />
					</div>
					<div class={styles["card-content"]}>
						<div class={styles.title}>Import Launcher</div>
						<div class={styles.description}>Choose launcher, then scan instances</div>
					</div>
				</button>
			</div>
		</div>
	);
}
