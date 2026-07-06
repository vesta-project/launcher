import { SettingsCard, SettingsField } from "@components/settings";
import panelStyles from "@components/settings/settings.module.css";
import {
	activeThemeDefinition,
	backgroundHue,
	backgroundOpacity,
	borderThickness,
	canChangeBorder,
	canChangeHue,
	canChangeStyle,
	filteredThemeCatalog,
	getThemeSource,
	gradientEnabled,
	gradientHarmony,
	gradientType,
	grainStrength,
	handleBackgroundOpacityChange,
	handleBorderThicknessChange,
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
import {
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

const SearchIcon = (props: { class?: string }) => (
	<svg
		xmlns="http://www.w3.org/2000/svg"
		width="20"
		height="20"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="2"
		stroke-linecap="round"
		stroke-linejoin="round"
		class={props.class}
	>
		<circle cx="11" cy="11" r="8"></circle>
		<line x1="21" y1="21" x2="16.65" y2="16.65"></line>
	</svg>
);

const ListIcon = (props: { class?: string }) => (
	<svg
		xmlns="http://www.w3.org/2000/svg"
		width="20"
		height="20"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="2"
		stroke-linecap="round"
		stroke-linejoin="round"
		class={props.class}
	>
		<line x1="8" y1="6" x2="21" y2="6"></line>
		<line x1="8" y1="12" x2="21" y2="12"></line>
		<line x1="8" y1="18" x2="21" y2="18"></line>
		<line x1="3" y1="6" x2="3.01" y2="6"></line>
		<line x1="3" y1="12" x2="3.01" y2="12"></line>
		<line x1="3" y1="18" x2="3.01" y2="18"></line>
	</svg>
);

const GridIcon = (props: { class?: string }) => (
	<svg
		xmlns="http://www.w3.org/2000/svg"
		width="20"
		height="20"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="2"
		stroke-linecap="round"
		stroke-linejoin="round"
		class={props.class}
	>
		<rect x="3" y="3" width="7" height="7"></rect>
		<rect x="14" y="3" width="7" height="7"></rect>
		<rect x="14" y="14" width="7" height="7"></rect>
		<rect x="3" y="14" width="7" height="7"></rect>
	</svg>
);

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
				return "None";
			case "transparent":
				return "Transparent";
			case "vibrancy":
				return "Vibrancy";
			case "liquid_glass":
				return "Liquid Glass";
			case "mica":
				return "Mica";
			case "acrylic":
				return "Acrylic";
			case "blur":
				return "Blur";
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
							title="Search themes"
							aria-label="Search themes"
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
								placeholder="Search themes"
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
									<ToggleGroupItem value="all">All</ToggleGroupItem>
									<ToggleGroupItem value="builtin">Defaults</ToggleGroupItem>
									<ToggleGroupItem value="imported">Imported</ToggleGroupItem>
								</ToggleGroup>
							</Show>
							<div class={styles["theme-toolbar__spacer"]} />
							<Button variant="ghost" size="sm" onClick={handleImportTheme}>
								Import
							</Button>
							<Show when={themeId() === "custom"}>
								<Button
									variant="ghost"
									size="sm"
									onClick={handleExportTheme}
									title="Export current custom theme"
								>
									Export
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
									title="Grid view"
									aria-label="Grid view"
								>
									<GridIcon class={styles["theme-toolbar-icon"]} />
								</ToggleGroupItem>
								<ToggleGroupItem
									value="list"
									icon_only={true}
									title="List view"
									aria-label="List view"
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
							No themes match your current filters.
						</div>
					</Show>
				</SettingsCard>

				<UiChromeModeControl
					value={uiChromeMode()}
					onChange={handleUiChromeModeChange}
				/>

				<Show when={canChangeHue()}>
					<SettingsCard
						header="Customize Colors"
						subHeader="Adjust the primary color hue to personalize your theme."
					>
						<SettingsField
							label="Primary Hue"
							description="The base color used for accents and backgrounds"
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
					header="Window Transparency"
					subHeader="Adjust native window compositor effects."
				>
					<SettingsField
						label="Window Effect Material"
						description="OS-native background blur."
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
						label="Background Opacity"
						description="Lower this value to reveal the native window effect underneath the launcher."
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
						header="Advanced Style"
						subHeader="Fine-tune the visual style and effects."
					>
						<Show when={canChangeStyle()}>
							<SettingsField
								label="Material Style"
								description="Glass keeps depth, Frosted obscures behind-content, Flat removes translucency."
								headerRight={
									<ToggleGroup
										value={styleMode()}
										onChange={(val) => {
											if (val) handleStyleModeChange(val as StyleMode);
										}}
									>
										<ToggleGroupItem value="glass">Glass</ToggleGroupItem>
										<ToggleGroupItem value="frosted">Frosted</ToggleGroupItem>
										<ToggleGroupItem value="flat">Flat</ToggleGroupItem>
									</ToggleGroup>
								}
							/>
						</Show>

						<SettingsField
							label="Layout Translucency"
							description="Adjust panel transparency and blur intensity (0 = translucent, 100 = opaque)."
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
								label="Material Grain"
								description="Change the intensity of the material texture overlay. Only applies to Glass and Frosted styles."
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
							label="Background Gradient"
							description="Enable animated background gradient"
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
								label="Gradient Type"
								description="Linear or circular background"
								headerRight={
									<ToggleGroup
										value={gradientType() ?? "linear"}
										onChange={(val) => {
											if (val)
												handleGradientTypeChange(val as "linear" | "radial");
										}}
									>
										<ToggleGroupItem value="linear">Linear</ToggleGroupItem>
										<ToggleGroupItem value="radial">Circular</ToggleGroupItem>
									</ToggleGroup>
								}
							/>

							<SettingsField
								label="Rotation"
								description="Angle of the background gradient"
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
								label="Color Harmony"
								description="Choose how secondary colors are generated"
								helpTopic="GRADIENT_HARMONY"
								headerRight={
									<ToggleGroup
										value={gradientHarmony() ?? "none"}
										onChange={(val) => {
											if (val)
												handleGradientHarmonyChange(val as GradientHarmony);
										}}
									>
										<ToggleGroupItem value="none">None</ToggleGroupItem>
										<ToggleGroupItem value="complementary">
											Complement
										</ToggleGroupItem>
										<ToggleGroupItem value="analogous">
											Analogous
										</ToggleGroupItem>
										<ToggleGroupItem value="triadic">Triadic</ToggleGroupItem>
									</ToggleGroup>
								}
							/>
						</Show>

						<Show when={canChangeBorder()}>
							<SettingsField
								label="Border Sharpness"
								description="Thickness of system borders and separator lines (0-6px)"
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
													? "None"
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
