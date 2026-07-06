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
import { Switch, SwitchControl, SwitchThumb } from "@ui/switch/switch";
import { TextFieldInput, TextFieldRoot } from "@ui/text-field/text-field";
import { showToast } from "@ui/toast/toast";
import { createEffect, createMemo, createSignal } from "solid-js";
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
				title: result.ok ? "Proxy connected" : "Proxy connection failed",
				description: result.ok
					? "Launcher traffic can use this proxy after restart."
					: "Check the proxy settings row or logs for details.",
				severity: result.ok ? "success" : "error",
			});
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			setProxyTestMessage("Proxy connection failed");
			setProxyTestDetail(message);
			setProxyTestOk(false);
			showToast({
				title: "Proxy connection failed",
				description: "Check the proxy settings row or logs for details.",
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
							<strong>OS Animation Disabled:</strong> Your operating system has
							animations disabled in accessibility settings. UI animations won't
							appear until you enable them in your system preferences.
						</div>
					)}
					<SettingsField
						label="Reduced Motion"
						description="Disable UI animations for a faster and cleaner experience."
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
						label="Discord Rich Presence"
						description="Show your current game and status on Discord."
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
					header="Performance"
					subHeader="Optimization settings for game performance."
				>
					<SettingsField
						label="Use Dedicated GPU"
						description="Attempt to force Minecraft to use your high-performance graphics card (NVIDIA/AMD)."
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

				<div ref={storageCardRef}>
					<SettingsCard header="Storage">
						<SettingsField
							label="Artifact Cache Limit"
							description="Controls the size of the installer artifact and modpack archive cache."
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
										MB
									</span>
								</div>
							}
						/>
					</SettingsCard>
				</div>

				<SettingsCard
					header="Network / Proxy"
					subHeader="Route launcher-managed HTTP traffic through a proxy."
				>
					<SettingsField
						label="Use Proxy"
						description="Apply a proxy to launcher HTTP traffic after restart."
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
								<strong>Restart required.</strong> Saved changes apply to
								regular launcher traffic after restart. You can keep editing and
								test the proxy first.
							</div>
						}
					/>
					<SettingsField
						label="Proxy URL"
						description="Supports http://, https://, socks5://, and socks5h://. HTTPS inspection requires a trusted proxy CA."
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
									Proxy credentials in URLs are saved in launcher config. Use
									them only on trusted devices.
								</div>
								<div class={styles["proxy-actions-row"]}>
									<LauncherButton
										size="sm"
										variant="outline"
										onClick={handleProxyTest}
										disabled={isTestingProxy()}
									>
										{isTestingProxy() ? "Testing..." : "Test Proxy"}
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
						label="Use For Launched Games"
						description="Pass proxy host and port to Minecraft as JVM arguments. Credentials are not passed to the game process."
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

				<SettingsCard header="System Tray">
					<SettingsField
						label="Launch On System Startup"
						description="Start Vesta Launcher automatically when you sign in."
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
						label="Show Tray Icon"
						description="Display the launcher icon in the system tray."
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
						label="Close Button Hides To Tray"
						description="When enabled, clicking the window close button hides the launcher to tray instead of requesting app exit."
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
