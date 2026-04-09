import { ModloaderSwitcher } from "@components/modloader-switcher/modloader-switcher";
import { SettingsCard, SettingsField } from "@components/settings";
import { ResourceAvatar } from "@ui/avatar";
import Button from "@ui/button/button";
import {
	Combobox,
	ComboboxContent,
	ComboboxControl,
	ComboboxInput,
	ComboboxItem,
	ComboboxTrigger,
} from "@ui/combobox/combobox";
import { Skeleton } from "@ui/skeleton/skeleton";
import {
	Switch,
	SwitchControl,
	SwitchLabel,
	SwitchThumb,
} from "@ui/switch/switch";
import { Show } from "solid-js";
import styles from "../instance-details.module.css";
import { ModpackVersionSelector } from "../modpack-version-selector";

interface VersioningTabProps {
	instance: any;
	isGuest: boolean;
	busy: boolean;
	isInstalling: boolean;
	checkingUpdates: boolean;
	checkUpdates: () => void;
	modpackVersions: any;
	handleModpackVersionSelect: (v: any) => void;
	rolloutModpackUpdate: () => void;
	handleUnlink: () => void;
	router: any;
	searchableMcVersions: () => any[];
	includeSnapshots: () => boolean;
	setIncludeSnapshots: (v: boolean) => void;
	selectedMcVersion: () => string;
	setSelectedMcVersion: (v: string) => void;
	selectedLoader: () => string;
	setSelectedLoader: (v: string) => void;
	selectedLoaderVersion: () => string;
	setSelectedLoaderVersion: (v: string) => void;
	loadersList: any[];
	currentVersionSupportedLoaders: () => string[];
	searchableLoaderVersions: () => any[];
	handleStandardUpdate: () => void;
	setShowExportDialog: (v: boolean) => void;
	handleDuplicate: () => void;
	handleHardReset: () => void;
	handleUninstall: () => void;
	repairInstance: (id: number) => void;
	mcVersions: any;
}

