import { SettingsCard, SettingsField } from "@components/settings";
import { invoke } from "@tauri-apps/api/core";
import {
	NumberField,
	NumberFieldDecrementTrigger,
	NumberFieldGroup,
	NumberFieldIncrementTrigger,
	NumberFieldInput,
} from "@ui/number-field/number-field";
import { Switch, SwitchControl, SwitchThumb } from "@ui/switch/switch";
import { hasTauriRuntime } from "@utils/tauri-runtime";
import styles from "../settings-page.module.css";

interface GeneralSettingsTabProps {
	reducedMotion: boolean;
	handleReducedMotionToggle: (checked: boolean) => void;
	discordPresenceEnabled: boolean;
	handleDiscordToggle: (checked: boolean) => void;
	telemetryEnabled: boolean;
	handleTelemetryToggle: (checked: boolean) => void;
	autoInstallDependencies: boolean;
	handleAutoInstallDepsToggle: (checked: boolean) => void;
	maxDownloadThreads: number;
	setMaxDownloadThreads: (val: number) => void;
	handleOpenAppData: () => void;
	cacheSizeValue: string;
	handleClearCache: () => void;
	showTrayIcon: boolean;
	handleShowTrayIconToggle: (checked: boolean) => void;
	closeToTray: boolean;
	handleCloseToTrayToggle: (checked: boolean) => void;
}

export function GeneralSettingsTab(props: GeneralSettingsTabProps) {
	const privacyPolicyUrl = "https://github.com/vesta-project/launcher/blob/main/docs/legal/PRIVACY_POLICY.md";

	return (
		<div class={styles["settings-tab-content"]}>
			<SettingsCard header="Accessibility">
				<SettingsField
					label="Reduced Motion"
					description="Disable UI animations for a faster and cleaner experience."
					headerRight={
						<Switch checked={props.reducedMotion} onCheckedChange={props.handleReducedMotionToggle}>
							<SwitchControl>
								<SwitchThumb />
							</SwitchControl>
						</Switch>
					}
				/>
			</SettingsCard>

			<SettingsCard header="Privacy & Integration">
				<SettingsField
					label="Error Telemetry"
					description={
						<>
							Send crash and error diagnostics to help improve reliability.
							{" "}
							<a href={privacyPolicyUrl} target="_blank" rel="noreferrer">
								Privacy Policy
							</a>
						</>
					}
					headerRight={
						<Switch checked={props.telemetryEnabled} onCheckedChange={props.handleTelemetryToggle}>
							<SwitchControl>
								<SwitchThumb />
							</SwitchControl>
						</Switch>
					}
				/>
				<SettingsField
					label="Discord Rich Presence"
					description="Show your current game and status on Discord."
					headerRight={
						<Switch checked={props.discordPresenceEnabled} onCheckedChange={props.handleDiscordToggle}>
							<SwitchControl>
								<SwitchThumb />
							</SwitchControl>
						</Switch>
					}
				/>
			</SettingsCard>

			<SettingsCard header="Resources">
				<SettingsField
					label="Automatically Install Dependencies"
					description="Automatically download and install required mods and engines when adding a new resource."
					headerRight={
						<Switch
							checked={props.autoInstallDependencies}
							onCheckedChange={props.handleAutoInstallDepsToggle}
						>
							<SwitchControl>
								<SwitchThumb />
							</SwitchControl>
						</Switch>
					}
				/>
				<SettingsField
					label="Parallel Download Threads"
					description="Number of simultaneous downloads when installing resources."
					headerRight={
						<NumberField
							value={props.maxDownloadThreads}
							onRawValueChange={async (val) => {
								props.setMaxDownloadThreads(val);
								if (hasTauriRuntime()) {
									await invoke("update_config_field", {
										field: "max_download_threads",
										value: val,
									});
								}
							}}
							minValue={1}
							maxValue={16}
						>
							<NumberFieldGroup>
								<NumberFieldInput />
								<NumberFieldIncrementTrigger />
								<NumberFieldDecrementTrigger />
							</NumberFieldGroup>
						</NumberField>
					}
				/>
			</SettingsCard>

			<SettingsCard header="Application Data">
				<SettingsField
					label="AppData Directory"
					description="Open the folder where Vesta Launcher stores its data."
					actionLabel="Open Folder"
					onAction={props.handleOpenAppData}
				/>
				<SettingsField
					label="Clear Cache"
					description={`Stored data: ${props.cacheSizeValue || "..."}. Clear metadata and temporary files to fix sync issues.`}
					actionLabel="Clear Now"
					onAction={props.handleClearCache}
				/>
			</SettingsCard>

			<SettingsCard header="System Tray">
				<SettingsField
					label="Show Tray Icon"
					description="Display the launcher icon in the system tray."
					headerRight={
						<Switch checked={props.showTrayIcon} onCheckedChange={props.handleShowTrayIconToggle}>
							<SwitchControl>
								<SwitchThumb />
							</SwitchControl>
						</Switch>
					}
				/>
				<SettingsField
					label="Close Button Hides To Tray"
					description="When enabled, clicking the window close button hides the launcher to tray instead of requesting app exit."
					headerRight={
						<Switch checked={props.closeToTray} onCheckedChange={props.handleCloseToTrayToggle}>
							<SwitchControl>
								<SwitchThumb />
							</SwitchControl>
						</Switch>
					}
				/>
			</SettingsCard>

			<SettingsCard header="Troubleshooting">
				<SettingsField
					label="Reset Onboarding"
					description="Redo the first-time setup process. This will not delete your accounts or instances."
					actionLabel="Redo Setup"
					destructive
					confirmationDesc="Are you sure you want to redo the onboarding process? You will be taken back to the welcome screen."
					onAction={async () => {
						try {
							await invoke("reset_onboarding");
							window.location.href = "/"; // Force reload to root
						} catch (e) {
							console.error("Failed to reset onboarding:", e);
						}
					}}
				/>
			</SettingsCard>
		</div>
	);
}
