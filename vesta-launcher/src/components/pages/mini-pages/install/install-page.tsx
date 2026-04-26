import { router } from "@components/page-viewer/page-viewer";
import { resources } from "@stores/resources";
import type { Instance } from "@utils/instances";
import { createMemo, createSignal, onMount, Show } from "solid-js";
import GlobeIcon from "@assets/earth-globe.svg";
import { launcherOptions, launcherVisualMap } from "./config/launcher-options";
import { FetchingOverlay } from "./components/FetchingOverlay";
import { InstallContextBanner } from "./components/InstallContextBanner";
import { InstallForm } from "./components/InstallForm";
import { InstallPageHeader } from "./components/InstallPageHeader";
import { InstallStageHeader } from "./components/InstallStageHeader";
import { LauncherDetailsPanel } from "./components/LauncherDetailsPanel";
import { LauncherMenuGrid } from "./components/LauncherMenuGrid";
import { SourceOptionsGrid } from "./components/SourceOptionsGrid";
import { UrlSourcePanel } from "./components/UrlSourcePanel";
import { useInstallCapabilities } from "./hooks/use-install-capabilities";
import { useInstallRouteState } from "./hooks/use-install-route-state";
import { useInstallSubmit } from "./hooks/use-install-submit";
import { useLauncherImport } from "./hooks/use-launcher-import";
import { useModpackSource } from "./hooks/use-modpack-source";
import { useProjectVersions } from "./hooks/use-project-versions";
import styles from "./install-page.module.css";
import type { InstallPageRouteProps } from "./types";

