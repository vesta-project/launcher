import { openMiniPage, router } from "@components/page-viewer/page-viewer";
import { SettingsCard, SettingsField } from "@components/settings";
import panelStyles from "@components/settings/settings.module.css";
import { restartHomeIntro } from "@stores/home-intro";
import {
	autoUpdateEnabled,
	debugLogging,
	handleAutoUpdateToggle,
	handleDebugToggle,
	handleStartupCheckToggle,
	startupCheckUpdates,
	version,
} from "@stores/settings";
import { invoke } from "@tauri-apps/api/core";
import LauncherButton from "@ui/button/button";
import { Switch, SwitchControl, SwitchThumb } from "@ui/switch/switch";
import { openExternal } from "@utils/external-link";
import { checkForAppUpdates } from "@utils/updater";
import { t } from "~/localization";
import styles from "../settings-page.module.css";
import { StorageUsageViewer } from "./storage-usage-viewer";

export function HelpSettingsTab(props: { close?: () => void }) {
	return (
		<div class={styles["settings-tab-content"]}>
			<div class={panelStyles["settings-panel"]}>
				<SettingsCard header={t("settings-help-modding-card-title")}>
					<SettingsField
						label={t("settings-help-modding-docs-label")}
						description={t("settings-help-modding-docs-description")}
						headerRight={
							<LauncherButton
								onClick={() => router()?.navigate("/modding-guide")}
							>
								{t("settings-help-modding-docs-action")}
							</LauncherButton>
						}
					/>
				</SettingsCard>

				<SettingsCard header={t("settings-help-tutorial-card-title")}>
					<SettingsField
						label={t("settings-help-tutorial-label")}
						description={t("settings-help-tutorial-description")}
						headerRight={
							<LauncherButton
								onClick={() => {
									props.close?.();
									setTimeout(() => restartHomeIntro(), 100);
								}}
							>
								{t("settings-help-tutorial-action")}
							</LauncherButton>
						}
					/>
				</SettingsCard>

				<SettingsCard header={t("settings-help-troubleshooting-card-title")}>
					<SettingsField
						label={t("settings-help-import-label")}
						description={t("settings-help-import-description")}
						actionLabel={t("settings-help-import-action")}
						onAction={() => router()?.navigate("/install/import")}
					/>
					<SettingsField
						label={t("settings-help-reset-onboarding-label")}
						description={t("settings-help-reset-onboarding-description")}
						actionLabel={t("settings-help-reset-onboarding-action")}
						destructive
						confirmationDesc={t("settings-help-reset-onboarding-confirmation")}
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

				<SettingsCard header={t("settings-help-support-card-title")}>
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
							{t("settings-help-github")}
						</LauncherButton>
						<LauncherButton
							variant="ghost"
							onClick={() => openExternal("https://discord.gg/zuDNHNHk8E")}
						>
							{t("settings-help-discord")}
						</LauncherButton>
					</div>
				</SettingsCard>

				<SettingsCard
					header={t("settings-help-storage-card-title")}
					subHeader={t("settings-help-storage-card-subheader")}
				>
					<StorageUsageViewer />
				</SettingsCard>

				<SettingsCard header={t("settings-help-updates-card-title")}>
					<SettingsField
						label={t("settings-help-auto-updates-label")}
						description={t("settings-help-auto-updates-description")}
						headerRight={
							<Switch
								checked={autoUpdateEnabled()}
								onCheckedChange={handleAutoUpdateToggle}
							>
								<SwitchControl>
									<SwitchThumb />
								</SwitchControl>
							</Switch>
						}
					/>
					<SettingsField
						label={t("settings-help-check-startup-label")}
						description={t("settings-help-check-startup-description")}
						headerRight={
							<Switch
								checked={startupCheckUpdates()}
								onCheckedChange={handleStartupCheckToggle}
							>
								<SwitchControl>
									<SwitchThumb />
								</SwitchControl>
							</Switch>
						}
					/>
					<SettingsField
						label={t("settings-help-debug-logging-label")}
						description={t("settings-help-debug-logging-description")}
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
						label={t("settings-help-update-check-label")}
						headerRight={
							<LauncherButton onClick={() => checkForAppUpdates()}>
								{t("settings-help-update-check-action")}
							</LauncherButton>
						}
					/>
				</SettingsCard>

				<SettingsCard header={t("settings-help-about-card-title")}>
					<div class={styles["about-info"]}>
						<div class={styles["about-field"]}>
							<span>{t("settings-help-app-version-label")}</span>
							<div
								style={{
									display: "flex",
									"align-items": "center",
									gap: "0.5rem",
								}}
							>
								<span>{version() || t("settings-help-version-placeholder")}</span>
								<LauncherButton
									variant="ghost"
									size="sm"
									onClick={() => {
										openMiniPage("/changelog");
									}}
								>
									{t("settings-help-view-changelog-action")}
								</LauncherButton>
							</div>
						</div>
						<div class={styles["about-field"]}>
							<span>{t("settings-help-platform-label")}</span>
							<span>{t("settings-help-platform-value")}</span>
						</div>

						<a
							href="https://www.gnu.org/licenses/gpl-3.0.html"
							target="_blank"
							rel="noopener noreferrer"
						>
							<div class={styles["about-field"]}>
								<span>{t("settings-help-license-label")}</span>
								<span>{t("settings-help-license-value")}</span>
							</div>
						</a>
					</div>
				</SettingsCard>
			</div>
		</div>
	);
}
