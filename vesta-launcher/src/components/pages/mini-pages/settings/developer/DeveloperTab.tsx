import { SettingsCard, SettingsField } from "@components/settings";
import { invoke } from "@tauri-apps/api/core";
import LauncherButton from "@ui/button/button";
import { Switch, SwitchControl, SwitchThumb } from "@ui/switch/switch";
import { showToast } from "@ui/toast/toast";
import { simulateUpdateProcess } from "@utils/updater";
import styles from "../settings-page.module.css";

interface DeveloperSettingsTabProps {
	debugLogging: boolean;
	handleDebugToggle: (checked: boolean) => void;
	handleOpenAppSettingsLocation: () => void;
	handleOpenRuntimeStorageLocation: () => void;
}

export function DeveloperSettingsTab(props: DeveloperSettingsTabProps) {
	return (
		<div class={styles["settings-tab-content"]}>
			<SettingsCard header="Data Paths">
				<SettingsField
					label="Open App Settings Location"
					description="Open the directory where Vesta stores app configuration and data files."
					actionLabel="Open Folder"
					onAction={props.handleOpenAppSettingsLocation}
				/>
				<SettingsField
					label="Open Runtime Storage Location"
					description="Open the Local AppData-style folder where runtime cache data (player heads, account capes, etc.) is stored."
					actionLabel="Open Folder"
					onAction={props.handleOpenRuntimeStorageLocation}
				/>
			</SettingsCard>

			<SettingsCard header="Debug Settings">
				<SettingsField
					label="Debug Logging"
					description="Enable verbose logging for troubleshooting"
					headerRight={
						<Switch checked={props.debugLogging} onCheckedChange={props.handleDebugToggle}>
							<SwitchControl>
								<SwitchThumb />
							</SwitchControl>
						</Switch>
					}
				/>
				<SettingsField
					label="Reset Notifications"
					description="Force-reset seen items and clear notification history"
					headerRight={
						<LauncherButton
							type="destructive"
							onClick={async () => {
								await invoke("reset_notification_system");
								showToast({
									title: "Notifications Reset",
									description: "Notification history and seen items cleared.",
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
					headerRight={
						<LauncherButton onClick={() => simulateUpdateProcess()}>Simulate Full Update</LauncherButton>
					}
				/>
				<SettingsField
					label="Simulate Discovery"
					description="Trigger only the 'Update Available' notification (Native Notification)"
					headerRight={
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
										description: "Vesta Launcher v9.9.9 is now available!",
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

			<SettingsCard header="Account Testing">
				<SettingsField
					label="Add Demo Account"
					description="Add a temporary demo account that is removed on restart"
					headerRight={
						<LauncherButton
							onClick={async () => {
								await invoke("start_demo_session");
								showToast({
									title: "Demo Account Added",
									description: "Temporal account 'DemoUser' is now active.",
									severity: "success",
								});
							}}
						>
							Add Demo Account
						</LauncherButton>
					}
				/>
			</SettingsCard>

			<SettingsCard header="Sentry Testing">
				<SettingsField
					label="Test Error Capture"
					description="Trigger an error to verify Sentry monitoring is working correctly"
					headerRight={
						<LauncherButton
							type="destructive"
							onClick={() => {
								throw new Error(
									"Test Sentry Error - Frontend Exception. Check Sentry dashboard to verify capture.",
								);
							}}
						>
							Trigger Test Error
						</LauncherButton>
					}
				/>
				<SettingsField
					label="Test Backend Panic"
					description="Trigger a panic on the backend to test backend Sentry capture"
					headerRight={
						<LauncherButton
							type="destructive"
							onClick={async () => {
								try {
									await invoke("trigger_test_panic");
								} catch (_e) {
									showToast({
										title: "Panic Triggered",
										description: "Backend panic was captured. Check Sentry dashboard.",
										severity: "info",
									});
								}
							}}
						>
							Trigger Backend Panic
						</LauncherButton>
					}
				/>
			</SettingsCard>
		</div>
	);
}
