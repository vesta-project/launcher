import { SettingsCard, SettingsField } from "@components/settings";
import { ResourceAvatar } from "@ui/avatar";
import { Badge } from "@ui/badge";
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
	selectedMcVersion: () => string;
	setSelectedMcVersion: (v: string) => void;
	selectedLoader: () => string;
	setSelectedLoader: (v: string) => void;
	selectedLoaderVersion: () => string;
	setSelectedLoaderVersion: (v: string) => void;
	loadersList: any[];
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
					<SettingsField
						label="Minecraft Version"
						description="The base version of the game to run."
						layout="stack"
					>
						<Combobox<any>
							options={props.searchableMcVersions()}
							optionValue="id"
							optionTextValue="searchString"
							value={props.selectedMcVersion()}
							disabled={props.isGuest}
							onChange={(id) => id && props.setSelectedMcVersion(id)}
							placeholder="Select version..."
							itemComponent={(p) => (
								<ComboboxItem item={p.item}>{p.item.rawValue.id}</ComboboxItem>
							)}
						>
							<ComboboxControl aria-label="Version Picker" style="width: 100%;">
								<ComboboxInput as="input" value={props.selectedMcVersion()} />
								<ComboboxTrigger />
							</ComboboxControl>
							<ComboboxContent />
						</Combobox>
					</SettingsField>

					<SettingsField
						label="Modloader Engine"
						description="Choose between Vanilla, Forge, Fabric, or others."
						layout="stack"
					>
						<Combobox<any>
							options={props.loadersList}
							optionValue="value"
							optionTextValue="label"
							value={props.selectedLoader()}
							disabled={props.isGuest}
							onChange={(val) => val && props.setSelectedLoader(val)}
							placeholder="Select loader..."
							itemComponent={(p) => (
								<ComboboxItem item={p.item}>
									{p.item.rawValue.label}
								</ComboboxItem>
							)}
						>
							<ComboboxControl aria-label="Loader Picker" style="width: 100%;">
								<ComboboxInput
									as="input"
									value={
										props.loadersList.find(
											(l) => l.value === props.selectedLoader(),
										)?.label || "Vanilla"
									}
								/>
								<ComboboxTrigger />
							</ComboboxControl>
							<ComboboxContent />
						</Combobox>
					</SettingsField>

					<Show
						when={
							props.selectedLoader() &&
							props.selectedLoader().toLowerCase() !== "vanilla"
						}
					>
						<SettingsField
							label="Loader Version"
							description="Specific version of the selected modloader."
							layout="stack"
						>
							<div style="display: flex; gap: 12px; align-items: flex-end; width: 100%;">
								<div style="flex: 1;">
									<Show
										when={!props.mcVersions.loading}
										fallback={<Skeleton class={styles["skeleton-picker"]} />}
									>
										<Combobox<any>
											options={props.searchableLoaderVersions()}
											optionValue="id"
											optionTextValue="searchString"
											value={props.selectedLoaderVersion()}
											disabled={props.isGuest}
											onChange={(id) =>
												id && props.setSelectedLoaderVersion(id)
											}
											placeholder="Select loader version..."
											itemComponent={(p) => (
												<ComboboxItem item={p.item}>
													{p.item.rawValue.id}
												</ComboboxItem>
											)}
										>
											<ComboboxControl
												aria-label="Loader Version Selection"
												style="width: 100%;"
											>
												<ComboboxInput
													as="input"
													value={props.selectedLoaderVersion()}
												/>
												<ComboboxTrigger />
											</ComboboxControl>
											<ComboboxContent />
										</Combobox>
									</Show>
								</div>

								<Show
									when={
										props.selectedLoader() !==
											(inst().modloader || "vanilla") ||
										props.selectedLoaderVersion() !==
											(inst().modloaderVersion || "") ||
										props.selectedMcVersion() !== inst().minecraftVersion
									}
								>
									<Button
										onClick={props.handleStandardUpdate}
										disabled={props.busy || props.isInstalling || props.isGuest}
										color="primary"
										variant="shadow"
									>
										Switch Engine
									</Button>
								</Show>
							</div>
						</SettingsField>
					</Show>
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
