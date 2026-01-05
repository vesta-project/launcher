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
import {
	Tabs,
	TabsContent,
	TabsIndicator,
	TabsList,
	TabsTrigger,
} from "@ui/tabs/tabs";
import { ToggleGroup, ToggleGroupItem } from "@ui/toggle-group/toggle-group";
import { onConfigUpdate } from "@utils/config-sync";
import { hasTauriRuntime } from "@utils/tauri-runtime";
import {
	createEffect,
	createSignal,
	For,
	onCleanup,
	onMount,
	Show,
} from "solid-js";
import {
	applyTheme,
	getThemeById,
	PRESET_THEMES,
	type ThemeConfig,
	validateTheme,
} from "../../../../themes/presets";
import { ThemePresetCard } from "../../../theme-preset-card/theme-preset-card";
import "./settings-page.css";

interface AppConfig {
	id: number;
	background_hue: number;
	theme: string;
	language: string;
	max_download_threads: number;
	max_memory_mb: number;
	java_path: string | null;
	default_game_dir: string | null;
	auto_update_enabled: boolean;
	notification_enabled: boolean;
	startup_check_updates: boolean;
	show_tray_icon: boolean;
	minimize_to_tray: boolean;
	reduced_motion: boolean;
	last_window_width: number;
	last_window_height: number;
	debug_logging: boolean;
	notification_retention_days?: number; // Optional as per user feedback
	active_account_uuid: string | null;

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
	const [styleMode, setStyleMode] = createSignal<ThemeConfig["style"]>();
	const [gradientEnabled, setGradientEnabled] = createSignal<boolean>();
	const [gradientAngle, setGradientAngle] = createSignal<number>();
	const [themeId, setThemeId] = createSignal<string>();
	const [borderThickness, setBorderThickness] = createSignal(1);
	const [loading, setLoading] = createSignal(true);
	const [reducedMotion, setReducedMotion] = createSignal(false);

	// Debounce timer for hue slider to prevent excessive applyTheme calls
	let hueDebounceTimer: number | undefined;

	// Permissions helpers based on current theme
	const canChangeHue = () => {
		const id = themeId();
		return id ? (getThemeById(id)?.allowHueChange ?? false) : false;
	};

	let unsubscribeConfigUpdate: (() => void) | null = null;

