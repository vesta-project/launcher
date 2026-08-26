import { SettingsCard, SettingsField } from "@components/settings";
import panelStyles from "@components/settings/settings.module.css";
import Button from "@ui/button/button";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "@ui/context-menu/context-menu";
import { areIconsEqual, IconPicker } from "@ui/icon-picker/icon-picker";
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
import {
	Slider,
	SliderFill,
	SliderThumb,
	SliderTrack,
} from "@ui/slider/slider";
import { Switch, SwitchControl, SwitchThumb } from "@ui/switch/switch";
import {
	TextFieldInput,
	TextFieldRoot,
	TextFieldTextArea,
} from "@ui/text-field/text-field";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ui/tooltip/tooltip";
import {
	getManualMemoryLimitMb,
	getMemoryWarningThresholdMb,
} from "@utils/memory-policy";
import {
	findLaunchBehaviorOption,
	launchBehaviorOptions as getLaunchBehaviorOptions,
} from "@utils/localized-options";
import { batch, createMemo, Show } from "solid-js";
import { t } from "~/localization";
import styles from "../instance-details.module.css";

interface SettingsTabProps {
	instance: any;
	name: string;
	setName: (v: string) => void;
	setIsNameDirty: (v: boolean) => void;
	iconPath: string;
	setIconPath: (v: string) => void;
	setIsIconDirty: (v: boolean) => void;
	uploadedIcons: () => string[];
	modpackIcon: () => string | null;
	isInstalling: boolean;
	jreOptions: () => any[];
	javaPath: string;
	setJavaPath: (v: string) => void;
	setIsJavaPathDirty: (v: boolean) => void;
	isCustomMode: boolean;
	setIsCustomMode: (v: boolean) => void;
	javaArgs: string;
	setJavaArgs: (v: string) => void;
	setIsJvmDirty: (v: boolean) => void;
	minMemory: number[];
	setMinMemory: (v: number[]) => void;
	setIsMinMemDirty: (v: boolean) => void;
	maxMemory: number[];
	setMaxMemory: (v: number[]) => void;
	setIsMaxMemDirty: (v: boolean) => void;

	// Linking & Overrides
	useGlobalResolution: boolean;
	setUseGlobalResolution: (v: boolean) => void;
	gameWidth: number;
	setGameWidth: (v: number) => void;
	gameHeight: number;
	setGameHeight: (v: number) => void;
	setIsResolutionDirty: (v: boolean) => void;
	useGlobalJavaArgs: boolean;
	setUseGlobalJavaArgs: (v: boolean) => void;
	useGlobalJavaPath: boolean;
	setUseGlobalJavaPath: (v: boolean) => void;
	preLaunchHook: string;
	setPreLaunchHook: (v: string) => void;
	postExitHook: string;
	setPostExitHook: (v: string) => void;
	wrapperCommand: string;
	setWrapperCommand: (v: string) => void;
	useGlobalHooks: boolean;
	setUseGlobalHooks: (v: boolean) => void;
	setIsHooksDirty: (v: boolean) => void;
	environmentVariables: string;
	setEnvironmentVariables: (v: string) => void;
	useGlobalEnvironmentVariables: boolean;
	setUseGlobalEnvironmentVariables: (v: boolean) => void;
	setIsEnvDirty: (v: boolean) => void;
	useGlobalLauncherAction: boolean;
	setUseGlobalLauncherAction: (v: boolean) => void;
	launcherActionOnLaunch: string;
	setLauncherActionOnLaunch: (v: string) => void;
	setIsLaunchActionDirty: (v: boolean) => void;

	handleSave: () => void;
	saving: () => boolean;
	totalRam: number;
	invoke: any;
	showToast: any;
	isGuest: boolean;
	busy: boolean;
	setShowExportDialog: (v: boolean) => void;
	handleDuplicate: () => void;
	handleHardReset: () => void;
	handleUninstall: () => void;
	repairInstance: (id: number) => void;
}

