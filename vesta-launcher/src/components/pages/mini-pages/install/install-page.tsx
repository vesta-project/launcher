import {
	createSignal,
	Show,
	createMemo,
	onMount,
	createEffect,
	batch,
	createResource
} from "solid-js";
import { showToast } from "@ui/toast/toast";
import {
	createInstance,
	installInstance,
	getInstance,
} from "@utils/instances";
import { type Instance } from "@utils/instances";
import { router } from "@components/page-viewer/page-viewer";
import { open } from "@tauri-apps/plugin-dialog";
import { 
	getModpackInfo, 
	getModpackInfoFromUrl, 
	installModpackFromUrl, 
	installModpackFromZip, 
	ModpackInfo 
} from "@utils/modpacks";
import { resources, SourcePlatform, ResourceVersion } from "@stores/resources";
import { InstallForm } from "./components/InstallForm";
import SearchIcon from "@assets/search.svg";
import GlobeIcon from "@assets/earth-globe.svg";
import CubeIcon from "@assets/cube.svg";
import "./install-page.css";

interface InstallPageProps {
	close?: () => void;
	// Routing Params
	projectId?: string;
	platform?: string;
	projectName?: string;
	projectIcon?: string;
	projectAuthor?: string;
	resourceType?: string;
	// Modpack Specific
	isModpack?: boolean;
	modpackUrl?: string;
	modpackPath?: string;
	initialName?: string;
	initialVersion?: string;
	initialModloader?: string;
	initialModloaderVersion?: string;
	initialIcon?: string;
	originalIcon?: string;
	initialMinMemory?: number;
	initialMaxMemory?: number;
	initialJvmArgs?: string;
	initialResW?: string;
	initialResH?: string;
	initialIncludeSnapshots?: boolean;
}

/**
 * InstallPage handles the high-level state of creating a new instance.
 * It manages:
 * 1. Mode (Standard vs Modpack)
 * 2. Source selection (Local, URL, or Browse)
 * 3. Metadata fetching for modpacks
 * 4. Communication with the InstallForm
 */
