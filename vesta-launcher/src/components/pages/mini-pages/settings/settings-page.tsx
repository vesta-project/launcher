import { router } from "@components/page-viewer/page-viewer";
import LauncherButton from "@ui/button/button";
import {
	Switch,
	SwitchControl,
	SwitchLabel,
	SwitchThumb,
} from "@ui/switch/switch";
import {
	Slider,
	SliderTrack,
	SliderFill,
	SliderThumb,
	SliderLabel,
	SliderValueLabel,
} from "@ui/slider/slider";
import { createSignal, onMount, Show, createEffect, onCleanup } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { onConfigUpdate } from "@utils/config-sync";
import { hasTauriRuntime } from "@utils/tauri-runtime";
import "./settings-page.css";

interface AppConfig {
	debug_logging: boolean;
	background_hue: number;
	[key: string]: any;
}

function SettingsPage() {
	const [debugLogging, setDebugLogging] = createSignal(false);
	const [backgroundHue, setBackgroundHue] = createSignal(220);
	const [loading, setLoading] = createSignal(true);

	let unsubscribeConfigUpdate: (() => void) | null = null;

	onMount(async () => {
		try {
			const config = await invoke<AppConfig>("get_config");
			setDebugLogging(config.debug_logging);
			setBackgroundHue(config.background_hue);
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
			backgroundHue().toString()
		);
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

	return (
		<div class="settings-page">
			<h1>Settings</h1>

			<Show when={!loading()} fallback={<div>Loading settings...</div>}>
				<section class="settings-section">
					<h2>Appearance</h2>
					<div class="settings-row">
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
					</div>
					<p class="settings-description">
						Adjust the primary color hue for the application theme (0-360°)
					</p>
				</section>

				<section class="settings-section">
					<h2>Developer Options</h2>
					<div class="settings-row">
						<Switch
							checked={debugLogging()}
							onChange={handleDebugToggle}
							class="settings-switch"
						>
							<SwitchLabel>Debug Logging</SwitchLabel>
							<SwitchControl>
								<SwitchThumb />
							</SwitchControl>
						</Switch>
					</div>
					<p class="settings-description">
						Enable detailed logging for debugging purposes
					</p>
				</section>

				<section class="settings-section">
					<h2>Application Data</h2>
					<LauncherButton onClick={handleOpenAppData}>
						Open App Data Folder
					</LauncherButton>
				</section>

				<section class="settings-section">
					<h2>Navigation Test</h2>
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
				</section>
			</Show>
		</div>
	);
}

export default SettingsPage;
