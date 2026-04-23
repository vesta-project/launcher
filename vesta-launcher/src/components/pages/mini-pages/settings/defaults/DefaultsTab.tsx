import { SettingsCard, SettingsField } from "@components/settings";
import {
	NumberField,
	NumberFieldDecrementTrigger,
	NumberFieldGroup,
	NumberFieldIncrementTrigger,
	NumberFieldInput,
	NumberFieldLabel,
} from "@ui/number-field/number-field";
import { Select, SelectContent, SelectTrigger, SelectValue } from "@ui/select/select";
import { Separator } from "@ui/separator/separator";
import { Slider, SliderFill, SliderThumb, SliderTrack } from "@ui/slider/slider";
import { TextFieldInput, TextFieldRoot, TextFieldTextArea } from "@ui/text-field/text-field";
import { Component } from "solid-js";
import styles from "../settings-page.module.css";

export const InstanceDefaultsTab: Component<{
	config: any;
	updateConfig: (field: string, value: any) => void;
	totalRam: number;
}> = (props) => {
	const handleMemoryChange = (val: number[]) => {
		props.updateConfig("default_min_memory", val[0]);
		props.updateConfig("default_max_memory", val[1]);
	};

	return (
		<div class={styles["settings-tab-content"]}>
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
								class={styles["res-number-field"]}
								style={{ flex: 1 }}
								value={props.config.default_width}
								onRawValueChange={(val) => props.updateConfig("default_width", val)}
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
								class={styles["res-number-field"]}
								style={{ flex: 1 }}
								value={props.config.default_height}
								onRawValueChange={(val) => props.updateConfig("default_height", val)}
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
						(props.totalRam || 16384) / 1024,
					)}GB)`}
					body={
						<>
							<div style={{ "margin-bottom": "32px", "margin-top": "12px" }}>
								<Slider
									value={[props.config.default_min_memory || 2048, props.config.default_max_memory || 4096]}
									onChange={handleMemoryChange}
									minValue={512}
									maxValue={props.totalRam || 16384}
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
											{(props.config.default_min_memory || 2048) >= 1024
												? `${((props.config.default_min_memory || 2048) / 1024).toFixed(1)}GB`
												: `${props.config.default_min_memory || 2048}MB`}
											{" — "}
											{(props.config.default_max_memory || 4096) >= 1024
												? `${((props.config.default_max_memory || 4096) / 1024).toFixed(1)}GB`
												: `${props.config.default_max_memory || 4096}MB`}
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
									<strong>Min (-Xms):</strong> {props.config.default_min_memory} MB
								</div>
								<div>
									<strong>Max (-Xmx):</strong> {props.config.default_max_memory} MB
								</div>
							</div>
						</>
					}
				/>
			</SettingsCard>

			<SettingsCard header="Launcher Behavior" subHeader="Default launcher action when a game starts.">
				<SettingsField
					label="Launcher Behavior After Launch"
					description="Choose what the launcher does once a game starts."
					body={
						<Select
							options={[
								{ label: "Stay Open", value: "stay-open" },
								{ label: "Minimize Window", value: "minimize" },
								{ label: "Hide To Tray", value: "hide-to-tray" },
								{ label: "Request Quit", value: "quit" },
							]}
							optionValue="value"
							optionTextValue="label"
							value={{
								label: (
									{
										"stay-open": "Stay Open",
										minimize: "Minimize Window",
										"hide-to-tray": "Hide To Tray",
										quit: "Request Quit",
									} as any
								)[props.config.default_launcher_action_on_launch || "stay-open"],
								value: props.config.default_launcher_action_on_launch || "stay-open",
							}}
							onChange={(option: any) =>
								props.updateConfig("default_launcher_action_on_launch", option.value)
							}
						>
							<SelectTrigger>
								<SelectValue<any>>{(state) => state.selectedOption().label}</SelectValue>
							</SelectTrigger>
							<SelectContent />
						</Select>
					}
				/>
			</SettingsCard>

			<SettingsCard
				header="Launch Arguments"
				subHeader="Global Java arguments applied to linked instances."
			>
				<TextFieldRoot>
					<TextFieldTextArea
						value={props.config.default_java_args || ""}
						onInput={(e) =>
							props.updateConfig("default_java_args", (e.currentTarget as HTMLTextAreaElement).value)
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
						value={props.config.default_environment_variables || ""}
						onInput={(e) =>
							props.updateConfig(
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
									value={props.config.default_pre_launch_hook || ""}
									onInput={(e) =>
										props.updateConfig("default_pre_launch_hook", (e.currentTarget as HTMLInputElement).value)
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
									value={props.config.default_wrapper_command || ""}
									onInput={(e) =>
										props.updateConfig("default_wrapper_command", (e.currentTarget as HTMLInputElement).value)
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
									value={props.config.default_post_exit_hook || ""}
									onInput={(e) =>
										props.updateConfig("default_post_exit_hook", (e.currentTarget as HTMLInputElement).value)
									}
									placeholder="e.g. echo 'Finished' >> start.log"
								/>
							</TextFieldRoot>
						}
					/>
				</div>
			</SettingsCard>
		</div>
	);
};
