import { Show, createMemo } from "solid-js";
import styles from "../instance-details.module.css";
import { SettingsCard, SettingsField } from "@components/settings";
import Button from "@ui/button/button";
import { IconPicker, areIconsEqual } from "@ui/icon-picker/icon-picker";
import {
	TextFieldInput,
	TextFieldRoot,
} from "@ui/text-field/text-field";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@ui/select/select";
import {
	Slider,
	SliderFill,
	SliderThumb,
	SliderTrack,
} from "@ui/slider/slider";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "@ui/context-menu/context-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ui/tooltip/tooltip";

interface SettingsTabProps {
	instance: any;
	name: string;
	setName: (v: string) => void;
	setIsNameDirty: (v: boolean) => void;
	iconPath: string;
	setIconPath: (v: string) => void;
	setIsIconDirty: (v: boolean) => void;
	uploadedIcons: () => string[];
	modpackIcon: () => string | null;
	isSuggestedSelected: () => boolean;
	isInstalling: () => boolean;
	jreOptions: () => any[];
	javaPath: string;
	setJavaPath: (v: string) => void;
	setIsJavaPathDirty: (v: boolean) => void;
	isCustomMode: boolean;
	setIsCustomMode: (v: boolean) => void;
	javaArgs: string;
	setJavaArgs: (v: string) => void;
	setIsJvmDirty: (v: boolean) => void;
	minMemory: number[];
	setMinMemory: (v: number[]) => void;
	setIsMinMemDirty: (v: boolean) => void;
	maxMemory: number[];
	setMaxMemory: (v: number[]) => void;
	setIsMaxMemDirty: (v: boolean) => void;
	handleSave: () => void;
	saving: () => boolean;
	totalRam: number;
	invoke: any;
	showToast: any;
}

