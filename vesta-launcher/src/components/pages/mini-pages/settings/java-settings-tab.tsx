import { For, Show } from "solid-js";
import { SettingsCard, SettingsField } from "@components/settings";
import LauncherButton from "@ui/button/button";
import { Switch, SwitchControl, SwitchThumb } from "@ui/switch/switch";
import { JavaOptionCard } from "./java-option-card";
import styles from "./settings-page.module.css";

interface JavaSettingsTabProps {
	requirements: any[];
	javaOptions: any[];
	isScanning: boolean;
	refreshJavas: () => void;
	useDedicatedGpu: boolean;
	handleGpuToggle: (checked: boolean) => void;
}

export function JavaSettingsTab(props: JavaSettingsTabProps) {
	return (
		<div class={styles["settings-tab-content"]}>
			<SettingsCard
				header="Java Environments"
				subHeader="Global defaults for each Java version. Instances follow these by default."
				helpTopic="JAVA_MANAGED"
			>
				<div
					class={styles["section-actions"]}
					style={{ "margin-bottom": "16px" }}
				>
					<LauncherButton
						onClick={props.refreshJavas}
						disabled={props.isScanning}
						variant="ghost"
						size="sm"
					>
						{props.isScanning ? "Scanning..." : "Rescan System"}
					</LauncherButton>
				</div>

				<Show
					when={props.requirements.length > 0}
					fallback={
						<div class={styles["settings-loading-state"]}>
							<div class={styles["spinner"]}></div>
							<p>Loading Minecraft version metadata...</p>
							<span>Your Java requirements will appear once the manifest is ready.</span>
						</div>
					}
				>
					<div class={styles["java-requirements-list"]}>
						<For each={props.requirements}>
							{(req: any) => {
							const versionOptions = () =>
								props.javaOptions.filter(
									(option) => option.version === req.major_version,
								);

							return (
								<div class={styles["java-req-item"]}>
									<div class={styles["java-req-header"]}>
										<h3>{req.recommended_name}</h3>
									</div>

									<div class={styles["java-options-grid"]}>
										<For each={versionOptions()}>
											{(option) => <JavaOptionCard option={option} />}
										</For>
									</div>
								</div>
							);
						}}
					</For>
				</div>
			</Show>
		</SettingsCard>

		<SettingsCard
			header="Performance & Graphics"
			subHeader="Optimization settings for game performance."
		>
				<SettingsField
					label="Use Dedicated GPU"
					description="Attempt to force Minecraft to use your high-performance graphics card (NVIDIA/AMD)."
					layout="inline"
					control={
						<Switch
							checked={props.useDedicatedGpu}
							onCheckedChange={props.handleGpuToggle}
						>
							<SwitchControl>
								<SwitchThumb />
							</SwitchControl>
						</Switch>
					}
				/>
			</SettingsCard>
		</div>
	);
}
