import { ModloaderSwitcher } from "@components/modloader-switcher/modloader-switcher";
import { LauncherDetailsPanel } from "@components/pages/mini-pages/install/components/LauncherDetailsPanel";
import { LauncherMenuGrid } from "@components/pages/mini-pages/install/components/LauncherMenuGrid";
import { launcherOptions } from "@components/pages/mini-pages/install/config/launcher-options";
import { useLauncherImport } from "@components/pages/mini-pages/install/hooks/use-launcher-import";
import { openModpackInstallFromUrl } from "@stores/modpack-install";
import { useMinecraftVersions } from "@stores/versions";
import { invoke } from "@tauri-apps/api/core";
import Button from "@ui/button/button";
import { IconPicker } from "@ui/icon-picker/icon-picker";
import {
	TextFieldInput,
	TextFieldLabel,
	TextFieldRoot,
} from "@ui/text-field/text-field";
import {
	type CreateInstanceData,
	createInstance,
	DEFAULT_ICONS,
	getStableIconId,
	type Instance,
	installInstance,
} from "@utils/instances";
import type { LauncherKind } from "@utils/launcher-imports";
import {
	getAllModloaders,
	getModloadersForGameVersion,
	resolveCompatibleVersionSelection,
} from "@utils/version-selection";
import {
	batch,
	createEffect,
	createMemo,
	createSignal,
	For,
	Show,
} from "solid-js";
import styles from "../init.module.css";

interface FirstInstanceStepProps {
	goNext: () => Promise<void>;
	goBack: () => Promise<void>;
	navigate: (to: string, options?: { replace?: boolean }) => void;
}

type FirstInstanceMode =
	| "menu"
	| "blank"
	| "modpack-picker"
	| "modpack-detail"
	| "import";

interface CuratedModpack {
	id: string;
	name: string;
	author: string;
	description: string;
	iconUrl: string | null;
	minecraftVersion: string;
	modloader: string;
	downloadCount: number;
	platform: "modrinth" | "curseforge";
}

