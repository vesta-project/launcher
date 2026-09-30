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
import { createNotification } from "@utils/notifications";
import { simulateUpdateProcess } from "@utils/updater";
import { createSignal, For, onMount, Show } from "solid-js";
import styles from "../settings-page.module.css";
import { t } from "~/localization";
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
				title: t("settings-developer-select-instance-title"),
				description: t("settings-developer-select-instance-description"),
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
				title: t("settings-developer-crash-simulated-title"),
				description: t("settings-developer-crash-simulated-description", {
					scenario: scenario.label,
				}),
				severity: "info",
			});
			if (openCrashTab()) {
				openInstanceTab(slug, "crash");
			}
		} catch (error) {
			showToast({
				title: t("settings-developer-simulation-failed-title"),
				description: String(error),
				severity: "error",
			});
		} finally {
			setBusyScenario(null);
		}
	};

	const showNotificationPreview = async (severity: "warning" | "error") => {
		const instance =
			instancesState.instances.find(
				(item) => getInstanceSlug(item) === selectedSlug(),
			) ?? instancesState.instances[0];
		const instanceName =
			instance?.name ?? t("settings-developer-example-instance");

		await createNotification({
			client_key: `developer_notification_preview_${severity}`,
			title:
				severity === "warning"
					? t("settings-developer-update-recovery-required-title")
					: t("settings-developer-modpack-update-failed-title"),
			description:
				severity === "warning"
					? t("settings-developer-update-recovery-required-description", {
							instance: instanceName,
						})
					: t("settings-developer-modpack-update-failed-description", {
							instance: instanceName,
						}),
			severity,
			notification_type: "patient",
			dismissible: true,
			metadata: {
				context: instance
					? {
							kind: "instance",
							id: String(instance.id),
							label: instance.name,
						}
					: {
							kind: "channel",
							label: t("settings-developer-preview-channel-label"),
							source: "launcher",
						},
			},
		});
	};

	const showGlobeNotificationPreview = async () => {
		await createNotification({
			client_key: "developer_notification_preview_globe",
			title: t("settings-developer-globe-icon-preview-title"),
			description: t("settings-developer-globe-icon-preview-description"),
			severity: "info",
			notification_type: "patient",
			dismissible: true,
			metadata: {
				context: {
					kind: "channel",
					label: t("settings-developer-news-channel-label"),
					source: "news",
				},
			},
		});
	};

	return (
		<div class={styles["settings-tab-content"]}>
			<div class={panelStyles["settings-panel"]}>
				<SettingsCard header={t("settings-developer-debug-settings-title")}>
					<SettingsField
						label={t("settings-developer-debug-logging-label")}
						description={t("settings-developer-debug-logging-description")}
						headerRight={
							<Switch
								checked={debugLogging()}
								onCheckedChange={handleDebugToggle}
							>
								<SwitchControl>
									<SwitchThumb />
								</SwitchControl>
							</Switch>
						}
					/>
					<SettingsField
						label={t("settings-developer-reset-notifications-label")}
						description={t("settings-developer-reset-notifications-description")}
						headerRight={
							<LauncherButton
								type="destructive"
								onClick={async () => {
									await invoke("reset_notification_system");
									showToast({
										title: t("settings-developer-notifications-reset-title"),
										description: t("settings-developer-notifications-reset-description"),
										severity: "success",
									});
								}}
							>
								{t("settings-developer-reset-system-button")}
							</LauncherButton>
						}
					/>
				</SettingsCard>

				<SettingsCard header={t("settings-developer-crash-simulation-title")}>
					<SettingsField
						label={t("settings-developer-target-instance-label")}
						description={t("settings-developer-target-instance-description")}
						headerRight={
							<select
								class={devStyles.instanceSelect}
								value={selectedSlug()}
								onChange={(e) => setSelectedSlug(e.currentTarget.value)}
							>
								<option value="">
									{t("settings-developer-select-instance-placeholder")}
								</option>
								<For each={instancesState.instances}>
									{(instance) => (
										<option value={getInstanceSlug(instance)}>
											{instance.name}
										</option>
									)}
								</For>
							</select>
						}
					/>
					<SettingsField
						label={t("settings-developer-open-crash-tab-label")}
						description={t("settings-developer-open-crash-tab-description")}
						headerRight={
							<Switch
								checked={openCrashTab()}
								onCheckedChange={setOpenCrashTab}
							>
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
								{t("settings-developer-crash-scenarios-unavailable")}
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
										<span class={devStyles.scenarioLabel}>
											{scenario.label}
										</span>
										<span class={devStyles.scenarioCategory}>
											{scenario.category}
										</span>
									</button>
								)}
							</For>
						</div>
					</Show>
				</SettingsCard>

				<SettingsCard header={t("settings-developer-updater-simulation-title")}>
					<SettingsField
						label={t("settings-developer-simulate-app-update-label")}
						description={t("settings-developer-simulate-app-update-description")}
						headerRight={
							<LauncherButton onClick={() => simulateUpdateProcess()}>
								{t("settings-developer-simulate-full-update-button")}
							</LauncherButton>
						}
					/>
					<SettingsField
						label={t("settings-developer-simulate-discovery-label")}
						description={t("settings-developer-simulate-discovery-description")}
						headerRight={
							<LauncherButton
								onClick={async () => {
									const actions = [
										{
											id: "open_update_dialog",
											label: t("settings-developer-update-now-action"),
											type: "primary",
										},
									];
									await invoke("create_notification", {
										payload: {
											client_key: "app_update_available",
											title: t("settings-developer-update-available-title"),
											description: t("settings-developer-update-available-description"),
											severity: "info",
											notification_type: "patient",
											dismissible: true,
											actions: JSON.stringify(actions),
										},
									});
								}}
							>
								{t("settings-developer-simulate-discovery-button")}
							</LauncherButton>
						}
					/>
				</SettingsCard>

				<SettingsCard header={t("settings-developer-notification-testing-title")}>
					<SettingsField
						label={t("settings-developer-warning-notification-label")}
						description={t("settings-developer-warning-notification-description")}
						headerRight={
							<LauncherButton
								onClick={() => void showNotificationPreview("warning")}
							>
								{t("settings-developer-test-warning-button")}
							</LauncherButton>
						}
					/>
					<SettingsField
						label={t("settings-developer-error-notification-label")}
						description={t("settings-developer-error-notification-description")}
						headerRight={
							<LauncherButton
								type="destructive"
								onClick={() => void showNotificationPreview("error")}
							>
								{t("settings-developer-test-error-button")}
							</LauncherButton>
						}
					/>
					<SettingsField
						label={t("settings-developer-globe-icon-label")}
						description={t("settings-developer-globe-icon-description")}
						headerRight={
							<LauncherButton
								onClick={() => void showGlobeNotificationPreview()}
							>
								{t("settings-developer-test-globe-button")}
							</LauncherButton>
						}
					/>
				</SettingsCard>

				<SettingsCard header={t("settings-developer-account-testing-title")}>
					<SettingsField
						label={t("settings-developer-add-demo-account-label")}
						description={t("settings-developer-add-demo-account-description")}
						headerRight={
							<LauncherButton
								onClick={async () => {
									await invoke("start_demo_session");
									showToast({
										title: t("settings-developer-demo-account-added-title"),
										description: t("settings-developer-demo-account-added-description"),
										severity: "success",
									});
								}}
							>
								{t("settings-developer-add-demo-account-button")}
							</LauncherButton>
						}
					/>
				</SettingsCard>

				<SettingsCard header={t("settings-developer-sentry-testing-title")}>
					<SettingsField
						label={t("settings-developer-test-error-capture-label")}
						description={t("settings-developer-test-error-capture-description")}
						headerRight={
							<LauncherButton
								type="destructive"
								onClick={() => {
									throw new Error(
										t("settings-developer-test-sentry-error-message"),
									);
								}}
							>
								{t("settings-developer-trigger-test-error-button")}
							</LauncherButton>
						}
					/>
					<SettingsField
						label={t("settings-developer-test-backend-panic-label")}
						description={t("settings-developer-test-backend-panic-description")}
						headerRight={
							<LauncherButton
								type="destructive"
								onClick={async () => {
									try {
										await invoke("trigger_test_panic");
									} catch (_e) {
										showToast({
											title: t("settings-developer-panic-triggered-title"),
											description: t("settings-developer-panic-triggered-description"),
											severity: "info",
										});
									}
								}}
							>
								{t("settings-developer-trigger-backend-panic-button")}
							</LauncherButton>
						}
					/>
				</SettingsCard>
			</div>
		</div>
	);
}
