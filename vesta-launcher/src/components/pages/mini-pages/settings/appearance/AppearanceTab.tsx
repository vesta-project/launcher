import { SettingsCard, SettingsField } from "@components/settings";
import SearchIcon from "@assets/icons/content/search.svg";
import ListIcon from "@assets/icons/content/list.svg";
import GridIcon from "@assets/icons/content/grid.svg";
import panelStyles from "@components/settings/settings.module.css";
import {
	activeThemeDefinition,
	backgroundHue,
	backgroundOpacity,
	borderThickness,
	canChangeBorder,
	canChangeHue,
	canChangeStyle,
	colorMode,
	filteredThemeCatalog,
	getThemeSource,
	gradientEnabled,
	gradientHarmony,
	gradientType,
	grainStrength,
	handleBackgroundOpacityChange,
	handleBorderThicknessChange,
	handleColorModeChange,
	handleDeleteImportedTheme,
	handleExportTheme,
	handleGradientHarmonyChange,
	handleGradientToggle,
	handleGradientTypeChange,
	handleGrainStrengthChange,
	handleHueChange,
	handleImportTheme,
	handleOpacityChange,
	handlePresetSelect,
	handleRotationChange,
	handleStyleModeChange,
	handleUiChromeModeChange,
	handleVariableChange,
	handleWindowEffectChange,
	hasImportedThemes,
	opacity,
	rotation,
	setThemeFilterMode,
	setThemeSearchQuery,
	setThemeViewMode,
	showAdvancedControls,
	styleMode,
	themeFilterMode,
	themeId,
	themeSearchQuery,
	themeViewMode,
	uiChromeMode,
	userVariablesSnapshot,
	windowEffect,
	windowEffectOptions,
} from "@stores/settings";
import Button from "@ui/button/button";
import {
	Slider,
	SliderFill,
	SliderThumb,
	SliderTrack,
} from "@ui/slider/slider";
import { Switch, SwitchControl, SwitchThumb } from "@ui/switch/switch";
import { ToggleGroup, ToggleGroupItem } from "@ui/toggle-group/toggle-group";
import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import { t } from "~/localization";
import {
	type ColorModePreference,
	type GradientHarmony,
	getThemeById,
	isBuiltinThemeId,
	type StyleMode,
	type ThemeConfig,
	type ThemeVariableValue,
	type UiChromeMode,
} from "../../../../../themes/presets";
import { ThemePresetCard } from "../../../../theme-preset-card/theme-preset-card";
import styles from "../settings-page.module.css";
import { UiChromeModeControl } from "./UiChromeModeControl";

