import { SettingsCard, SettingsField } from "@components/settings";
import Button from "@ui/button/button";
import { Slider, SliderFill, SliderThumb, SliderTrack } from "@ui/slider/slider";
import { Switch, SwitchControl, SwitchThumb } from "@ui/switch/switch";
import { ToggleGroup, ToggleGroupItem } from "@ui/toggle-group/toggle-group";
import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import {
	type GradientHarmony,
	isBuiltinThemeId,
	type StyleMode,
	type ThemeConfig,
	type ThemeVariableValue,
} from "../../../../../themes/presets";
import { ThemePresetCard } from "../../../../theme-preset-card/theme-preset-card";
import styles from "../settings-page.module.css";

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

interface ThemeVariableViewModel {
	name: string;
	key: string;
	type: "number" | "color" | "boolean" | "select";
	default: ThemeVariableValue;
	value: ThemeVariableValue;
	description?: string;
	min?: number;
	max?: number;
	step?: number;
	unit?: string;
	options?: Array<{ label: string; value: string }>;
}

export interface AppearanceSettingsTabProps {
	themes: ThemeConfig[];
	themeId: string;
	themeSearchQuery: string;
	onThemeSearchQueryChange: (value: string) => void;
	themeFilterMode: ThemeFilterMode;
	onThemeFilterModeChange: (value: ThemeFilterMode) => void;
	themeViewMode: ThemeViewMode;
	onThemeViewModeChange: (value: ThemeViewMode) => void;
	hasImportedThemes: boolean;
	handleDeleteTheme: (themeId: string) => void;
	canExportTheme: boolean;
	handlePresetSelect: (id: string) => void;
	canChangeHue: boolean;
	canChangeStyle: boolean;
	canChangeBorder: boolean;
	showAdvancedControls: boolean;
	backgroundHue: number;
	handleHueChange: (val: number[], live?: boolean) => void;
	styleMode: StyleMode;
	handleStyleChange: (mode: StyleMode) => void;
	opacity: number;
	handleOpacityChange: (val: number[], live?: boolean) => void;
	grainStrength: number;
	handleGrainStrengthChange: (val: number[], live?: boolean) => void;
	gradientEnabled: boolean;
	handleGradientToggle: (checked: boolean) => void;
	gradientType: "linear" | "radial";
	handleGradientTypeChange: (val: "linear" | "radial") => void;
	rotation: number;
	handleRotationChange: (val: number[], live?: boolean) => void;
	gradientHarmony: GradientHarmony;
	handleGradientHarmonyChange: (val: GradientHarmony) => void;
	borderThickness: number;
	handleBorderThicknessChange: (val: number[], live?: boolean) => void;
	backgroundOpacity: number;
	handleBackgroundOpacityChange: (val: number[], live?: boolean) => void;
	windowEffect: string;
	windowEffectOptions: string[];
	handleWindowEffectChange: (val: string) => void;
	handleImportTheme: () => void;
	handleExportTheme: () => void;
	themeVariables?: ThemeVariableViewModel[];
	handleVariableChange: (key: string, val: ThemeVariableValue, live?: boolean) => void;
}