function FirstInstanceStep(props: FirstInstanceStepProps) {
	const [mode, setMode] = createSignal<FirstInstanceMode>("menu");
	const [isInstalling, setIsInstalling] = createSignal(false);

	// Blank instance form state
	const [instanceName, setInstanceName] = createSignal("My First Instance");
	const [selectedVersion, setSelectedVersion] = createSignal<string>("");
	const [selectedModloader, setSelectedModloader] =
		createSignal<string>("vanilla");
	const [iconPath, setIconPath] = createSignal<string | null>(null);
	const [customIconsThisSession, setCustomIconsThisSession] = createSignal<
		string[]
	>([]);

	// Modpack picker state
	const [modpacks, setModpacks] = createSignal<CuratedModpack[]>([]);
	const [modpacksLoading, setModpacksLoading] = createSignal(false);
	const [modpacksError, setModpacksError] = createSignal("");
	const [installingModpackId, setInstallingModpackId] = createSignal<
		string | null
	>(null);
	const [selectedModpack, setSelectedModpack] =
		createSignal<CuratedModpack | null>(null);
	const [selectedImportLauncher, setSelectedImportLauncher] =
		createSignal<LauncherKind | null>(null);
	const [isDetectingLauncher, setIsDetectingLauncher] = createSignal(false);

	const launcherImport = useLauncherImport({
		selectedLauncherFromQuery: () => null,
		onImportSuccess: async () => {
			await completeOnboarding();
			await props.goNext();
		},
	});

	const handleSelectLauncher = async (kind: LauncherKind) => {
		setIsDetectingLauncher(true);
		try {
			await launcherImport.initializeLauncherDetails(kind);
		} finally {
			setIsDetectingLauncher(false);
		}
		setSelectedImportLauncher(kind);
	};

	const { versions: metadata } = useMinecraftVersions();

	createEffect(() => {
		const meta = metadata();
		if (meta && !selectedVersion()) {
			const latestRelease = meta.game_versions.find((v) => v.stable);
			if (latestRelease) {
				setSelectedVersion(latestRelease.id);
			}
		}
	});

	const uploadedIcons = createMemo(() => {
		const result = [...customIconsThisSession()];
		const current = iconPath();
		if (
			current &&
			!current.startsWith("default:") &&
			!result.includes(current)
		) {
			return [current, ...result];
		}
		return result;
	});

	createEffect(() => {
		const current = iconPath();
		if (current && !current.startsWith("default:")) {
			setCustomIconsThisSession((prev) => {
				if (prev.includes(current)) return prev;
				return [current, ...prev];
			});
		}
	});

	const availableModloaders = createMemo(() => {
		const meta = metadata();
		if (!meta) return ["vanilla"];
		return getAllModloaders(meta);
	});

	const currentVersionSupportedLoaders = createMemo(() => {
		const version = selectedVersion();
		const meta = metadata();
		if (!version || !meta) return ["vanilla"];
		return getModloadersForGameVersion(meta, version);
	});

	const modloaderSwitcherOptions = createMemo(() => {
		const supportedLoaders = currentVersionSupportedLoaders();
		return availableModloaders().map((loaderId) => ({
			value: loaderId,
			label: loaderId.charAt(0).toUpperCase() + loaderId.slice(1),
			supported: supportedLoaders.includes(loaderId.toLowerCase()),
		}));
	});

	createEffect(() => {
		const meta = metadata();
		const version = selectedVersion();
		if (!meta || !version) return;

		const resolved = resolveCompatibleVersionSelection({
			metadata: meta,
			minecraftVersion: version,
			modloader: selectedModloader(),
			includeSnapshots: false,
		});

		batch(() => {
			if (resolved.minecraftVersion !== version) {
				setSelectedVersion(resolved.minecraftVersion);
			}
			if (resolved.modloader !== selectedModloader()) {
				setSelectedModloader(resolved.modloader);
			}
		});
	});

	const fetchCuratedModpacks = async () => {
		setModpacksLoading(true);
		setModpacksError("");
		try {
			// Search for popular modpacks on Modrinth
			const response = await invoke<{
				hits: Array<{
					id: string;
					name: string;
					author: string;
					summary: string;
					icon_url: string | null;
					download_count: number;
				}>;
				total_hits: number;
			}>("search_resources", {
				platform: "modrinth",
				query: {
					text: null,
					resource_type: "modpack",
					offset: 0,
					limit: 10,
					game_version: null,
					loader: null,
					categories: null,
					sort_by: "downloads",
					sort_order: "desc",
				},
			});

			const curated: CuratedModpack[] = response.hits.map((hit) => ({
				id: hit.id,
				name: hit.name,
				author: hit.author,
				description: hit.summary,
				iconUrl: hit.icon_url,
				minecraftVersion: "",
				modloader: "",
				downloadCount: hit.download_count,
				platform: "modrinth",
			}));

			setModpacks(curated);
		} catch (e) {
			console.error("Failed to fetch curated modpacks:", e);
			setModpacksError(
				"Could not load modpacks. Please try again or create a blank instance.",
			);
		} finally {
			setModpacksLoading(false);
		}
	};

	const handleOpenModpackPicker = () => {
		setMode("modpack-picker");
		void fetchCuratedModpacks();
	};

	const handleSelectModpack = (modpack: CuratedModpack) => {
		setSelectedModpack(modpack);
		setMode("modpack-detail");
	};

	const handleInstallModpack = async (modpack: CuratedModpack) => {
		setInstallingModpackId(modpack.id);
		try {
			// Fetch versions to get download URL
			const versions = await invoke<
				Array<{
					id: string;
					version_number: string;
					game_versions: string[];
					loaders: string[];
					download_url: string;
					file_name: string;
					release_type: "release" | "beta" | "alpha";
				}>
			>("get_resource_versions", {
				platform: modpack.platform,
				projectId: modpack.id,
			});

			if (!versions || versions.length === 0) {
				throw new Error("No versions found for this modpack");
			}

			// Find latest stable version
			const latestVersion =
				versions.find((v) => v.release_type === "release") || versions[0];

			// Complete onboarding and go to finish step
			await completeOnboarding();
			await props.goNext();

			// Open install dialog
			openModpackInstallFromUrl(
				latestVersion.download_url,
				modpack.iconUrl || undefined,
				modpack.id,
				modpack.platform,
			);
		} catch (e) {
			console.error("Failed to install modpack:", e);
			setModpacksError(`Failed to install ${modpack.name}. Please try again.`);
		} finally {
			setInstallingModpackId(null);
		}
	};

	const handleInstallBlank = async () => {
		const name = instanceName().trim();
		const version = selectedVersion();
		if (!name || !version) return;

		setIsInstalling(true);
		try {
			const instanceData: CreateInstanceData = {
				name,
				minecraftVersion: version,
				iconPath: iconPath() || undefined,
				modloader:
					selectedModloader() === "vanilla" ? undefined : selectedModloader(),
				minMemory: 2048,
				maxMemory: 4096,
			};

			const instanceId = await createInstance(instanceData);
			const fullInstance: Instance = {
				id: instanceId,
				name,
				minecraftVersion: version,
				modloader:
					selectedModloader() === "vanilla" ? null : selectedModloader(),
				modloaderVersion: null,
				javaPath: null,
				javaArgs: null,
				gameDirectory: null,
				gameWidth: 854,
				gameHeight: 480,
				minMemory: 2048,
				maxMemory: 4096,
				iconPath: iconPath(),
				lastPlayed: null,
				totalPlaytimeMinutes: 0,
				createdAt: null,
				updatedAt: null,
				installationStatus: "pending",
				modpackId: null,
				modpackVersionId: null,
				modpackPlatform: null,
				modpackIconUrl: null,
				iconData: null,
				useGlobalResolution: true,
				useGlobalJavaArgs: true,
				useGlobalJavaPath: true,
				useGlobalHooks: true,
				useGlobalEnvironmentVariables: true,
				useGlobalGameDir: true,
				useGlobalLauncherAction: true,
				launcherActionOnLaunch: null,
				environmentVariables: null,
				preLaunchHook: null,
				postExitHook: null,
				wrapperCommand: null,
			};

			// Start installation in background, continue onboarding immediately
			installInstance(fullInstance).catch((error) => {
				console.error("[Onboarding] Background install failed:", error);
			});
			await completeOnboarding();
			await props.goNext();
		} catch (error) {
			console.error("[Onboarding] Installation failed:", error);
		} finally {
			setIsInstalling(false);
		}
	};

	const handleSkip = async () => {
		await completeOnboarding();
		await props.goNext();
	};

	const completeOnboarding = async () => {
		try {
			await invoke("complete_onboarding");
		} catch (e) {
			console.error("Failed to complete onboarding:", e);
		}
	};

	const formatDownloads = (count: number) => {
		if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
		if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
		return String(count);
	};

	const menuOptions = [
		{
			id: "browse" as const,
			title: "Browse Modpacks",
			description: "Discover curated packs from Modrinth and CurseForge",
			icon: <SearchIcon width="32" height="32" stroke-width="1.5" />,
			action: () => handleOpenModpackPicker(),
		},
		{
			id: "import" as const,
			title: "Import from Launcher",
			description: "Bring in instances from CurseForge, Prism, and others",
			icon: <UploadIcon width="32" height="32" stroke-width="1.5" />,
			action: () => setMode("import"),
		},
		{
			id: "blank" as const,
			title: "Blank Instance",
			description: "Start from scratch with any version and modloader",
			icon: <AddIcon width="32" height="32" stroke-width="1.5" />,
			action: () => setMode("blank"),
		},
	];

	return (
		<div class={styles["first-instance-step"]}>
			<Show when={mode() === "menu"} keyed>
				<div
					class={`${styles["first-instance-menu"]} ${styles["panel--enter"]}`}
				>
					<div class={styles["first-instance-header"]}>
						<h2 class={styles["first-instance-title"]}>Your First Instance</h2>
						<p class={styles["first-instance-subtitle"]}>
							How would you like to get started?
						</p>
					</div>

					<div class={styles["first-instance-options"]}>
						{menuOptions.map((option) => (
							<button
								class={styles["first-instance-option"]}
								onClick={option.action}
							>
								<div class={styles["first-instance-option-icon"]}>
									{option.icon}
								</div>
								<div class={styles["first-instance-option-text"]}>
									<span class={styles["first-instance-option-title"]}>
										{option.title}
									</span>
									<span class={styles["first-instance-option-desc"]}>
										{option.description}
									</span>
								</div>
							</button>
						))}
					</div>

					<div class={styles["first-instance-footer"]}>
						<button class={styles["first-instance-skip"]} onClick={handleSkip}>
							Skip for now
						</button>
					</div>
				</div>
			</Show>

			<Show when={mode() === "modpack-picker"} keyed>
				<div class={`${styles["modpack-picker"]} ${styles["panel--enter"]}`}>
					<div class={styles["modpack-picker-header"]}>
						<button
							class={styles["first-instance-back"]}
							onClick={() => setMode("menu")}
						>
							<ChevronLeftIcon width="16" height="16" stroke-width="2.5" />
							Back
						</button>
						<h3 class={styles["modpack-picker-title"]}>Popular Modpacks</h3>
						<p class={styles["modpack-picker-subtitle"]}>
							Hand-picked modpacks from the community
						</p>
					</div>

					<Show when={modpacksLoading()}>
						<div class={styles["modpack-picker-loading"]}>
							<div class={styles["spinner--small"]} />
							<span>Loading modpacks...</span>
						</div>
					</Show>

					<Show when={modpacksError()}>
						<div class={styles["modpack-picker-error"]}>{modpacksError()}</div>
					</Show>

					<div class={styles["modpack-grid"]}>
						<For each={modpacks()}>
							{(modpack) => (
								<button
									class={styles["modpack-card"]}
									onClick={() => handleSelectModpack(modpack)}
									disabled={installingModpackId() !== null}
								>
									<div class={styles["modpack-card-icon"]}>
										<Show
											when={modpack.iconUrl}
											fallback={
												<div class={styles["modpack-card-icon-placeholder"]}>
													<ModpackIcon width="28" height="28" />
												</div>
											}
										>
											{(iconUrl) => (
												<img
													src={iconUrl()}
													alt={modpack.name}
													loading="lazy"
												/>
											)}
										</Show>
									</div>
									<span class={styles["modpack-card-name"]}>
										{modpack.name}
									</span>
								</button>
							)}
						</For>
					</div>
				</div>
			</Show>

			<Show when={mode() === "modpack-detail" && selectedModpack()} keyed>
				{(modpack) => (
					<div class={`${styles["modpack-detail"]} ${styles["panel--enter"]}`}>
						<button
							class={styles["first-instance-back"]}
							onClick={() => setMode("modpack-picker")}
						>
							<ChevronLeftIcon width="16" height="16" stroke-width="2.5" />
							Back
						</button>

						<div class={styles["modpack-detail-hero"]}>
							<div class={styles["modpack-detail-icon"]}>
								<Show
									when={modpack.iconUrl}
									fallback={
										<div class={styles["modpack-card-icon-placeholder"]}>
											<ModpackIcon width="40" height="40" />
										</div>
									}
								>
									{(iconUrl) => (
										<img src={iconUrl()} alt={modpack.name} loading="lazy" />
									)}
								</Show>
							</div>
							<h3 class={styles["modpack-detail-name"]}>{modpack.name}</h3>
							<p class={styles["modpack-detail-author"]}>by {modpack.author}</p>
						</div>

						<p class={styles["modpack-detail-desc"]}>{modpack.description}</p>

						<div class={styles["modpack-detail-meta"]}>
							<span>
								<DownloadIcon width="14" height="14" />
								{formatDownloads(modpack.downloadCount)} downloads
							</span>
						</div>

						<div class={styles["modpack-detail-actions"]}>
							<Button
								color="primary"
								size="lg"
								onClick={() => void handleInstallModpack(modpack)}
								disabled={installingModpackId() !== null}
							>
								<Show
									when={installingModpackId() !== modpack.id}
									fallback={
										<div
											style={{
												display: "flex",
												"align-items": "center",
												gap: "8px",
											}}
										>
											<div class={styles["spinner--small"]} />
											Installing...
										</div>
									}
								>
									Install Modpack
								</Show>
							</Button>
						</div>
					</div>
				)}
			</Show>

			<Show when={mode() === "import"} keyed>
				<div
					class={`${styles["first-instance-import"]} ${styles["panel--enter"]}`}
				>
					<div class={styles["first-instance-form-header"]}>
						<button
							class={styles["first-instance-back"]}
							onClick={() => {
								if (selectedImportLauncher()) {
									setSelectedImportLauncher(null);
								} else {
									setMode("menu");
								}
							}}
						>
							<ChevronLeftIcon width="16" height="16" stroke-width="2.5" />
							Back
						</button>
						<h3 class={styles["first-instance-form-title"]}>
							{selectedImportLauncher()
								? "Import Instance"
								: "Import from Launcher"}
						</h3>
					</div>

					<Show
						when={selectedImportLauncher()}
						fallback={
							<Show
								when={!isDetectingLauncher()}
								fallback={
									<div class={styles["import-detecting"]}>
										<div class={styles["spinner--small"]} />
										<span>Detecting launcher...</span>
									</div>
								}
							>
								<LauncherMenuGrid
									launchers={launcherOptions}
									onSelect={handleSelectLauncher}
								/>
							</Show>
						}
					>
						<LauncherDetailsPanel
							basePath={launcherImport.launcherBasePath()}
							instances={launcherImport.launcherInstances()}
							selectedInstancePath={launcherImport.selectedInstancePath()}
							hasScanned={launcherImport.hasScannedLauncherInstances()}
							isLoading={launcherImport.isLoadingLauncherInstances()}
							isImporting={launcherImport.isImportingLauncher()}
							onPathChange={launcherImport.setLauncherBasePath}
							onBrowse={launcherImport.handleLauncherFolderPick}
							onRescan={() => launcherImport.loadLauncherInstances()}
							onSelectInstance={launcherImport.setSelectedInstancePath}
							onImport={launcherImport.handleImportLauncherInstance}
						/>
					</Show>
				</div>
			</Show>

			<Show when={mode() === "blank"} keyed>
				<div
					class={`${styles["first-instance-form"]} ${styles["panel--enter"]}`}
				>
					<div class={styles["first-instance-form-header"]}>
						<button
							class={styles["first-instance-back"]}
							onClick={() => setMode("menu")}
						>
							<ChevronLeftIcon width="16" height="16" stroke-width="2.5" />
							Back
						</button>
						<h3 class={styles["first-instance-form-title"]}>Blank Instance</h3>
					</div>

					<div class={styles["first-instance-form-body"]}>
						<div class={styles["first-instance-form-row"]}>
							<IconPicker
								value={
									iconPath() ||
									getStableIconId(DEFAULT_ICONS[0]) ||
									DEFAULT_ICONS[0]
								}
								onSelect={setIconPath}
								uploadedIcons={uploadedIcons()}
								showHint={true}
							/>
							<div class={styles["first-instance-form-fields"]}>
								<TextFieldRoot>
									<TextFieldLabel class={styles["first-instance-label"]}>
										Instance Name
									</TextFieldLabel>
									<TextFieldInput
										value={instanceName()}
										onInput={(e) =>
											setInstanceName((e.target as HTMLInputElement).value)
										}
										placeholder="Enter instance name..."
										style={{ background: "var(--surface-sunken)" }}
									/>
								</TextFieldRoot>

								<div>
									<label class={styles["first-instance-label"]}>
										Modloader
									</label>
									<ModloaderSwitcher
										options={modloaderSwitcherOptions()}
										value={selectedModloader()}
										onChange={setSelectedModloader}
									/>
								</div>
							</div>
						</div>
					</div>

					<div class={styles["first-instance-form-footer"]}>
						<Button
							color="primary"
							onClick={handleInstallBlank}
							disabled={isInstalling() || !instanceName() || !selectedVersion()}
						>
							{isInstalling() ? "Creating..." : "Create Instance"}
						</Button>
					</div>
				</div>
			</Show>
		</div>
	);
}

export default FirstInstanceStep;
import AddIcon from "@assets/icons/actions/add.svg";
import DownloadIcon from "@assets/icons/actions/download.svg";
import UploadIcon from "@assets/icons/actions/upload.svg";
import ModpackIcon from "@assets/icons/content/modpack.svg";
import SearchIcon from "@assets/icons/content/search.svg";
import ChevronLeftIcon from "@assets/icons/controls/chevron-left.svg";
