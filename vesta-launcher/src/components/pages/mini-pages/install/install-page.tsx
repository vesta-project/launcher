import { router } from "@components/page-viewer/page-viewer";
import type { Instance } from "@utils/instances";
import { createMemo, createSignal, onMount, Show } from "solid-js";
import { FetchingOverlay } from "./components/FetchingOverlay";
import { InstallContextBanner } from "./components/InstallContextBanner";
import { InstallForm } from "./components/InstallForm";
import { InstallStageHeader } from "./components/InstallStageHeader";
import { useInstallCapabilities } from "./hooks/use-install-capabilities";
import { useInstallSubmit } from "./hooks/use-install-submit";
import { useModpackSource } from "./hooks/use-modpack-source";
import { useProjectVersions } from "./hooks/use-project-versions";
import styles from "./install-page.module.css";
import type { InstallPageRouteProps } from "./types";

/**
 * InstallPage is the simplified instance configuration form.
 *
 * Standard installs arrive directly at /install.
 * Modpack installs arrive here with modpackUrl/modpackPath/projectId params
 * (set by the resource browser, source-select-page, or file-drop).
 */
function InstallPage(props: InstallPageRouteProps) {
	const [formState, setFormState] = createSignal<Partial<Instance>>({});
	const [selectedModpackVersionId, setSelectedModpackVersionId] = createSignal("");
	const routeParams = createMemo(() => (props.router || router())?.currentParams.get() || {});
	const activeRouter = createMemo(() => props.router || router());

	// --- Effective props (merge route params with direct props) ---
	const effectiveIsModpack = createMemo(() => {
		const routeFlag = routeParams().isModpack as boolean | string | undefined;
		if (String(routeFlag) === "true" || routeFlag === true) return true;
		if (String(routeFlag) === "false" || routeFlag === false) return false;
		return String(props.isModpack) === "true" || props.isModpack === true;
	});
	const effectiveModpackUrl = createMemo(
		() => (routeParams().modpackUrl as string | undefined) || props.modpackUrl,
	);
	const effectiveModpackPath = createMemo(
		() => (routeParams().modpackPath as string | undefined) || props.modpackPath,
	);
	const effectiveProjectId = createMemo(
		() => (routeParams().projectId as string | undefined) || props.projectId,
	);
	const effectivePlatform = createMemo(
		() => (routeParams().platform as string | undefined) || props.platform,
	);
	const effectiveInitialVersion = createMemo(
		() => (routeParams().initialVersion as string | undefined) || props.initialVersion,
	);
	const effectiveInitialMinecraftVersion = createMemo(
		() =>
			(routeParams().initialMinecraftVersion as string | undefined) || props.initialMinecraftVersion,
	);
	const effectiveInitialModloader = createMemo(
		() => (routeParams().initialModloader as string | undefined) || props.initialModloader,
	);
	const effectiveResourceType = createMemo(
		() => (routeParams().resourceType as string | undefined) || props.resourceType,
	);

	// --- Hooks ---
	const isModpackMode = createMemo(
		() =>
			effectiveIsModpack() ||
			!!effectiveModpackUrl() ||
			!!effectiveModpackPath() ||
			effectiveResourceType()?.toLowerCase() === "modpack" ||
			effectiveResourceType()?.toLowerCase() === "modpacks",
	);

	const source = useModpackSource({
		projectId: effectiveProjectId(),
		platform: effectivePlatform(),
		projectName: props.projectName,
		projectIcon: props.projectIcon,
		projectAuthor: props.projectAuthor,
		initialVersion: effectiveInitialVersion(),
		initialMinecraftVersion: effectiveInitialMinecraftVersion(),
		initialModloader: effectiveInitialModloader(),
		initialModloaderVersion: props.initialModloaderVersion,
		originalIcon: props.originalIcon,
		modpackUrl: effectiveModpackUrl(),
		modpackPath: effectiveModpackPath(),
		selectedModpackVersionId,
	});

	const install = useInstallSubmit({
		close: props.close,
		navigateHome: () => activeRouter()?.navigate("/home"),
		isModpackMode,
		modpackUrl: source.modpackUrl,
		modpackPath: source.modpackPath,
		modpackInfo: source.modpackInfo as any,
	});

	const { projectVersions, handleModpackVersionChange } = useProjectVersions({
		isModpackMode,
		modpackPath: source.modpackPath,
		modpackUrl: source.modpackUrl,
		modpackInfo: source.modpackInfo as any,
		projectId: effectiveProjectId,
		platform: effectivePlatform,
		initialVersion: effectiveInitialVersion,
		initialMinecraftVersion: effectiveInitialMinecraftVersion,
		initialModloader: effectiveInitialModloader,
		selectedModpackVersionId,
		setSelectedModpackVersionId,
		setModpackUrl: source.setModpackUrl,
	});

	const capabilities = useInstallCapabilities({
		modpackInfo: source.modpackInfo as any,
		modpackUrl: source.modpackUrl,
		modpackPath: source.modpackPath,
		projectVersions: () => projectVersions(),
	});

	onMount(() => {
		console.log("[InstallPage] Mounted with props:", props, "route params:", routeParams());
		activeRouter()?.registerStateProvider("/install", () => ({
			...props,
			modpackUrl: source.modpackUrl(),
			modpackPath: source.modpackPath(),
			selectedModpackVersionId: selectedModpackVersionId(),
			initialData: formState(),
			originalIcon: source.originalIcon(),
		}));
	});

	// --- Derived UI state ---
	const isFetchingMetadata = createMemo(
		() => source.isFetchingMetadata() || projectVersions.loading,
	);

	const showForm = createMemo(
		() =>
			!isFetchingMetadata() &&
			(!isModpackMode() || source.modpackUrl() || source.modpackPath() || effectiveProjectId()),
	);

	return (
		<div class={styles["page-root"]}>
			{/* Header for standard (non-modpack) installs */}
			<Show when={!isModpackMode() && !effectiveProjectId()}>
				<InstallStageHeader
					title="New Instance"
					description="Create a clean slate and customize it."
					actionLabel="Back"
					onAction={() => activeRouter()?.navigate("/install/source")}
				/>
			</Show>

			<div class={styles["page-wrapper"]}>
				{/* Context banner (modpack info bar) */}
				<Show
					when={
						(props.projectName || source.modpackPath() || source.modpackUrl()) && !isFetchingMetadata()
					}
				>
					<InstallContextBanner
						title={props.projectName || source.modpackInfo()?.name || "Analyzing modpack details..."}
						label={effectiveResourceType() || (isModpackMode() ? "Modpack" : "Package")}
						iconUrl={props.projectIcon || source.modpackInfo()?.iconUrl}
							minecraftVersion={source.modpackInfo()?.minecraftVersion || effectiveInitialMinecraftVersion()}
						modloader={source.modpackInfo()?.modloader || effectiveInitialModloader()}
						analyzing={!source.modpackInfo() && !props.projectName}
						backLabel={effectiveProjectId() ? "Back to Browser" : "Back to Source"}
						onBack={() => (effectiveProjectId() ? activeRouter()?.backwards() : source.resetSource())}
					/>
				</Show>

				{/* Loading overlay */}
				<FetchingOverlay
					isVisible={isFetchingMetadata()}
					title={
						projectVersions.loading ? "Loading available versions..." : "Fetching modpack details..."
					}
					message={
						projectVersions.loading
							? undefined
							: "This usually takes a few seconds as we verify the pack manifest."
					}
				/>

				{/* The actual install form */}
				<Show when={showForm()}>
					<InstallForm
						isModpack={isModpackMode()}
						isLocalImport={!!source.modpackPath()}
						modpackInfo={source.modpackInfo()}
						modpackVersions={projectVersions() ?? []}
						selectedModpackVersionId={selectedModpackVersionId()}
						onModpackVersionChange={handleModpackVersionChange}
						supportedMcVersions={capabilities.supportedMcVersions()}
						supportedModloaders={capabilities.supportedModloaders()}
						onStateChange={setFormState}
						projectId={effectiveProjectId()}
						platform={effectivePlatform()}
						initialData={(props as any).initialData}
						initialName={props.initialName || source.modpackInfo()?.name || props.projectName}
						initialAuthor={source.modpackInfo()?.author || props.projectAuthor || undefined}
						initialIcon={
							props.initialIcon || source.modpackInfo()?.iconUrl || props.projectIcon || undefined
						}
						originalIcon={source.originalIcon()}
					initialVersion={
						isModpackMode()
							? effectiveInitialMinecraftVersion() || source.modpackInfo()?.minecraftVersion || ""
							: props.initialVersion
					}
						initialModloader={effectiveInitialModloader() || source.modpackInfo()?.modloader}
						initialModloaderVersion={
							source.modpackInfo()?.modloaderVersion || props.initialModloaderVersion || undefined
						}
						initialIncludeSnapshots={props.initialIncludeSnapshots}
						initialMinMemory={props.initialMinMemory}
						initialMaxMemory={props.initialMaxMemory}
						initialJvmArgs={props.initialJvmArgs}
						onInstall={install.handleInstall}
						onCancel={() => {
							if (isModpackMode() && (source.modpackUrl() || source.modpackPath())) source.resetSource();
							else if (props.close) props.close();
							else activeRouter()?.navigate(props.projectName ? "/resources" : "/home");
						}}
						isInstalling={install.isInstalling()}
						isFetchingMetadata={isFetchingMetadata()}
					/>
				</Show>
			</div>
		</div>
	);
}

export default InstallPage;
