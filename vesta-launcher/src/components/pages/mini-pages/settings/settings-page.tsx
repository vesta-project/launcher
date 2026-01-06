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
import { onConfigUpdate, updateThemeConfigLocal, currentThemeConfig } from "@utils/config-sync";
import { hasTauriRuntime } from "@utils/tauri-runtime";
import { startAppTutorial } from "@utils/tutorial";
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
	configToTheme,
	getThemeById,
	PRESET_THEMES,
	type ThemeConfig,
	validateTheme,
	type StyleMode,
	type GradientHarmony,
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
	theme_style: StyleMode;
	theme_gradient_enabled: boolean;
	theme_gradient_angle?: number;
	theme_gradient_type?: "linear" | "radial";
	theme_gradient_harmony?: GradientHarmony;
	theme_advanced_overrides?: string;
	theme_border_width?: number;
	setup_completed: boolean;
	setup_step: number;
	tutorial_completed: boolean;
	[key: string]: any;
}

function SettingsPage(props: { close?: () => void }) {
	const [currentTab, setCurrentTab] = createSignal("general");
	const [debugLogging, setDebugLogging] = createSignal(false);
	
	// Initialize from global theme cache to prevent "Midnight Blue" flash
	const [backgroundHue, setBackgroundHue] = createSignal(currentThemeConfig.theme_primary_hue ?? currentThemeConfig.background_hue ?? 220);
	const [styleMode, setStyleMode] = createSignal<ThemeConfig["style"]>(currentThemeConfig.theme_style as ThemeConfig["style"] ?? "glass");
	const [gradientEnabled, setGradientEnabled] = createSignal<boolean>(currentThemeConfig.theme_gradient_enabled ?? true);
	const [rotation, setRotation] = createSignal<number>(currentThemeConfig.theme_gradient_angle ?? 135);
	const [gradientType, setGradientType] = createSignal<"linear" | "radial">(currentThemeConfig.theme_gradient_type as "linear" | "radial" ?? "linear");
	const [gradientHarmony, setGradientHarmony] = createSignal<GradientHarmony>(currentThemeConfig.theme_gradient_harmony as GradientHarmony ?? "none");
	const [themeId, setThemeId] = createSignal<string>(currentThemeConfig.theme_id ?? "midnight");
	const [borderThickness, setBorderThickness] = createSignal(currentThemeConfig.theme_border_width ?? 1);
	
	const [loading, setLoading] = createSignal(true);
	const [reducedMotion, setReducedMotion] = createSignal(false);
	const [globalJavas, setGlobalJavas] = createSignal<any[]>([]);
	const [isScanning, setIsScanning] = createSignal(false);

	// Permissions helpers based on current theme
	const canChangeHue = () => {
		const id = themeId();
		return id ? (getThemeById(id)?.allowHueChange ?? false) : false;
	};

	let unsubscribeConfigUpdate: (() => void) | null = null;

	const fetchJavas = async () => {
		if (!hasTauriRuntime()) return;
		try {
			setIsScanning(true);
			const detected = await invoke<any[]>("detect_java");
			setGlobalJavas(detected);
		} catch (e) {
			console.error("Failed to fetch javas:", e);
		} finally {
			setIsScanning(false);
		}
	};

	onMount(async () => {
		try {
			if (hasTauriRuntime()) {
				fetchJavas();
				const config = await invoke<AppConfig>("get_config");
				setDebugLogging(config.debug_logging);
				setReducedMotion(config.reduced_motion ?? false);

				// Load theme configuration
				if (config.theme_id) setThemeId(config.theme_id);
				if (config.theme_primary_hue !== null && config.theme_primary_hue !== undefined)
					setBackgroundHue(config.theme_primary_hue);
				else if (config.background_hue !== null && config.background_hue !== undefined)
					setBackgroundHue(config.background_hue);

				if (config.theme_style) setStyleMode(config.theme_style as ThemeConfig["style"]);
				if (config.theme_gradient_enabled !== null && config.theme_gradient_enabled !== undefined)
					setGradientEnabled(config.theme_gradient_enabled);
				if (config.theme_gradient_angle !== null && config.theme_gradient_angle !== undefined)
					setRotation(config.theme_gradient_angle);
				if (config.theme_gradient_type)
					setGradientType(config.theme_gradient_type as "linear" | "radial");
				if (config.theme_gradient_harmony)
					setGradientHarmony(config.theme_gradient_harmony as GradientHarmony);
				if (config.theme_border_width !== null && config.theme_border_width !== undefined)
					setBorderThickness(config.theme_border_width);
			}

			unsubscribeConfigUpdate = onConfigUpdate((field, value) => {
				if (field === "debug_logging") setDebugLogging(value);
				if (field === "reduced_motion") setReducedMotion(value ?? false);
				if (field === "theme_id" && value) setThemeId(value);
				if (field === "theme_primary_hue" && value !== null) setBackgroundHue(value);
				if (field === "theme_style" && value)
					setStyleMode(value as ThemeConfig["style"]);
				if (field === "theme_gradient_enabled" && value !== null) setGradientEnabled(value);
				if (field === "theme_gradient_angle" && value !== null) setRotation(value);
				if (field === "theme_gradient_type" && value) setGradientType(value as "linear" | "radial");
				if (field === "theme_gradient_harmony" && value) setGradientHarmony(value as GradientHarmony);
				if (field === "theme_border_width" && value !== null) setBorderThickness(value);
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
			setRotation(theme.rotation || 135);
			setGradientType(theme.gradientType || "linear");
			setGradientHarmony(theme.gradientHarmony || "none");
			if (theme.borderWidthSubtle !== undefined) {
				setBorderThickness(theme.borderWidthSubtle);
			}

			const newHue =
				theme.allowHueChange === false
					? (theme.primaryHue ?? 220)
					: backgroundHue();
			if (theme.primaryHue !== undefined && theme.allowHueChange === false) {
				setBackgroundHue(newHue);
			}

			// Update local config cache to prevent async updates from reverting state
			updateThemeConfigLocal("theme_id", id);
			updateThemeConfigLocal("theme_primary_hue", newHue);
			updateThemeConfigLocal("background_hue", newHue);
			updateThemeConfigLocal("theme_style", theme.style);
			updateThemeConfigLocal("theme_gradient_enabled", theme.gradientEnabled);
			updateThemeConfigLocal("theme_gradient_angle", theme.rotation ?? 135);
			updateThemeConfigLocal("theme_gradient_type", theme.gradientType || "linear");
			updateThemeConfigLocal("theme_gradient_harmony", theme.gradientHarmony || "none");
			if (theme.borderWidthSubtle !== undefined) {
				updateThemeConfigLocal("theme_border_width", theme.borderWidthSubtle);
			}

			if (hasTauriRuntime()) {
				try {
					const updates: any = {
						theme_id: id,
						theme_primary_hue: newHue,
						background_hue: newHue,
						theme_style: theme.style,
						theme_gradient_enabled: theme.gradientEnabled,
						theme_gradient_angle: theme.rotation ?? 135,
						theme_gradient_type: theme.gradientType || "linear",
						theme_gradient_harmony: theme.gradientHarmony || "none",
					};

					if (theme.borderWidthSubtle !== undefined) {
						updates.theme_border_width = theme.borderWidthSubtle;
					}

					await invoke("update_config_fields", {
						updates,
					});
				} catch (error) {
					console.error("Failed to save theme preset selection:", error);
				}
			}
		}
	};

	const handleHueChange = async (values: number[]) => {
		const newHue = values[0];
		setBackgroundHue(newHue);
		updateThemeConfigLocal("theme_primary_hue", newHue);
		updateThemeConfigLocal("background_hue", newHue);

		// Save immediately
		if (hasTauriRuntime()) {
			try {
				await invoke("update_config_fields", {
					updates: {
						theme_primary_hue: newHue,
						background_hue: newHue,
					},
				});
			} catch (error) {
				console.error("Failed to persist hue immediately:", error);
			}
		}
	};

	const handleStyleModeChange = async (mode: ThemeConfig["style"]) => {
		setStyleMode(mode);
		updateThemeConfigLocal("theme_style", mode);
		if (hasTauriRuntime()) {
			await invoke("update_config_field", {
				field: "theme_style",
				value: mode,
			});
		}
	};

	const handleGradientToggle = async (enabled: boolean) => {
		setGradientEnabled(enabled);
		updateThemeConfigLocal("theme_gradient_enabled", enabled);
		if (hasTauriRuntime()) {
			await invoke("update_config_field", {
				field: "theme_gradient_enabled",
				value: enabled,
			});
		}
	};

	const handleRotationChange = async (values: number[]) => {
		const newRotation = Math.round(values[0]);
		if (newRotation === rotation()) return;

		setRotation(newRotation);
		updateThemeConfigLocal("theme_gradient_angle", newRotation);

		// Save immediately
		if (hasTauriRuntime()) {
			try {
				await invoke("update_config_field", {
					field: "theme_gradient_angle",
					value: newRotation,
				});
			} catch (error) {
				console.error("Failed to persist rotation immediately:", error);
			}
		}
	};

	const handleBorderThicknessChange = async (values: number[]) => {
		const newThickness = values[0];
		if (newThickness === borderThickness()) return;

		setBorderThickness(newThickness);
		updateThemeConfigLocal("theme_border_width", newThickness);

		// Save immediately
		if (hasTauriRuntime()) {
			try {
				await invoke("update_config_field", {
					field: "theme_border_width",
					value: newThickness,
				});
			} catch (error) {
				console.error("Failed to persist border thickness immediately:", error);
			}
		}
	};

	const handleGradientTypeChange = async (type: "linear" | "radial") => {
		if (type === gradientType()) return;

		setGradientType(type);
		updateThemeConfigLocal("theme_gradient_type", type);
		if (hasTauriRuntime()) {
			await invoke("update_config_field", {
				field: "theme_gradient_type",
				value: type,
			});
		}
	};

	const handleGradientHarmonyChange = async (harmony: GradientHarmony) => {
		setGradientHarmony(harmony);
		updateThemeConfigLocal("theme_gradient_harmony", harmony);
		if (hasTauriRuntime()) {
			await invoke("update_config_field", {
				field: "theme_gradient_harmony",
				value: harmony,
			});
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
		if (loading()) return;
		
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
					rotation: (rotation() ??
						currentTheme.rotation) as number,
					gradientType: (gradientType() ??
						currentTheme.gradientType) as "linear" | "radial",
					gradientHarmony: (gradientHarmony() ??
						currentTheme.gradientHarmony) as GradientHarmony,
					borderWidthSubtle: borderThickness(),
					borderWidthStrong: Math.max(borderThickness() + 1, 1),
				}),
			);
		}
	});

	createEffect(() => {
		if (loading()) return;
		
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
						<TabsTrigger value="general">General</TabsTrigger>
						<TabsTrigger value="appearance">Appearance</TabsTrigger>
						<TabsTrigger value="java">Java</TabsTrigger>
						<TabsTrigger value="defaults">Defaults</TabsTrigger>
						<TabsTrigger value="developer">Developer</TabsTrigger>
						<TabsTrigger value="help">Help</TabsTrigger>
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
											value={styleMode() ?? "glass"}
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
											<ToggleGroupItem value="solid">Solid</ToggleGroupItem>
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
										<div class="settings-row">
											<div class="settings-info">
												<span class="settings-label">Gradient Type</span>
												<span class="settings-description">
													Linear or circular background
												</span>
											</div>
											<ToggleGroup
												value={gradientType() ?? "linear"}
												onChange={(val) => {
													if (val)
														handleGradientTypeChange(
															val as "linear" | "radial",
														);
												}}
											>
												<ToggleGroupItem value="linear">Linear</ToggleGroupItem>
												<ToggleGroupItem value="radial">Circular</ToggleGroupItem>
											</ToggleGroup>
										</div>

										<div class="settings-row--nested">
											<Slider
												value={[rotation() ?? 135]}
												onChange={handleRotationChange}
												minValue={0}
												maxValue={360}
												step={1}
												class="slider--angle"
											>
												<div class="slider__header">
													<label class="slider__label">Rotation</label>
													<div class="slider__value-label">
														{rotation()}°
													</div>
												</div>
												<SliderTrack>
													<SliderFill />
													<SliderThumb />
												</SliderTrack>
											</Slider>
										</div>

										<div class="settings-row">
											<div class="settings-info">
												<span class="settings-label">Color Harmony</span>
												<span class="settings-description">
													Choose how secondary colors are generated
												</span>
											</div>
											<ToggleGroup
												value={gradientHarmony() ?? "none"}
												onChange={(val) => {
													if (val)
														handleGradientHarmonyChange(
															val as GradientHarmony,
														);
												}}
											>
												<ToggleGroupItem value="none">None</ToggleGroupItem>
												<ToggleGroupItem value="analogous">
													Analogous
												</ToggleGroupItem>
												<ToggleGroupItem value="complementary">
													Complementary
												</ToggleGroupItem>
												<ToggleGroupItem value="triadic">
													Triadic
												</ToggleGroupItem>
											</ToggleGroup>
										</div>
									</Show>

									<Show when={styleMode() === "bordered"}>
										<Slider
											value={[borderThickness()]}
											onChange={handleBorderThicknessChange}
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

					<TabsContent value="java">
						<div class="settings-tab-content">
							<section class="settings-section">
								<div class="section-header">
									<div>
										<h2>Java Environments</h2>
										<p class="section-description">
											Vesta uses these Java installations to run Minecraft.
										</p>
									</div>
									<LauncherButton 
										onClick={fetchJavas} 
										disabled={isScanning()}
										variant="ghost"
									>
										{isScanning() ? "Scanning..." : "Rescan System"}
									</LauncherButton>
								</div>
								
								<div class="java-list">
									<For each={globalJavas()} fallback={
										<div class="java-empty">
											{isScanning() ? "Scanning for Java installations..." : "No Java installations found."}
										</div>
									}>
										{(java) => (
											<div class="java-item">
												<div class="java-info">
													<div class="java-version-row">
														<span class="java-version">Java {java.major_version}</span>
														<Show when={java.is_managed}>
															<span class="managed-badge">Managed</span>
														</Show>
													</div>
													<div class="java-path">{java.path}</div>
												</div>
											</div>
										)}
									</For>
								</div>
							</section>
						</div>
					</TabsContent>

					<TabsContent value="help">
						<div class="settings-tab-content">
							<section class="settings-section">
								<h2>App Tutorial</h2>
								<div class="settings-row">
									<div class="settings-info">
										<span class="settings-label">Guided Walkthrough</span>
										<span class="settings-description">
											Run the interactive tutorial to learn how to use Vesta.
										</span>
									</div>
									<LauncherButton onClick={() => {
										props.close?.();
										setTimeout(() => startAppTutorial(), 100);
									}}>
										Run Tutorial
									</LauncherButton>
								</div>
							</section>

							<section class="settings-section">
								<h2>Social & Support</h2>
								<div class="social-links">
									<LauncherButton variant="ghost" onClick={() => window.open("https://github.com/VestaLauncher/Vesta", "_blank")}>
										GitHub
									</LauncherButton>
									<LauncherButton variant="ghost">
										Discord Support
									</LauncherButton>
								</div>
							</section>
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

							<section class="settings-section">
								<h2>Troubleshooting</h2>
								<div class="settings-row">
									<div class="settings-info">
										<span class="settings-label">Reset Onboarding</span>
										<span class="settings-description">
											Redo the first-time setup process. This will not delete your accounts or instances.
										</span>
									</div>
									<LauncherButton 
										variant="shadow" 
										color="destructive"
										onClick={async () => {
											if (await confirm("Are you sure you want to redo the onboarding process? You will be taken back to the welcome screen.")) {
												try {
													await invoke("reset_onboarding");
													window.location.href = "/"; // Force reload to root
												} catch (e) {
													console.error("Failed to reset onboarding:", e);
												}
											}
										}}
									>
										Redo Setup
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
