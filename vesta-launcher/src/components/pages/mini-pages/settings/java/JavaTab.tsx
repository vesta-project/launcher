import { SettingsCard, SettingsField } from "@components/settings";
import panelStyles from "@components/settings/settings.module.css";
import { getRequirements, isScanning, javaOptions, refreshJavas } from "@stores/settings";
import LauncherButton from "@ui/button/button";
import { Switch, SwitchControl, SwitchThumb } from "@ui/switch/switch";
import { For, Show } from "solid-js";
import styles from "../settings-page.module.css";
import { JavaOptionCard } from "./JavaOptionCard";

export function JavaSettingsTab() {
	return (
		<div class={`${styles["settings-tab-content"]} ${styles["settings-tab-content--wide"]}`}>
			<div class={panelStyles["settings-panel"]}>
			<SettingsCard
				header="Java Environments"
				subHeader="Global defaults for each Java version. Instances follow these by default."
				helpTopic="JAVA_MANAGED"
			>
				<div class={styles["section-actions"]} style={{ "margin-bottom": "16px" }}>
					<LauncherButton onClick={refreshJavas} disabled={isScanning()} variant="ghost" size="sm">
						{isScanning() ? "Scanning..." : "Rescan System"}
					</LauncherButton>
				</div>

				<Show
					when={getRequirements().length > 0}
					fallback={
						<div class={styles["settings-loading-state"]}>
							<div class={styles["spinner"]}></div>
							<p>Loading Minecraft version metadata...</p>
							<span>Your Java requirements will appear once the manifest is ready.</span>
						</div>
					}
				>
					<div class={styles["java-requirements-list"]}>
						<For each={getRequirements()}>
							{(req: any) => {
								const versionOptions = () =>
									javaOptions().filter((option) => option.version === req.major_version);

								return (
									<div class={styles["java-req-item"]}>
										<div class={styles["java-req-header"]}>
											<h3>{req.recommended_name}</h3>
										</div>

										<div class={styles["java-options-grid"]}>
											<For each={versionOptions()}>{(option) => <JavaOptionCard option={option} />}</For>
										</div>
									</div>
								);
							}}
						</For>
					</div>
				</Show>
			</SettingsCard>
			</div>
		</div>
	);
}
