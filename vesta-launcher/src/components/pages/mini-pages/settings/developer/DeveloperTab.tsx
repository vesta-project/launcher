import { SettingsCard, SettingsField } from "@components/settings";
import panelStyles from "@components/settings/settings.module.css";
import { instancesState } from "@stores/instances";
import { debugLogging, handleDebugToggle } from "@stores/settings";
import { invoke } from "@tauri-apps/api/core";
import LauncherButton from "@ui/button/button";
import { Switch, SwitchControl, SwitchThumb } from "@ui/switch/switch";
import { showToast } from "@ui/toast/toast";
import { getInstanceSlug } from "@utils/instances";
import { openInstanceTab } from "@utils/launch-intents";
import { simulateUpdateProcess } from "@utils/updater";
import { createSignal, For, onMount, Show } from "solid-js";
import styles from "../settings-page.module.css";
import devStyles from "./developer-tab.module.css";

type CrashScenarioInfo = {
	id: string;
	label: string;
	category: string;
};

export function DeveloperSettingsTab() {
	const [scenarios, setScenarios] = createSignal<CrashScenarioInfo[]>([]);
	const [selectedSlug, setSelectedSlug] = createSignal("");
	const [openCrashTab, setOpenCrashTab] = createSignal(true);
	const [busyScenario, setBusyScenario] = createSignal<string | null>(null);

	onMount(async () => {
		try {
			const catalog = await invoke<CrashScenarioInfo[]>("list_crash_scenarios");
			setScenarios(catalog);
		} catch (error) {
			console.error("Failed to load crash scenarios:", error);
		}
	});

	const emitScenario = async (scenario: CrashScenarioInfo) => {
		const slug = selectedSlug();
		if (!slug) {
			showToast({
				title: "Select an instance",
				description: "Choose an instance before simulating a crash.",
				severity: "warning",
			});
			return;
		}

		setBusyScenario(scenario.id);
		try {
			await invoke("emit_fake_crash_scenario", {
				instanceIdSlug: slug,
				scenario: scenario.id,
			});
			showToast({
				title: "Crash simulated",
				description: `${scenario.label} applied to the selected instance.`,
				severity: "info",
			});
			if (openCrashTab()) {
				openInstanceTab(slug, "crash");
			}
		} catch (error) {
			showToast({
				title: "Simulation failed",
				description: String(error),
				severity: "error",
			});
		} finally {
			setBusyScenario(null);
		}
	};

	return (
		<div class={styles["settings-tab-content"]}>
			<div class={panelStyles["settings-panel"]}>
			<SettingsCard header="Debug Settings">
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

			<SettingsCard header="Crash Simulation">
				<SettingsField
					label="Target instance"
					description="Simulated crashes are stored on the selected instance (dev builds only)"
					headerRight={
						<select
							class={devStyles.instanceSelect}
							value={selectedSlug()}
							onChange={(e) => setSelectedSlug(e.currentTarget.value)}
						>
							<option value="">Select instance…</option>
							<For each={instancesState.instances}>
								{(instance) => (
									<option value={getInstanceSlug(instance)}>{instance.name}</option>
								)}
							</For>
						</select>
					}
				/>
				<SettingsField
					label="Open crash tab"
					description="Navigate to the instance Crash tab after emitting a scenario"
					headerRight={
						<Switch checked={openCrashTab()} onCheckedChange={setOpenCrashTab}>
							<SwitchControl>
								<SwitchThumb />
							</SwitchControl>
						</Switch>
					}
				/>
				<Show
					when={scenarios().length > 0}
					fallback={
						<p class={devStyles.hint}>
							Crash scenarios are only available in development builds.
						</p>
					}
				>
					<div class={devStyles.scenarioGrid}>
						<For each={scenarios()}>
							{(scenario) => (
								<button
									type="button"
									class={devStyles.scenarioButton}
									disabled={!selectedSlug() || busyScenario() === scenario.id}
									onClick={() => void emitScenario(scenario)}
								>
									<span class={devStyles.scenarioLabel}>{scenario.label}</span>
									<span class={devStyles.scenarioCategory}>{scenario.category}</span>
								</button>
							)}
						</For>
					</div>
				</Show>
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
		</div>
	);
}
