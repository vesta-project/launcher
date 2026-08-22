import { ModloaderSwitcher } from "@components/modloader-switcher/modloader-switcher";
import { SettingsCard, SettingsField } from "@components/settings";
import panelStyles from "@components/settings/settings.module.css";
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
import { t } from "~/localization";
import { ModpackVersionSelector } from "../modpack-version-selector";
import styles from "./versioning-tab.module.css";

interface VersioningTabProps {
	instance: any;
	modpackIcon: () => string | null;
	isGuest: boolean;
	busy: boolean;
	isInstalling: boolean;
	checkingUpdates: boolean;
	checkUpdates: () => void;
	modpackVersions: any;
	availableModpackUpdate: any;
	handleModpackVersionSelect: (v: any) => void;
	rolloutModpackUpdate: () => void;
	handleUnlink: () => void;
	handleDeleteModpackAndUnlink: () => void;
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
		if (!inst().modpackId) return;
		props.router?.navigate("/resource-details", {
			projectId: inst().modpackId,
			platform: inst().modpackPlatform,
		});
	};

	return (
		<div class={styles["tab-versioning"]}>
			<div class={panelStyles["settings-panel"]}>
				<Show when={inst().modpackId}>
					<SettingsCard
						header={t("instances-versioning-linked-modpack-title")}
						subHeader={t("instances-versioning-linked-modpack-subheader")}
					>
						<div class={styles["versioning-stack"]}>
							<ModpackVersionSelector
								projectName={inst().name}
								projectIcon={props.modpackIcon()}
								platform={inst().modpackPlatform}
								minecraftVersion={inst().minecraftVersion}
								loader={inst().modloader || "Vanilla"}
								versions={props.modpackVersions()}
								loading={props.modpackVersions.loading}
								currentVersionId={
									inst().modpackVersionId
										? String(inst().modpackVersionId)
										: null
								}
								availableUpdate={props.availableModpackUpdate}
								onVersionSelect={props.handleModpackVersionSelect}
								onUpdate={props.rolloutModpackUpdate}
								onOpenProject={navigateToModpack}
								disabled={props.busy || props.isInstalling || props.isGuest}
							/>
						</div>
					</SettingsCard>
				</Show>

				<Show when={!inst().modpackId}>
					<SettingsCard
						header={t("instances-versioning-core-config-title")}
						subHeader={t("instances-versioning-core-config-subheader")}
					>
						<SettingsField
							label={t("instances-versioning-modloader-label")}
							description={t("instances-versioning-modloader-description")}
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
							label={t("instances-versioning-mc-version-label")}
							description={t("instances-versioning-mc-version-description")}
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
									<SwitchLabel class={styles["version-snapshot-switch__label"]}>
										{t("instances-versioning-show-snapshots")}
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
									placeholder={t("instances-versioning-mc-version-placeholder")}
									itemComponent={(p) => (
										<ComboboxItem item={p.item}>
											{p.item.rawValue.id}
										</ComboboxItem>
									)}
								>
									<ComboboxControl
										aria-label={t("instances-versioning-version-picker-aria")}
									>
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
								label={t("instances-versioning-loader-version-label")}
								description={t("instances-versioning-loader-version-description")}
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
											placeholder={t(
												"instances-versioning-loader-version-placeholder",
											)}
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
																{t("instances-versioning-experimental-badge")}
															</span>
														</Show>
													</div>
												</ComboboxItem>
											)}
										>
											<ComboboxControl
												aria-label={t(
													"instances-versioning-loader-version-aria",
												)}
											>
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
									variant="shadow"
								>
									{t("instances-versioning-switch-engine")}
								</Button>
							</div>
						</Show>
					</SettingsCard>
				</Show>

				<Show when={inst().modpackId}>
				<SettingsCard
					header={t("instances-versioning-connection-title")}
					subHeader={t("instances-versioning-connection-subheader")}
				>
					<Show when={inst().modpackId}>
						<SettingsField
							label={t("instances-versioning-unlink-label")}
							description={t("instances-versioning-unlink-description")}
							actionLabel={t("instances-versioning-unlink-action")}
							destructive
							onAction={props.handleUnlink}
							disabled={props.busy || props.isInstalling || props.isGuest}
						/>
						<SettingsField
							label={t("instances-versioning-delete-unlink-label")}
							description={t("instances-versioning-delete-unlink-description")}
							actionLabel={t("instances-versioning-delete-unlink-action")}
							destructive
							onAction={props.handleDeleteModpackAndUnlink}
							disabled={props.busy || props.isInstalling || props.isGuest}
						/>
					</Show>
				</SettingsCard>
				</Show>
			</div>
		</div>
	);
};
