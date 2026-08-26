import { SettingsCard, SettingsField } from "@components/settings";
import panelStyles from "@components/settings/settings.module.css";
import {
	getTotalRam,
	instanceDefaults,
	updateDefaultField,
} from "@stores/settings";
import {
	NumberField,
	NumberFieldDecrementTrigger,
	NumberFieldGroup,
	NumberFieldIncrementTrigger,
	NumberFieldInput,
	NumberFieldLabel,
} from "@ui/number-field/number-field";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@ui/select/select";
import { Separator } from "@ui/separator/separator";
import {
	Slider,
	SliderFill,
	SliderThumb,
	SliderTrack,
} from "@ui/slider/slider";
import {
	TextFieldInput,
	TextFieldRoot,
	TextFieldTextArea,
} from "@ui/text-field/text-field";
import {
	formatMemoryLabel,
	findLaunchBehaviorOption,
	launchBehaviorOptions,
} from "@utils/localized-options";
import {
	DEFAULT_MIN_MEMORY_MB,
	getDynamicPreferredMaxMemoryMb,
	getGeneratedMemoryLimitMb,
	MAX_GENERATED_MEMORY_MB,
} from "@utils/memory-policy";
import { createMemo } from "solid-js";
import { t } from "~/localization";
import styles from "../settings-page.module.css";

