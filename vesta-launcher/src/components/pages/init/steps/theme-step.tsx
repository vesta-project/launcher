import Button from "@ui/button/button";
import { Slider, SliderThumb, SliderTrack } from "@ui/slider/slider";
import { Motion } from "@motionone/solid";
import { invoke } from "@tauri-apps/api/core";
import { createSignal, For, onMount, Show } from "solid-js";
import {
	applyTheme,
	getThemeById,
	PRESET_THEMES,
	type ThemeConfig,
} from "../../../themes/presets";
import { currentThemeConfig, saveThemeUpdate as persistThemeUpdate } from "../../../utils/config-sync";
import ThemePreviewCard from "../components/theme-preview-card";
import { DURATION, EASE } from "../utils/motion";
import styles from "../init.module.css";

interface ThemeStepProps {
	goNext: () => Promise<void>;
	goBack: () => Promise<void>;
	onThemeActivated: () => void;
}

function ThemeStep(props: ThemeStepProps) {
	const [themeId, setThemeId] = createSignal<string>(currentThemeConfig.theme_id ?? "vesta");
	const [backgroundHue, setBackgroundHue] = createSignal(
		currentThemeConfig.theme_primary_hue ?? currentThemeConfig.background_hue ?? 180,
	);
	const [explicitThemeSelected, setExplicitThemeSelected] = createSignal(false);
	const [isPersisting, setIsPersisting] = createSignal(false);

	onMount(async () => {
		try {
			const config = await invoke<any>("get_config");
			if (config.theme_id) setThemeId(config.theme_id);
			if (config.theme_primary_hue !== null && config.theme_primary_hue !== undefined) {
				setBackgroundHue(config.theme_primary_hue);
			}
			setExplicitThemeSelected(false);
		} catch (e) {
			console.error("Failed to load appearance config:", e);
		}
	});

	const handlePresetSelect = async (id: string) => {
		const theme = getThemeById(id);
		if (!theme) return;

		setIsPersisting(true);
		setThemeId(id);

		const newHue =
			theme.allowHueChange === false
				? (theme.primaryHue ?? 180)
				: backgroundHue();

		if (theme.primaryHue !== undefined && theme.allowHueChange === false) {
			setBackgroundHue(newHue);
		}

		applyTheme(
			{ ...theme, primaryHue: newHue },
			{ transition: "preset-switch" },
		);

		try {
			await persistThemeUpdate({
				themeId: id,
				primaryHue: newHue,
				opacity: theme.opacity,
				gradientEnabled: theme.gradientEnabled,
				rotation: theme.rotation,
				gradientType: theme.gradientType,
				gradientHarmony: theme.gradientHarmony,
				borderWidth: theme.borderWidth,
				backgroundOpacity: 25,
				windowEffect: theme.windowEffect,
			});
			setExplicitThemeSelected(true);
			props.onThemeActivated();
		} catch (e) {
			setExplicitThemeSelected(false);
			console.error("Failed to persist selected onboarding theme:", e);
		} finally {
			setIsPersisting(false);
		}
	};

	const handleHueChange = async (values: number[]) => {
		if (!explicitThemeSelected()) return;
		const newHue = values[0];
		setBackgroundHue(newHue);
		await persistThemeUpdate({ primaryHue: newHue });
	};

	const isSelected = (id: string) => explicitThemeSelected() && themeId() === id;

	const canChangeHue = () => {
		const theme = getThemeById(themeId());
		return theme?.allowHueChange ?? false;
	};

	const canProceed = () => explicitThemeSelected() && !isPersisting();

	return (
		<div class={styles["theme-step"]}>
			<Motion
				initial={{ opacity: 0, y: 12 }}
				animate={{ opacity: 1, y: 0 }}
				transition={{ duration: DURATION.normal, easing: EASE.smooth }}
			>
				<div class={styles["theme-header"]}>
					<h2 class={styles["theme-title"]}>Make it yours.</h2>
					<p class={styles["theme-subtitle"]}>
						Pick a starting look for Vesta. You can always change this later.
					</p>
				</div>
			</Motion>

			<Motion
				initial={{ opacity: 0, y: 16 }}
				animate={{ opacity: 1, y: 0 }}
				transition={{ duration: DURATION.slow, delay: 0.1, easing: EASE.smooth }}
			>
				<div class={styles["theme-grid"]}>
					<For each={PRESET_THEMES.filter((t) => t.id !== "custom")}>
						{(theme) => (
							<ThemePreviewCard
								theme={theme}
								isSelected={isSelected(theme.id)}
								onClick={() => void handlePresetSelect(theme.id)}
							/>
						)}
					</For>
				</div>
			</Motion>

			<Show when={explicitThemeSelected() && canChangeHue()}>
				<Motion
					initial={{ opacity: 0, y: 12 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ duration: DURATION.normal, easing: EASE.smooth }}
				>
					<div class={styles["theme-hue-section"]}>
						<div class={styles["theme-hue-label"]}>
							<span>Customize Primary Hue</span>
							<span class={styles["theme-hue-value"]}>{backgroundHue()}°</span>
						</div>
						<Slider
							value={[backgroundHue()]}
							onChange={handleHueChange}
							minValue={0}
							maxValue={360}
							step={1}
						>
							<SliderTrack
								style={{
									background:
										"linear-gradient(to right, #ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%)",
									height: "10px",
									"border-radius": "5px",
								}}
							>
								<SliderThumb />
							</SliderTrack>
						</Slider>
					</div>
				</Motion>
			</Show>

			<Show when={explicitThemeSelected()}>
				<Motion
					initial={{ opacity: 0, y: 12 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ duration: DURATION.normal, easing: EASE.smooth }}
				>
					<div class={styles["theme-footer"]}>
						<Button
							color="primary"
							size="lg"
							onClick={() => void props.goNext()}
							disabled={!canProceed()}
							class={styles["theme-continue-btn"]}
						>
							Continue
						</Button>
					</div>
				</Motion>
			</Show>
		</div>
	);
}

export default ThemeStep;
