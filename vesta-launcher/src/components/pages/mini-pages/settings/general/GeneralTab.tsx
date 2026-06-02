import { SettingsCard, SettingsField } from "@components/settings";
import panelStyles from "@components/settings/settings.module.css";
import {
	autoInstallDependencies,
	autostartEnabled,
	closeToTray,
	discordPresenceEnabled,
	getCacheSizeDisplay,
	handleAutoInstallDepsToggle,
	handleAutostartToggle,
	handleClearCache,
	handleCloseToTrayToggle,
	handleDiscordToggle,
	handleGpuToggle,
	handleMaxDownloadThreadsChange,
	handleOpenAppData,
	handleReducedMotionToggle,
	handleShowTrayIconToggle,
	handleTelemetryToggle,
	maxDownloadThreads,
	reducedMotion,
	showTrayIcon,
	telemetryEnabled,
	useDedicatedGpu,
} from "@stores/settings";
import {
	NumberField,
	NumberFieldDecrementTrigger,
	NumberFieldGroup,
	NumberFieldIncrementTrigger,
	NumberFieldInput,
} from "@ui/number-field/number-field";
import { Switch, SwitchControl, SwitchThumb } from "@ui/switch/switch";
import { invoke } from "@tauri-apps/api/core";
import { router } from "@components/page-viewer/page-viewer";
import { createEffect, createSignal } from "solid-js";
import styles from "../settings-page.module.css";

export function GeneralSettingsTab() {
	const privacyPolicyUrl =
		"https://github.com/vesta-project/launcher/blob/main/docs/legal/PRIVACY_POLICY.md";

	const [osReducedMotion, setOsReducedMotion] = createSignal(false);

	createEffect(() => {
		setOsReducedMotion(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
	});

	return (
		<div class={styles["settings-tab-content"]}>
			<div class={panelStyles["settings-panel"]}>
			<SettingsCard header="Accessibility">
				{osReducedMotion() && (
					<div
						style={{
							"background-color": "hsl(var(--hue-warning) 70% 55% / 0.15)",
							border: "1px solid hsl(var(--hue-warning) 70% 50% / 0.3)",
							"border-radius": "8px",
							padding: "12px 16px",
							"margin-bottom": "16px",
							"font-size": "var(--font-xxsmall)",
							color: "var(--text-secondary)",
							"line-height": "1.5",
						}}
					>
						<strong>OS Animation Disabled:</strong> Your operating system has animations disabled in
						accessibility settings. UI animations won't appear until you enable them in your system
						preferences.
					</div>
				)}
				<SettingsField
					label="Reduced Motion"
					description="Disable UI animations for a faster and cleaner experience."
					headerRight={
						<Switch checked={reducedMotion()} onCheckedChange={handleReducedMotionToggle}>
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
							Send crash and error diagnostics to help improve reliability.{" "}
							<a href={privacyPolicyUrl} target="_blank" rel="noreferrer">
								Privacy Policy
							</a>
						</>
					}
					headerRight={
						<Switch checked={telemetryEnabled()} onCheckedChange={handleTelemetryToggle}>
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
						<Switch checked={discordPresenceEnabled()} onCheckedChange={handleDiscordToggle}>
							<SwitchControl>
								<SwitchThumb />
							</SwitchControl>
						</Switch>
					}
				/>
			</SettingsCard>

			<SettingsCard header="Performance" subHeader="Optimization settings for game performance.">
				<SettingsField
					label="Use Dedicated GPU"
					description="Attempt to force Minecraft to use your high-performance graphics card (NVIDIA/AMD)."
					headerRight={
						<Switch checked={useDedicatedGpu()} onCheckedChange={handleGpuToggle}>
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
							checked={autoInstallDependencies()}
							onCheckedChange={handleAutoInstallDepsToggle}
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
							value={maxDownloadThreads()}
							onRawValueChange={(val) => handleMaxDownloadThreadsChange(val)}
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
					onAction={handleOpenAppData}
				/>
				<SettingsField
					label="Clear Cache"
					description={`Stored data: ${getCacheSizeDisplay() || "..."}. Clear metadata and temporary files to fix sync issues.`}
					actionLabel="Clear Now"
					onAction={handleClearCache}
				/>
			</SettingsCard>

			<SettingsCard header="System Tray">
				<SettingsField
					label="Launch On System Startup"
					description="Start Vesta Launcher automatically when you sign in."
					headerRight={
						<Switch checked={autostartEnabled()} onCheckedChange={handleAutostartToggle}>
							<SwitchControl>
								<SwitchThumb />
							</SwitchControl>
						</Switch>
					}
				/>
				<SettingsField
					label="Show Tray Icon"
					description="Display the launcher icon in the system tray."
					headerRight={
						<Switch checked={showTrayIcon()} onCheckedChange={handleShowTrayIconToggle}>
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
						<Switch checked={closeToTray()} onCheckedChange={handleCloseToTrayToggle}>
							<SwitchControl>
								<SwitchThumb />
							</SwitchControl>
						</Switch>
					}
				/>
			</SettingsCard>

			<SettingsCard header="Troubleshooting">
				<SettingsField
					label="Launcher Import"
					description="Open the launcher import flow to bring in instances from other launchers."
					actionLabel="Open Importer"
					onAction={() => router()?.navigate("/install/import")}
				/>
				<SettingsField
					label="Reset Onboarding"
					description="Redo the first-time setup process. This will not delete your accounts or instances."
					actionLabel="Redo Setup"
					destructive
					confirmationDesc="Are you sure you want to redo the onboarding process? You will be taken back to the welcome screen."
					onAction={async () => {
						try {
							await invoke("reset_onboarding");
							window.location.href = "/";
						} catch (e) {
							console.error("Failed to reset onboarding:", e);
						}
					}}
				/>
			</SettingsCard>
			</div>
		</div>
	);
}
