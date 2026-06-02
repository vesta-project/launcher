import { SettingsCard, SettingsField } from "@components/settings";
import panelStyles from "@components/settings/settings.module.css";
import { getTotalRam, instanceDefaults, updateDefaultField } from "@stores/settings";
import {
	NumberField,
	NumberFieldDecrementTrigger,
	NumberFieldGroup,
	NumberFieldIncrementTrigger,
	NumberFieldInput,
	NumberFieldLabel,
} from "@ui/number-field/number-field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ui/select/select";
import { Separator } from "@ui/separator/separator";
import { Slider, SliderFill, SliderThumb, SliderTrack } from "@ui/slider/slider";
import { TextFieldInput, TextFieldRoot, TextFieldTextArea } from "@ui/text-field/text-field";
import styles from "../settings-page.module.css";

export function InstanceDefaultsTab() {
	const handleMemoryChange = (val: number[]) => {
		updateDefaultField("default_min_memory", val[0]);
		updateDefaultField("default_max_memory", val[1]);
	};

	return (
		<div class={styles["settings-tab-content"]}>
			<div class={panelStyles["settings-panel"]}>
			<SettingsCard header="Resolution Defaults" subHeader="Default window size for new instances.">
				<SettingsField
					label="Game Window"
					description="Initial width and height for the game window."
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
								onRawValueChange={(val) => updateDefaultField("default_width", val)}
								minValue={0}
							>
								<NumberFieldLabel
									style={{
										"font-size": "12px",
										"margin-bottom": "4px",
										opacity: 0.6,
									}}
								>
									Width
								</NumberFieldLabel>
								<NumberFieldGroup>
									<NumberFieldInput placeholder="Width" />
									<NumberFieldIncrementTrigger />
									<NumberFieldDecrementTrigger />
								</NumberFieldGroup>
							</NumberField>
							<span style={{ opacity: 0.5, "margin-bottom": "12px" }}>×</span>
							<NumberField
								style={{ flex: 1 }}
								value={instanceDefaults().default_height}
								onRawValueChange={(val) => updateDefaultField("default_height", val)}
								minValue={0}
							>
								<NumberFieldLabel
									style={{
										"font-size": "12px",
										"margin-bottom": "4px",
										opacity: 0.6,
									}}
								>
									Height
								</NumberFieldLabel>
								<NumberFieldGroup>
									<NumberFieldInput placeholder="Height" />
									<NumberFieldIncrementTrigger />
									<NumberFieldDecrementTrigger />
								</NumberFieldGroup>
							</NumberField>
						</div>
					}
				/>
			</SettingsCard>

			<SettingsCard header="Memory Allocation" subHeader="Default memory settings for new instances.">
				<SettingsField
					label="Allocation Range"
					description={`Set the minimum and maximum RAM for the game. (System Total: ${Math.round(
						getTotalRam() / 1024,
					)}GB)`}
					body={
						<>
							<div style={{ "margin-bottom": "32px", "margin-top": "12px" }}>
								<Slider
									value={[instanceDefaults().default_min_memory || 2048, instanceDefaults().default_max_memory || 4096]}
									onChange={handleMemoryChange}
									minValue={512}
									maxValue={getTotalRam() || 16384}
									step={512}
								>
									<div
										style={{
											display: "flex",
											"justify-content": "space-between",
											"margin-bottom": "8px",
										}}
									>
										<div style={{ "font-size": "13px", "font-weight": "600" }}>
											{(instanceDefaults().default_min_memory || 2048) >= 1024
												? `${((instanceDefaults().default_min_memory || 2048) / 1024).toFixed(1)}GB`
												: `${instanceDefaults().default_min_memory || 2048}MB`}
											{" — "}
											{(instanceDefaults().default_max_memory || 4096) >= 1024
												? `${((instanceDefaults().default_max_memory || 4096) / 1024).toFixed(1)}GB`
												: `${instanceDefaults().default_max_memory || 4096}MB`}
										</div>
									</div>
									<SliderTrack>
										<SliderFill />
										<SliderThumb />
										<SliderThumb />
									</SliderTrack>
								</Slider>
							</div>
							<div
								style={{
									display: "grid",
									"grid-template-columns": "1fr 1fr",
									gap: "16px",
									opacity: "0.8",
									"font-size": "13px",
								}}
							>
								<div>
									<strong>Min (-Xms):</strong> {instanceDefaults().default_min_memory} MB
								</div>
								<div>
									<strong>Max (-Xmx):</strong> {instanceDefaults().default_max_memory} MB
								</div>
							</div>
						</>
					}
				/>
			</SettingsCard>

			<SettingsCard header="Launcher Behavior After Launch" subHeader="Choose what the launcher does once a game starts.">
				<Select
					options={[
						{ label: "Stay Open", value: "stay-open" },
						{ label: "Minimize Window", value: "minimize" },
						{ label: "Hide To Tray", value: "hide-to-tray" },
						{ label: "Request Quit", value: "quit" },
					]}
					optionValue={"value" as any}
					optionTextValue={"label" as any}
					value={(instanceDefaults().default_launcher_action_on_launch || "stay-open") as string}
					onChange={(value: any) => updateDefaultField("default_launcher_action_on_launch", value)}
					itemComponent={(selectProps: any) => (
						<SelectItem item={selectProps.item}>{selectProps.item.rawValue.label}</SelectItem>
					)}
				>
					<SelectTrigger>
						<SelectValue<any>>{(state) => state.selectedOption()?.label || "Select..."}</SelectValue>
					</SelectTrigger>
					<SelectContent />
				</Select>
			</SettingsCard>

			<SettingsCard
				header="Launch Arguments"
				subHeader="Global Java arguments applied to linked instances."
			>
				<TextFieldRoot>
					<TextFieldTextArea
						value={instanceDefaults().default_java_args || ""}
						onInput={(e) =>
							updateDefaultField("default_java_args", (e.currentTarget as HTMLTextAreaElement).value)
						}
						placeholder="-Xmx4G -XX:+UseG1GC ..."
						style={{ "min-height": "100px" }}
					/>
				</TextFieldRoot>
			</SettingsCard>

			<SettingsCard
				header="Environment Variables"
				subHeader="Global environment variables for the game process. One per line (e.g. KEY=VALUE)."
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
				header="Lifecycle Hooks"
				subHeader="Commands to run at different stages of the instance lifecycle."
			>
				<div style={{ display: "flex", "flex-direction": "column", gap: "16px" }}>
					<SettingsField
						label="Pre-launch Command"
						description="Runs before the game starts."
						body={
							<TextFieldRoot>
								<TextFieldInput
									value={instanceDefaults().default_pre_launch_hook || ""}
									onInput={(e) =>
										updateDefaultField("default_pre_launch_hook", (e.currentTarget as HTMLInputElement).value)
									}
									placeholder="e.g. echo 'Starting...' > start.log"
								/>
							</TextFieldRoot>
						}
					/>
					<Separator />
					<SettingsField
						label="Wrapper Command"
						description="Wraps the Java process (e.g. mangohud, optirun)."
						body={
							<TextFieldRoot>
								<TextFieldInput
									value={instanceDefaults().default_wrapper_command || ""}
									onInput={(e) =>
										updateDefaultField("default_wrapper_command", (e.currentTarget as HTMLInputElement).value)
									}
									placeholder="e.g. mangohud"
								/>
							</TextFieldRoot>
						}
					/>
					<Separator />
					<SettingsField
						label="Post-exit Command"
						description="Runs after the game process terminates."
						body={
							<TextFieldRoot>
								<TextFieldInput
									value={instanceDefaults().default_post_exit_hook || ""}
									onInput={(e) =>
										updateDefaultField("default_post_exit_hook", (e.currentTarget as HTMLInputElement).value)
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