export const SettingsTab = (p: SettingsTabProps) => {
	const launchBehaviorOptions = createMemo(() => getLaunchBehaviorOptions());

	const currentSelection = createMemo(() => {
		if (p.useGlobalJavaPath) return "__default__";
		if (p.isCustomMode) return "__custom__";
		if (!p.javaPath) return "__default__";
		return p.javaPath;
	});
	const selectedLaunchBehavior = createMemo(() =>
		findLaunchBehaviorOption(p.launcherActionOnLaunch),
	);

	// Memory Multi-Thumb Logic
	const sliderMaxMemory = createMemo(() => getManualMemoryLimitMb(p.totalRam));
	const memoryRange = createMemo(() => {
		const rawMin = p.minMemory[0] ?? 2048;
		const rawMax = p.maxMemory[0] ?? 4096;
		const boundedMin = Math.max(512, Math.min(rawMin, sliderMaxMemory()));
		const boundedMax = Math.max(512, Math.min(rawMax, sliderMaxMemory()));
		return boundedMin <= boundedMax
			? [boundedMin, boundedMax]
			: [boundedMax, boundedMin];
	});
	const handleMemoryChange = (val: number[]) => {
		if (!Array.isArray(val) || val.length < 2) return;

		const normalizedMin = Math.max(512, Math.min(val[0], sliderMaxMemory()));
		const normalizedMax = Math.max(512, Math.min(val[1], sliderMaxMemory()));
		const nextMin = Math.min(normalizedMin, normalizedMax);
		const nextMax = Math.max(normalizedMin, normalizedMax);

		// Guard against phantom changes (e.g. from Slider mount/sync)
		if (nextMin === p.minMemory[0] && nextMax === p.maxMemory[0]) return;

		batch(() => {
			p.setMinMemory([nextMin]);
			p.setMaxMemory([nextMax]);
			p.setIsMinMemDirty(true);
			p.setIsMaxMemDirty(true);
		});
	};

	return (
		<div class={styles["tab-settings"]}>
			<div class={styles["settings-metadata-section"]}>
				<div class={styles["metadata-main-info"]}>
					<div class={styles["metadata-icon-container"]}>
						<IconPicker
							value={p.iconPath}
							onSelect={(val) => {
								if (areIconsEqual(val, p.iconPath)) return;
								p.setIconPath(val);
								p.setIsIconDirty(true);
							}}
							uploadedIcons={p.uploadedIcons()}
							modpackIcon={p.modpackIcon()}
							showHint={true}
						/>
					</div>

					<div class={styles["metadata-fields"]}>
						<TextFieldRoot class={styles["metadata-name-input-root"]}>
							<TextFieldInput
								class={styles["metadata-name-input"]}
								value={p.name}
								onInput={(e) => {
									const val = (e.currentTarget as HTMLInputElement).value;
									if (val === p.name) return;
									p.setName(val);
									p.setIsNameDirty(true);
								}}
								disabled={p.isInstalling}
								placeholder={t("instances-settings-name-placeholder")}
							/>
						</TextFieldRoot>
						<p class={styles["metadata-description"]}>
							{t("instances-settings-metadata-description")}
						</p>
					</div>
				</div>
			</div>

			<div class={panelStyles["settings-panel"]}>
				<SettingsCard header={t("instances-settings-java-title")}>
					<SettingsField
						label={t("instances-settings-java-executable-label")}
						description={t("instances-settings-java-executable-description")}
						helpTopic="JAVA_MANAGED"
					>
						<div style="display: flex; flex-direction: column; gap: 8px;">
							<Select<any>
								options={p.jreOptions()}
								optionValue="value"
								optionTextValue="label"
								value={p
									.jreOptions()
									.find((o) => o.value === currentSelection())}
								onChange={(val: any) => {
									if (val.value === currentSelection()) return;

									if (val.value === "__default__") {
										batch(() => {
											p.setJavaPath("");
											p.setUseGlobalJavaPath(true);
											p.setIsCustomMode(false);
											p.setIsJavaPathDirty(true);
										});
									} else if (val.value === "__custom__") {
										batch(() => {
											p.setUseGlobalJavaPath(false);
											p.setIsCustomMode(true);
										});
									} else if (val.value.startsWith("__download_")) {
										const version = parseInt(val.value.split("_")[2]);
										p.invoke("download_managed_java", { version })
											.then(() => {
												p.showToast({
													title: t("common-java-download-started"),
													description: t(
														"common-java-download-started-description",
														{ version },
													),
													severity: "info",
												});
											})
											.catch(() => {
												p.showToast({
													title: t("common-error"),
													description: t("common-java-download-failed"),
													severity: "error",
												});
											});
										batch(() => {
											p.setJavaPath("");
											p.setUseGlobalJavaPath(false);
											p.setIsCustomMode(false);
											p.setIsJavaPathDirty(true);
										});
									} else {
										batch(() => {
											p.setJavaPath(val.value);
											p.setUseGlobalJavaPath(false);
											p.setIsCustomMode(false);
											p.setIsJavaPathDirty(true);
										});
									}
								}}
								itemComponent={(p) => (
									<SelectItem item={p.item}>
										<div style="display: flex; flex-direction: column; line-height: 1.2;">
											<span style="font-weight: 600; font-size: 13px; color: var(--text-primary);">
												{p.item.rawValue.label}
											</span>
											<span style="font-size: 10px; opacity: 0.5; color: var(--text-secondary); font-family: var(--font-mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 300px;">
												{p.item.rawValue.description}
											</span>
										</div>
									</SelectItem>
								)}
							>
								<ContextMenu>
									<Tooltip>
										<TooltipTrigger
											style="width: 100%; display: block;"
											as="div"
										>
											<ContextMenuTrigger style="width: 100%;" as="div">
												<SelectTrigger style="width: 100%;">
													<SelectValue<any>>
														{(state) => (
															<div style="display: flex; flex-direction: column; align-items: flex-start; line-height: 1.2;">
																<span style="font-size: 13px;">
																	{state.selectedOption().label}
																</span>
																<span style="font-size: 10px; opacity: 0.5; font-family: var(--font-mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 340px;">
																	{state.selectedOption().description}
																</span>
															</div>
														)}
													</SelectValue>
												</SelectTrigger>
											</ContextMenuTrigger>
										</TooltipTrigger>
										<TooltipContent>
											<Show
												when={
													p
														.jreOptions()
														.find((o) => o.value === currentSelection())
														?.description
												}
												fallback={t("common-java-no-path-set")}
											>
												{(desc) => (
													<div style="font-family: var(--font-mono); font-size: 11px; max-width: 400px; word-break: break-all;">
														{desc().startsWith("→ ")
															? desc().substring(2)
															: desc()}
													</div>
												)}
											</Show>
										</TooltipContent>
									</Tooltip>
									<ContextMenuContent>
										<ContextMenuItem
											onClick={() => {
												const current = p
													.jreOptions()
													.find((o) => o.value === currentSelection());
												if (
													current &&
													current.description &&
													current.description !== "(not set)"
												) {
													let path = current.description;
													if (path.startsWith("→ ")) path = path.substring(2);
													navigator.clipboard.writeText(path);
													p.showToast({
														title: t("common-copied"),
														description: t("common-java-path-copied"),
														severity: "success",
													});
												}
											}}
										>
											{t("common-copy-full-path")}
										</ContextMenuItem>
									</ContextMenuContent>
								</ContextMenu>
								<SelectContent />
							</Select>

							<Show when={p.isCustomMode}>
								<div style="display: flex; gap: 8px; margin-top: 4px;">
									<TextFieldRoot style="flex: 1">
										<TextFieldInput
											value={p.javaPath}
											placeholder={t("instances-settings-java-path-placeholder")}
											onInput={(e) => {
												const val = (e.currentTarget as HTMLInputElement).value;
												if (val === p.javaPath) return;
												batch(() => {
													p.setJavaPath(val);
													p.setUseGlobalJavaPath(false);
													p.setIsJavaPathDirty(true);
												});
											}}
										/>
									</TextFieldRoot>
									<Button
										variant="ghost"
										size="sm"
										onClick={async () => {
											const path = await p.invoke("select_java_file");
											if (path && path !== p.javaPath) {
												batch(() => {
													p.setJavaPath(path);
													p.setUseGlobalJavaPath(false);
													p.setIsJavaPathDirty(true);
												});
											}
										}}
									>
										{t("common-browse")}
									</Button>
								</div>
							</Show>
						</div>
					</SettingsField>

					<SettingsField
						label={t("instances-settings-java-args-label")}
						description={t("instances-settings-java-args-description")}
						headerRight={
							<div style="display: flex; align-items: center; gap: 8px;">
								<span style="font-size: 11px; opacity: 0.75; color: var(--text-secondary);">
									{t("common-use-global")}
								</span>
								<Switch
									checked={p.useGlobalJavaArgs}
									onCheckedChange={(val: boolean) => {
										batch(() => {
											p.setUseGlobalJavaArgs(val);
											p.setIsJvmDirty(true);
										});
									}}
								>
									<SwitchControl>
										<SwitchThumb />
									</SwitchControl>
								</Switch>
							</div>
						}
						body={
							<Show
								when={!p.useGlobalJavaArgs}
								fallback={
									<div style="padding: 10px; border-radius: 8px; border: 1px dashed var(--border-subtle); opacity: 0.6; font-size: 12px;">
										{t("settings-using-global-java-args")}
									</div>
								}
							>
								<TextFieldRoot>
									<TextFieldInput
										value={p.javaArgs}
										onInput={(e: any) => {
											const val = (e.currentTarget as HTMLInputElement).value;
											if (val === p.javaArgs) return;
											p.setJavaArgs(val);
											p.setIsJvmDirty(true);
										}}
										placeholder="-XX:+UseG1GC -XX:+ParallelRefProcEnabled"
									/>
								</TextFieldRoot>
							</Show>
						}
					/>
				</SettingsCard>

				<SettingsCard header={t("instances-settings-memory-title")}>
					<SettingsField
						label={t("instances-settings-memory-allocation-label")}
						description={t("instances-settings-memory-allocation-description", {
							totalRam: Math.round(p.totalRam / 1024),
						})}
						body={
							<>
								<div style="margin-bottom: 32px; margin-top: 12px;">
									<Slider
										value={memoryRange()}
										onChange={handleMemoryChange}
										minValue={512}
										maxValue={sliderMaxMemory()}
										step={512}
									>
										<div class={styles["slider__header"]}>
											<div class={styles["slider__value-label"]}>
												{p.minMemory[0] >= 1024
													? `${(p.minMemory[0] / 1024).toFixed(1)}GB`
													: `${p.minMemory[0]}MB`}
												{" — "}
												{p.maxMemory[0] >= 1024
													? `${(p.maxMemory[0] / 1024).toFixed(1)}GB`
													: `${p.maxMemory[0]}MB`}
											</div>
										</div>
										<SliderTrack>
											<SliderFill />
											<SliderThumb />
											<SliderThumb />
										</SliderTrack>
									</Slider>
								</div>
								<Show
									when={
										p.maxMemory[0] >= getMemoryWarningThresholdMb(p.totalRam)
									}
								>
									<div style="margin-top: -18px; margin-bottom: 16px; opacity: 0.65; font-size: 12px;">
										{t("instances-settings-memory-low-system-warning")}
									</div>
								</Show>
								<>
									<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; opacity: 0.8; font-size: 13px;">
										<div>
											<strong>{t("instances-settings-memory-min-label")}</strong>{" "}
											{p.minMemory[0]} MB
										</div>
										<div>
											<strong>{t("instances-settings-memory-max-label")}</strong>{" "}
											{p.maxMemory[0]} MB
										</div>
									</div>
								</>
							</>
						}
					/>
				</SettingsCard>

				<SettingsCard header={t("instances-settings-resolution-title")}>
					<SettingsField
						label={t("instances-settings-resolution-window-label")}
						description={t("instances-settings-resolution-window-description")}
						headerRight={
							<div style="display: flex; align-items: center; gap: 8px;">
								<span style="font-size: 11px; opacity: 0.75; color: var(--text-secondary);">
									{t("common-use-global")}
								</span>
								<Switch
									checked={p.useGlobalResolution}
									onCheckedChange={(val: boolean) => {
										batch(() => {
											p.setUseGlobalResolution(val);
											p.setIsResolutionDirty(true);
										});
									}}
								>
									<SwitchControl>
										<SwitchThumb />
									</SwitchControl>
								</Switch>
							</div>
						}
						body={
							<Show
								when={!p.useGlobalResolution}
								fallback={
									<div style="padding: 10px; border-radius: 8px; border: 1px dashed var(--border-subtle); opacity: 0.6; font-size: 12px;">
										{t("settings-using-global-resolution")}
									</div>
								}
							>
								<div
									style={{
										display: "flex",
										gap: "16px",
										"align-items": "flex-end",
										"max-width": "400px",
									}}
								>
									<NumberField
										style="flex: 1;"
										value={p.gameWidth}
										onRawValueChange={(val) => {
											p.setGameWidth(val);
											p.setIsResolutionDirty(true);
										}}
										minValue={0}
									>
										<label
											style={{
												display: "block",
												"font-size": "12px",
												opacity: 0.6,
												"margin-bottom": "4px",
											}}
										>
											{t("common-width")}
										</label>
										<NumberFieldGroup>
											<NumberFieldInput placeholder="1280" />
											<NumberFieldIncrementTrigger />
											<NumberFieldDecrementTrigger />
										</NumberFieldGroup>
									</NumberField>
									<span style="opacity: 0.5; margin-bottom: 12px;">×</span>
									<NumberField
										style="flex: 1;"
										value={p.gameHeight}
										onRawValueChange={(val) => {
											p.setGameHeight(val);
											p.setIsResolutionDirty(true);
										}}
										minValue={0}
									>
										<label
											style={{
												display: "block",
												"font-size": "12px",
												opacity: 0.6,
												"margin-bottom": "4px",
											}}
										>
											{t("common-height")}
										</label>
										<NumberFieldGroup>
											<NumberFieldInput placeholder="720" />
											<NumberFieldIncrementTrigger />
											<NumberFieldDecrementTrigger />
										</NumberFieldGroup>
									</NumberField>
								</div>
							</Show>
						}
					/>
				</SettingsCard>

				<SettingsCard header={t("instances-settings-env-title")}>
					<SettingsField
						label={t("instances-settings-env-variables-label")}
						description={t("instances-settings-env-variables-description")}
						headerRight={
							<div style="display: flex; align-items: center; gap: 8px;">
								<span style="font-size: 11px; opacity: 0.75; color: var(--text-secondary);">
									{t("common-use-global")}
								</span>
								<Switch
									checked={p.useGlobalEnvironmentVariables}
									onCheckedChange={(val: boolean) => {
										batch(() => {
											p.setUseGlobalEnvironmentVariables(val);
											p.setIsEnvDirty(true);
										});
									}}
								>
									<SwitchControl>
										<SwitchThumb />
									</SwitchControl>
								</Switch>
							</div>
						}
						body={
							<Show
								when={!p.useGlobalEnvironmentVariables}
								fallback={
									<div style="padding: 10px; border-radius: 8px; border: 1px dashed var(--border-subtle); opacity: 0.6; font-size: 12px;">
										{t("settings-using-global-env")}
									</div>
								}
							>
								<TextFieldRoot>
									<TextFieldTextArea
										value={p.environmentVariables}
										onInput={(e: any) => {
											p.setEnvironmentVariables(e.currentTarget.value);
											p.setIsEnvDirty(true);
										}}
										placeholder="MESA_GL_VERSION_OVERRIDE=4.6&#10;__GL_THREADED_OPTIMIZATIONS=1"
										style="min-height: 80px; font-family: var(--font-mono); font-size: 12px; padding: 10px;"
									/>
								</TextFieldRoot>
							</Show>
						}
					/>
				</SettingsCard>

				<SettingsCard header={t("instances-settings-launcher-action-title")}>
					<SettingsField
						label={t("instances-settings-launcher-action-behavior-label")}
						description={t("instances-settings-launcher-action-behavior-description")}
						headerRight={
							<div style="display: flex; align-items: center; gap: 8px;">
								<span style="font-size: 11px; opacity: 0.75; color: var(--text-secondary);">
									{t("common-use-global")}
								</span>
								<Switch
									checked={p.useGlobalLauncherAction}
									onCheckedChange={(val: boolean) => {
										batch(() => {
											p.setUseGlobalLauncherAction(val);
											p.setIsLaunchActionDirty(true);
										});
									}}
								>
									<SwitchControl>
										<SwitchThumb />
									</SwitchControl>
								</Switch>
							</div>
						}
						body={
							<Show
								when={!p.useGlobalLauncherAction}
								fallback={
									<div style="padding: 10px; border-radius: 8px; border: 1px dashed var(--border-subtle); opacity: 0.6; font-size: 12px;">
										{t("settings-using-global-launcher-action")}
									</div>
								}
							>
								{/* SelectContent needs itemComponent to render options; derive value from the same options list to avoid object mismatch bugs. */}
								<Select
									options={launchBehaviorOptions}
									optionValue="value"
									optionTextValue="label"
									value={selectedLaunchBehavior()}
									onChange={(option: any) => {
										p.setLauncherActionOnLaunch(option.value);
										p.setIsLaunchActionDirty(true);
									}}
									itemComponent={(props) => (
										<SelectItem item={props.item}>
											{props.item.rawValue.label}
										</SelectItem>
									)}
								>
									<SelectTrigger>
										<SelectValue<any>>
											{(state) => state.selectedOption().label}
										</SelectValue>
									</SelectTrigger>
									<SelectContent />
								</Select>
							</Show>
						}
					/>
				</SettingsCard>

				<SettingsCard header={t("instances-settings-hooks-title")}>
					<div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; padding: 0 4px;">
						<div style="display: flex; flex-direction: column; gap: 2px;">
							<span style="font-size: 13px; font-weight: 500; color: var(--text-secondary);">
								{t("settings-lifecycle-hooks-global-label")}
							</span>
							<span style="font-size: 11px; opacity: 0.6;">
								{t("settings-lifecycle-hooks-global-description")}
							</span>
						</div>
						<Switch
							checked={p.useGlobalHooks}
							onCheckedChange={(val: boolean) => {
								batch(() => {
									p.setUseGlobalHooks(val);
									p.setIsHooksDirty(true);
								});
							}}
						>
							<SwitchControl>
								<SwitchThumb />
							</SwitchControl>
						</Switch>
					</div>

					<Show
						when={!p.useGlobalHooks}
						fallback={
							<div style="padding: 12px; border-radius: 8px; border: 1px dashed var(--border-subtle); opacity: 0.6; font-size: 12px; margin-bottom: 12px;">
								{t("settings-using-global-hooks-active")}
							</div>
						}
					>
						<SettingsField
							label={t("instances-settings-pre-launch-label")}
							description={t("instances-settings-pre-launch-description")}
							body={
								<TextFieldRoot>
									<TextFieldInput
										value={p.preLaunchHook}
										onInput={(e: any) => {
											p.setPreLaunchHook(e.currentTarget.value);
											p.setIsHooksDirty(true);
										}}
										placeholder="e.g. C:\scripts\pre-launch.bat"
										style="font-family: var(--font-mono); font-size: 12px;"
									/>
								</TextFieldRoot>
							}
						/>

						<SettingsField
							label={t("instances-settings-wrapper-label")}
							description={t("instances-settings-wrapper-description")}
							body={
								<TextFieldRoot>
									<TextFieldInput
										value={p.wrapperCommand}
										onInput={(e: any) => {
											p.setWrapperCommand(e.currentTarget.value);
											p.setIsHooksDirty(true);
										}}
										placeholder="e.g. mangohud --dlsym"
										style="font-family: var(--font-mono); font-size: 12px;"
									/>
								</TextFieldRoot>
							}
						/>

						<SettingsField
							label={t("instances-settings-post-exit-label")}
							description={t("instances-settings-post-exit-description")}
							body={
								<TextFieldRoot>
									<TextFieldInput
										value={p.postExitHook}
										onInput={(e: any) => {
											p.setPostExitHook(e.currentTarget.value);
											p.setIsHooksDirty(true);
										}}
										placeholder="e.g. powershell -File C:\scripts\cleanup.ps1"
										style="font-family: var(--font-mono); font-size: 12px;"
									/>
								</TextFieldRoot>
							}
						/>
					</Show>
				</SettingsCard>

				<SettingsCard header={t("instances-settings-maintenance-title")}>
					<SettingsField label={t("instances-settings-export-label")} description={t("instances-settings-export-description")} actionLabel={t("instances-settings-export-action")} onAction={() => p.setShowExportDialog(true)} disabled={p.isGuest || p.busy || p.isInstalling} />
					<SettingsField label={t("instances-settings-duplicate-label")} description={t("instances-settings-duplicate-description")} actionLabel={t("instances-settings-duplicate-action")} onAction={p.handleDuplicate} disabled={p.busy || p.isInstalling} />
					<SettingsField label={p.instance.modpackId ? t("instances-settings-repair-modpack-label") : t("instances-settings-repair-instance-label")} description={t("instances-settings-repair-description")} actionLabel={t("instances-settings-repair-action")} onAction={() => p.repairInstance(p.instance.id)} disabled={p.isGuest || p.busy || p.isInstalling} />
				</SettingsCard>

				<SettingsCard header={t("instances-settings-danger-title")} destructive>
					<SettingsField label={t("instances-settings-reset-label")} description={t("instances-settings-reset-description")} actionLabel={t("instances-settings-reset-action")} destructive onAction={p.handleHardReset} disabled={p.isGuest || p.busy || p.isInstalling} />
					<SettingsField label={t("instances-settings-delete-label")} description={t("instances-settings-delete-description")} actionLabel={t("instances-settings-delete-action")} destructive onAction={p.handleUninstall} disabled={p.isGuest || p.busy || p.isInstalling} />
				</SettingsCard>
			</div>
		</div>
	);
};
