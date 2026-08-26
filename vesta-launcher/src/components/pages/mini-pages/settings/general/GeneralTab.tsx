import { router } from "@components/page-viewer/page-viewer";
import { SettingsCard, SettingsField } from "@components/settings";
import panelStyles from "@components/settings/settings.module.css";
import {
	artifactCacheLimitBytes,
	autoInstallDependencies,
	autostartEnabled,
	closeToTray,
	discordPresenceEnabled,
	handleArtifactCacheLimitChange,
	handleAutoInstallDepsToggle,
	handleAutostartToggle,
	handleCloseToTrayToggle,
	handleDiscordToggle,
	handleGpuToggle,
	handleMaxDownloadThreadsChange,
	handleProxyApplyToGamesToggle,
	handleProxyEnabledToggle,
	handleProxyUrlChange,
	handleReducedMotionToggle,
	handleShowTrayIconToggle,
	handleTelemetryToggle,
	maxDownloadThreads,
	proxyApplyToGames,
	proxyEnabled,
	proxyRestartRequired,
	proxyUrl,
	reducedMotion,
	showTrayIcon,
	telemetryEnabled,
	testProxyConnection,
	useDedicatedGpu,
} from "@stores/settings";
import LauncherButton from "@ui/button/button";
import {
	NumberField,
	NumberFieldDecrementTrigger,
	NumberFieldGroup,
	NumberFieldIncrementTrigger,
	NumberFieldInput,
} from "@ui/number-field/number-field";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@ui/select/select";
import { Switch, SwitchControl, SwitchThumb } from "@ui/switch/switch";
import { TextFieldInput, TextFieldRoot } from "@ui/text-field/text-field";
import { showToast } from "@ui/toast/toast";
import { createEffect, createMemo, createSignal } from "solid-js";
import {
	changeLanguagePreference,
	getSupportedLocales,
	languagePreference,
	SYSTEM_LANGUAGE,
	t,
} from "~/localization";
import styles from "../settings-page.module.css";