type ThemeFilterMode = "all" | "builtin" | "imported";
type ThemeViewMode = "grid" | "list";
export function AppearanceSettingsTab() {
	const [isSearchExpanded, setIsSearchExpanded] = createSignal(
		themeSearchQuery().trim().length > 0,
	);
	let searchInputRef: HTMLInputElement | undefined;
	let blurTimer: ReturnType<typeof setTimeout> | undefined;

	createEffect(() => {
		if (themeSearchQuery().trim().length > 0) {
			setIsSearchExpanded(true);
		}
	});

	onCleanup(() => {
		if (blurTimer) clearTimeout(blurTimer);
	});

	const expandSearch = () => {
		setIsSearchExpanded(true);
		requestAnimationFrame(() => searchInputRef?.focus());
	};

	const collapseSearchIfEmpty = () => {
		if (blurTimer) clearTimeout(blurTimer);
		blurTimer = setTimeout(() => {
			if (themeSearchQuery().trim().length === 0) {
				setIsSearchExpanded(false);
			}
		}, 120);
	};

	const getWindowEffectLabel = (effect: string): string => {
		switch (effect) {
			case "none":
				return t("settings-appearance-window-effect-none");
			case "transparent":
				return t("settings-appearance-window-effect-transparent");
			case "vibrancy":
				return t("settings-appearance-window-effect-vibrancy");
			case "liquid_glass":
				return t("settings-appearance-window-effect-liquid-glass");
			case "mica":
				return t("settings-appearance-window-effect-mica");
			case "acrylic":
				return t("settings-appearance-window-effect-acrylic");
			case "blur":
				return t("settings-appearance-window-effect-blur");
			default:
				return effect
					.split("_")
					.map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
					.join(" ");
		}
	};

	const getNumberVariableValue = (
		value: ThemeVariableValue,
		fallback: number,
		min = 0,
		max = 100,
	) => {
		const next = typeof value === "number" ? value : Number(value);
		const finite = Number.isFinite(next) ? next : fallback;
		return Math.max(min, Math.min(max, finite));
	};

	return (
		<div
			class={`${styles["settings-tab-content"]} ${styles["settings-tab-content--wide"]}`}
		>
			<div class={panelStyles["settings-panel"]}>
				<SettingsCard>
					<div class={styles["theme-toolbar"]}>
						<Button
							variant="slate"
							size="icon"
							icon_only={true}
							class={styles["theme-search-trigger"]}
							onClick={expandSearch}
							title={t("settings-appearance-search-themes")}
							aria-label={t("settings-appearance-search-themes")}
						>
							<SearchIcon class={styles["theme-toolbar-icon"]} />
						</Button>
						<Show when={isSearchExpanded()}>
							<input
								ref={(element) => {
									searchInputRef = element;
								}}
								type="text"
								value={themeSearchQuery()}
								onInput={(event) =>
									setThemeSearchQuery(event.currentTarget.value)
								}
								onBlur={collapseSearchIfEmpty}
								placeholder={t("settings-appearance-search-themes")}
								class={`${styles["theme-search-input"]} ${styles["theme-search-input--expanded"]}`}
							/>
						</Show>
						<Show when={!isSearchExpanded()}>
							<Show when={hasImportedThemes()}>
								<ToggleGroup
									value={themeFilterMode()}
									onChange={(value) => {
										if (value) {
											setThemeFilterMode(value as ThemeFilterMode);
										}
									}}
								>
									<ToggleGroupItem value="all">
										{t("settings-appearance-filter-all")}
									</ToggleGroupItem>
									<ToggleGroupItem value="builtin">
										{t("settings-appearance-filter-defaults")}
									</ToggleGroupItem>
									<ToggleGroupItem value="imported">
										{t("settings-appearance-filter-imported")}
									</ToggleGroupItem>
								</ToggleGroup>
							</Show>
							<div class={styles["theme-toolbar__spacer"]} />
							<Button variant="ghost" size="sm" onClick={handleImportTheme}>
								{t("settings-appearance-import")}
							</Button>
							<Show when={themeId() === "custom"}>
								<Button
									variant="ghost"
									size="sm"
									onClick={handleExportTheme}
									title={t("settings-appearance-export-custom-title")}
								>
									{t("settings-appearance-export")}
								</Button>
							</Show>
							<ToggleGroup
								value={themeViewMode()}
								onChange={(value) => {
									if (value) {
										setThemeViewMode(value as ThemeViewMode);
									}
								}}
							>
								<ToggleGroupItem
									value="grid"
									icon_only={true}
									title={t("settings-appearance-grid-view")}
									aria-label={t("settings-appearance-grid-view")}
								>
									<GridIcon class={styles["theme-toolbar-icon"]} />
								</ToggleGroupItem>
								<ToggleGroupItem
									value="list"
									icon_only={true}
									title={t("settings-appearance-list-view")}
									aria-label={t("settings-appearance-list-view")}
								>
									<ListIcon class={styles["theme-toolbar-icon"]} />
								</ToggleGroupItem>
							</ToggleGroup>
						</Show>
					</div>
					<div
						class={styles["theme-preset-grid"]}
						classList={{
							[styles["theme-preset-grid--list"]]: themeViewMode() === "list",
						}}
					>
						<For each={filteredThemeCatalog()}>
							{(theme) => {
								const source =
									theme.source ??
									(isBuiltinThemeId(theme.id) ? "builtin" : "imported");
								return (
									<ThemePresetCard
										theme={theme}
										source={source}
										viewMode={themeViewMode()}
										isSelected={themeId() === theme.id}
										isDeletable={source === "imported"}
										onDelete={() => handleDeleteImportedTheme(theme.id)}
										onClick={() => handlePresetSelect(theme.id)}
									/>
								);
							}}
						</For>
					</div>
					<Show when={filteredThemeCatalog().length === 0}>
						<div class={styles["theme-empty-state"]}>
							{t("settings-appearance-no-themes-match")}
						</div>
					</Show>
				</SettingsCard>

				<UiChromeModeControl
					value={uiChromeMode()}
					onChange={handleUiChromeModeChange}
				/>

				<SettingsCard
					header={t("settings-appearance-color-mode-title")}
					subHeader={t("settings-appearance-color-mode-subheader")}
				>
					<SettingsField
						label={t("settings-appearance-color-mode-label")}
						description={t("settings-appearance-color-mode-description")}
						headerRight={
							<ToggleGroup
								value={colorMode()}
								onChange={(mode) => {
									if (mode) {
										void handleColorModeChange(
											mode as ColorModePreference,
										);
									}
								}}
							>
								<ToggleGroupItem value="system">
									{t("settings-appearance-color-mode-system")}
								</ToggleGroupItem>
								<ToggleGroupItem value="light">
									{t("settings-appearance-color-mode-light")}
								</ToggleGroupItem>
								<ToggleGroupItem value="dark">
									{t("settings-appearance-color-mode-dark")}
								</ToggleGroupItem>
							</ToggleGroup>
						}
					/>
				</SettingsCard>

				<Show when={canChangeHue()}>
					<SettingsCard
						header={t("settings-appearance-customize-colors-title")}
						subHeader={t("settings-appearance-customize-colors-subheader")}
					>
						<SettingsField
							label={t("settings-appearance-primary-hue-label")}
							description={t("settings-appearance-primary-hue-description")}
							body={
								<div class={styles["hue-customization"]}>
									<Slider
										value={[backgroundHue()]}
										onInput={(val: any) => handleHueChange(val, true)}
										onChange={(val) => handleHueChange(val, false)}
										minValue={0}
										maxValue={360}
										step={1}
										class={styles["slider--hue"]}
									>
										<div class={styles["slider__header"]}>
											<div class={styles["slider__value-label"]}>
												{backgroundHue()}°
											</div>
										</div>
										<SliderTrack class={styles["slider-track-hue"]}>
											<SliderThumb />
										</SliderTrack>
									</Slider>
								</div>
							}
						/>
					</SettingsCard>
				</Show>

				<SettingsCard
					header={t("settings-appearance-window-transparency-title")}
					subHeader={t("settings-appearance-window-transparency-subheader")}
				>
					<SettingsField
						label={t("settings-appearance-window-effect-label")}
						description={t("settings-appearance-window-effect-description")}
						headerRight={
							<ToggleGroup
								value={windowEffect() || "none"}
								onChange={(val) => {
									if (val) handleWindowEffectChange(val as string);
								}}
								style={{ "flex-wrap": "wrap" }}
							>
								<For each={windowEffectOptions()}>
									{(effect) => (
										<ToggleGroupItem value={effect}>
											{getWindowEffectLabel(effect)}
										</ToggleGroupItem>
									)}
								</For>
							</ToggleGroup>
						}
					/>
					<SettingsField
						label={t("settings-appearance-background-opacity-label")}
						description={t("settings-appearance-background-opacity-description")}
						body={
							<Slider
								value={[
									backgroundOpacity() !== undefined ? backgroundOpacity() : 12,
								]}
								onInput={(val: any) => handleBackgroundOpacityChange(val, true)}
								onChange={(val) => handleBackgroundOpacityChange(val, false)}
								minValue={0}
								maxValue={100}
								step={1}
							>
								<div class={styles["slider__header"]}>
									<div class={styles["slider__value-label"]}>
										{backgroundOpacity() !== undefined
											? backgroundOpacity()
											: 12}
										%
									</div>
								</div>
								<SliderTrack>
									<SliderFill />
									<SliderThumb />
								</SliderTrack>
							</Slider>
						}
					/>
				</SettingsCard>

				<Show when={showAdvancedControls()}>
					<SettingsCard
						header={t("settings-appearance-advanced-style-title")}
						subHeader={t("settings-appearance-advanced-style-subheader")}
					>
						<Show when={canChangeStyle()}>
							<SettingsField
								label={t("settings-appearance-material-style-label")}
								description={t("settings-appearance-material-style-description")}
								headerRight={
									<ToggleGroup
										value={styleMode()}
										onChange={(val) => {
											if (val) handleStyleModeChange(val as StyleMode);
										}}
									>
										<ToggleGroupItem value="glass">
											{t("settings-appearance-material-glass")}
										</ToggleGroupItem>
										<ToggleGroupItem value="frosted">
											{t("settings-appearance-material-frosted")}
										</ToggleGroupItem>
										<ToggleGroupItem value="flat">
											{t("settings-appearance-material-flat")}
										</ToggleGroupItem>
									</ToggleGroup>
								}
							/>
						</Show>

						<SettingsField
							label={t("settings-appearance-layout-translucency-label")}
							description={t("settings-appearance-layout-translucency-description")}
							body={
								<Slider
									value={[opacity()]}
									onInput={(val: any) => handleOpacityChange(val, true)}
									onChange={(val) =>
										opacity() !== val[0] && handleOpacityChange(val, false)
									}
									minValue={0}
									maxValue={100}
									step={1}
								>
									<div class={styles["slider__header"]}>
										<div class={styles["slider__value-label"]}>
											{opacity()}%
										</div>
									</div>
									<SliderTrack>
										<SliderFill />
										<SliderThumb />
									</SliderTrack>
								</Slider>
							}
						/>

						<Show when={styleMode() !== "flat"}>
							<SettingsField
								label={t("settings-appearance-material-grain-label")}
								description={t("settings-appearance-material-grain-description")}
								body={
									<Slider
										value={[grainStrength()]}
										onInput={(val: any) => handleGrainStrengthChange(val, true)}
										onChange={(val) => handleGrainStrengthChange(val, false)}
										minValue={0}
										maxValue={100}
										step={1}
									>
										<div class={styles["slider__header"]}>
											<div class={styles["slider__value-label"]}>
												{grainStrength()}%
											</div>
										</div>
										<SliderTrack>
											<SliderFill />
											<SliderThumb />
										</SliderTrack>
									</Slider>
								}
							/>
						</Show>

						<SettingsField
							label={t("settings-appearance-background-gradient-label")}
							description={t("settings-appearance-background-gradient-description")}
							headerRight={
								<Switch
									checked={gradientEnabled() ?? false}
									onCheckedChange={handleGradientToggle}
								>
									<SwitchControl>
										<SwitchThumb />
									</SwitchControl>
								</Switch>
							}
						/>
						<Show when={gradientEnabled()}>
							<SettingsField
								label={t("settings-appearance-gradient-type-label")}
								description={t("settings-appearance-gradient-type-description")}
								headerRight={
									<ToggleGroup
										value={gradientType() ?? "linear"}
										onChange={(val) => {
											if (val)
												handleGradientTypeChange(val as "linear" | "radial");
										}}
									>
										<ToggleGroupItem value="linear">
											{t("settings-appearance-gradient-linear")}
										</ToggleGroupItem>
										<ToggleGroupItem value="radial">
											{t("settings-appearance-gradient-circular")}
										</ToggleGroupItem>
									</ToggleGroup>
								}
							/>

							<SettingsField
								label={t("settings-appearance-rotation-label")}
								description={t("settings-appearance-rotation-description")}
								body={
									<Slider
										value={[rotation() ?? 135]}
										onInput={(val: any) => handleRotationChange(val, true)}
										onChange={(val) => handleRotationChange(val, false)}
										minValue={0}
										maxValue={360}
										step={1}
										class={styles["slider--angle"]}
									>
										<div class={styles["slider__header"]}>
											<div class={styles["slider__value-label"]}>
												{rotation()}°
											</div>
										</div>
										<SliderTrack>
											<SliderFill />
											<SliderThumb />
										</SliderTrack>
									</Slider>
								}
							/>

							<SettingsField
								label={t("settings-appearance-color-harmony-label")}
								description={t("settings-appearance-color-harmony-description")}
								helpTopic="GRADIENT_HARMONY"
								headerRight={
									<ToggleGroup
										value={gradientHarmony() ?? "none"}
										onChange={(val) => {
											if (val)
												handleGradientHarmonyChange(val as GradientHarmony);
										}}
									>
										<ToggleGroupItem value="none">
											{t("settings-appearance-none")}
										</ToggleGroupItem>
										<ToggleGroupItem value="complementary">
											{t("settings-appearance-harmony-complement")}
										</ToggleGroupItem>
										<ToggleGroupItem value="analogous">
											{t("settings-appearance-harmony-analogous")}
										</ToggleGroupItem>
										<ToggleGroupItem value="triadic">
											{t("settings-appearance-harmony-triadic")}
										</ToggleGroupItem>
									</ToggleGroup>
								}
							/>
						</Show>

						<Show when={canChangeBorder()}>
							<SettingsField
								label={t("settings-appearance-border-sharpness-label")}
								description={t("settings-appearance-border-sharpness-description")}
								body={
									<Slider
										value={[borderThickness() ?? 1]}
										onInput={(val: any) =>
											handleBorderThicknessChange(val, true)
										}
										onChange={(val) => handleBorderThicknessChange(val, false)}
										minValue={0}
										maxValue={6}
										step={0.5}
									>
										<div class={styles["slider__header"]}>
											<div class={styles["slider__value-label"]}>
												{borderThickness() === 0
													? t("settings-appearance-none")
													: `${(borderThickness() ?? 1).toString()}px`}
											</div>
										</div>
										<SliderTrack>
											<SliderFill />
											<SliderThumb />
										</SliderTrack>
									</Slider>
								}
							/>
						</Show>
					</SettingsCard>

					<For
						each={
							activeThemeDefinition() ? activeThemeDefinition()?.variables : []
						}
					>
						{(group) => (
							<SettingsCard header={group.name} subHeader={group.description}>
								<SettingsField
									label={group.name}
									description={group.description}
									headerRight={
										group.type === "boolean" ? (
											<Switch
												checked={Boolean(
													userVariablesSnapshot()[group.key] ?? group.default,
												)}
												onCheckedChange={(val: boolean) =>
													handleVariableChange(group.key, val)
												}
											>
												<SwitchControl>
													<SwitchThumb />
												</SwitchControl>
											</Switch>
										) : group.type === "select" ? (
											<ToggleGroup
												value={String(
													userVariablesSnapshot()[group.key] ?? group.default,
												)}
												onChange={(val) =>
													val && handleVariableChange(group.key, val)
												}
											>
												<For each={group.options}>
													{(opt) => (
														<ToggleGroupItem value={opt.value}>
															{opt.label}
														</ToggleGroupItem>
													)}
												</For>
											</ToggleGroup>
										) : undefined
									}
									body={
										group.type === "number" ? (
											<Slider
												value={[
													getNumberVariableValue(
														userVariablesSnapshot()[group.key] ?? group.default,
														group.default,
														group.min,
														group.max,
													),
												]}
												onChange={(val) =>
													handleVariableChange(group.key, val[0], true)
												}
												onChangeEnd={(val) =>
													handleVariableChange(group.key, val[0], false)
												}
												minValue={group.min ?? 0}
												maxValue={group.max ?? 100}
												step={group.step ?? 1}
											>
												<div class={styles["slider__header"]}>
													<div class={styles["slider__value-label"]}>
														{getNumberVariableValue(
															userVariablesSnapshot()[group.key] ??
																group.default,
															group.default,
															group.min,
															group.max,
														)}
														{group.unit || ""}
													</div>
												</div>
												<SliderTrack>
													<SliderFill />
													<SliderThumb />
												</SliderTrack>
											</Slider>
										) : undefined
									}
								/>
							</SettingsCard>
						)}
					</For>
				</Show>
			</div>
		</div>
	);
}

export default AppearanceSettingsTab;
