import { SettingsCard, SettingsField } from "@components/settings";
import LauncherButton from "@ui/button/button";
import { openExternal } from "@utils/external-link";
import { Switch, SwitchControl, SwitchThumb } from "@ui/switch/switch";
import { setPageViewerOpen, router } from "@components/page-viewer/page-viewer";
import { startAppTutorial } from "@utils/tutorial";
import { checkForAppUpdates } from "@utils/updater";
import styles from "../settings-page.module.css";

interface HelpSettingsTabProps {
	close?: () => void;
	navigate: (path: string) => void;
	autoUpdateEnabled: boolean;
	handleAutoUpdateToggle: (checked: boolean) => void;
	startupCheckUpdates: boolean;
	handleStartupCheckToggle: (checked: boolean) => void;
	version: string;
}

export function HelpSettingsTab(props: HelpSettingsTabProps) {
	return (
		<div class={styles["settings-tab-content"]}>
			<SettingsCard header="Minecraft Modding">
				<SettingsField
					label="Documentation"
					description="Technical overview of modding frameworks, runtime environments, and configuration."
					control={
						<LauncherButton
							onClick={() => props.navigate("/modding-guide")}
						>
							View Docs
						</LauncherButton>
					}
				/>
			</SettingsCard>

			<SettingsCard header="App Tutorial">
				<SettingsField
					label="Platform Walkthrough"
					description="Initiate the interactive walkthrough to familiarize yourself with Vesta's interface."
					control={
						<LauncherButton
							onClick={() => {
								props.close?.();
								setTimeout(() => startAppTutorial(), 100);
							}}
						>
							Run Tutorial
						</LauncherButton>
					}
				/>
			</SettingsCard>

			<SettingsCard header="Support">
				<div
					class={styles["social-links"]}
					style={{ display: "flex", gap: "8px" }}
				>
					<LauncherButton
						variant="ghost"
						onClick={() =>
							openExternal("https://github.com/vesta-project/launcher")
						}
					>
						GitHub
					</LauncherButton>
					<LauncherButton
						variant="ghost"
						onClick={() =>
							openExternal("https://discord.gg/zuDNHNHk8E")
						}
					>
						Discord
					</LauncherButton>
				</div>
			</SettingsCard>

			<SettingsCard header="App Updates">
				<SettingsField
					label="Automatic Updates"
					description="Download and install updates automatically in the background"
					control={
						<Switch
							checked={props.autoUpdateEnabled}
							onCheckedChange={props.handleAutoUpdateToggle}
						>
							<SwitchControl>
								<SwitchThumb />
							</SwitchControl>
						</Switch>
					}
				/>
				<SettingsField
					label="Check on Startup"
					description="Check for new versions when the launcher starts"
					control={
						<Switch
							checked={props.startupCheckUpdates}
							onCheckedChange={props.handleStartupCheckToggle}
						>
							<SwitchControl>
								<SwitchThumb />
							</SwitchControl>
						</Switch>
					}
				/>
				<SettingsField
					label="Update Check"
					control={
						<LauncherButton onClick={() => checkForAppUpdates()}>
							Check Now
						</LauncherButton>
					}
				/>
			</SettingsCard>

			<SettingsCard header="About">
				<div class={styles["about-info"]}>
					<div class={styles["about-field"]}>
						<span>App Version</span>
						<div style={{ display: "flex", "align-items": "center", gap: "0.5rem" }}>
							<span>{props.version || "..."}</span>
							<LauncherButton 
								variant="ghost" 
								size="sm" 
								onClick={() => {
									router().navigate("/changelog");
									setPageViewerOpen(true);
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
					
					<a
						href="https://www.gnu.org/licenses/gpl-3.0.html"
						target="_blank"
						rel="noopener noreferrer"
					>
						<div class={styles["about-field"]} >
							<span>License</span>
							<span>GNU General Public License v3.0</span>
						</div>
					</a>
				</div>
			</SettingsCard>
		</div>
	);
}