export function InstanceDefaultsTab() {
	const launchOptions = createMemo(() => launchBehaviorOptions());

	const handleMemoryChange = (val: number[]) => {
		const nextMax = val[0] || preferredMaxMemory();
		updateDefaultField("default_min_memory", DEFAULT_MIN_MEMORY_MB);
		updateDefaultField("default_max_memory", nextMax);
	};

	const preferredMaxMemory = () =>
		instanceDefaults().default_max_memory ||
		getDynamicPreferredMaxMemoryMb(getTotalRam());
	const generatedMemoryLimit = () => getGeneratedMemoryLimitMb(getTotalRam());

	return (
		<div class={styles["settings-tab-content"]}>
			<div class={panelStyles["settings-panel"]}>
				<SettingsCard
					header={t("settings-defaults-resolution-title")}
					subHeader={t("settings-defaults-resolution-subheader")}
				>
					<SettingsField
						label={t("settings-defaults-game-window-label")}
						description={t("settings-defaults-game-window-description")}
						body={
							<div
								style={{
									display: "flex",
									gap: "16px",
									"align-items": "flex-end",
									"max-width": "400px",
								}}
							>
								<NumberField
									style={{ flex: 1 }}
									value={instanceDefaults().default_width}
									onRawValueChange={(val) =>
										updateDefaultField("default_width", val)
									}
									minValue={0}
								>
									<NumberFieldLabel
										style={{
											"font-size": "12px",
											"margin-bottom": "4px",
											opacity: 0.6,
										}}
									>
										{t("common-width")}
									</NumberFieldLabel>
									<NumberFieldGroup>
										<NumberFieldInput placeholder={t("common-width")} />
										<NumberFieldIncrementTrigger />
										<NumberFieldDecrementTrigger />
									</NumberFieldGroup>
								</NumberField>
								<span style={{ opacity: 0.5, "margin-bottom": "12px" }}>×</span>
								<NumberField
									style={{ flex: 1 }}
									value={instanceDefaults().default_height}
									onRawValueChange={(val) =>
										updateDefaultField("default_height", val)
									}
									minValue={0}
								>
									<NumberFieldLabel
										style={{
											"font-size": "12px",
											"margin-bottom": "4px",
											opacity: 0.6,
										}}
									>
										{t("common-height")}
									</NumberFieldLabel>
									<NumberFieldGroup>
										<NumberFieldInput placeholder={t("common-height")} />
										<NumberFieldIncrementTrigger />
										<NumberFieldDecrementTrigger />
									</NumberFieldGroup>
								</NumberField>
							</div>
						}
					/>
				</SettingsCard>

				<SettingsCard
					header={t("settings-defaults-memory-title")}
					subHeader={t("settings-defaults-memory-subheader")}
				>
					<SettingsField
						label={t("settings-defaults-memory-preferred-label")}
						description={t("settings-defaults-memory-preferred-description", {
							totalRam: Math.round(getTotalRam() / 1024),
						})}
						body={
							<>
								<div class={styles["memory-default-control"]}>
									<Slider
										value={[preferredMaxMemory()]}
										onChange={handleMemoryChange}
										minValue={2048}
										maxValue={MAX_GENERATED_MEMORY_MB}
										step={512}
									>
										<div
											style={{
												display: "flex",
												"justify-content": "space-between",
												"margin-bottom": "8px",
											}}
										>
											<div
												style={{ "font-size": "13px", "font-weight": "600" }}
											>
												{formatMemoryLabel(preferredMaxMemory())}
											</div>
										</div>
										<SliderTrack>
											<SliderFill />
											<SliderThumb />
										</SliderTrack>
									</Slider>
								</div>
								{preferredMaxMemory() > generatedMemoryLimit() && (
									<div class={styles["memory-default-warning"]}>
										<span>
											{t("settings-defaults-memory-warning", {
												recommended: formatMemoryLabel(generatedMemoryLimit()),
											})}
										</span>
									</div>
								)}
							</>
						}
					/>
				</SettingsCard>

				<SettingsCard
					header={t("settings-defaults-launcher-action-title")}
					subHeader={t("settings-defaults-launcher-action-subheader")}
				>
					<Select
						options={launchOptions()}
						optionValue={"value" as any}
						optionTextValue={"label" as any}
						value={
							findLaunchBehaviorOption(
								instanceDefaults().default_launcher_action_on_launch ||
									"stay-open",
							) as any
						}
						onChange={(option: any) =>
							updateDefaultField(
								"default_launcher_action_on_launch",
								option?.value,
							)
						}
						itemComponent={(selectProps: any) => (
							<SelectItem item={selectProps.item}>
								{selectProps.item.rawValue.label}
							</SelectItem>
						)}
					>
						<SelectTrigger>
							<SelectValue<any>>
								{(state) =>
									state.selectedOption()?.label ?? t("common-select-placeholder")
								}
							</SelectValue>
						</SelectTrigger>
						<SelectContent />
					</Select>
				</SettingsCard>

				<SettingsCard
					header={t("settings-defaults-java-args-title")}
					subHeader={t("settings-defaults-java-args-subheader")}
				>
					<TextFieldRoot>
						<TextFieldTextArea
							value={instanceDefaults().default_java_args || ""}
							onInput={(e) =>
								updateDefaultField(
									"default_java_args",
									(e.currentTarget as HTMLTextAreaElement).value,
								)
							}
							placeholder="-Xmx4G -XX:+UseG1GC ..."
							style={{ "min-height": "100px" }}
						/>
					</TextFieldRoot>
				</SettingsCard>

				<SettingsCard
					header={t("settings-defaults-env-title")}
					subHeader={t("settings-defaults-env-subheader")}
				>
					<TextFieldRoot>
						<TextFieldTextArea
							value={instanceDefaults().default_environment_variables || ""}
							onInput={(e) =>
								updateDefaultField(
									"default_environment_variables",
									(e.currentTarget as HTMLTextAreaElement).value,
								)
							}
							placeholder="KEY=VALUE"
							style={{
								"min-height": "100px",
								"font-family": "var(--font-mono)",
								"font-size": "12px",
							}}
						/>
					</TextFieldRoot>
				</SettingsCard>

				<SettingsCard
					header={t("settings-defaults-hooks-title")}
					subHeader={t("settings-defaults-hooks-subheader")}
				>
					<div
						style={{ display: "flex", "flex-direction": "column", gap: "16px" }}
					>
						<SettingsField
							label={t("settings-defaults-pre-launch-label")}
							description={t("settings-defaults-pre-launch-description")}
							body={
								<TextFieldRoot>
									<TextFieldInput
										value={instanceDefaults().default_pre_launch_hook || ""}
										onInput={(e) =>
											updateDefaultField(
												"default_pre_launch_hook",
												(e.currentTarget as HTMLInputElement).value,
											)
										}
										placeholder="e.g. echo 'Starting...' > start.log"
									/>
								</TextFieldRoot>
							}
						/>
						<Separator />
						<SettingsField
							label={t("settings-defaults-wrapper-label")}
							description={t("settings-defaults-wrapper-description")}
							body={
								<TextFieldRoot>
									<TextFieldInput
										value={instanceDefaults().default_wrapper_command || ""}
										onInput={(e) =>
											updateDefaultField(
												"default_wrapper_command",
												(e.currentTarget as HTMLInputElement).value,
											)
										}
										placeholder="e.g. mangohud"
									/>
								</TextFieldRoot>
							}
						/>
						<Separator />
						<SettingsField
							label={t("settings-defaults-post-exit-label")}
							description={t("settings-defaults-post-exit-description")}
							body={
								<TextFieldRoot>
									<TextFieldInput
										value={instanceDefaults().default_post_exit_hook || ""}
										onInput={(e) =>
											updateDefaultField(
												"default_post_exit_hook",
												(e.currentTarget as HTMLInputElement).value,
											)
										}
										placeholder="e.g. echo 'Finished' >> start.log"
									/>
								</TextFieldRoot>
							}
						/>
					</div>
				</SettingsCard>
			</div>
		</div>
	);
}