export const VersioningTab = (props: VersioningTabProps) => {
	const inst = () => props.instance;
	const selectedMcOption = () => {
		return (
			props
				.searchableMcVersions()
				.find((version) => version.id === props.selectedMcVersion()) || null
		);
	};
	const selectedLoaderVersionOption = () => {
		return (
			props
				.searchableLoaderVersions()
				.find((version) => version.id === props.selectedLoaderVersion()) || null
		);
	};

	const hasPendingEngineChanges = () => {
		const instanceLoader = (inst().modloader || "vanilla").toLowerCase();
		const instanceLoaderVersion =
			instanceLoader === "vanilla" ? "" : inst().modloaderVersion || "";
		const selectedLoader = props.selectedLoader().toLowerCase();
		const selectedLoaderVersion =
			selectedLoader === "vanilla" ? "" : props.selectedLoaderVersion() || "";

		return (
			props.selectedMcVersion() !== inst().minecraftVersion ||
			selectedLoader !== instanceLoader ||
			selectedLoaderVersion !== instanceLoaderVersion
		);
	};

	const modloaderSwitcherOptions = () => {
		const supportedLoaders = props.currentVersionSupportedLoaders();
		return props.loadersList.map((loaderOption) => ({
			value: loaderOption.value,
			label: loaderOption.label,
			supported: supportedLoaders.includes(loaderOption.value.toLowerCase()),
		}));
	};

	const navigateToModpack = () => {
		if (inst().modpackId) {
			props.router?.navigate("/resource-details", {
				projectId: inst().modpackId,
				platform: inst().modpackPlatform,
			});
		}
	};

	return (
		<div class={styles["tab-versioning"]}>
			<Show when={inst().modpackId}>
				<SettingsCard
					header="Modpack Version"
					subHeader={`Project ID: ${inst().modpackId}`}
					variant="bordered"
				>
					<div class={styles["modpack-hero"]} onClick={navigateToModpack}>
						<div class={styles["modpack-hero-icon-container"]}>
							<ResourceAvatar
								icon={inst().modpackIconUrl}
								name={inst().name}
								class={styles["modpack-hero-icon"]}
							/>
						</div>
						<div class={styles["modpack-hero-info"]}>
							<div class={styles["modpack-hero-header"]}>
								<h3 class={styles["modpack-hero-title"]}>{inst().name}</h3>
								<Button
									variant="ghost"
									size="sm"
									onClick={(e: MouseEvent) => {
										e.stopPropagation();
										props.handleUnlink();
									}}
								>
									Unlink
								</Button>
							</div>
							<p class={styles["modpack-hero-subtitle"]}>
								{inst().modpackPlatform === "modrinth"
									? "Modrinth"
									: "CurseForge"}{" "}
								• {inst().minecraftVersion}
							</p>
						</div>
					</div>

					<ModpackVersionSelector
						versions={props.modpackVersions()}
						loading={props.modpackVersions.loading}
						currentVersionId={
							inst().modpackVersionId ? String(inst().modpackVersionId) : null
						}
						onVersionSelect={props.handleModpackVersionSelect}
						onUpdate={props.rolloutModpackUpdate}
						disabled={props.busy || props.isInstalling || props.isGuest}
					/>
				</SettingsCard>
			</Show>

			<Show when={!inst().modpackId}>
				<SettingsCard
					header="Core Configuration"
					subHeader="Define the Minecraft version and modloader for this instance."
					variant="bordered"
				>
					<div class={styles["versioning-game-options"]}>
						<div class={styles["versioning-section-title"]}>Game Options</div>

						<SettingsField
							label="Modloader"
							description="Choose between Vanilla, Forge, Fabric, or others."
							body={
								<ModloaderSwitcher
									options={modloaderSwitcherOptions()}
									value={props.selectedLoader()}
									onChange={(nextLoader) => {
										props.setSelectedLoader(nextLoader);
										props.setSelectedLoaderVersion("");
									}}
									disabled={props.isGuest}
								/>
							}
						/>

						<SettingsField
							label="Minecraft Version"
							description="The base version of the game to run."
							headerRight={
								<Switch
									checked={props.includeSnapshots()}
									onCheckedChange={props.setIncludeSnapshots}
									disabled={props.isGuest}
									class={styles["version-snapshot-switch"]}
								>
									<SwitchControl
										class={styles["version-snapshot-switch__control"]}
									>
										<SwitchThumb
											class={styles["version-snapshot-switch__thumb"]}
										/>
									</SwitchControl>
									<SwitchLabel
										class={styles["version-snapshot-switch__label"]}
									>
										Show Snapshots
									</SwitchLabel>
								</Switch>
							}
							body={
								<Combobox<any>
									options={props.searchableMcVersions()}
									optionValue="id"
									optionLabel="id"
									optionTextValue="searchString"
									value={selectedMcOption()}
									disabled={props.isGuest}
									onChange={(version) =>
										version?.id && props.setSelectedMcVersion(version.id)
									}
									placeholder="Select version..."
									itemComponent={(p) => (
										<ComboboxItem item={p.item}>{p.item.rawValue.id}</ComboboxItem>
									)}
								>
									<ComboboxControl aria-label="Version Picker">
										<ComboboxInput as="input" />
										<ComboboxTrigger />
									</ComboboxControl>
									<ComboboxContent />
								</Combobox>
							}
						/>

						<Show
							when={
								props.selectedLoader() &&
								props.selectedLoader().toLowerCase() !== "vanilla"
							}
						>
							<SettingsField
								label="Loader Version"
								description="Specific version of the selected modloader."
								body={
									<Show
										when={!props.mcVersions.loading}
										fallback={<Skeleton class={styles["skeleton-picker"]} />}
									>
										<Combobox<any>
											options={props.searchableLoaderVersions()}
											optionValue="id"
											optionLabel="id"
											optionTextValue="searchString"
											value={selectedLoaderVersionOption()}
											disabled={props.isGuest}
											onChange={(loaderVersion) =>
												loaderVersion?.id &&
												props.setSelectedLoaderVersion(loaderVersion.id)
											}
											placeholder="Select loader version..."
											itemComponent={(p) => (
												<ComboboxItem item={p.item}>
													<div
														style={{
															display: "flex",
															"justify-content": "space-between",
															width: "100%",
															"align-items": "center",
															gap: "12px",
														}}
													>
														<span>{p.item.rawValue.id}</span>
														<Show when={!p.item.rawValue.stable}>
															<span
																style={{
																	"font-size": "10px",
																	background: "var(--surface-raised)",
																	padding: "2px 6px",
																	"border-radius": "4px",
																	opacity: 0.6,
																}}
															>
																Experimental
															</span>
														</Show>
													</div>
												</ComboboxItem>
											)}
										>
											<ComboboxControl aria-label="Loader Version Selection">
												<ComboboxInput as="input" />
												<ComboboxTrigger />
											</ComboboxControl>
											<ComboboxContent />
										</Combobox>
									</Show>
								}
							/>
						</Show>

						<Show when={hasPendingEngineChanges()}>
							<div class={styles["versioning-action-row"]}>
								<Button
									onClick={props.handleStandardUpdate}
									disabled={props.busy || props.isInstalling || props.isGuest}
									color="primary"
									variant="shadow"
								>
									Switch Engine
								</Button>
							</div>
						</Show>
					</div>
				</SettingsCard>
			</Show>

			<SettingsCard header="General Operations">
				<SettingsField
					label="Export Instance"
					description="Pack this instance into a file for sharing or backup."
					actionLabel="Export..."
					onAction={() => props.setShowExportDialog(true)}
					disabled={props.isGuest}
				/>
				<SettingsField
					label="Duplicate Instance"
					description="Create an exact clone of this instance."
					actionLabel="Duplicate"
					onAction={props.handleDuplicate}
				/>
				<SettingsField
					label={inst().modpackId ? "Repair Files" : "Repair Instance"}
					description={
						inst().modpackId
							? "Verify all modpack assets and re-download missing files."
							: "Force a re-check of all files and re-download any missing components."
					}
					actionLabel="Repair"
					onAction={() => props.repairInstance(inst().id)}
				/>
			</SettingsCard>

			<SettingsCard header="Danger Zone" destructive>
				<Show when={inst().modpackId}>
					<SettingsField
						label="Unlink Connection"
						description="Disconnect from the source to manage files manually. This is irreversible."
						actionLabel="Unlink"
						destructive
						onAction={props.handleUnlink}
						disabled={props.busy || props.isInstalling || props.isGuest}
					/>
				</Show>
				<SettingsField
					label="Hard Reset"
					description={
						<span>
							Reinstalls the game from scratch. This{" "}
							<strong>permanently deletes</strong> your worlds, configs, and
							screenshots!
						</span>
					}
					actionLabel="Reset"
					destructive
					onAction={props.handleHardReset}
				/>
				<SettingsField
					label="Uninstall Instance"
					description={
						<span>
							Remove this instance and all its files from your computer. This
							action is <strong>permanent and irreversible</strong>.
						</span>
					}
					actionLabel="Uninstall"
					destructive
					onAction={props.handleUninstall}
				/>
			</SettingsCard>
		</div>
	);
};
