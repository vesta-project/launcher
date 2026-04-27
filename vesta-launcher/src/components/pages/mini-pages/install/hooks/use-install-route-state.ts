import type { MiniRouter } from "@components/page-viewer/mini-router";
import { router } from "@components/page-viewer/page-viewer";
import type { LauncherKind } from "@utils/launcher-imports";
import { type Accessor, createMemo } from "solid-js";

export type InstallStep =
	| "sourceSelect"
	| "urlInput"
	| "launcherSelect"
	| "launcherDetails"
	| "metadataLoading"
	| "form"
	| "submitting";

interface UseInstallRouteStateParams {
	isModpackFlag?: boolean;
	resourceType?: string;
	modpackUrl?: string;
	modpackPath?: string;
	activeRouterProp?: MiniRouter;
	isFetchingMetadata: Accessor<boolean>;
	hasSource: Accessor<boolean>;
	hasProjectContext: Accessor<boolean>;
	isInstalling: Accessor<boolean>;
}

export function useInstallRouteState(params: UseInstallRouteStateParams) {
	const activeRouter = createMemo(() => params.activeRouterProp || router());

	const isModpackMode = createMemo(() => {
		const query = activeRouter()?.currentParams.get();
		if (query?.mode === "modpack") return true;
		if (query?.mode === "standard") return false;
		const resType = params.resourceType?.toLowerCase();
		return (
			String(params.isModpackFlag) === "true" ||
			params.isModpackFlag === true ||
			!!params.modpackUrl ||
			!!params.modpackPath ||
			resType === "modpack" ||
			resType === "modpacks"
		);
	});

	const source = createMemo(() => activeRouter()?.currentParams.get()?.source);
	const selectedLauncherFromQuery = createMemo(() => {
		const launcher = activeRouter()?.currentParams.get()?.launcher;
		return launcher ? (launcher as LauncherKind) : null;
	});

	const step = createMemo<InstallStep>(() => {
		if (params.isInstalling()) return "submitting";
		if (params.isFetchingMetadata()) return "metadataLoading";
		if (!isModpackMode()) return "form";
		if (source() === "url") return "urlInput";
		if (source() === "launcher" && selectedLauncherFromQuery()) return "launcherDetails";
		if (source() === "launcher") return "launcherSelect";
		if (!params.hasSource() && !params.hasProjectContext()) return "sourceSelect";
		return "form";
	});

	const dispatch = (
		event: "toggleMode" | "showUrl" | "showLauncher" | "clearSource" | "clearLauncher",
	) => {
		switch (event) {
			case "toggleMode":
				activeRouter()?.updateQuery("mode", isModpackMode() ? "standard" : "modpack", true);
				break;
			case "showUrl":
				activeRouter()?.updateQuery("source", "url", true);
				break;
			case "showLauncher":
				activeRouter()?.updateQuery("source", "launcher", true);
				break;
			case "clearLauncher":
				activeRouter()?.removeQuery("launcher");
				break;
			case "clearSource":
				activeRouter()?.removeQuery("source");
				break;
		}
	};

	return {
		activeRouter,
		isModpackMode,
		source,
		step,
		selectedLauncherFromQuery,
		dispatch,
	};
}
