import { router } from "@components/page-viewer/page-viewer";
import { invoke } from "@tauri-apps/api/core";
import LauncherButton from "@ui/button/button";
import {
	Slider,
	SliderFill,
	SliderThumb,
	SliderTrack,
} from "@ui/slider/slider";
import {
	Switch,
	SwitchControl,
	SwitchLabel,
	SwitchThumb,
} from "@ui/switch/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent, TabsIndicator } from "@ui/tabs/tabs";
import { onConfigUpdate } from "@utils/config-sync";
import { hasTauriRuntime } from "@utils/tauri-runtime";
import { createEffect, createSignal, onCleanup, onMount, Show, For } from "solid-js";
import { applyTheme, validateTheme, getThemeById, PRESET_THEMES, type ThemeConfig } from "../../../../themes/presets";
import { ToggleGroup, ToggleGroupItem } from "@ui/toggle-group/toggle-group";
import { ThemePresetCard } from "../../../theme-preset-card/theme-preset-card";
import "./settings-page.css";

interface AppConfig {
	debug_logging: boolean;
	background_hue: number;
	reduced_motion?: boolean;
	reduced_effects?: boolean;
	
	// Theme system fields
	theme_id: string;
	theme_mode: string;
	theme_primary_hue: number;
	theme_primary_sat?: number;
	theme_primary_light?: number;
	theme_style: string;
	theme_gradient_enabled: boolean;
	theme_gradient_angle?: number;
	theme_gradient_harmony?: string;
	theme_advanced_overrides?: string;
	[key: string]: any;
}