export function AppearanceSettingsTab(props: AppearanceSettingsTabProps) {
	const [isSearchExpanded, setIsSearchExpanded] = createSignal(
		props.themeSearchQuery.trim().length > 0,
	);
	let searchInputRef: HTMLInputElement | undefined;
	let blurTimer: ReturnType<typeof setTimeout> | undefined;

	createEffect(() => {
		if (props.themeSearchQuery.trim().length > 0) {
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
			if (props.themeSearchQuery.trim().length === 0) {
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

	return (
		<div class={styles["settings-tab-content"]}>
			<section class={styles["settings-section"]}>
				<div
					style={{
						display: "flex",
						"justify-content": "space-between",
						"align-items": "center",
					}}
				>
					<h2>Theme Presets</h2>
					<div style={{ display: "flex", gap: "8px" }}>
						<Button variant="ghost" size="sm" onClick={props.handleImportTheme}>
							Import
						</Button>
						<Show when={props.canExportTheme}>
							<Button
								variant="ghost"
								size="sm"
								onClick={props.handleExportTheme}
								title="Export current custom theme"
							>
								Export
							</Button>
						</Show>
					</div>
				</div>
				<p class={styles["section-description"]}>
					Choose a pre-designed theme or create your own custom look.
				</p>
				<div class={styles["theme-toolbar"]}>
					<div class={styles["theme-toolbar__left"]}>
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
								value={props.themeSearchQuery}
								onInput={(event) => props.onThemeSearchQueryChange(event.currentTarget.value)}
								onBlur={collapseSearchIfEmpty}
								placeholder="Search themes"
								class={`${styles["theme-search-input"]} ${styles["theme-search-input--expanded"]}`}
							/>
						</Show>
						<div class={styles["theme-toolbar__toggles"]}>
							<Show when={props.hasImportedThemes}>
								<ToggleGroup
									value={props.themeFilterMode}
									onChange={(value) => {
										if (value) {
											props.onThemeFilterModeChange(value as ThemeFilterMode);
										}
									}}
								>
									<ToggleGroupItem value="all">All</ToggleGroupItem>
									<ToggleGroupItem value="builtin">Defaults</ToggleGroupItem>
									<ToggleGroupItem value="imported">Imported</ToggleGroupItem>
								</ToggleGroup>
							</Show>
						</div>
					</div>
					<ToggleGroup
						value={props.themeViewMode}
						onChange={(value) => {
							if (value) {
								props.onThemeViewModeChange(value as ThemeViewMode);
							}
						}}
					>
						<ToggleGroupItem value="grid" title="Grid view" aria-label="Grid view">
							<GridIcon class={styles["theme-toolbar-icon"]} />
						</ToggleGroupItem>
						<ToggleGroupItem value="list" title="List view" aria-label="List view">
							<ListIcon class={styles["theme-toolbar-icon"]} />
						</ToggleGroupItem>
					</ToggleGroup>
				</div>
				<div
					class={styles["theme-preset-grid"]}
					classList={{
						[styles["theme-preset-grid--list"]]: props.themeViewMode === "list",
					}}
				>
					<For each={props.themes}>
						{(theme) => {
							const source = theme.source ?? (isBuiltinThemeId(theme.id) ? "builtin" : "imported");
							return (
								<ThemePresetCard
									theme={theme}
									source={source}
									viewMode={props.themeViewMode}
									isSelected={props.themeId === theme.id}
									isDeletable={source === "imported"}
									onDelete={() => props.handleDeleteTheme(theme.id)}
									onClick={() => props.handlePresetSelect(theme.id)}
								/>
							);
						}}
					</For>
				</div>
				<Show when={props.themes.length === 0}>
					<div class={styles["theme-empty-state"]}>No themes match your current filters.</div>
				</Show>
			</section>

			<Show when={props.canChangeHue}>
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
									value={[props.backgroundHue]}
									onInput={(val: any) => props.handleHueChange(val, true)}
									onChange={(val) => props.handleHueChange(val, false)}
									minValue={0}
									maxValue={360}
									step={1}
									class={styles["slider--hue"]}
								>
									<div class={styles["slider__header"]}>
										<div class={styles["slider__value-label"]}>{props.backgroundHue}°</div>
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

			<SettingsCard header="Window Transparency" subHeader="Adjust native window compositor effects.">
				<SettingsField
					label="Window Effect Material"
					description="OS-native background blur."
					headerRight={
						<ToggleGroup
							value={props.windowEffect || "none"}
							onChange={(val) => {
								if (val) props.handleWindowEffectChange(val as string);
							}}
							style={{ "flex-wrap": "wrap" }}
						>
							<For each={props.windowEffectOptions}>
								{(effect) => (
									<ToggleGroupItem value={effect}>{getWindowEffectLabel(effect)}</ToggleGroupItem>
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
							value={[props.backgroundOpacity !== undefined ? props.backgroundOpacity : 12]}
							onInput={(val: any) => props.handleBackgroundOpacityChange(val, true)}
							onChange={(val) => props.handleBackgroundOpacityChange(val, false)}
							minValue={0}
							maxValue={100}
							step={1}
						>
							<div class={styles["slider__header"]}>
								<div class={styles["slider__value-label"]}>
									{props.backgroundOpacity !== undefined ? props.backgroundOpacity : 12}%
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

			<Show when={props.showAdvancedControls}>
				<SettingsCard header="Advanced Style" subHeader="Fine-tune the visual style and effects.">
					<Show when={props.canChangeStyle}>
						<SettingsField
							label="Material Style"
							description="Glass keeps depth, Frosted obscures behind-content, Flat removes translucency."
							headerRight={
								<ToggleGroup
									value={props.styleMode}
									onChange={(val) => {
										if (val) props.handleStyleChange(val as StyleMode);
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
								value={[props.opacity]}
								onInput={(val: any) => props.handleOpacityChange(val, true)}
								onChange={(val) => props.opacity !== val[0] && props.handleOpacityChange(val, false)}
								minValue={0}
								maxValue={100}
								step={1}
							>
								<div class={styles["slider__header"]}>
									<div class={styles["slider__value-label"]}>{props.opacity}%</div>
								</div>
								<SliderTrack>
									<SliderFill />
									<SliderThumb />
								</SliderTrack>
							</Slider>
						}
					/>

					<Show when={props.styleMode !== "flat"}>
						<SettingsField
							label="Material Grain"
							description="Change the intensity of the material texture overlay. Only applies to Glass and Frosted styles."
							body={
								<Slider
									value={[props.grainStrength]}
									onInput={(val: any) => props.handleGrainStrengthChange(val, true)}
									onChange={(val) => props.handleGrainStrengthChange(val, false)}
									minValue={0}
									maxValue={100}
									step={1}
								>
									<div class={styles["slider__header"]}>
										<div class={styles["slider__value-label"]}>{props.grainStrength}%</div>
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
								checked={props.gradientEnabled ?? false}
								onCheckedChange={props.handleGradientToggle}
							>
								<SwitchControl>
									<SwitchThumb />
								</SwitchControl>
							</Switch>
						}
					/>
					<Show when={props.gradientEnabled}>
						<SettingsField
							label="Gradient Type"
							description="Linear or circular background"
							headerRight={
								<ToggleGroup
									value={props.gradientType ?? "linear"}
									onChange={(val) => {
										if (val) props.handleGradientTypeChange(val as "linear" | "radial");
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
									value={[props.rotation ?? 135]}
									onInput={(val: any) => props.handleRotationChange(val, true)}
									onChange={(val) => props.handleRotationChange(val, false)}
									minValue={0}
									maxValue={360}
									step={1}
									class={styles["slider--angle"]}
								>
									<div class={styles["slider__header"]}>
										<div class={styles["slider__value-label"]}>{props.rotation}°</div>
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
									value={props.gradientHarmony ?? "none"}
									onChange={(val) => {
										if (val) props.handleGradientHarmonyChange(val as GradientHarmony);
									}}
								>
									<ToggleGroupItem value="none">None</ToggleGroupItem>
									<ToggleGroupItem value="complementary">Complement</ToggleGroupItem>
									<ToggleGroupItem value="analogous">Analogous</ToggleGroupItem>
									<ToggleGroupItem value="triadic">Triadic</ToggleGroupItem>
								</ToggleGroup>
							}
						/>
					</Show>

					<Show when={props.canChangeBorder}>
						<SettingsField
							label="Border Sharpness"
							description="Thickness of system borders and separator lines (0-6px)"
							body={
								<Slider
									value={[props.borderThickness ?? 1]}
									onInput={(val: any) => props.handleBorderThicknessChange(val, true)}
									onChange={(val) => props.handleBorderThicknessChange(val, false)}
									minValue={0}
									maxValue={6}
									step={0.5}
								>
									<div class={styles["slider__header"]}>
										<div class={styles["slider__value-label"]}>
											{props.borderThickness === 0
												? "None"
												: `${(props.borderThickness ?? 1).toString()}px`}
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

				<For each={props.themeVariables}>
					{(group) => (
						<SettingsCard header={group.name} subHeader={group.description}>
							<SettingsField
								label={group.name}
								description={group.description}
								headerRight={
									group.type === "boolean" ? (
										<Switch
											checked={Boolean(group.value)}
											onCheckedChange={(val: boolean) => props.handleVariableChange(group.key, val)}
										>
											<SwitchControl>
												<SwitchThumb />
											</SwitchControl>
										</Switch>
									) : group.type === "select" ? (
										<ToggleGroup
											value={String(group.value)}
											onChange={(val) => val && props.handleVariableChange(group.key, val)}
										>
											<For each={group.options}>
												{(opt) => <ToggleGroupItem value={opt.value}>{opt.label}</ToggleGroupItem>}
											</For>
										</ToggleGroup>
									) : undefined
								}
								body={
									group.type === "number" ? (
										<Slider
											value={[group.value as number]}
											onInput={(val: any) => props.handleVariableChange(group.key, val[0], true)}
											onChange={(val) => props.handleVariableChange(group.key, val[0], false)}
											minValue={group.min ?? 0}
											maxValue={group.max ?? 100}
											step={group.step ?? 1}
										>
											<div class={styles["slider__header"]}>
												<div class={styles["slider__value-label"]}>
													{group.value}
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
	);
}

export default AppearanceSettingsTab;
