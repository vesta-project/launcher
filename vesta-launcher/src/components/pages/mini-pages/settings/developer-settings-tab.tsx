import { SettingsCard, SettingsField } from "@components/settings";
import LauncherButton from "@ui/button/button";
import { invoke } from "@tauri-apps/api/core";
import { showToast } from "@ui/toast/toast";
import { Switch, SwitchControl, SwitchThumb } from "@ui/switch/switch";
import { simulateUpdateProcess } from "@utils/updater";
import styles from "./settings-page.module.css";

interface DeveloperSettingsTabProps {
	debugLogging: boolean;
	handleDebugToggle: (checked: boolean) => void;
}

export function DeveloperSettingsTab(props: DeveloperSettingsTabProps) {
	return (
		<div class={styles["settings-tab-content"]}>
			<SettingsCard header="Debug Settings">
				<SettingsField
					label="Debug Logging"
					description="Enable verbose logging for troubleshooting"
					control={
						<Switch
							checked={props.debugLogging}
							onCheckedChange={props.handleDebugToggle}
						>
							<SwitchControl>
								<SwitchThumb />
							</SwitchControl>
						</Switch>
					}
				/>
				<SettingsField
					label="Reset Notifications"
					description="Force-reset seen items and clear notification history"
					control={
						<LauncherButton
							type="destructive"
							onClick={async () => {
								await invoke("reset_notification_system");
								showToast({
									title: "Notifications Reset",
									description:
										"Notification history and seen items cleared.",
									severity: "success",
								});
							}}
						>
							Reset System
						</LauncherButton>
					}
				/>
			</SettingsCard>

			<SettingsCard header="Updater Simulation">
				<SettingsField
					label="Simulate App Update"
					description="Trigger a full update flow simulation (Toast -> Progress -> Ready)"
					control={
						<LauncherButton onClick={() => simulateUpdateProcess()}>
							Simulate Full Update
						</LauncherButton>
					}
				/>
				<SettingsField
					label="Simulate Discovery"
					description="Trigger only the 'Update Available' notification (Native Notification)"
					control={
						<LauncherButton
							onClick={async () => {
								const actions = [
									{
										id: "open_update_dialog",
										label: "Update Now",
										type: "primary",
									},
								];
								await invoke("create_notification", {
									payload: {
										client_key: "app_update_available",
										title: "Update Available (Simulated)",
										description:
											"Vesta Launcher v9.9.9 is now available!",
										severity: "info",
										notification_type: "patient",
										dismissible: true,
										actions: JSON.stringify(actions),
									},
								});
							}}
						>
							Simulate Discovery
						</LauncherButton>
					}
				/>
			</SettingsCard>
		</div>
	);
}