function SettingsPage() {
	const [currentTab, setCurrentTab] = createSignal("appearance");
	const [debugLogging, setDebugLogging] = createSignal(false);
	const [backgroundHue, setBackgroundHue] = createSignal(220);
	const [styleMode, setStyleMode] = createSignal<ThemeConfig["style"] | null>(null);
	const [gradientEnabled, setGradientEnabled] = createSignal<boolean | null>(null);
	const [gradientAngle, setGradientAngle] = createSignal<number | null>(null);
	const [themeId, setThemeId] = createSignal<string | null>(null);
	const [borderThickness, setBorderThickness] = createSignal(1);
	const [customCss, setCustomCss] = createSignal("");
	const [reducedMotion, setReducedMotion] = createSignal(false);
	const [loading, setLoading] = createSignal(true);

	// Permissions helpers based on current theme
	const canChangeStyle = () => (themeId() ? (getThemeById(themeId()!)?.allowStyleChange ?? false) : false);
	const canChangeHue = () => (themeId() ? (getThemeById(themeId()!)?.allowHueChange ?? false) : false);
	const canChangeBorder = () => (themeId() ? (getThemeById(themeId()!)?.allowBorderChange ?? false) : false);

	let unsubscribeConfigUpdate: (() => void) | null = null;

	onMount(async () => {
		try {
			if (hasTauriRuntime()) {
				const config = await invoke<AppConfig>("get_config");
				setDebugLogging(config.debug_logging);
				setReducedMotion(config.reduced_motion ?? false);
				
				// Load theme configuration - migrate from legacy background_hue if present
				const themeIdFromConfig = config.theme_id ?? null;
				const primaryHueFromConfig = typeof config.theme_primary_hue === "number" ? config.theme_primary_hue : (typeof config.background_hue === "number" ? config.background_hue : null);
				const styleFromConfig = (config.theme_style as ThemeConfig["style"]) ?? null;
				const gradientEnabledFromConfig = typeof config.theme_gradient_enabled === "boolean" ? config.theme_gradient_enabled : null;
				const gradientAngleFromConfig = typeof config.theme_gradient_angle === "number" ? config.theme_gradient_angle : null;
				
				// Set UI state only for values present in config
				if (themeIdFromConfig) setThemeId(themeIdFromConfig);
				if (primaryHueFromConfig !== null) setBackgroundHue(primaryHueFromConfig as number);
				if (styleFromConfig) setStyleMode(styleFromConfig);
				if (gradientEnabledFromConfig !== null) setGradientEnabled(gradientEnabledFromConfig);
				if (gradientAngleFromConfig !== null) setGradientAngle(gradientAngleFromConfig);
				
				// Apply current theme only if config provided explicit theme_id or primary hue
				if (themeIdFromConfig || primaryHueFromConfig !== null) {
					const effectiveThemeId = themeIdFromConfig ?? "midnight";
					const currentTheme = getThemeById(effectiveThemeId);
					const hueToApply = (primaryHueFromConfig !== null ? primaryHueFromConfig : currentTheme?.primaryHue ?? 220) as number;
					const styleToApply = (styleFromConfig ?? currentTheme?.style ?? "glass") as ThemeConfig["style"];
					const gradientToApply = (gradientEnabledFromConfig !== null ? gradientEnabledFromConfig : currentTheme?.gradientEnabled ?? true) as boolean;
					const angleToApply = (gradientAngleFromConfig ?? currentTheme?.gradientAngle ?? 135) as number;
					if (currentTheme) {
						applyTheme(validateTheme({
							...currentTheme,
							primaryHue: hueToApply,
							style: styleToApply,
							gradientEnabled: gradientToApply,
							gradientAngle: angleToApply,
						}));
					}
				}
			}

			// Subscribe to config updates
			unsubscribeConfigUpdate = onConfigUpdate(async (updatedConfig) => {
				const config = updatedConfig as AppConfig;
				setDebugLogging(config.debug_logging);
				setReducedMotion(config.reduced_motion ?? false);
				
				// Update theme state from config changes
				if (config.theme_id) setThemeId(config.theme_id);
				if (config.theme_primary_hue) setBackgroundHue(config.theme_primary_hue);
				if (config.theme_style) setStyleMode(config.theme_style as ThemeConfig["style"]);
				if (typeof config.theme_gradient_enabled === "boolean") setGradientEnabled(config.theme_gradient_enabled);
				if (config.theme_gradient_angle) setGradientAngle(config.theme_gradient_angle);
			});
		} catch (error) {
			console.error("Failed to load settings:", error);
		} finally {
			setLoading(false);
		}
	});

	onCleanup(() => {
		unsubscribeConfigUpdate?.();
	});

	const handlePresetSelect = async (id: string) => {
		const theme = getThemeById(id);
		if (theme) {
			setThemeId(id);
			setStyleMode(theme.style);
			setGradientEnabled(theme.gradientEnabled);
			setGradientAngle(theme.gradientAngle || 135);
			
			// For template themes with locked hue, use theme's hue; otherwise keep current
			const newHue = theme.allowHueChange === false ? theme.primaryHue : backgroundHue();
			if (theme.primaryHue && theme.allowHueChange === false) {
				setBackgroundHue(newHue);
			}
			
			// Apply theme immediately
			applyTheme(validateTheme({
				...theme,
				primaryHue: newHue,
			}));
			
			// Save to config database
			if (hasTauriRuntime()) {
				try {
					const currentConfig = await invoke<AppConfig>("get_config");
					const updatedConfig = {
						...currentConfig,
						theme_id: id,
						theme_primary_hue: newHue,
						theme_style: theme.style,
						theme_gradient_enabled: theme.gradientEnabled,
						theme_gradient_angle: theme.gradientAngle || 135,
						theme_gradient_harmony: theme.gradientHarmony || "complementary",
						// Keep legacy field in sync for migration compatibility
						background_hue: newHue,
					};
					await invoke("set_config", { config: updatedConfig });
				} catch (error) {
					console.error("Failed to save theme preset selection:", error);
				}
			}
		}
	};

	const handleHueChange = (values: number[]) => {
		const newHue = values[0];
		setBackgroundHue(newHue);
	
		// Apply theme change immediately for live preview
		const currentTheme = getThemeById(themeId());
		if (currentTheme) {
			applyTheme(validateTheme({
				...currentTheme,
				primaryHue: newHue,
				style: styleMode(),
				gradientEnabled: gradientEnabled(),
				gradientAngle: gradientAngle(),
			}));
		}
	};

	const handleHueCommit = async () => {
		if (!hasTauriRuntime()) return;
		try {
			const newHue = backgroundHue();
			const currentConfig = await invoke<AppConfig>("get_config");
			const updatedConfig = {
				...currentConfig,
				theme_primary_hue: newHue,
				background_hue: newHue, // keep legacy field in sync
			};
			await invoke("set_config", { config: updatedConfig });
		} catch (error) {
			console.error("Failed to persist hue on commit:", error);
		}
	};

	const handleStyleModeChange = (mode: ThemeConfig["style"]) => {
		setStyleMode(mode);
	};

	const handleGradientToggle = (enabled: boolean) => {
		setGradientEnabled(enabled);
	};

	const handleGradientAngleChange = (values: number[]) => {
		setGradientAngle(values[0]);
	};

	const handleGradientAngleCommit = async () => {
		if (!hasTauriRuntime()) return;
		try {
			const newAngle = gradientAngle();
			const currentConfig = await invoke<AppConfig>("get_config");
			const updatedConfig = {
				...currentConfig,
				theme_gradient_angle: newAngle,
			};
			await invoke("set_config", { config: updatedConfig });
		} catch (error) {
			console.error("Failed to persist gradient angle on commit:", error);
		}
	};

	// React to hue changes — only apply when we have explicit config-driven values
	createEffect(() => {
		// If no theme information is available yet, do not override the current app theme
		if (!themeId() && backgroundHue() === 220 && styleMode() === null && gradientEnabled() === null && gradientAngle() === null) {
			return;
		}

		const currentTheme = themeId() ? getThemeById(themeId()!) : undefined;
		if (currentTheme) {
			applyTheme(validateTheme({
				...currentTheme,
				primaryHue: (backgroundHue() ?? currentTheme.primaryHue) as number,
				style: (styleMode() ?? currentTheme.style) as ThemeConfig["style"],
				gradientEnabled: (gradientEnabled() ?? currentTheme.gradientEnabled) as boolean,
				gradientAngle: (gradientAngle() ?? currentTheme.gradientAngle) as number,
				borderWidthSubtle: borderThickness(),
				borderWidthStrong: Math.max(borderThickness() + 1, 1),
			}));
		} else if (backgroundHue() !== null && backgroundHue() !== undefined) {
			// No preset theme id but we have a hue — apply a migrated style using a fallback preset
			const fallback = PRESET_THEMES[0];
			applyTheme(validateTheme({
				...fallback,
				primaryHue: backgroundHue() as number,
				style: (styleMode() ?? fallback.style) as ThemeConfig["style"],
				gradientEnabled: (gradientEnabled() ?? fallback.gradientEnabled) as boolean,
				gradientAngle: (gradientAngle() ?? fallback.gradientAngle) as number,
				borderWidthSubtle: borderThickness(),
				borderWidthStrong: Math.max(borderThickness() + 1, 1),
			}));
		}
	});

	// Apply border thickness live (only in bordered mode)
	createEffect(() => {
		if (styleMode() === "bordered") {
			document.documentElement.style.setProperty("--border-width-subtle", `${borderThickness()}px`);
			document.documentElement.style.setProperty("--border-width-strong", `${Math.max(borderThickness() + 1, 1)}px`);
		} else {
			// Reset to defaults for other modes
			document.documentElement.style.setProperty("--border-width-subtle", "1px");
			document.documentElement.style.setProperty("--border-width-strong", "1px");
		}
	});

	const handleDebugToggle = async (checked: boolean) => {
		setDebugLogging(checked);
		
		if (hasTauriRuntime()) {
			try {
				const currentConfig = await invoke<AppConfig>("get_config");
				const updatedConfig = { ...currentConfig, debug_logging: checked };
				await invoke("set_config", { config: updatedConfig });
			} catch (error) {
				console.error("Failed to save debug logging setting:", error);
			}
		}
	};

	const handleOpenAppData = async () => {
		try {
			if (hasTauriRuntime()) {
				await invoke("open_app_config_dir");
			}
		} catch (error) {
			console.error("Failed to open app config directory:", error);
		}
	};

	const handleReducedMotionToggle = async (checked: boolean) => {
		setReducedMotion(checked);
		
		if (hasTauriRuntime()) {
			try {
				const currentConfig = await invoke<AppConfig>("get_config");
				const updatedConfig = { ...currentConfig, reduced_motion: checked };
				await invoke("set_config", { config: updatedConfig });
			} catch (error) {
				console.error("Failed to save reduced motion setting:", error);
			}
		}
	};

	return (
		<div class="settings-page">
			<Show when={!loading()} fallback={<div class="settings-loading">Loading settings...</div>}>
				<Tabs value={currentTab()} onChange={setCurrentTab}>
					<TabsList>
						<TabsIndicator />
						<TabsTrigger value="appearance">Appearance</TabsTrigger>
						<TabsTrigger value="general">General</TabsTrigger>
						<TabsTrigger value="defaults">Defaults</TabsTrigger>
						<TabsTrigger value="developer">Developer</TabsTrigger>
					</TabsList>

					{/* Appearance Tab */}
					<TabsContent value="appearance">
						<div class="settings-tab-content">
							<section class="settings-section">
								<h2>Theme Presets</h2>
								<p class="section-description">Choose a pre-designed theme or create your own custom look.</p>
								
								<div class="theme-preset-grid">
									<For each={PRESET_THEMES}>
										{(theme) => (
											<ThemePresetCard
												theme={theme}
												isSelected={themeId() === theme.id}
												onClick={() => handlePresetSelect(theme.id)}
											/>
										)}
									</For>
								</div>
							</section>

							{/* Theme Customization */}
							<Show when={canChangeHue()}>
								<section class="settings-section">
									<h2>Customize Colors</h2>
									<p class="section-description">Adjust the primary color hue to personalize your theme.</p>
									
									<div class="hue-customization">
										<Slider
											value={[backgroundHue()]}
											onChange={handleHueChange}
											onPointerUp={() => handleHueCommit()}
											onPointerCancel={() => handleHueCommit()}
											onKeyUp={(e) => { if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') handleHueCommit(); }}
											onBlur={() => handleHueCommit()}
											minValue={0}
											maxValue={360}
											step={1}
											class="slider--hue"
										>
											<div class="slider__header">
												<label class="slider__label">Primary Hue</label>
												<div class="slider__value-label">{backgroundHue()}°</div>
											</div>
											<SliderTrack class="hue-track">
												<SliderFill />
												<SliderThumb />
											</SliderTrack>
										</Slider>
									</div>
								</section>
							</Show>
							
							<Show when={!canChangeHue()}>
								<section class="settings-section">
									<div class="settings-info-box">
										<span class="settings-info-title">Signature Theme</span>
										<span class="settings-info-description">
											This theme has carefully chosen colors that cannot be customized to maintain its signature look.
											Try selecting "Classic" or "Old School" themes for color customization options.
										</span>
									</div>
								</section>
							</Show>

							{/* Advanced Style Controls */}
							<Show when={themeId() === "custom"}>
								<section class="settings-section">
									<h2>Advanced Style</h2>
									<p class="section-description">Fine-tune the visual style and effects.</p>
									
									<div class="settings-row">
										<div class="settings-info">
											<span class="settings-label">Style Mode</span>
											<span class="settings-description">Choose the visual depth and transparency effects</span>
										</div>
										<ToggleGroup type="single" value={styleMode()} onChange={handleStyleModeChange}>
											<ToggleGroupItem value="glass">Glass</ToggleGroupItem>
											<ToggleGroupItem value="satin">Satin</ToggleGroupItem>
											<ToggleGroupItem value="flat">Flat</ToggleGroupItem>
											<ToggleGroupItem value="bordered">Bordered</ToggleGroupItem>
										</ToggleGroup>
									</div>

									<div class="settings-row">
										<div class="settings-info">
											<span class="settings-label">Background Gradient</span>
											<span class="settings-description">Enable animated background gradient</span>
										</div>
										<Switch checked={gradientEnabled()} onChange={handleGradientToggle} class="settings-switch">
											<SwitchControl>
												<SwitchThumb />
											</SwitchControl>
										</Switch>
									</div>

									<Show when={gradientEnabled()}>
										<Slider
											value={[gradientAngle()]}
											onChange={handleGradientAngleChange}
											onPointerUp={() => handleGradientAngleCommit()}
											onPointerCancel={() => handleGradientAngleCommit()}
											onKeyUp={(e) => { if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') handleGradientAngleCommit(); }}
											onBlur={() => handleGradientAngleCommit()}
											minValue={0}
											maxValue={360}
											step={1}
											class="slider--angle"
										>
											<div class="slider__header">
												<label class="slider__label">Gradient Angle</label>
												<div class="slider__value-label">{gradientAngle()}°</div>
											</div>
											<SliderTrack>
												<SliderFill />
												<SliderThumb />
											</SliderTrack>
										</Slider>
									</Show>

									<Show when={styleMode() === "bordered"}>
										<Slider
											value={[borderThickness()]}
											onChange={(vals) => setBorderThickness(vals[0])}
											minValue={0}
											maxValue={4}
											step={1}
											class="slider--border"
										>
											<div class="slider__header">
												<label class="slider__label">Border Thickness</label>
												<div class="slider__value-label">{borderThickness()}px</div>
											</div>
											<SliderTrack>
												<SliderFill />
												<SliderThumb />
											</SliderTrack>
										</Slider>
									</Show>
								</section>
							</Show>
						</div>
					</TabsContent>

					{/* General Tab */}
					<TabsContent value="general">
						<div class="settings-tab-content">
							<section class="settings-section">
								<h2>Accessibility</h2>
								<div class="settings-row">
									<div class="settings-info">
										<span class="settings-label">Reduced Motion</span>
										<span class="settings-description">Disable animations and transitions</span>
									</div>
									<Switch checked={reducedMotion()} onChange={handleReducedMotionToggle} class="settings-switch">
										<SwitchControl>
											<SwitchThumb />
										</SwitchControl>
									</Switch>
								</div>
							</section>

							<section class="settings-section">
								<h2>Application Data</h2>
								<div class="settings-row">
									<div class="settings-info">
										<span class="settings-label">App Data Folder</span>
										<span class="settings-description">
											Open the folder where Vesta Launcher stores its configuration and data.
										</span>
									</div>
									<LauncherButton onClick={handleOpenAppData}>
										Open Folder
									</LauncherButton>
								</div>
							</section>
						</div>
					</TabsContent>

					{/* Defaults Tab - Placeholder */}
					<TabsContent value="defaults">
						<div class="settings-tab-content">
							<section class="settings-section">
								<h2>Instance Defaults</h2>
								<p class="section-description">Default settings for new instances.</p>
								<div class="settings-placeholder">
									<p>Coming soon: Default Java paths, memory settings, and more.</p>
								</div>
							</section>
						</div>
					</TabsContent>

					{/* Developer Tab */}
					<TabsContent value="developer">
						<div class="settings-tab-content">
							<section class="settings-section">
								<h2>Debug Settings</h2>
								<div class="settings-row">
									<div class="settings-info">
										<span class="settings-label">Debug Logging</span>
										<span class="settings-description">
											Enable verbose logging for troubleshooting
										</span>
									</div>
									<Switch checked={debugLogging()} onChange={handleDebugToggle} class="settings-switch">
										<SwitchControl>
											<SwitchThumb />
										</SwitchControl>
									</Switch>
								</div>
							</section>

							<section class="settings-section">
								<h2>Navigation Test</h2>
								<div style="display: flex; gap: 12px; flex-wrap: wrap;">
									<LauncherButton
										onClick={() => {
											router()?.navigate("/install");
										}}
									>
										Navigate to Install
									</LauncherButton>
									<LauncherButton
										onClick={() => {
											router()?.navigate("/file-drop");
										}}
									>
										Navigate to File Drop Test
									</LauncherButton>
									<LauncherButton
										onClick={() => {
											router()?.navigate("/task-test");
										}}
									>
										Navigate to Task System Test
									</LauncherButton>
								</div>
							</section>
						</div>
					</TabsContent>
				</Tabs>
			</Show>
		</div>
	);
}

export default SettingsPage;