function InstallPage(props: InstallPageProps) {
	// Derive states from router params for navigable history
	const isModpackMode = createMemo(() => {
		const params = router()?.currentParams.get();
		if (params?.mode === "modpack") return true;
		if (params?.mode === "standard") return false;

		const isModpack = props.isModpack;
		const resType = props.resourceType?.toLowerCase();
		return (
			String(isModpack) === "true" || 
			isModpack === true ||
			!!props.modpackUrl || 
			!!props.modpackPath || 
			resType === "modpack" ||
			resType === "modpacks"
		);
	});

	const showUrlInput = createMemo(() => {
		return router()?.currentParams.get()?.sourceView === "url";
	});

	// --- Fundamental State ---
	const [isInstalling, setIsInstalling] = createSignal(false);
	const [isFetchingMetadata, setIsFetchingMetadata] = createSignal(false);

	// Modpack source tracking
	const [modpackUrl, setModpackUrl] = createSignal(props.modpackUrl || "");
	const [modpackPath, setModpackPath] = createSignal(props.modpackPath || "");
	const [modpackInfo, setModpackInfo] = createSignal<ModpackInfo | undefined>();

	// The "Original" icon for the picker (persists even if user changes selection)
	const originalIcon = createMemo(() => props.originalIcon || modpackInfo()?.iconUrl || props.projectIcon || undefined);

	// --- Form Capture ---
	const [formState, setFormState] = createSignal<Partial<Instance>>({});

	onMount(() => {
		// Register state provider for pop-out
		router()?.registerStateProvider("/install", () => ({
			...props, // Include routing params
			modpackUrl: modpackUrl(),
			modpackPath: modpackPath(),
			selectedModpackVersionId: selectedModpackVersionId(),
			// Pass the live form state as a single object to simplify persistence
			initialData: formState(),
			originalIcon: originalIcon(),
		}));
	});

	// UI Toggles
	const [urlInputValue, setUrlInputValue] = createSignal("");
	const [selectedModpackVersionId, setSelectedModpackVersionId] = createSignal("");

	// --- Derived UI States ---
	// These prevent layout flickering between state updates
	const shouldShowOverlay = createMemo(() => {
		// If we HAVE a source but don't have modpack info yet, we are analyzing
		const hasSource = !!(modpackUrl() || modpackPath());
		const hasInfo = !!modpackInfo();
		
		if (isModpackMode() && hasSource && !hasInfo && !props.projectName) return true;
		
		// If we're loading project versions from the browser and don't have a name yet
		if (isModpackMode() && props.projectId && projectVersions.loading && !props.projectName) return true;
		
		return false;
	});

	const shouldShowForm = createMemo(() => {
		// Always show form in standard mode
		if (!isModpackMode()) return true;
		// Show if we have modpack metadata
		if (modpackInfo()) return true;
		// Show if we have initial project context (browser install)
		if (props.projectName) return true;
		return false;
	});

	// --- Resource: Fetch Platform Versions (Remote Repos) ---
	const [projectVersions] = createResource(
		() => {
			// [FIX] Never fetch versions for a local file import. 
			// We only support version switching for Browser or URL imports.
			if (modpackPath()) return null;

			const pId = props.projectId || modpackInfo()?.modpackId;
			const pPlatform = props.platform || modpackInfo()?.modpackPlatform;
			
			if (pId && pPlatform) {
				return { id: pId, platform: pPlatform };
			}
			return null;
		},
		async ({ id, platform }: { id: string, platform: string }) => {
			try {
				const vs = await resources.getVersions(platform as SourcePlatform, id);
				// Sync selection if we have an initial URL matched up
				const currentUrl = modpackUrl();
				const info = modpackInfo();
				const initialVer = props.initialVersion || info?.modpackVersionId;

				if (initialVer) {
					const match = vs.find((v: ResourceVersion) => v.id === initialVer || v.version_number === initialVer);
					if (match) {
						setSelectedModpackVersionId(match.id);
						return vs;
					}
				}

				if (currentUrl) {
					const match = vs.find((v: ResourceVersion) => v.download_url === currentUrl);
					if (match) {
						setSelectedModpackVersionId(match.id);
						return vs;
					}
				} 
				
				if (vs.length > 0 && isModpackMode()) {
					// Auto-select latest if no specific match found
					let target = vs[0];
					
					batch(() => {
						setSelectedModpackVersionId(target.id);
						setModpackUrl(target.download_url);
					});
				}
				return vs;
			} catch (e) {
				console.error("[InstallPage] Version fetch failed:", e);
				return [];
			}
		}
	);

	// --- Effect: Reactive Metadata Sync ---
	// Whenever the modpack source changes, fetch its info.
	createEffect(() => {
		const url = modpackUrl();
		const path = modpackPath();

		if (!url && !path) {
			setModpackInfo(undefined);
			return;
		}

		const fetchDetails = async () => {
			setIsFetchingMetadata(true);
			try {
				const info = url 
					? await getModpackInfoFromUrl(url, props.projectId, props.platform) 
					: await getModpackInfo(path, props.projectId, props.platform);
				
				setModpackInfo(info);
			} catch (err) {
				console.error("[InstallPage] Metadata fetch error:", err);
				
				// Fallback: If we have project metadata, we can construct a partial ModpackInfo
				// This allows the UI to still function even if the ZIP reading fails.
				if (props.projectId || props.projectName) {
					// If versions are still loading, wait a bit or try to find them
					let vs = projectVersions();
					if (!vs && projectVersions.loading) {
						console.log("[InstallPage] Waiting for project versions to settle for fallback...");
						// We don't want to block progress too much, but a small delay help
					}

					const initialVerId = props.initialVersion || selectedModpackVersionId();
					const selectedVer = vs?.find((v: ResourceVersion) => v.id === initialVerId || v.version_number === initialVerId) || vs?.[0];
					
					setModpackInfo({
						name: props.projectName || "Unknown Modpack",
						version: selectedVer?.version_number || props.initialVersion || "1.0.0",
						author: props.projectAuthor || "", 
						description: null,
						iconUrl: props.projectIcon || null,
						minecraftVersion: selectedVer?.game_versions[0] || props.initialModloaderVersion || "",
						modloader: (selectedVer?.loaders[0] as any) || props.initialModloader || "vanilla",
						modloaderVersion: null,
						modCount: 0,
						format: "unknown"
					});
					console.warn("[InstallPage] Using constructed fallback metadata due to fetch failure for:", props.projectName);
				} else {
					showToast({
						title: "Metadata Sync Failed",
						description: "Could not read modpack metadata from the provided source. Check your selection.",
						severity: "Warning"
					});
					// Reset the source so we go back to the selection page
					batch(() => {
						setModpackUrl("");
						setModpackPath("");
					});
				}
			} finally {
				setIsFetchingMetadata(false);
			}
		};

		fetchDetails();
	});

	// --- Actions ---

	const handleModpackVersionChange = (versionId: string) => {
		const vs = projectVersions();
		const target = vs?.find((v: ResourceVersion) => v.id === versionId);
		if (target) {
			setSelectedModpackVersionId(versionId);
			setModpackUrl(target.download_url);
			// createEffect above will handle the rest
		}
	};

	const handleInstall = async (data: Partial<Instance>) => {
		setIsInstalling(true);
		
		try {
			if (isModpackMode() && (modpackUrl() || modpackPath())) {
				const sourceUrl = modpackUrl();
				const sourcePath = modpackPath();
				const info = modpackInfo();
				const fullMetadata = info?.fullMetadata;
				
				if (sourceUrl) {
					console.log(`[Install] Fetching modpack from URL: ${sourceUrl}`);
					await installModpackFromUrl(sourceUrl, data, fullMetadata);
				} else if (sourcePath) {
					console.log(`[Install] Installing modpack from local file: ${sourcePath}`);
					await installModpackFromZip(sourcePath, data, fullMetadata);
				}
				
				showToast({ title: "Install Started", description: `Installing modpack: ${data.name}`, severity: "Success" });
			} else {
				const id = await createInstance(data as any);
				if (id) {
					const instance = await getInstance(id);
					await installInstance(instance);
					showToast({ title: "Created", description: `Created instance: ${data.name}`, severity: "Success" });
				}
			}

			// Navigate back after starting
			setTimeout(() => {
				if (props.close) props.close();
				else router()?.navigate("/home");
			}, 500);
		} catch (e) {
			console.error("[Install] ERROR:", e);
			showToast({ title: "Failed", description: String(e), severity: "Error" });
			setIsInstalling(false);
		}
	};

	const handleLocalImport = async () => {
		try {
			const res = await open({
				multiple: false,
				filters: [{ name: "Modpack", extensions: ["zip", "mrpack"] }]
			});
			if (res && typeof res === "string") {
				setModpackPath(res);
				setModpackUrl("");
			}
		} catch (e) {
			console.error("[InstallPage] Import error:", e);
		}
	};

	const handleUrlSubmit = () => {
		const val = urlInputValue().trim();
		if (val) {
			setModpackUrl(val);
			setModpackPath("");
			router()?.removeQuery("source");
			setUrlInputValue("");
		}
	};

	// --- Filtering & Logic Memos ---

	const supportedMcVersions = createMemo(() => {
		const info = modpackInfo();
		// If we have a source, we are locked to its version.
		if (info && (modpackUrl() || modpackPath())) return [info.minecraftVersion];
		// If browsing a project, show all its available versions
		return projectVersions()?.flatMap((v: ResourceVersion) => v.game_versions) || undefined;
	});

	const supportedModloaders = createMemo(() => {
		const info = modpackInfo();
		if (info && (modpackUrl() || modpackPath())) return [info.modloader.toLowerCase()];
		
		const vs = projectVersions();
		if (vs && vs.length > 0) {
			const set = new Set(["vanilla"]);
			vs.forEach((v: ResourceVersion) => v.loaders.forEach((l: string) => set.add(l.toLowerCase())));
			return Array.from(set);
		}
		return undefined;
	});

	return (
		<div class="page-root">
			<Show when={!(props.projectId || modpackUrl() || modpackPath() || isModpackMode())}>
				<header class="install-page-header">
					<div class="header-text">
						<h1>{isModpackMode() ? "Install Modpack" : "New Instance"}</h1>
						<p>{isModpackMode() ? "Install a pre-configured modpack." : "Create a clean slate and customize it."}</p>
					</div>
					
					<Show when={!props.projectId && !props.modpackUrl && !props.modpackPath && !modpackUrl() && !modpackPath() && !isFetchingMetadata()}>
						<button class="quick-install-pill" onClick={() => router()?.updateQuery("mode", isModpackMode() ? "standard" : "modpack", true)}>
							<span class="pill-text">{isModpackMode() ? "Standard Instance" : "Install Modpack"}</span>
						</button>
					</Show>
				</header>
			</Show>

			<div class="page-wrapper">
				{/* Context Banner (e.g. "Installing Fabulous Optimized") */}
				<Show when={(props.projectName || modpackPath() || modpackUrl()) && !shouldShowOverlay()}>
					<div class="install-resource-context">
						<button class="back-link" onClick={() => {
							if (props.projectId) {
								router()?.backwards();
							} else {
								batch(() => {
									setModpackUrl("");
									setModpackPath("");
									setModpackInfo(undefined);
								});
							}
						}}>
							{props.projectId ? "Back to Browser" : "Back to Source"}
						</button>
						<div class="resource-pill">
							<Show when={props.projectIcon || modpackInfo()?.iconUrl}>
								<img src={(props.projectIcon || modpackInfo()?.iconUrl) ?? undefined} alt="" />
							</Show>
							<div class="resource-info">
								<span class="resource-label">
									{props.resourceType || (isModpackMode() ? "Modpack" : "Package")}
								</span>
								<div class="resource-name-row">
									<span 
										class="resource-name"
										classList={{ "is-analyzing": !modpackInfo() && !props.projectName }}
									>
										{props.projectName || modpackInfo()?.name || "Analyzing modpack details..."}
									</span>
									<Show when={modpackInfo() || (props.initialVersion && props.initialModloader)}>
										<div class="resource-meta">
											<span class="meta-tag">{modpackInfo()?.minecraftVersion || props.initialVersion}</span>
											<span class="meta-tag capitalize">{modpackInfo()?.modloader || props.initialModloader}</span>
										</div>
									</Show>
								</div>
							</div>
						</div>
					</div>
				</Show>

				{/* Source Selection (Only if we don't have a source yet and we're in modpack mode) */}
				<Show when={isModpackMode() && !modpackUrl() && !modpackPath() && !isFetchingMetadata() && !props.projectId}>
					<div class="import-selection-wrapper">
						<Show when={!showUrlInput()}>
							<div class="import-header">
								<h1>Install Modpack</h1>
								<p>Choose an installation source to get started.</p>
							</div>

							<div class="modpack-import-container">
								<div class="modpack-import-card" onClick={handleLocalImport}>
									<div class="card-icon">
										<CubeIcon />
									</div>
									<div class="card-content">
										<div class="title">Local File</div>
										<div class="description">Upload .zip or .mrpack</div>
									</div>
								</div>
								<div class="modpack-import-card" onClick={() => { resources.setType('modpack'); router()?.navigate("/resources"); }}>
									<div class="card-icon">
										<SearchIcon />
									</div>
									<div class="card-content">
										<div class="title">Explore</div>
										<div class="description">Browse Modrinth & CF</div>
									</div>
								</div>
								<div class="modpack-import-card" onClick={() => router()?.updateQuery("source", "url", true)}>
									<div class="card-icon is-stroke">
										<GlobeIcon />
									</div>
									<div class="card-content">
										<div class="title">From URL</div>
										<div class="description">Direct download link</div>
									</div>
								</div>
							</div>

							<div class="import-footer">
								<button class="switch-mode-button" onClick={() => router()?.updateQuery("mode", "standard", true)}>
									Switch to Standard Instance
								</button>
							</div>
						</Show>

						<Show when={showUrlInput()}>
							<div class="url-input-container">
								<div class="url-input-header">
									<div class="card-icon is-stroke">
										<GlobeIcon />
									</div>
									<h3>Enter Download Link</h3>
									<p>Paste a CurseForge, Modrinth, or direct ZIP/MRPACK link.</p>
								</div>
								<div class="url-input-row">
									<input 
										type="text" 
										placeholder="https://example.com/pack.zip" 
										value={urlInputValue()} 
										onInput={(e) => setUrlInputValue(e.currentTarget.value)}
										onKeyDown={(e) => e.key === "Enter" && handleUrlSubmit()}
										autofocus
									/>
									<button class="import-button" onClick={handleUrlSubmit} disabled={!urlInputValue()}>Continue</button>
								</div>
								<button class="cancel-link" onClick={() => router()?.removeQuery("source")}>Go Back</button>
							</div>
						</Show>
					</div>
				</Show>

					{/* Loading / Fetching State (Initial) */}
				{/* We only show the full-page fetching overlay if we don't have a project name to show the form for yet */}
				<Show when={shouldShowOverlay()}>
					<div class="fetching-metadata-container">
						<div class="fetching-overlay">
							<div class="spinner" />
							<p>{projectVersions.loading ? "Loading available versions..." : "Fetching modpack details..."}</p>
							<Show when={!projectVersions.loading}>
								<span class="fetching-subtext">This usually takes a few seconds as we verify the pack manifest.</span>
							</Show>
						</div>
					</div>
				</Show>

				{/* Configuration Form */}
				{/* We show the form as soon as we have some basic context, or if we are not in modpack mode. */}
				<Show when={shouldShowForm() && (!isModpackMode() || modpackUrl() || modpackPath() || props.projectId)}>
					<InstallForm 
						isModpack={isModpackMode()}
						isLocalImport={!!modpackPath()}
						modpackInfo={modpackInfo()}
						modpackVersions={projectVersions() ?? []}
						selectedModpackVersionId={selectedModpackVersionId()}
						onModpackVersionChange={handleModpackVersionChange}
						supportedMcVersions={supportedMcVersions()}
						supportedModloaders={supportedModloaders()}
						onStateChange={setFormState}
						
						projectId={props.projectId}
						platform={props.platform}
						
						// Primary state source for persistence/handoff
						initialData={(props as any).initialData}

						// Fallback Mapping (Used for initial route parameters or metadata)
						initialName={props.initialName || modpackInfo()?.name || props.projectName}
						initialAuthor={modpackInfo()?.author || props.projectAuthor || undefined}
						initialIcon={props.initialIcon || modpackInfo()?.iconUrl || props.projectIcon || undefined}
						originalIcon={originalIcon()}
						initialVersion={props.initialVersion || modpackInfo()?.minecraftVersion}
						initialModloader={props.initialModloader || modpackInfo()?.modloader}
						initialModloaderVersion={modpackInfo()?.modloaderVersion || props.initialModloaderVersion || undefined}
						initialIncludeSnapshots={props.initialIncludeSnapshots}
						initialMinMemory={props.initialMinMemory}
						initialMaxMemory={props.initialMaxMemory}
						initialJvmArgs={props.initialJvmArgs}
						initialResW={props.initialResW}
						initialResH={props.initialResH}
						
						onInstall={handleInstall}
						onCancel={() => {
							if (isModpackMode() && (modpackUrl() || modpackPath())) {
								batch(() => { setModpackUrl(""); setModpackPath(""); setModpackInfo(undefined); });
							} else if (props.close) props.close();
							else router()?.navigate(props.projectName ? "/resources" : "/home");
						}}
						isInstalling={isInstalling()}
						isFetchingMetadata={isFetchingMetadata() || projectVersions.loading}
					/>
				</Show>
			</div>
		</div>
	);
}

export default InstallPage;



