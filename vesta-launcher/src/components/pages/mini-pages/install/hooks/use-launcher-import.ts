import { open } from "@tauri-apps/plugin-dialog";
import { showToast } from "@ui/toast/toast";
import {
	detectExternalLaunchers,
	importExternalInstance,
	listExternalInstances,
	type DetectedLauncher,
	type ExternalInstanceCandidate,
	type LauncherKind,
} from "@utils/launcher-imports";
import { createEffect, createSignal, type Accessor } from "solid-js";
import { launcherLabelMap } from "../config/launcher-options";

interface UseLauncherImportParams {
	selectedLauncherFromQuery: Accessor<LauncherKind | null>;
	showLauncherDetails: Accessor<boolean>;
	onImportSuccess: () => void;
}

export function useLauncherImport(params: UseLauncherImportParams) {
	const [selectedLauncher, setSelectedLauncher] = createSignal<LauncherKind>("curseforgeFlame");
	const [launcherBasePath, setLauncherBasePath] = createSignal("");
	const [launcherInstances, setLauncherInstances] = createSignal<ExternalInstanceCandidate[]>([]);
	const [selectedInstancePath, setSelectedInstancePath] = createSignal("");
	const [isLoadingLauncherInstances, setIsLoadingLauncherInstances] = createSignal(false);
	const [isImportingLauncher, setIsImportingLauncher] = createSignal(false);
	const [hasScannedLauncherInstances, setHasScannedLauncherInstances] = createSignal(false);
	const [autoLoadedLauncher, setAutoLoadedLauncher] = createSignal<string | null>(null);

	const activeLauncherKind = () => params.selectedLauncherFromQuery() ?? selectedLauncher();

	const loadLauncherInstances = async (
		launcher: LauncherKind = activeLauncherKind(),
		basePathOverride?: string,
	) => {
		setHasScannedLauncherInstances(true);
		setIsLoadingLauncherInstances(true);
		try {
			const basePath = (basePathOverride ?? launcherBasePath()).trim();
			const instances = await listExternalInstances(launcher, basePath || undefined);
			setLauncherInstances(instances);
			setSelectedInstancePath(instances[0]?.instancePath ?? "");
		} catch (error) {
			console.error("[InstallPage] Failed to list launcher instances", error);
			showToast({
				title: "Instance Detection Failed",
				description: String(error),
				severity: "warning",
			});
		} finally {
			setIsLoadingLauncherInstances(false);
		}
	};

	const initializeLauncherDetails = async (launcher: LauncherKind) => {
		setSelectedLauncher(launcher);
		setHasScannedLauncherInstances(false);
		setLauncherInstances([]);
		setSelectedInstancePath("");
		setLauncherBasePath("");

		let preferredPath = "";
		let detectedPaths: string[] = [];
		try {
			const detected = await detectExternalLaunchers();
			const matched = detected.find((entry: DetectedLauncher) => entry.kind === launcher);
			detectedPaths = matched?.detectedPaths?.filter(Boolean) ?? [];
			preferredPath = detectedPaths[0] ?? "";
		} catch (error) {
			console.warn("[InstallPage] Failed to load launcher detection paths", error);
		}

		const validRoots: string[] = [];
		for (const path of detectedPaths) {
			try {
				const instancesAtRoot = await listExternalInstances(launcher, path);
				if (instancesAtRoot.length > 0) validRoots.push(path);
			} catch (error) {
				console.debug("[InstallPage] Launcher root probe failed", path, error);
			}
		}
		const uniqueRoots = Array.from(new Set(validRoots.length > 0 ? validRoots : detectedPaths));
		if (uniqueRoots.length > 0) preferredPath = uniqueRoots[0];

		if (uniqueRoots.length > 1) {
			const optionsText = uniqueRoots.map((path, index) => `${index + 1}. ${path}`).join("\n");
			const response = window.prompt(
				`Multiple ${launcherLabelMap.get(launcher) ?? "launcher"} data roots were detected.\nChoose a path number:\n\n${optionsText}`,
				"1",
			);
			if (response !== null) {
				const selectedIndex = Number.parseInt(response, 10);
				if (Number.isFinite(selectedIndex) && selectedIndex >= 1 && selectedIndex <= uniqueRoots.length) {
					preferredPath = uniqueRoots[selectedIndex - 1];
				}
			}
		}

		setLauncherBasePath(preferredPath);
		await loadLauncherInstances(launcher, preferredPath);
	};

	const handleLauncherFolderPick = async () => {
		const result = await open({ directory: true, multiple: false });
		if (typeof result === "string") setLauncherBasePath(result);
	};

	const handleImportLauncherInstance = async () => {
		if (!selectedInstancePath()) return;
		setIsImportingLauncher(true);
		try {
			await importExternalInstance({
				launcher: activeLauncherKind(),
				instancePath: selectedInstancePath(),
				selectedInstance: launcherInstances().find((item) => item.instancePath === selectedInstancePath()) ?? null,
				basePathOverride: launcherBasePath().trim() || null,
			});
			showToast({
				title: "Import Queued",
				description: "The import task is queued and will start when a worker is available.",
				severity: "success",
			});
			// Give the user a moment to see confirmation before the view closes.
			setTimeout(() => params.onImportSuccess(), 180);
		} catch (error) {
			showToast({
				title: "Import Failed",
				description: String(error),
				severity: "error",
			});
		} finally {
			setIsImportingLauncher(false);
		}
	};

	createEffect(() => {
		const launcher = params.selectedLauncherFromQuery();
		if (!params.showLauncherDetails() || !launcher) {
			setAutoLoadedLauncher(null);
			return;
		}
		if (autoLoadedLauncher() === launcher) return;
		setAutoLoadedLauncher(launcher);
		void initializeLauncherDetails(launcher);
	});

	return {
		selectedLauncher,
		setSelectedLauncher,
		activeLauncherKind,
		launcherBasePath,
		setLauncherBasePath,
		launcherInstances,
		selectedInstancePath,
		setSelectedInstancePath,
		isLoadingLauncherInstances,
		isImportingLauncher,
		hasScannedLauncherInstances,
		loadLauncherInstances,
		initializeLauncherDetails,
		handleLauncherFolderPick,
		handleImportLauncherInstance,
	};
}