function InstallPage(props: InstallPageRouteProps) {
	const [formState, setFormState] = createSignal<Partial<Instance>>({});
	const [selectedModpackVersionId, setSelectedModpackVersionId] = createSignal("");

	const source = useModpackSource({
		projectId: props.projectId,
		platform: props.platform,
		projectName: props.projectName,
		projectIcon: props.projectIcon,
		projectAuthor: props.projectAuthor,
		initialVersion: props.initialVersion,
		initialModloader: props.initialModloader,
		initialModloaderVersion: props.initialModloaderVersion,
		originalIcon: props.originalIcon,
		modpackUrl: props.modpackUrl,
		modpackPath: props.modpackPath,
		selectedModpackVersionId,
	});

	let installStateAccessor: () => boolean = () => false;
	const routeState = useInstallRouteState({
		isModpackFlag: props.isModpack,
		resourceType: props.resourceType,
		modpackUrl: props.modpackUrl,
		modpackPath: props.modpackPath,
		activeRouterProp: props.router,
		isFetchingMetadata: source.isFetchingMetadata,
		hasSource: () => !!(source.modpackUrl() || source.modpackPath()),
		hasProjectContext: () => !!props.projectId,
		isInstalling: () => installStateAccessor(),
	});

	const install = useInstallSubmit({
		close: props.close,
		navigateHome: () => (props.router || router())?.navigate("/home"),
		isModpackMode: routeState.isModpackMode,
		modpackUrl: source.modpackUrl,
		modpackPath: source.modpackPath,
		modpackInfo: source.modpackInfo as any,
	});
	installStateAccessor = install.isInstalling;

	const { projectVersions, handleModpackVersionChange } = useProjectVersions({
		isModpackMode: routeState.isModpackMode,
		modpackPath: source.modpackPath,
		modpackUrl: source.modpackUrl,
		modpackInfo: source.modpackInfo as any,
		projectId: props.projectId,
		platform: props.platform,
		initialVersion: props.initialVersion,
		selectedModpackVersionId,
		setSelectedModpackVersionId,
		setModpackUrl: source.setModpackUrl,
	});

	const launcherImport = useLauncherImport({
		selectedLauncherFromQuery: routeState.selectedLauncherFromQuery,
		showLauncherDetails: () => routeState.step() === "launcherDetails",
		onImportSuccess: () => (props.close ? props.close() : router()?.navigate("/home")),
	});

	const capabilities = useInstallCapabilities({
		modpackInfo: source.modpackInfo as any,
		modpackUrl: source.modpackUrl,
		modpackPath: source.modpackPath,
		projectVersions: () => projectVersions() ?? [],
	});

	onMount(() => {
		routeState.activeRouter()?.registerStateProvider("/install", () => ({
			...props,
			modpackUrl: source.modpackUrl(),
			modpackPath: source.modpackPath(),
			selectedModpackVersionId: selectedModpackVersionId(),
			initialData: formState(),
			originalIcon: source.originalIcon(),
		}));
	});

	const showGlobalHeader = createMemo(
		() =>
			!props.projectId &&
			!source.modpackUrl() &&
			!source.modpackPath() &&
			!source.isFetchingMetadata() &&
			(routeState.step() === "sourceSelect" ||
				routeState.step() === "urlInput" ||
				routeState.step() === "launcherSelect" ||
				routeState.step() === "launcherDetails" ||
				(!routeState.isModpackMode() && routeState.step() === "form")),
	);
	const activeLauncherVisual = createMemo(() => launcherVisualMap.get(routeState.selectedLauncherFromQuery() ?? launcherImport.activeLauncherKind()));
	const shouldShowOverlay = createMemo(() => routeState.step() === "metadataLoading");
	const shouldShowForm = createMemo(() => routeState.step() === "form" || routeState.step() === "submitting");

	return <div class={styles["page-root"]}>
		<Show when={showGlobalHeader()}>
			<Show
				when={routeState.step() === "urlInput" || routeState.step() === "launcherSelect" || routeState.step() === "launcherDetails"}
				fallback={
					<InstallPageHeader isModpackMode={routeState.isModpackMode()} onToggleMode={() => routeState.dispatch("toggleMode")} />
				}
			>
				<InstallStageHeader
					title={
						routeState.step() === "urlInput"
							? "Enter Download Link"
							: routeState.step() === "launcherSelect"
								? "Launcher Import"
								: activeLauncherVisual()?.label ?? "Launcher Import"
					}
					description={
						routeState.step() === "urlInput"
							? "Paste a CurseForge, Modrinth, or direct ZIP/MRPACK link."
							: routeState.step() === "launcherSelect"
								? "Choose which launcher you want to import from."
								: "Select a launcher path, rescan detected instances, then import one."
					}
					actionLabel={routeState.step() === "launcherDetails" ? "Back to Launchers" : "Back"}
					onAction={() => {
						if (routeState.step() === "launcherDetails") routeState.dispatch("clearLauncher");
						else routeState.dispatch("clearSource");
					}}
					prefixIcon={
						routeState.step() === "urlInput" ? (
							<span class={`${styles["card-icon"]} ${styles["is-stroke"]}`}>
								<GlobeIcon />
							</span>
						) : routeState.step() === "launcherDetails" && activeLauncherVisual()?.icon ? (
							<span class={styles["launcher-title-icon"]}>
								{(() => {
									const Icon = activeLauncherVisual()?.icon;
									return Icon ? <Icon /> : null;
								})()}
							</span>
						) : undefined
					}
				/>
			</Show>
		</Show>
		<div class={styles["page-wrapper"]}>
			<Show when={(props.projectName || source.modpackPath() || source.modpackUrl()) && !shouldShowOverlay()}>
				<InstallContextBanner title={props.projectName || source.modpackInfo()?.name || "Analyzing modpack details..."} label={props.resourceType || (routeState.isModpackMode() ? "Modpack" : "Package")} iconUrl={props.projectIcon || source.modpackInfo()?.iconUrl} minecraftVersion={source.modpackInfo()?.minecraftVersion || props.initialVersion} modloader={source.modpackInfo()?.modloader || props.initialModloader} analyzing={!source.modpackInfo() && !props.projectName} backLabel={props.projectId ? "Back to Browser" : "Back to Source"} onBack={() => props.projectId ? routeState.activeRouter()?.backwards() : source.resetSource()} />
			</Show>

			<Show when={routeState.isModpackMode() && routeState.step() !== "form" && routeState.step() !== "submitting" && !props.projectId}>
				<div class={styles["import-selection-wrapper"]}>
					<Show when={routeState.step() === "sourceSelect"}>
						<SourceOptionsGrid onLocalImport={source.handleLocalImport} onExplore={() => { resources.setType("modpack"); routeState.activeRouter()?.navigate("/resources"); }} onUrl={() => routeState.dispatch("showUrl")} onLauncher={() => routeState.dispatch("showLauncher")} />
					</Show>
					<Show when={routeState.step() === "launcherSelect"}>
						<LauncherMenuGrid launchers={launcherOptions} onSelect={(kind) => { launcherImport.setSelectedLauncher(kind); routeState.activeRouter()?.updateQuery("launcher", kind, true); }} />
					</Show>
					<Show when={routeState.step() === "launcherDetails"}>
						<LauncherDetailsPanel basePath={launcherImport.launcherBasePath()} instances={launcherImport.launcherInstances()} selectedInstancePath={launcherImport.selectedInstancePath()} hasScanned={launcherImport.hasScannedLauncherInstances()} isLoading={launcherImport.isLoadingLauncherInstances()} isImporting={launcherImport.isImportingLauncher()} onPathChange={launcherImport.setLauncherBasePath} onBrowse={launcherImport.handleLauncherFolderPick} onRescan={() => launcherImport.loadLauncherInstances()} onSelectInstance={launcherImport.setSelectedInstancePath} onImport={launcherImport.handleImportLauncherInstance} />
					</Show>
					<Show when={routeState.step() === "urlInput"}>
						<UrlSourcePanel value={source.urlInputValue()} onInput={source.setUrlInputValue} onSubmit={() => { if (source.handleUrlSubmit()) routeState.dispatch("clearSource"); }} />
					</Show>
				</div>
			</Show>

			<FetchingOverlay isVisible={shouldShowOverlay()} title={projectVersions.loading ? "Loading available versions..." : "Fetching modpack details..."} message={projectVersions.loading ? undefined : "This usually takes a few seconds as we verify the pack manifest."} />

			<Show when={shouldShowForm() && (!routeState.isModpackMode() || source.modpackUrl() || source.modpackPath() || props.projectId)}>
				<InstallForm
					isModpack={routeState.isModpackMode()}
					isLocalImport={!!source.modpackPath()}
					modpackInfo={source.modpackInfo()}
					modpackVersions={projectVersions() ?? []}
					selectedModpackVersionId={selectedModpackVersionId()}
					onModpackVersionChange={handleModpackVersionChange}
					supportedMcVersions={capabilities.supportedMcVersions()}
					supportedModloaders={capabilities.supportedModloaders()}
					onStateChange={setFormState}
					projectId={props.projectId}
					platform={props.platform}
					initialData={(props as any).initialData}
					initialName={props.initialName || source.modpackInfo()?.name || props.projectName}
					initialAuthor={source.modpackInfo()?.author || props.projectAuthor || undefined}
					initialIcon={props.initialIcon || source.modpackInfo()?.iconUrl || props.projectIcon || undefined}
					originalIcon={source.originalIcon()}
					initialVersion={props.initialVersion || source.modpackInfo()?.minecraftVersion}
					initialModloader={props.initialModloader || source.modpackInfo()?.modloader}
					initialModloaderVersion={source.modpackInfo()?.modloaderVersion || props.initialModloaderVersion || undefined}
					initialIncludeSnapshots={props.initialIncludeSnapshots}
					initialMinMemory={props.initialMinMemory}
					initialMaxMemory={props.initialMaxMemory}
					initialJvmArgs={props.initialJvmArgs}
					initialResW={props.initialResW}
					initialResH={props.initialResH}
					onInstall={install.handleInstall}
					onCancel={() => {
						if (routeState.isModpackMode() && (source.modpackUrl() || source.modpackPath())) source.resetSource();
						else if (props.close) props.close();
						else routeState.activeRouter()?.navigate(props.projectName ? "/resources" : "/home");
					}}
					isInstalling={install.isInstalling()}
					isFetchingMetadata={source.isFetchingMetadata() || projectVersions.loading}
				/>
			</Show>
		</div>
	</div>;
}

export default InstallPage;
