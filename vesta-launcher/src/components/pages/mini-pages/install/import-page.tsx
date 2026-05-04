import { router } from "@components/page-viewer/page-viewer";
import type { LauncherKind } from "@utils/launcher-imports";
import { createMemo, Show } from "solid-js";
import { InstallStageHeader } from "./components/InstallStageHeader";
import { LauncherDetailsPanel } from "./components/LauncherDetailsPanel";
import { LauncherMenuGrid } from "./components/LauncherMenuGrid";
import { launcherOptions, launcherVisualMap } from "./config/launcher-options";
import { useLauncherImport } from "./hooks/use-launcher-import";
import styles from "./install-page.module.css";

interface ImportPageRouteProps {
	router?: any;
	close?: () => void;
}

/**
 * ImportPage is a self-contained page for the launcher import flow.
 * It handles: launcher selection → instance scanning → import.
 */
function ImportPage(props: ImportPageRouteProps) {
	const activeRouter = () => props.router || router();
	const routeParams = createMemo(() => activeRouter()?.currentParams.get() || {});

	const selectedLauncherFromQuery = createMemo(() => {
		const launcher = routeParams().launcher;
		return launcher ? (launcher as LauncherKind) : null;
	});

	const showLauncherDetails = createMemo(() => !!selectedLauncherFromQuery());

	const launcherImport = useLauncherImport({
		selectedLauncherFromQuery,
		showLauncherDetails,
		onImportSuccess: () => (props.close ? props.close() : activeRouter()?.navigate("/home")),
	});

	const activeLauncherVisual = createMemo(() =>
		launcherVisualMap.get(selectedLauncherFromQuery() ?? launcherImport.activeLauncherKind()),
	);

	const isDetailsMode = createMemo(() => !!selectedLauncherFromQuery());

	return (
		<div class={styles["page-root"]}>
			<Show
				when={isDetailsMode()}
				fallback={
					<InstallStageHeader
						title="Launcher Import"
						description="Choose which launcher you want to import from."
						actionLabel="Back"
						onAction={() => activeRouter()?.navigate("/install/source")}
					/>
				}
			>
				<InstallStageHeader
					title={activeLauncherVisual()?.label ?? "Launcher Import"}
					description="Select a launcher path, rescan detected instances, then import one."
					actionLabel="Back to Launchers"
					onAction={() => activeRouter()?.removeQuery("launcher")}
					prefixIcon={
						activeLauncherVisual()?.icon ? (
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
			<div class={styles["page-wrapper"]}>
				<div class={styles["import-selection-wrapper"]}>
					<Show when={!isDetailsMode()}>
						<LauncherMenuGrid
							launchers={launcherOptions}
							onSelect={(kind) => {
								launcherImport.setSelectedLauncher(kind);
								activeRouter()?.updateQuery("launcher", kind, true);
							}}
						/>
					</Show>
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
		</div>
	);
}

export default ImportPage;