	onMount(async () => {
		try {
			if (hasTauriRuntime()) {
				const config = await invoke<AppConfig>("get_config");
				setDebugLogging(config.debug_logging);
				setReducedMotion(config.reduced_motion ?? false);

				// Load theme configuration
				const themeIdFromConfig = config.theme_id ?? undefined;
				const primaryHueFromConfig =
					typeof config.theme_primary_hue === "number"
						? config.theme_primary_hue
						: typeof config.background_hue === "number"
							? config.background_hue
							: undefined;
				const styleFromConfig =
					(config.theme_style as ThemeConfig["style"]) ?? undefined;
				const gradientEnabledFromConfig =
					typeof config.theme_gradient_enabled === "boolean"
						? config.theme_gradient_enabled
						: undefined;
				const gradientAngleFromConfig =
					typeof config.theme_gradient_angle === "number"
						? config.theme_gradient_angle
						: undefined;

				if (themeIdFromConfig) setThemeId(themeIdFromConfig);
				if (primaryHueFromConfig !== undefined)
					setBackgroundHue(primaryHueFromConfig as number);
				if (styleFromConfig) setStyleMode(styleFromConfig);
				if (gradientEnabledFromConfig !== undefined)
					setGradientEnabled(gradientEnabledFromConfig);
				if (gradientAngleFromConfig !== undefined)
					setGradientAngle(gradientAngleFromConfig);

				// Apply current theme
				if (themeIdFromConfig || primaryHueFromConfig !== undefined) {
					const effectiveThemeId = themeIdFromConfig ?? "midnight";
					const currentTheme = getThemeById(effectiveThemeId);
					if (currentTheme) {
						applyTheme(
							validateTheme({
								...currentTheme,
								primaryHue: (primaryHueFromConfig !== undefined
									? primaryHueFromConfig
									: (currentTheme.primaryHue ?? 220)) as number,
								style: (styleFromConfig ??
									currentTheme.style ??
									"glass") as ThemeConfig["style"],
								gradientEnabled: (gradientEnabledFromConfig !== undefined
									? gradientEnabledFromConfig
									: (currentTheme.gradientEnabled ?? true)) as boolean,
								gradientAngle: (gradientAngleFromConfig ??
									currentTheme.gradientAngle ??
									135) as number,
							}),
						);
					}
				}
			}

			unsubscribeConfigUpdate = onConfigUpdate((field, value) => {
				if (field === "debug_logging") setDebugLogging(value);
				if (field === "reduced_motion") setReducedMotion(value ?? false);
				if (field === "theme_id") setThemeId(value);
				if (field === "theme_primary_hue") setBackgroundHue(value);
				if (field === "theme_style")
					setStyleMode(value as ThemeConfig["style"]);
				if (field === "theme_gradient_enabled") setGradientEnabled(value);
				if (field === "theme_gradient_angle") setGradientAngle(value);
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

			const newHue =
				theme.allowHueChange === false
					? (theme.primaryHue ?? 220)
					: backgroundHue();
			if (theme.primaryHue !== undefined && theme.allowHueChange === false) {
				setBackgroundHue(newHue);
			}

			applyTheme(
				validateTheme({
					...theme,
					primaryHue: newHue,
				}),
			);

			if (hasTauriRuntime()) {
				try {
					await invoke("update_config_field", { field: "theme_id", value: id });
					await invoke("update_config_field", {
						field: "theme_primary_hue",
						value: newHue,
					});
					await invoke("update_config_field", {
						field: "background_hue",
						value: newHue,
					});
					await invoke("update_config_field", {
						field: "theme_style",
						value: theme.style,
					});
					await invoke("update_config_field", {
						field: "theme_gradient_enabled",
						value: theme.gradientEnabled,
					});
					await invoke("update_config_field", {
						field: "theme_gradient_angle",
						value: theme.gradientAngle ?? 135,
					});
				} catch (error) {
					console.error("Failed to save theme preset selection:", error);
				}
			}
		}
	};

	const handleHueChange = (values: number[]) => {
		const newHue = values[0];
		setBackgroundHue(newHue);
		const id = themeId();
		const currentTheme = id ? getThemeById(id) : undefined;
		if (currentTheme) {
			// Clear existing debounce timer
			if (hueDebounceTimer !== undefined) {
				clearTimeout(hueDebounceTimer);
			}
			// Apply theme after 50ms delay to avoid excessive calls while dragging
			hueDebounceTimer = setTimeout(() => {
				applyTheme(
					validateTheme({
						...currentTheme,
						primaryHue: newHue,
						style: styleMode(),
						gradientEnabled: gradientEnabled(),
						gradientAngle: gradientAngle(),
					}),
				);
			}, 50) as unknown as number;
		}
	};

	const handleHueCommit = async () => {
		if (!hasTauriRuntime()) return;
		try {
			await invoke("update_config_field", {
				field: "theme_primary_hue",
				value: backgroundHue(),
			});
			await invoke("update_config_field", {
				field: "background_hue",
				value: backgroundHue(),
			});
		} catch (error) {
			console.error("Failed to persist hue on commit:", error);
		}
	};

	const handleStyleModeChange = async (mode: ThemeConfig["style"]) => {
		setStyleMode(mode);
		if (hasTauriRuntime()) {
			await invoke("update_config_field", {
				field: "theme_style",
				value: mode,
			});
		}
	};

	const handleGradientToggle = async (enabled: boolean) => {
		setGradientEnabled(enabled);
		if (hasTauriRuntime()) {
			await invoke("update_config_field", {
				field: "theme_gradient_enabled",
				value: enabled,
			});
		}
	};

	const handleGradientAngleChange = (values: number[]) => {
		setGradientAngle(values[0]);
	};

	const handleGradientAngleCommit = async () => {
		if (!hasTauriRuntime()) return;
		try {
			await invoke("update_config_field", {
				field: "theme_gradient_angle",
				value: gradientAngle() ?? 135,
			});
		} catch (error) {
			console.error("Failed to persist gradient angle on commit:", error);
		}
	};

	const handleReducedMotionToggle = async (checked: boolean) => {
		setReducedMotion(checked);
		if (hasTauriRuntime()) {
			await invoke("update_config_field", {
				field: "reduced_motion",
				value: checked,
			});
		}
	};

	const handleDebugToggle = async (checked: boolean) => {
		setDebugLogging(checked);
		if (hasTauriRuntime()) {
			await invoke("update_config_field", {
				field: "debug_logging",
				value: checked,
			});
		}
	};

	const handleOpenAppData = async () => {
		if (hasTauriRuntime()) {
			await invoke("open_app_config_dir");
		}
	};

	createEffect(() => {
		const id = themeId();
		const currentTheme = id ? getThemeById(id) : undefined;
		if (currentTheme) {
			applyTheme(
				validateTheme({
					...currentTheme,
					primaryHue: (backgroundHue() ?? currentTheme.primaryHue) as number,
					style: (styleMode() ?? currentTheme.style) as ThemeConfig["style"],
					gradientEnabled: (gradientEnabled() ??
						currentTheme.gradientEnabled) as boolean,
					gradientAngle: (gradientAngle() ??
						currentTheme.gradientAngle) as number,
					borderWidthSubtle: borderThickness(),
					borderWidthStrong: Math.max(borderThickness() + 1, 1),
				}),
			);
		}
	});

	createEffect(() => {
		if (styleMode() === "bordered") {
			document.documentElement.style.setProperty(
				"--border-width-subtle",
				`${borderThickness()}px`,
			);
			document.documentElement.style.setProperty(
				"--border-width-strong",
				`${Math.max(borderThickness() + 1, 1)}px`,
			);
		} else {
			document.documentElement.style.setProperty(
				"--border-width-subtle",
				"1px",
			);
			document.documentElement.style.setProperty(
				"--border-width-strong",
				"1px",
			);
		}
	});

	return (
		<div class="settings-page">
			<Show
				when={!loading()}
				fallback={<div class="settings-loading">Loading settings...</div>}
			>
				<Tabs value={currentTab()} onChange={setCurrentTab}>
					<TabsList>
						<TabsIndicator />
						<TabsTrigger value="appearance">Appearance</TabsTrigger>
						<TabsTrigger value="general">General</TabsTrigger>
						<TabsTrigger value="defaults">Defaults</TabsTrigger>
						<TabsTrigger value="developer">Developer</TabsTrigger>
					</TabsList>

					<TabsContent value="appearance">
						<div class="settings-tab-content">
							<section class="settings-section">
								<h2>Theme Presets</h2>
								<p class="section-description">
									Choose a pre-designed theme or create your own custom look.
								</p>
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

							<Show when={canChangeHue()}>
								<section class="settings-section">
									<h2>Customize Colors</h2>
									<p class="section-description">
										Adjust the primary color hue to personalize your theme.
									</p>
									<div class="hue-customization">
										<Slider
											value={[backgroundHue()]}
											onChange={handleHueChange}
											onPointerUp={() => handleHueCommit()}
											onPointerCancel={() => handleHueCommit()}
											minValue={0}
											maxValue={360}
											step={1}
											class="slider--hue"
										>
											<div class="slider__header">
												<label class="slider__label">Primary Hue</label>
												<div class="slider__value-label">
													{backgroundHue()}°
												</div>
											</div>
											<SliderTrack class="hue-track">
												<SliderFill />
												<SliderThumb />
											</SliderTrack>
										</Slider>
									</div>
								</section>
							</Show>

							<Show when={themeId() === "custom"}>
								<section class="settings-section">
									<h2>Advanced Style</h2>
									<p class="section-description">
										Fine-tune the visual style and effects.
									</p>
									<div class="settings-row">
										<div class="settings-info">
											<span class="settings-label">Style Mode</span>
											<span class="settings-description">
												Choose the visual depth and transparency effects
											</span>
										</div>
										<ToggleGroup
											value={styleMode() as string}
											onChange={(val) => {
												if (val)
													handleStyleModeChange(val as ThemeConfig["style"]);
											}}
										>
											<ToggleGroupItem value="glass">Glass</ToggleGroupItem>
											<ToggleGroupItem value="satin">Satin</ToggleGroupItem>
											<ToggleGroupItem value="flat">Flat</ToggleGroupItem>
											<ToggleGroupItem value="bordered">
												Bordered
											</ToggleGroupItem>
										</ToggleGroup>
									</div>

									<div class="settings-row">
										<div class="settings-info">
											<span class="settings-label">Background Gradient</span>
											<span class="settings-description">
												Enable animated background gradient
											</span>
										</div>
										<Switch
											checked={gradientEnabled() ?? false}
											onChange={handleGradientToggle}
											class="settings-switch"
										>
											<SwitchControl>
												<SwitchThumb />
											</SwitchControl>
										</Switch>
									</div>

									<Show when={gradientEnabled()}>
										<Slider
											value={[gradientAngle() ?? 135]}
											onChange={handleGradientAngleChange}
											onPointerUp={() => handleGradientAngleCommit()}
											onPointerCancel={() => handleGradientAngleCommit()}
											minValue={0}
											maxValue={360}
											step={1}
											class="slider--angle"
										>
											<div class="slider__header">
												<label class="slider__label">Gradient Angle</label>
												<div class="slider__value-label">
													{gradientAngle()}°
												</div>
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
												<div class="slider__value-label">
													{borderThickness()}px
												</div>
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

					<TabsContent value="general">
						<div class="settings-tab-content">
							<section class="settings-section">
								<h2>Accessibility</h2>
								<div class="settings-row">
									<div class="settings-info">
										<span class="settings-label">Reduced Motion</span>
										<span class="settings-description">
											Disable animations and transitions
										</span>
									</div>
									<Switch
										checked={reducedMotion()}
										onChange={handleReducedMotionToggle}
										class="settings-switch"
									>
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
											Open the folder where Vesta Launcher stores its data.
										</span>
									</div>
									<LauncherButton onClick={handleOpenAppData}>
										Open Folder
									</LauncherButton>
								</div>
							</section>
						</div>
					</TabsContent>

					<TabsContent value="defaults">
						<div class="settings-tab-content">
							<section class="settings-section">
								<h2>Instance Defaults</h2>
								<p class="section-description">
									Default settings for new instances.
								</p>
								<div class="settings-placeholder">
									<p>
										Coming soon: Default Java paths, memory settings, and more.
									</p>
								</div>
							</section>
						</div>
					</TabsContent>

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
									<Switch
										checked={debugLogging()}
										onChange={handleDebugToggle}
										class="settings-switch"
									>
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
										onClick={() => router()?.navigate("/install")}
									>
										Navigate to Install
									</LauncherButton>
									<LauncherButton
										onClick={() => router()?.navigate("/file-drop")}
									>
										Navigate to File Drop Test
									</LauncherButton>
									<LauncherButton
										onClick={() => router()?.navigate("/task-test")}
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
