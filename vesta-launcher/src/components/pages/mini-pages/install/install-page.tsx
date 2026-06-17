import { router } from "@components/page-viewer/page-viewer";
import type { ResourceVersion } from "@stores/resources";
import type { Instance } from "@utils/instances";
import { createEffect, createMemo, createSignal, onMount, Show, untrack } from "solid-js";
import { FetchingOverlay } from "./components/FetchingOverlay";
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
	const effectiveInitialVersionNumber = createMemo(
		() => (routeParams().initialVersionNumber as string | undefined) || props.initialVersionNumber,
	);
	const effectiveProjectName = createMemo(
		() => (routeParams().projectName as string | undefined) || props.projectName,
	);
	const effectiveProjectIcon = createMemo(
		() => (routeParams().projectIcon as string | undefined) || props.projectIcon,
	);
	const effectiveProjectAuthor = createMemo(
		() => (routeParams().projectAuthor as string | undefined) || props.projectAuthor,
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
		projectName: effectiveProjectName(),
		projectIcon: effectiveProjectIcon(),
		projectAuthor: effectiveProjectAuthor(),
		initialVersion: effectiveInitialVersion(),
		initialMinecraftVersion: effectiveInitialMinecraftVersion(),
		initialVersionNumber: effectiveInitialVersionNumber(),
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

	// --- Enrich modpackInfo with version details when the selected version resolves ---
	createEffect(() => {
		const vs = projectVersions();
		const selectedId = selectedModpackVersionId();
		if (!vs || !selectedId) return;

		const selected = vs.find(
			(v: ResourceVersion) => v.id === selectedId || v.version_number === selectedId,
		);
		if (!selected) return;

		const info = untrack(() => source.modpackInfo());

		source.setModpackInfo({
			name: info?.name || effectiveProjectName() || "Unknown Modpack",
			version: selected.version_number,
			author: info?.author || effectiveProjectAuthor() || null,
			description: info?.description ?? null,
			iconUrl: info?.iconUrl || effectiveProjectIcon() || null,
			minecraftVersion:
				selected.game_versions[0] || info?.minecraftVersion || effectiveInitialMinecraftVersion() || "",
			modloader:
				(selected.loaders[0] as any) || info?.modloader || effectiveInitialModloader() || "vanilla",
			modloaderVersion: info?.modloaderVersion || null,
			modCount: info?.modCount || 0,
			format: info?.format || effectivePlatform() || "unknown",
			modpackId: info?.modpackId || effectiveProjectId(),
			modpackVersionId: selected.id,
			modpackPlatform: info?.modpackPlatform || effectivePlatform(),
		});
	});

	// --- Sync modpackInfo project-level fields from effective values ---
	createEffect(() => {
		const info = untrack(() => source.modpackInfo());
		if (!info) return;

		const name = effectiveProjectName();
		const id = effectiveProjectId();
		const platform = effectivePlatform();
		const icon = effectiveProjectIcon();
		const author = effectiveProjectAuthor();

		const updates: Record<string, any> = {};
		if (name && info.name === "Unknown Modpack") updates.name = name;
		if (id && !info.modpackId) updates.modpackId = id;
		if (platform && !info.modpackPlatform) updates.modpackPlatform = platform;
		if (icon && !info.iconUrl) updates.iconUrl = icon;
		if (author && !info.author) updates.author = author;

		if (Object.keys(updates).length > 0) {
			source.setModpackInfo({ ...info, ...updates });
		}
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
	const metadataStatus = createMemo(() => source.metadataStatus());
	const isFetchingMetadata = createMemo(() => source.isFetchingMetadata());
	const hasMinimumInstallData = createMemo(
		() => !isModpackMode() || !!source.modpackInfo() || !!effectiveProjectId(),
	);

	const showForm = createMemo(() => hasMinimumInstallData() && metadataStatus().phase !== "failed");
	const isLocalModpackUpload = createMemo(() => !!source.modpackPath() && !effectiveProjectId());

	const goBackFromLocalUpload = () => {
		const r = activeRouter();
		if (r?.canGoBack?.()) r.backwards();
		else r?.navigate("/home");
	};

	const contextBackLabel = createMemo(() => {
		if (effectiveProjectId()) return "Back to Browser";
		if (isLocalModpackUpload()) return "Back";
		return "Back to Source";
	});

	const handleContextBack = () => {
		if (effectiveProjectId()) {
			activeRouter()?.backwards();
			return;
		}

		if (isLocalModpackUpload()) {
			goBackFromLocalUpload();
			return;
		}

		source.resetSource();
	};

	return (
		<div class={styles["page-root"]}>
			<InstallStageHeader
				title={
					isModpackMode()
						? effectiveProjectName() || source.modpackInfo()?.name || "Analyzing modpack details..."
						: "New Instance"
				}
				description={isModpackMode() ? undefined : "Create a clean slate and customize it."}
				label={isModpackMode() ? effectiveResourceType() || "Modpack" : undefined}
				iconUrl={isModpackMode() ? effectiveProjectIcon() || source.modpackInfo()?.iconUrl : undefined}
				minecraftVersion={
					isModpackMode()
						? source.modpackInfo()?.minecraftVersion || effectiveInitialMinecraftVersion()
						: undefined
				}
				modloader={
					isModpackMode()
						? source.modpackInfo()?.modloader || effectiveInitialModloader()
						: undefined
				}
				analyzing={
					isModpackMode() && (isFetchingMetadata() || (!source.modpackInfo() && !effectiveProjectName()))
				}
				actionLabel={isModpackMode() ? contextBackLabel() : "Back"}
				onAction={isModpackMode() ? handleContextBack : () => activeRouter()?.navigate("/install/source")}
			/>

			<div class={styles["page-wrapper"]}>
				{/* Loading overlay */}
				<FetchingOverlay
					isVisible={isFetchingMetadata() || metadataStatus().phase === "failed"}
					title={
						metadataStatus().phase === "reading-local-pack"
							? "Reading modpack manifest..."
							: metadataStatus().phase === "failed"
								? "Could not read modpack"
								: "Fetching modpack details..."
					}
					message={metadataStatus().message}
					error={metadataStatus().error}
					variant={metadataStatus().phase === "failed" ? "error" : "loading"}
					onRetry={metadataStatus().canRetry ? source.retryMetadata : undefined}
					onChooseAnother={
						metadataStatus().phase === "failed" && source.modpackPath()
							? source.handleLocalImport
							: undefined
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
						initialName={props.initialName || source.modpackInfo()?.name || effectiveProjectName()}
						initialAuthor={source.modpackInfo()?.author || effectiveProjectAuthor() || undefined}
						initialIcon={
							props.initialIcon || source.modpackInfo()?.iconUrl || effectiveProjectIcon() || undefined
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
							if (isLocalModpackUpload()) goBackFromLocalUpload();
							else if (isModpackMode() && (source.modpackUrl() || source.modpackPath()))
								source.resetSource();
							else if (props.close) props.close();
							else activeRouter()?.navigate(effectiveProjectName() ? "/resources" : "/home");
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
