import { router } from "@components/page-viewer/page-viewer";
import { invoke } from "@tauri-apps/api/core";
import LauncherButton from "@ui/button/button";
import {
	Slider,
	SliderFill,
	SliderLabel,
	SliderThumb,
	SliderTrack,
	SliderValueLabel,
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
	const [reducedMotion, setReducedMotion] = createSignal(false);
	const [reducedEffects, setReducedEffects] = createSignal(false);
	const [loading, setLoading] = createSignal(true);

	let unsubscribeConfigUpdate: (() => void) | null = null;

	onMount(async () => {
		try {
			const config = await invoke<AppConfig>("get_config");
			setDebugLogging(config.debug_logging);
			setBackgroundHue(config.background_hue);
			setReducedMotion(Boolean(config.reduced_motion));
			setReducedEffects(Boolean(config.reduced_effects));
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
			} else if (field === "reduced_effects" && typeof value === "boolean") {
				setReducedEffects(value);
			}
			// Add more field handlers as needed
		});
	});

	onCleanup(() => {
		unsubscribeConfigUpdate?.();
	});

	// Apply hue changes to CSS variable in real-time
	createEffect(() => {
		document.documentElement.style.setProperty(
			"--color__primary-hue",
			backgroundHue().toString(),
		);
	});

	createEffect(() => {
		document.documentElement.dataset.reducedEffects =
			reducedEffects().toString();
	});

	const handleDebugToggle = async (checked: boolean) => {
		setDebugLogging(checked);
		try {
			await invoke("update_config_field", {
				field: "debug_logging",
				value: checked,
			});
			console.log("Debug logging updated:", checked);
		} catch (error) {
			console.error("Failed to update debug logging:", error);
			// Revert on error
			setDebugLogging(!checked);
		}
	};

	const handleHueChange = (value: number[]) => {
		// Update the signal immediately for live preview
		const hue = value[0];
		setBackgroundHue(hue);
	};

	const handleHueChangeEnd = async (value: number[]) => {
		// Only persist to database when slider is released
		const hue = value[0];
		try {
			await invoke("update_config_field", {
				field: "background_hue",
				value: hue,
			});
			console.log("Background hue updated:", hue);
		} catch (error) {
			console.error("Failed to update background hue:", error);
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
		setReducedMotion(checked);
		try {
			await invoke("update_config_field", {
				field: "reduced_motion",
				value: checked,
			});
		} catch (error) {
			console.error("Failed to update reduced motion:", error);
			setReducedMotion(!checked);
		}
	};

	const handleReducedEffectsToggle = async (checked: boolean) => {
		setReducedEffects(checked);
		try {
			await invoke("update_config_field", {
				field: "reduced_effects",
				value: checked,
			});
		} catch (error) {
			console.error("Failed to update reduced effects:", error);
			setReducedEffects(!checked);
		}
	};

	return (
		<div class="settings-page">
			<Show when={!loading()} fallback={<div>Loading settings...</div>}>
				<section class="settings-section">
					<h2>Appearance</h2>
					<div
						class="settings-row"
						style="flex-direction: column; align-items: stretch;"
					>
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
								<SliderLabel>Theme Hue</SliderLabel>
								<SliderValueLabel />
							</div>
							<SliderTrack>
								<SliderFill />
								<SliderThumb />
							</SliderTrack>
						</Slider>
						<p class="settings-description">
							Adjust the primary color hue for the application theme (0-360°)
						</p>
					</div>

					<div class="settings-row">
						<div class="settings-info">
							<span class="settings-label">Reduced Motion</span>
							<span class="settings-description">
								Disable non-essential animations and transitions for better
								performance and accessibility.
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

					<div class="settings-row">
						<div class="settings-info">
							<span class="settings-label">Reduced Effects</span>
							<span class="settings-description">
								Disable transparency and blur effects (glassmorphism) to improve
								performance.
							</span>
						</div>
						<Switch
							checked={reducedEffects()}
							onChange={handleReducedEffectsToggle}
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
								Open the folder where Vesta Launcher stores its configuration
								and data.
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
