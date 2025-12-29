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
import { onConfigUpdate } from "@utils/config-sync";
import { hasTauriRuntime } from "@utils/tauri-runtime";
import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";
import { applyTheme, validateTheme, getThemeById, PRESET_THEMES, type ThemeConfig } from "../../../../themes/presets";
import { ToggleGroup, ToggleGroupItem } from "@ui/toggle-group/toggle-group";
import "./settings-page.css";

interface AppConfig {
	debug_logging: boolean;
	background_hue: number;
	reduced_motion?: boolean;
	reduced_effects?: boolean;
	[key: string]: any;
}

function SettingsPage() {
	const [debugLogging, setDebugLogging] = createSignal(false);
	const [backgroundHue, setBackgroundHue] = createSignal(220);
	const [styleMode, setStyleMode] = createSignal<ThemeConfig["style"]>("glass");
	const [gradientEnabled, setGradientEnabled] = createSignal(true);
	const [gradientAngle, setGradientAngle] = createSignal(135);
	const [themeId, setThemeId] = createSignal<string>("midnight");
	const [borderThickness, setBorderThickness] = createSignal(1);
	const [customCss, setCustomCss] = createSignal("");
	const [reducedMotion, setReducedMotion] = createSignal(false);
	const [loading, setLoading] = createSignal(true);

	// Permissions helpers based on current theme
	const canChangeStyle = () => (getThemeById(themeId())?.allowStyleChange ?? false);
	const canChangeHue = () => (getThemeById(themeId())?.allowHueChange ?? false);
	const canChangeBorder = () => (getThemeById(themeId())?.allowBorderChange ?? false);

	let unsubscribeConfigUpdate: (() => void) | null = null;

	onMount(async () => {
		try {
			const config = await invoke<AppConfig>("get_config");
			setDebugLogging(config.debug_logging);
			setBackgroundHue(config.background_hue);
			if (typeof config.theme_style === "string") setStyleMode(config.theme_style as any);
			if (typeof config.theme_gradient_enabled === "boolean") setGradientEnabled(Boolean(config.theme_gradient_enabled));
			if (typeof (config as any).theme_gradient_angle === "number") setGradientAngle((config as any).theme_gradient_angle);
			if (typeof (config as any).theme_id === "string") setThemeId((config as any).theme_id);
			setReducedMotion(Boolean(config.reduced_motion));
		} catch (error) {
			console.error("Failed to load config:", error);
		} finally {
			setLoading(false);
		}

		// Register handler for config updates from other windows
		unsubscribeConfigUpdate = onConfigUpdate((field, value) => {
			// Update local state based on field
			if (field === "background_hue" && typeof value === "number") {
				setBackgroundHue(value);
			} else if (field === "debug_logging" && typeof value === "boolean") {
				setDebugLogging(value);
			} else if (field === "reduced_motion" && typeof value === "boolean") {
				setReducedMotion(value);
			}
			// Add more field handlers as needed
		});
	});

	onCleanup(() => {
		unsubscribeConfigUpdate?.();
	});

	// Apply hue changes to CSS variable in real-time
	createEffect(() => {
		const root = document.documentElement;
		const hue = backgroundHue();
		root.style.setProperty("--hue-primary", hue.toString());
		root.style.setProperty("--color__primary-hue", hue.toString());
		applyTheme(
			validateTheme({
				id: themeId(),
				name: "Live Theme",
				primaryHue: hue,
				style: styleMode(),
				gradientEnabled: gradientEnabled(),
				gradientAngle: gradientAngle(),
				// Only apply border thickness if in bordered mode
				...(styleMode() === "bordered" && {
					borderWidthSubtle: borderThickness(),
					borderWidthStrong: Math.max(borderThickness() + 1, 1),
				}),
				customCss: themeId() === "custom" ? customCss() : undefined,
			}),
		);
	});

	// React to style mode changes
	createEffect(() => {
		applyTheme(
			validateTheme({
				id: themeId(),
				primaryHue: backgroundHue(),
				style: styleMode(),
				gradientEnabled: gradientEnabled(),
				gradientAngle: gradientAngle(),
			}),
		);
	});

	// React to gradient changes
	createEffect(() => {
		applyTheme(
			validateTheme({
				id: themeId(),
				primaryHue: backgroundHue(),
				style: styleMode(),
				gradientEnabled: gradientEnabled(),
				gradientAngle: gradientAngle(),
			}),
		);
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
		// UI-only: do not persist to config DB for now
		setDebugLogging(checked);
	};

	const handleHueChange = (value: number[]) => {
		// Update the signal immediately for live preview
		const hue = value[0];
		setBackgroundHue(hue);
	};

	const handleHueChangeEnd = async (_value: number[]) => {
		// UI-only: no persistence
	};

	const handleStyleModeChange = async (value: string | null) => {
		const mode = (value ?? "glass") as ThemeConfig["style"];
		setStyleMode(mode);
	};

	const handleGradientToggle = async (checked: boolean) => {
		setGradientEnabled(checked);
	};

	const handleGradientAngleChange = async (value: number[]) => {
		const angle = value[0];
		setGradientAngle(angle);
	};

	const handlePresetSelect = async (id: string) => {
		setThemeId(id);
		const preset = getThemeById(id);
		if (preset) {
			// Update all UI signals to match the preset
			setBackgroundHue(preset.primaryHue); // This was missing!
			setStyleMode(preset.style);
			setGradientEnabled(preset.gradientEnabled);
			if (preset.gradientAngle) setGradientAngle(preset.gradientAngle);
			if (typeof preset.borderWidthSubtle === "number") setBorderThickness(preset.borderWidthSubtle);
			setCustomCss(preset.customCss ?? "");
			
			// Apply the theme immediately
			applyTheme(preset);
		}
	};

	const handleOpenAppData = async () => {
		if (hasTauriRuntime()) {
			try {
				await invoke("open_app_config_dir");
			} catch (error) {
				console.error("Failed to open app config directory:", error);
			}
		} else {
			console.warn("Tauri API not available (running in browser dev mode)");
		}
	};

	const handleReducedMotionToggle = async (checked: boolean) => {
		// UI-only: do not persist to config DB for now
		setReducedMotion(checked);
	};

	return (
		<div class="settings-page">
			<Show when={!loading()} fallback={<div>Loading settings...</div>}>
				<section class="settings-section">
					<h2>Appearance</h2>
					{/* Theme Presets at top */}
					<div class="settings-row" style="flex-direction: column; gap:8px;">
						<span class="settings-label">Theme Presets</span>
						<div style="display:flex; gap:8px; flex-wrap:wrap;">
							{PRESET_THEMES.map((t) => (
								<LauncherButton
									class={`theme-preset-button ${themeId() === t.id ? "theme-preset-button--selected" : ""}`}
									onClick={() => handlePresetSelect(t.id)}
									style={{
										"--preview-hue": t.primaryHue,
										border: themeId() === t.id ? "2px solid var(--accent-primary)" : "1px solid var(--border-subtle)",
										background: themeId() === t.id ? "var(--accent-primary)" : "var(--surface-raised)",
										color: themeId() === t.id ? "var(--text-on-primary)" : "var(--text-primary)"
									}}
								>
									{t.name}
								</LauncherButton>
							))}
						</div>
					</div>

					<Show when={themeId() === "custom"}>
					<div class="settings-row" style="flex-direction: column; align-items: stretch;">
						<div style="display:flex; gap:12px; align-items:center; justify-content:space-between;">
							<div>
								<span class="settings-label">Style Mode</span>
								<p class="settings-description">Choose between glass, satin, or flat.</p>
							</div>
							<ToggleGroup type="single" value={styleMode()} onChange={handleStyleModeChange}>
							<ToggleGroupItem value="glass">Glass</ToggleGroupItem>
							<ToggleGroupItem value="satin">Satin</ToggleGroupItem>
							<ToggleGroupItem value="flat">Flat</ToggleGroupItem>
							<ToggleGroupItem value="bordered">Bordered</ToggleGroupItem>
							</ToggleGroup>
						</div>

						<div class="settings-row" style="justify-content:space-between; align-items:center;">
							<div>
								<span class="settings-label">Background Gradient</span>
								<p class="settings-description">Toggle gradient and pick its angle.</p>
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
								minValue={0}
								maxValue={360}
								step={1}
								class="slider--angle"
							>
								<div class="slider__header">
									<label class="slider__label">Gradient Angle</label>
									<div class="slider__value-label">{gradientAngle()}</div>
								</div>
								<SliderTrack>
									<SliderFill />
									<SliderThumb />
								</SliderTrack>
							</Slider>
						</Show>

						<Show when={styleMode() === "bordered"}>
						<div class="settings-row" style="flex-direction: column; align-items: stretch;">
							<div class="slider__header">
								<label class="slider__label">Border Thickness</label>
								<div class="slider__value-label">{borderThickness()}</div>
							</div>
							<Slider
								value={[borderThickness()]}
								onChange={(vals) => setBorderThickness(vals[0])}
								minValue={0}
								maxValue={4}
								step={1}
								class="slider--border"
							>
							<SliderTrack>
								<SliderFill />
								<SliderThumb />
							</SliderTrack>
						</Slider>
						<p class="settings-description">Border thickness is editable only in Bordered style.</p>
						</div>
						</Show>
					</div>
					</Show>

						<Show when={themeId() === "custom"}>
							<div class="settings-row" style="flex-direction: column; gap:8px;">
								<span class="settings-label">Custom CSS</span>
								<p class="settings-description">Add CSS rules applied when Custom theme is active.</p>
								<textarea
									value={customCss()}
									onInput={(e) => setCustomCss(e.currentTarget.value)}
									style="min-height:120px; border-radius:8px; padding:8px; background: var(--surface-base); color: var(--text-primary); border: var(--border-width-subtle) solid var(--border-subtle, hsl(var(--hue-primary) 10% var(--lightness-border) / 0.4));"
								/>
							</div>
						</Show>

						<Show when={canChangeHue()}>
						<Slider
							value={[backgroundHue()]}
							onChange={handleHueChange}
							onChangeEnd={handleHueChangeEnd}
							minValue={0}
							maxValue={360}
							step={1}
							class="slider--hue"
							style={{ "--preview-hue": backgroundHue() }}
						>
							<div class="slider__header">
								<label class="slider__label">Theme Hue</label>
								<div class="slider__value-label">{backgroundHue()}</div>
							</div>
							<SliderTrack>
								<SliderFill />
								<SliderThumb />
							</SliderTrack>
						</Slider>
						<p class="settings-description">
							Adjust the primary color hue for the application theme (0-360°)
						</p>
						</Show>

					<div class="settings-row">
						<div class="settings-info">
							<span class="settings-label">Reduced Motion</span>
							<span class="settings-description">
								Disable non-essential animations and transitions for better performance
								and accessibility.
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
					<h2>Developer Options</h2>
					<div class="settings-row">
						<div class="settings-info">
							<span class="settings-label">Debug Logging</span>
							<span class="settings-description">
								Enable detailed logging for debugging purposes
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
			</Show>
		</div>
	);
}

export default SettingsPage;