export function GeneralSettingsTab() {
	const privacyPolicyUrl =
		"https://github.com/vesta-project/launcher/blob/main/docs/legal/PRIVACY_POLICY.md";

	const [osReducedMotion, setOsReducedMotion] = createSignal(false);
	const [isTestingProxy, setIsTestingProxy] = createSignal(false);
	const [proxyTestMessage, setProxyTestMessage] = createSignal("");
	const [proxyTestDetail, setProxyTestDetail] = createSignal("");
	const [proxyTestOk, setProxyTestOk] = createSignal<boolean | null>(null);
	const [
		lastHandledStorageFocusRequestId,
		setLastHandledStorageFocusRequestId,
	] = createSignal<number | undefined>();
	let storageCardRef: HTMLDivElement | undefined;

	createEffect(() => {
		setOsReducedMotion(
			window.matchMedia("(prefers-reduced-motion: reduce)").matches,
		);
	});

	createEffect(() => {
		const path = router()?.currentPath.get();
		const props = router()?.currentPathProps?.();
		const requestId = props?.focusArtifactCacheLimitRequestId;
		if (
			path !== "/config" ||
			!props?.focusArtifactCacheLimit ||
			!storageCardRef
		)
			return;
		if (requestId === lastHandledStorageFocusRequestId()) return;

		setLastHandledStorageFocusRequestId(requestId);

		requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				storageCardRef?.scrollIntoView({ behavior: "smooth", block: "start" });
			});
		});
	});

	const handleProxyTest = async () => {
		if (isTestingProxy()) return;
		setIsTestingProxy(true);
		setProxyTestMessage("");
		setProxyTestDetail("");
		setProxyTestOk(null);
		try {
			const result = await testProxyConnection();
			setProxyTestMessage(result.message);
			setProxyTestDetail(result.detail ?? "");
			setProxyTestOk(result.ok);
			showToast({
				title: result.ok
					? t("settings-general-proxy-connected")
					: t("settings-general-proxy-connection-failed"),
				description: result.ok
					? t("settings-general-proxy-connected-description")
					: t("settings-general-proxy-connection-failed-description"),
				severity: result.ok ? "success" : "error",
			});
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			setProxyTestMessage(t("settings-general-proxy-connection-failed"));
			setProxyTestDetail(message);
			setProxyTestOk(false);
			showToast({
				title: t("settings-general-proxy-connection-failed"),
				description: t("settings-general-proxy-connection-failed-description"),
				severity: "error",
			});
		} finally {
			setIsTestingProxy(false);
		}
	};

	const cacheLimitMb = createMemo(() =>
		Math.max(
			1,
			Math.round((artifactCacheLimitBytes() || 1024 * 1024) / (1024 * 1024)),
		),
	);
	const languageOptions = createMemo(() => [
		SYSTEM_LANGUAGE,
		...getSupportedLocales().map((locale) => locale.code),
	]);
	const languageOptionLabel = (preference: string) => {
		if (preference === SYSTEM_LANGUAGE) return t("common-system-default");
		const locale = getSupportedLocales().find(
			(candidate) => candidate.code === preference,
		);
		return locale?.nativeName ?? preference;
	};
	const handleLanguageChange = async (preference: string | null) => {
		if (!preference || preference === languagePreference()) return;

		try {
			await changeLanguagePreference(preference);
		} catch (error) {
			console.error("Failed to change language:", error);
			showToast({
				title: t("common-language-change-failed"),
				description: t("common-language-change-failed-description"),
				severity: "error",
			});
		}
	};

	return (
		<div class={styles["settings-tab-content"]}>
			<div class={panelStyles["settings-panel"]}>
				<SettingsCard header={t("settings-language-card-title")}>
					<SettingsField
						label={t("settings-language-label")}
						description={t("settings-language-description")}
						headerRight={
							<Select<string>
								options={languageOptions()}
								value={languagePreference()}
								onChange={handleLanguageChange}
								optionValue={(value) => value}
								optionTextValue={languageOptionLabel}
								itemComponent={(props) => (
									<SelectItem item={props.item}>
										{languageOptionLabel(props.item.rawValue)}
									</SelectItem>
								)}
							>
								<SelectTrigger style={{ "min-width": "180px" }}>
									<SelectValue<string>>
										{(state) =>
											languageOptionLabel(
												state.selectedOption() ?? languagePreference(),
											)
										}
									</SelectValue>
								</SelectTrigger>
								<SelectContent />
							</Select>
						}
					/>
				</SettingsCard>

				<SettingsCard header={t("settings-general-accessibility-title")}>
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
							{t("settings-general-os-reduced-motion-notice")}
						</div>
					)}
					<SettingsField
						label={t("settings-general-reduced-motion-label")}
						description={t("settings-general-reduced-motion-description")}
						headerRight={
							<Switch
								checked={reducedMotion()}
								onCheckedChange={handleReducedMotionToggle}
							>
								<SwitchControl>
									<SwitchThumb />
								</SwitchControl>
							</Switch>
						}
					/>
				</SettingsCard>

				<SettingsCard header={t("settings-general-privacy-integration-title")}>
					<SettingsField
						label={t("settings-general-telemetry-label")}
						description={
							<>
								{t("settings-general-telemetry-description")}{" "}
								<a href={privacyPolicyUrl} target="_blank" rel="noreferrer">
									{t("settings-general-privacy-policy")}
								</a>
							</>
						}
						headerRight={
							<Switch
								checked={telemetryEnabled()}
								onCheckedChange={handleTelemetryToggle}
							>
								<SwitchControl>
									<SwitchThumb />
								</SwitchControl>
							</Switch>
						}
					/>
					<SettingsField
						label={t("settings-general-discord-presence-label")}
						description={t("settings-general-discord-presence-description")}
						headerRight={
							<Switch
								checked={discordPresenceEnabled()}
								onCheckedChange={handleDiscordToggle}
							>
								<SwitchControl>
									<SwitchThumb />
								</SwitchControl>
							</Switch>
						}
					/>
				</SettingsCard>

				<SettingsCard
					header={t("settings-general-performance-title")}
					subHeader={t("settings-general-performance-subheader")}
				>
					<SettingsField
						label={t("settings-general-dedicated-gpu-label")}
						description={t("settings-general-dedicated-gpu-description")}
						headerRight={
							<Switch
								checked={useDedicatedGpu()}
								onCheckedChange={handleGpuToggle}
							>
								<SwitchControl>
									<SwitchThumb />
								</SwitchControl>
							</Switch>
						}
					/>
				</SettingsCard>

				<SettingsCard header={t("settings-general-resources-title")}>
					<SettingsField
						label={t("settings-general-auto-install-deps-label")}
						description={t("settings-general-auto-install-deps-description")}
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
						label={t("settings-general-parallel-downloads-label")}
						description={t("settings-general-parallel-downloads-description")}
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

				<div ref={storageCardRef}>
					<SettingsCard header={t("settings-general-storage-title")}>
						<SettingsField
							label={t("settings-general-artifact-cache-label")}
							description={t("settings-general-artifact-cache-description")}
							headerRight={
								<div
									style={{
										display: "flex",
										"align-items": "center",
										gap: "8px",
									}}
								>
									<NumberField
										value={cacheLimitMb()}
										minValue={128}
										maxValue={524288}
										formatOptions={{ useGrouping: false }}
										onRawValueChange={(val) =>
											void handleArtifactCacheLimitChange(val * 1024 * 1024)
										}
									>
										<NumberFieldGroup>
											<NumberFieldInput />
											<NumberFieldIncrementTrigger />
											<NumberFieldDecrementTrigger />
										</NumberFieldGroup>
									</NumberField>
									<span
										style={{
											"font-size": "12px",
											color: "var(--text-secondary)",
										}}
									>
										{t("settings-general-cache-limit-unit")}
									</span>
								</div>
							}
						/>
					</SettingsCard>
				</div>

				<SettingsCard
					header={t("settings-general-network-proxy-title")}
					subHeader={t("settings-general-network-proxy-subheader")}
				>
					<SettingsField
						label={t("settings-general-use-proxy-label")}
						description={t("settings-general-use-proxy-description")}
						headerRight={
							<Switch
								checked={proxyEnabled()}
								onCheckedChange={handleProxyEnabledToggle}
							>
								<SwitchControl>
									<SwitchThumb />
								</SwitchControl>
							</Switch>
						}
						body={
							<div
								class={styles["proxy-restart-note"]}
								hidden={!proxyRestartRequired()}
								aria-live="polite"
							>
								{t("settings-general-proxy-restart-note")}
							</div>
						}
					/>
					<SettingsField
						label={t("settings-general-proxy-url-label")}
						description={t("settings-general-proxy-url-description")}
						disabled={!proxyEnabled()}
						body={
							<div class={styles["proxy-control-stack"]}>
								<TextFieldRoot>
									<TextFieldInput
										type="url"
										value={proxyUrl()}
										onInput={(e) =>
											handleProxyUrlChange(
												(e.currentTarget as HTMLInputElement).value,
											)
										}
										placeholder="http://127.0.0.1:8080"
										autocomplete="off"
										spellcheck={false}
									/>
								</TextFieldRoot>
								<div class={styles["proxy-credential-note"]}>
									{t("settings-general-proxy-credentials-note")}
								</div>
								<div class={styles["proxy-actions-row"]}>
									<LauncherButton
										size="sm"
										variant="outline"
										onClick={handleProxyTest}
										disabled={isTestingProxy()}
									>
										{isTestingProxy()
											? t("settings-general-proxy-testing")
											: t("settings-general-proxy-test")}
									</LauncherButton>
									{proxyTestMessage() && (
										<span
											class={styles["proxy-status-text"]}
											classList={{
												[styles["proxy-status-text--success"]]:
													proxyTestOk() === true,
												[styles["proxy-status-text--error"]]:
													proxyTestOk() === false,
											}}
										>
											{proxyTestMessage()}
										</span>
									)}
								</div>
								{proxyTestDetail() && (
									<div class={styles["proxy-status-detail"]}>
										{proxyTestDetail()}
									</div>
								)}
							</div>
						}
					/>
					<SettingsField
						label={t("settings-general-proxy-apply-to-games-label")}
						description={t("settings-general-proxy-apply-to-games-description")}
						disabled={!proxyEnabled()}
						headerRight={
							<Switch
								checked={proxyApplyToGames()}
								onCheckedChange={handleProxyApplyToGamesToggle}
							>
								<SwitchControl>
									<SwitchThumb />
								</SwitchControl>
							</Switch>
						}
					/>
				</SettingsCard>

				<SettingsCard header={t("settings-general-system-tray-title")}>
					<SettingsField
						label={t("settings-general-autostart-label")}
						description={t("settings-general-autostart-description")}
						headerRight={
							<Switch
								checked={autostartEnabled()}
								onCheckedChange={handleAutostartToggle}
							>
								<SwitchControl>
									<SwitchThumb />
								</SwitchControl>
							</Switch>
						}
					/>
					<SettingsField
						label={t("settings-general-show-tray-icon-label")}
						description={t("settings-general-show-tray-icon-description")}
						headerRight={
							<Switch
								checked={showTrayIcon()}
								onCheckedChange={handleShowTrayIconToggle}
							>
								<SwitchControl>
									<SwitchThumb />
								</SwitchControl>
							</Switch>
						}
					/>
					<SettingsField
						label={t("settings-general-close-to-tray-label")}
						description={t("settings-general-close-to-tray-description")}
						headerRight={
							<Switch
								checked={closeToTray()}
								onCheckedChange={handleCloseToTrayToggle}
							>
								<SwitchControl>
									<SwitchThumb />
								</SwitchControl>
							</Switch>
						}
					/>
				</SettingsCard>
			</div>
		</div>
	);
}
