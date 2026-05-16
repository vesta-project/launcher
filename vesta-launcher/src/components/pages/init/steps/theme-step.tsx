import Button from "@ui/button/button";
import { Slider, SliderThumb, SliderTrack } from "@ui/slider/slider";
import { invoke } from "@tauri-apps/api/core";
import { createEffect, createSignal, For, onMount, Show } from "solid-js";
import {
	applyTheme,
	getThemeById,
	PRESET_THEMES,
	type ThemeConfig,
} from "../../../../themes/presets";
import { currentThemeConfig, saveThemeUpdate as persistThemeUpdate } from "../../../../utils/config-sync";
import styles from "../init.module.css";

interface ThemeStepProps {
	goNext: () => Promise<void>;
	goBack: () => Promise<void>;
	onThemeActivated: () => void;
}

function OnboardingThemeCard(props: {
	theme: ThemeConfig;
	isSelected: boolean;
	onClick: () => void;
}) {
	const previewStyle = () => props.theme.style ?? "glass";

	return (
		<button
			type="button"
			class={styles["onboarding-theme-card"]}
			classList={{ [styles["onboarding-theme-card--selected"]]: props.isSelected }}
			onClick={props.onClick}
			data-preview-style={previewStyle()}
			data-preview-gradient={props.theme.gradientEnabled ? "1" : "0"}
			style={{
				"--preview-hue": props.theme.primaryHue,
				"--preview-angle": props.theme.rotation ?? 135,
			}}
		>
			<div class={styles["onboarding-theme-preview"]}>
				<div class={styles["onboarding-theme-preview__bg"]} />
				<div class={styles["onboarding-theme-preview__sidebar"]}>
					<div class={styles["onboarding-theme-preview__dot"]} />
					<div
						class={styles["onboarding-theme-preview__dot"]}
						classList={{ [styles["onboarding-theme-preview__dot--active"]]: true }}
					/>
					<div class={styles["onboarding-theme-preview__dot"]} />
				</div>
				<div class={styles["onboarding-theme-preview__main"]}>
					<div class={styles["onboarding-theme-preview__card"]}>
						<div class={styles["onboarding-theme-preview__line"]} />
						<div class={styles["onboarding-theme-preview__line--short"]} />
					</div>
				</div>
			</div>
			<span class={styles["onboarding-theme-card__name"]}>{props.theme.name}</span>
		</button>
	);
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

	createEffect(() => {
		if (explicitThemeSelected()) {
			// Defer until after the hue slider and footer have rendered
			requestAnimationFrame(() => {
				requestAnimationFrame(() => {
					const content = document.querySelector(".stage-card-content");
					if (content) {
						content.scrollTo({
							top: content.scrollHeight,
							behavior: "smooth",
						});
					}
				});
			});
		}
	});

	const handlePresetSelect = (id: string) => {
		const theme = getThemeById(id);
		if (!theme) return;

		setThemeId(id);
		setExplicitThemeSelected(true);
		setIsPersisting(true);

		const newHue =
			theme.allowHueChange === false
				? (theme.primaryHue ?? 180)
				: backgroundHue();

		if (theme.primaryHue !== undefined && theme.allowHueChange === false) {
			setBackgroundHue(newHue);
		}

		requestAnimationFrame(() => {
			applyTheme(
				{ ...theme, primaryHue: newHue },
				{ transition: "preset-switch" },
			);
			props.onThemeActivated();

			persistThemeUpdate({
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
			})
				.then(() => setIsPersisting(false))
				.catch((e) => {
					setIsPersisting(false);
					console.error("Failed to persist selected onboarding theme:", e);
				});
		});
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
			<div class={styles["theme-fade-up--enter"]}>
				<div class={styles["theme-header"]}>
					<h2 class={styles["theme-title"]}>Make it yours.</h2>
					<p class={styles["theme-subtitle"]}>
						Pick a starting look for Vesta.
					</p>
				</div>
			</div>

			<div class={styles["theme-scrollable"]}>
				<div class={styles["theme-fade-up--enter-delayed"]}>
					<div class={styles["theme-grid"]}>
						<For each={PRESET_THEMES.filter((t) => t.id !== "custom")}>
							{(theme) => (
								<OnboardingThemeCard
									theme={theme}
									isSelected={isSelected(theme.id)}
									onClick={() => void handlePresetSelect(theme.id)}
								/>
							)}
						</For>
					</div>
				</div>
			</div>

			<Show when={explicitThemeSelected() && canChangeHue()}>
				<div class={styles["theme-fade-up--enter"]}>
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
				</div>
			</Show>

			<Show when={explicitThemeSelected()}>
				<div class={styles["theme-fade-up--enter"]}>
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
				</div>
			</Show>
		</div>
	);
}

export default ThemeStep;