export const SettingsTab = (p: SettingsTabProps) => {
	const currentSelection = createMemo(() => {
		const path = p.javaPath;
		if (p.isCustomMode) return "__custom__";
		if (!path) return "__default__";
		return path;
	});

	// Memory Multi-Thumb Logic
	const memoryRange = createMemo(() => [p.minMemory[0], p.maxMemory[0]]);
	const handleMemoryChange = (val: number[]) => {
		// Guard against phantom changes (e.g. from Slider mount/sync)
		if (val[0] === p.minMemory[0] && val[1] === p.maxMemory[0]) return;

		p.setMinMemory([val[0]]);
		p.setMaxMemory([val[1]]);
		p.setIsMinMemDirty(true);
		p.setIsMaxMemDirty(true);
	};

	return (
		<div class={styles["tab-settings"]}>
			<div class={styles["settings-metadata-section"]}>
				<div class={styles["metadata-main-info"]}>
					<div class={styles["metadata-icon-container"]}>
						<IconPicker
							value={p.iconPath}
							onSelect={(val) => {
								if (areIconsEqual(val, p.iconPath)) return;
								p.setIconPath(val);
								p.setIsIconDirty(true);
							}}
							uploadedIcons={p.uploadedIcons()}
							modpackIcon={p.modpackIcon()}
							isSuggestedSelected={p.isSuggestedSelected()}
							showHint={true}
						/>
					</div>

					<div class={styles["metadata-fields"]}>
						<TextFieldRoot class={styles["metadata-name-input-root"]}>
							<TextFieldInput
								class={styles["metadata-name-input"]}
								value={p.name}
								onInput={(e) => {
									const val = e.currentTarget.value;
									if (val === p.name) return;
									p.setName(val);
									p.setIsNameDirty(true);
								}}
								disabled={p.isInstalling()}
								placeholder="Instance Name"
							/>
						</TextFieldRoot>
						<p class={styles["metadata-description"]}>
							Choose an icon and a name for this instance. These will be visible in your library.
						</p>
					</div>
				</div>
			</div>

			<SettingsCard header="Java Configuration">
				<SettingsField
					label="Java Executable"
					description="The Java runtime used to launch this instance."
					helpTopic="JAVA_MANAGED"
					layout="stack"
				>
					<div style="display: flex; flex-direction: column; gap: 8px;">
						<Select<any>
							options={p.jreOptions()}
							optionValue="value"
							optionTextValue="label"
							value={p.jreOptions().find((o) => o.value === currentSelection())}
							onChange={(val) => {
								if (val.value === currentSelection()) return;

								if (val.value === "__default__") {
									p.setJavaPath("");
									p.setIsCustomMode(false);
									p.setIsJavaPathDirty(true);
								} else if (val.value === "__custom__") {
									p.setIsCustomMode(true);
								} else if (val.value.startsWith("__download_")) {
									const version = parseInt(val.value.split("_")[2]);
									p.invoke("download_managed_java", { version })
										.then(() => {
											p.showToast({
												title: "Download Started",
												description: `Java ${version} is being downloaded.`,
												severity: "Info",
											});
										})
										.catch(() => {
											p.showToast({
												title: "Error",
												description: "Failed to start Java download.",
												severity: "Error",
											});
										});
									p.setJavaPath("");
									p.setIsCustomMode(false);
									p.setIsJavaPathDirty(true);
								} else {
									p.setJavaPath(val.value);
									p.setIsCustomMode(false);
									p.setIsJavaPathDirty(true);
								}
							}}
							itemComponent={(p) => (
								<SelectItem item={p.item}>
									<div style="display: flex; flex-direction: column; line-height: 1.2;">
										<span style="font-weight: 600; font-size: 13px; color: var(--text-primary);">{p.item.rawValue.label}</span>
										<span style="font-size: 10px; opacity: 0.5; color: var(--text-secondary); font-family: var(--font-mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 300px;">
											{p.item.rawValue.description}
										</span>
									</div>
								</SelectItem>
							)}
						>
							<ContextMenu>
								<Tooltip>
									<TooltipTrigger style="width: 100%; display: block;" as="div">
										<ContextMenuTrigger style="width: 100%;" as="div">
											<SelectTrigger style="width: 100%;">
												<SelectValue<any>>
													{(state) => (
														<div style="display: flex; flex-direction: column; align-items: flex-start; line-height: 1.2;">
															<span style="font-size: 13px;">{state.selectedOption().label}</span>
															<span style="font-size: 10px; opacity: 0.5; font-family: var(--font-mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 340px;">
																{state.selectedOption().description}
															</span>
														</div>
													)}
												</SelectValue>
											</SelectTrigger>
										</ContextMenuTrigger>
									</TooltipTrigger>
									<TooltipContent>
										<Show
											when={p.jreOptions().find((o) => o.value === currentSelection())?.description}
											fallback="No path set"
										>
											{(desc) => (
												<div style="font-family: var(--font-mono); font-size: 11px; max-width: 400px; word-break: break-all;">
													{desc().startsWith("→ ") ? desc().substring(2) : desc()}
												</div>
											)}
										</Show>
									</TooltipContent>
								</Tooltip>
								<ContextMenuContent>
									<ContextMenuItem
										onClick={() => {
											const current = p.jreOptions().find((o) => o.value === currentSelection());
											if (current && current.description && current.description !== "(not set)") {
												let path = current.description;
												if (path.startsWith("→ ")) path = path.substring(2);
												navigator.clipboard.writeText(path);
												p.showToast({
													title: "Copied",
													description: "Java path copied to clipboard",
													severity: "Success",
												});
											}
										}}
									>
										Copy Full Path
									</ContextMenuItem>
								</ContextMenuContent>
							</ContextMenu>
							<SelectContent />
						</Select>

						<Show when={currentSelection() === "__custom__"}>
							<div style="display: flex; gap: 8px; margin-top: 4px;">
								<TextFieldRoot style="flex: 1">
									<TextFieldInput
										value={p.javaPath}
										placeholder="Path to java executable"
										onInput={(e) => {
											const val = e.currentTarget.value;
											if (val === p.javaPath) return;
											p.setJavaPath(val);
											p.setIsJavaPathDirty(true);
										}}
									/>
								</TextFieldRoot>
								<Button
									variant="ghost"
									size="sm"
									onClick={async () => {
										const path = await p.invoke("pick_java_path");
										if (path && path !== p.javaPath) {
											p.setJavaPath(path);
											p.setIsCustomMode(false);
											p.setIsJavaPathDirty(true);
										}
									}}
								>
									Browse...
								</Button>
							</div>
						</Show>
					</div>
				</SettingsField>

				<SettingsField label="Java Arguments" description="Custom JVM arguments for this instance." layout="stack">
					<TextFieldRoot>
						<TextFieldInput
							value={p.javaArgs}
							onInput={(e: any) => {
								const val = e.currentTarget.value;
								if (val === p.javaArgs) return;
								p.setJavaArgs(val);
								p.setIsJvmDirty(true);
							}}
							placeholder="-XX:+UseG1GC -XX:+ParallelRefProcEnabled"
						/>
					</TextFieldRoot>
				</SettingsField>
			</SettingsCard>

			<SettingsCard header="Memory Management">
				<SettingsField 
					label="Allocation Range" 
					description={`Set the minimum and maximum RAM for the game. (System Total: ${Math.round(p.totalRam / 1024)}GB)`}
					layout="stack"
				>
					<div style="margin-bottom: 32px;">
						<Slider
							value={memoryRange()}
							onChange={handleMemoryChange}
							minValue={512}
							maxValue={p.totalRam}
							step={512}
						>
							<div class={styles["slider__header"]}>
								<div class={styles["slider__value-label"]}>
									{p.minMemory[0] >= 1024 ? `${(p.minMemory[0] / 1024).toFixed(1)}GB` : `${p.minMemory[0]}MB`}
									{" — "}
									{p.maxMemory[0] >= 1024 ? `${(p.maxMemory[0] / 1024).toFixed(1)}GB` : `${p.maxMemory[0]}MB`}
								</div>
							</div>
							<SliderTrack>
								<SliderFill />
								<SliderThumb />
								<SliderThumb />
							</SliderTrack>
						</Slider>
					</div>
					<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; opacity: 0.8; font-size: 13px;">
						<div>
							<strong>Min (-Xms):</strong> {p.minMemory[0]} MB
						</div>
						<div>
							<strong>Max (-Xmx):</strong> {p.maxMemory[0]} MB
						</div>
					</div>
				</SettingsField>
			</SettingsCard>

			<div class={styles["settings-actions"]} style="display: flex; gap: 12px; margin-top: 24px;">
				<Button onClick={p.handleSave} disabled={p.saving() || p.isInstalling()}>
					{p.saving() ? "Saving…" : p.isInstalling() ? "Installing..." : "Save Settings"}
				</Button>
			</div>
		</div>
	);
};
