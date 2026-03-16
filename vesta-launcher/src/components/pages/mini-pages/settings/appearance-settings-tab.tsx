import { For, Show } from "solid-js";
import { SettingsCard, SettingsField } from "@components/settings";
import { Switch, SwitchControl, SwitchThumb } from "@ui/switch/switch";
import { NumberField, NumberFieldDecrementTrigger, NumberFieldGroup, NumberFieldIncrementTrigger, NumberFieldInput } from "@ui/number-field/number-field";
import { Slider, SliderFill, SliderThumb, SliderTrack } from "@ui/slider/slider";
import { ToggleGroup, ToggleGroupItem } from "@ui/toggle-group/toggle-group";
import { ThemePresetCard } from "../../../theme-preset-card/theme-preset-card";
import { invoke } from "@tauri-apps/api/core";
import { hasTauriRuntime } from "@utils/tauri-runtime";
import { PRESET_THEMES, type ThemeConfig, type GradientHarmony } from "../../../../themes/presets";
import styles from "./settings-page.module.css";

interface AppearanceSettingsTabProps {
	PRESET_THEMES: typeof PRESET_THEMES;
	themeId: string;
	handlePresetSelect: (id: string) => void;
	canChangeHue: boolean;
	backgroundHue: number;
	handleHueChange: (val: number[]) => void;
	styleMode: ThemeConfig["style"];
	handleStyleModeChange: (val: ThemeConfig["style"]) => void;
	gradientEnabled: boolean;
	handleGradientToggle: (checked: boolean) => void;
	gradientType: "linear" | "radial";
	handleGradientTypeChange: (val: "linear" | "radial") => void;
	rotation: number;
	handleRotationChange: (val: number[]) => void;
	gradientHarmony: GradientHarmony;
	handleGradientHarmonyChange: (val: GradientHarmony) => void;
	borderThickness: number;
	handleBorderThicknessChange: (val: number[]) => void;
}

export function AppearanceSettingsTab(props: AppearanceSettingsTabProps) {
	return (
		<div class={styles["settings-tab-content"]}>
			<section class={styles["settings-section"]}>
				<h2>Theme Presets</h2>
				<p class={styles["section-description"]}>
					Choose a pre-designed theme or create your own custom look.
				</p>
				<div class={styles["theme-preset-grid"]}>
					<For each={props.PRESET_THEMES}>
						{(theme) => (
							<ThemePresetCard
								theme={theme}
								isSelected={props.themeId === theme.id}
								onClick={() => props.handlePresetSelect(theme.id)}
							/>
						)}
					</For>
				</div>
			</section>

			<Show when={props.canChangeHue}>
				<SettingsCard
					header="Customize Colors"
					subHeader="Adjust the primary color hue to personalize your theme."
				>
					<SettingsField
						label="Primary Hue"
						description="The base color used for accents and backgrounds"
						layout="stack"
						control={
							<div
								class={styles["hue-customization"]}
								style={{ width: "100%" }}
							>
								<Slider
									value={[props.backgroundHue]}
									onChange={props.handleHueChange}
									minValue={0}
									maxValue={360}
									step={1}
									class={styles["slider--hue"]}
								>
									<div class={styles["slider__header"]}>
										<div class={styles["slider__value-label"]}>
											{props.backgroundHue}°
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

			<Show when={props.themeId === "custom"}>
				<SettingsCard
					header="Advanced Style"
					subHeader="Fine-tune the visual style and effects."
				>
					<SettingsField
						label="Style Mode"
						description="Choose the visual depth and transparency effects"
						layout="inline"
						control={
							<ToggleGroup
								value={props.styleMode ?? "glass"}
								onChange={(val) => {
									if (val)
										props.handleStyleModeChange(val as ThemeConfig["style"]);
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
						}
					/>

					<SettingsField
						label="Background Gradient"
						description="Enable animated background gradient"
						control={
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
							layout="inline"
							control={
								<ToggleGroup
									value={props.gradientType ?? "linear"}
									onChange={(val) => {
										if (val)
											props.handleGradientTypeChange(
												val as "linear" | "radial",
											);
									}}
								>
									<ToggleGroupItem value="linear">
										Linear
									</ToggleGroupItem>
									<ToggleGroupItem value="radial">
										Circular
									</ToggleGroupItem>
								</ToggleGroup>
							}
						/>

						<SettingsField
							label="Rotation"
							description="Angle of the background gradient"
							layout="stack"
							control={
								<div style={{ width: "100%" }}>
									<Slider
										value={[props.rotation ?? 135]}
										onChange={props.handleRotationChange}
										minValue={0}
										maxValue={360}
										step={1}
										class={styles["slider--angle"]}
									>
										<div class={styles["slider__header"]}>
											<div class={styles["slider__value-label"]}>
												{props.rotation}°
											</div>
										</div>
										<SliderTrack>
											<SliderFill />
											<SliderThumb />
										</SliderTrack>
									</Slider>
								</div>
							}
						/>

						<SettingsField
							label="Color Harmony"
							description="Choose how secondary colors are generated"
							helpTopic="GRADIENT_HARMONY"
							layout="inline"
							control={
								<ToggleGroup
									value={props.gradientHarmony ?? "none"}
									onChange={(val) => {
										if (val)
											props.handleGradientHarmonyChange(
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
							}
						/>
					</Show>

					<Show when={props.styleMode === "bordered"}>
						<SettingsField
							label="Border Thickness"
							description="Width of the element borders in pixels"
							layout="stack"
							control={
								<div style={{ width: "100%" }}>
									<Slider
										value={[props.borderThickness]}
										onChange={props.handleBorderThicknessChange}
										minValue={0}
										maxValue={4}
										step={1}
										class={styles["slider--border"]}
									>
										<div class={styles["slider__header"]}>
											<div class={styles["slider__value-label"]}>
												{props.borderThickness}px
											</div>
										</div>
										<SliderTrack>
											<SliderFill />
											<SliderThumb />
										</SliderTrack>
									</Slider>
								</div>
							}
						/>
					</Show>
				</SettingsCard>
			</Show>
		</div>
	);
}
