import { openMiniPage, router } from "@components/page-viewer/page-viewer";
import { SettingsCard, SettingsField } from "@components/settings";
import panelStyles from "@components/settings/settings.module.css";
import {
	autoUpdateEnabled,
	debugLogging,
	handleAutoUpdateToggle,
	handleDebugToggle,
	handleStartupCheckToggle,
	startupCheckUpdates,
	version,
} from "@stores/settings";
import LauncherButton from "@ui/button/button";
import { Switch, SwitchControl, SwitchThumb } from "@ui/switch/switch";
import { openExternal } from "@utils/external-link";
import { restartHomeIntro } from "@stores/home-intro";
import { checkForAppUpdates } from "@utils/updater";
import styles from "../settings-page.module.css";

export function HelpSettingsTab(props: { close?: () => void }) {
	return (
		<div class={styles["settings-tab-content"]}>
			<div class={panelStyles["settings-panel"]}>
			<SettingsCard header="Minecraft Modding">
				<SettingsField
					label="Documentation"
					description="Technical overview of modding frameworks, runtime environments, and configuration."
					headerRight={
						<LauncherButton onClick={() => router()?.navigate("/modding-guide")}>View Docs</LauncherButton>
					}
				/>
			</SettingsCard>

			<SettingsCard header="App Tutorial">
				<SettingsField
					label="Platform Walkthrough"
					description="Initiate the interactive walkthrough to familiarize yourself with Vesta's interface."
					headerRight={
						<LauncherButton
							onClick={() => {
								props.close?.();
								setTimeout(() => restartHomeIntro(), 100);
							}}
						>
							Run Tutorial
						</LauncherButton>
					}
				/>
			</SettingsCard>

			<SettingsCard header="Support">
				<div class={styles["social-links"]} style={{ display: "flex", gap: "8px" }}>
					<LauncherButton
						variant="ghost"
						onClick={() => openExternal("https://github.com/vesta-project/launcher")}
					>
						GitHub
					</LauncherButton>
					<LauncherButton variant="ghost" onClick={() => openExternal("https://discord.gg/zuDNHNHk8E")}>
						Discord
					</LauncherButton>
				</div>
			</SettingsCard>

			<SettingsCard header="App Updates">
				<SettingsField
					label="Automatic Updates"
					description="Download and install updates automatically in the background"
					headerRight={
						<Switch checked={autoUpdateEnabled()} onCheckedChange={handleAutoUpdateToggle}>
							<SwitchControl>
								<SwitchThumb />
							</SwitchControl>
						</Switch>
					}
				/>
				<SettingsField
					label="Check on Startup"
					description="Check for new versions when the launcher starts"
					headerRight={
						<Switch checked={startupCheckUpdates()} onCheckedChange={handleStartupCheckToggle}>
							<SwitchControl>
								<SwitchThumb />
							</SwitchControl>
						</Switch>
					}
				/>
				<SettingsField
					label="Debug Logging"
					description="Enable verbose logging for troubleshooting"
					headerRight={
						<Switch checked={debugLogging()} onCheckedChange={handleDebugToggle}>
							<SwitchControl>
								<SwitchThumb />
							</SwitchControl>
						</Switch>
					}
				/>
				<SettingsField
					label="Update Check"
					headerRight={<LauncherButton onClick={() => checkForAppUpdates()}>Check Now</LauncherButton>}
				/>
			</SettingsCard>

			<SettingsCard header="About">
				<div class={styles["about-info"]}>
					<div class={styles["about-field"]}>
						<span>App Version</span>
						<div
							style={{
								display: "flex",
								"align-items": "center",
								gap: "0.5rem",
							}}
						>
							<span>{version() || "..."}</span>
							<LauncherButton
								variant="ghost"
								size="sm"
								onClick={() => {
									openMiniPage("/changelog");
								}}
							>
								View Changelog
							</LauncherButton>
						</div>
					</div>
					<div class={styles["about-field"]}>
						<span>Platform</span>
						<span>Tauri + SolidJS</span>
					</div>

					<a href="https://www.gnu.org/licenses/gpl-3.0.html" target="_blank" rel="noopener noreferrer">
						<div class={styles["about-field"]}>
							<span>License</span>
							<span>GNU General Public License v3.0</span>
						</div>
					</a>
				</div>
			</SettingsCard>
			</div>
		</div>
	);
}
