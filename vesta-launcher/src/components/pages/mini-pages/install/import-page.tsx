import { router } from "@components/page-viewer/page-viewer";
import type { LauncherKind } from "@utils/launcher-imports";
import { createMemo, createSignal, onMount, Show } from "solid-js";
import {
	ImportMethodModal,
	type ImportMethodModalStep,
} from "./components/ImportMethodModal";
import { InstallStageHeader } from "./components/InstallStageHeader";
import { LauncherDetailsPanel } from "./components/LauncherDetailsPanel";
import { launcherVisualMap } from "./config/launcher-options";
import { useLauncherImport } from "./hooks/use-launcher-import";
import {
	openBrowseModpacks,
	openLauncherImport,
	openLocalModpackInstall,
	openUrlModpackInstall,
} from "./install-entry-actions";
import styles from "./install-page.module.css";

interface ImportPageRouteProps {
	router?: any;
	close?: () => void;
}

/**
 * ImportPage hosts the launcher-details step only.
 * Launcher picking lives in ImportMethodModal (same density as method choice).
 */
function ImportPage(props: ImportPageRouteProps) {
	const activeRouter = () => props.router || router();
	const navigateInstall = (path: string, params?: Record<string, unknown>) => {
		activeRouter()?.navigate(path, params);
	};
	const [importModalOpen, setImportModalOpen] = createSignal(false);
	const [importModalStep, setImportModalStep] =
		createSignal<ImportMethodModalStep>("launchers");
	const routeParams = createMemo(
		() => activeRouter()?.currentParams.get() || {},
	);

	const selectedLauncherFromQuery = createMemo(() => {
		const launcher = routeParams().launcher;
		return launcher ? (launcher as LauncherKind) : null;
	});

	const launcherImport = useLauncherImport({
		selectedLauncherFromQuery,
		onImportSuccess: () =>
			props.close ? props.close() : activeRouter()?.navigate("/home"),
	});

	const activeLauncherVisual = createMemo(() =>
		launcherVisualMap.get(
			selectedLauncherFromQuery() ?? launcherImport.activeLauncherKind(),
		),
	);

	const isDetailsMode = createMemo(() => !!selectedLauncherFromQuery());

	onMount(() => {
		if (!selectedLauncherFromQuery()) {
			setImportModalStep("launchers");
			setImportModalOpen(true);
		}
	});

	const openMethodModal = (step: ImportMethodModalStep) => {
		setImportModalStep(step);
		setImportModalOpen(true);
	};

	const closeImportModal = () => {
		setImportModalOpen(false);
		if (!selectedLauncherFromQuery()) {
			if (activeRouter()?.canGoBack?.()) activeRouter()?.backwards();
			else activeRouter()?.navigate("/install");
		}
	};

	return (
		<div class={styles["page-root"]}>
			<Show when={isDetailsMode()}>
				<InstallStageHeader
					title={activeLauncherVisual()?.label ?? "Launcher Import"}
					description="Select a launcher path, rescan detected instances, then import one."
					actionLabel="Change import"
					onAction={() => openMethodModal("methods")}
					prefixIcon={
						activeLauncherVisual()?.icon ? (
							<span
								class={styles["launcher-title-icon"]}
								classList={{
									[styles["launcher-title-icon--modrinth"]]:
										activeLauncherVisual()?.tone === "modrinth",
									[styles["launcher-title-icon--curseforge"]]:
										activeLauncherVisual()?.tone === "curseforge",
								}}
							>
								{(() => {
									const Icon = activeLauncherVisual()?.icon;
									return Icon ? <Icon /> : null;
								})()}
							</span>
						) : undefined
					}
				/>
			</Show>
			<div class={styles["page-wrapper"]}>
				<div class={styles["import-selection-wrapper"]}>
					<Show when={isDetailsMode()}>
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
			</div>

			<ImportMethodModal
				isOpen={importModalOpen()}
				onClose={closeImportModal}
				initialStep={importModalStep()}
				onSelectLocal={(path) => {
					setImportModalOpen(false);
					openLocalModpackInstall(navigateInstall, path);
				}}
				onSelectBrowseModpacks={() => {
					setImportModalOpen(false);
					void openBrowseModpacks(navigateInstall);
				}}
				onSelectLauncher={(kind) => {
					setImportModalOpen(false);
					launcherImport.setSelectedLauncher(kind);
					openLauncherImport(navigateInstall, kind);
				}}
				onSelectUrl={(url) => {
					setImportModalOpen(false);
					openUrlModpackInstall(navigateInstall, url);
				}}
			/>
		</div>
	);
}

export default ImportPage;
