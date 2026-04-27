import type { MiniRouter } from "@components/page-viewer/mini-router";
import type { Instance } from "@utils/instances";
import type { ExternalInstanceCandidate, LauncherKind } from "@utils/launcher-imports";
import type { JSX } from "solid-js";

export interface InstallPageProps {
	close?: () => void;
	projectId?: string;
	platform?: string;
	projectName?: string;
	projectIcon?: string;
	projectAuthor?: string;
	resourceType?: string;
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

export type InstallPageRouteProps = InstallPageProps & { router?: MiniRouter };

export type IconComponent = (props: { class?: string }) => JSX.Element;

export type LauncherVisualTone =
	| "curseforge"
	| "gdlauncher"
	| "prism"
	| "multimc"
	| "modrinth"
	| "atlauncher"
	| "ftb"
	| "technic";

export interface LauncherOption {
	kind: LauncherKind;
	label: string;
	icon?: IconComponent;
	tone: LauncherVisualTone;
	iconMonochrome?: boolean;
}

export interface LauncherDetailsViewModel {
	label: string;
	icon?: IconComponent;
	basePath: string;
	instances: ExternalInstanceCandidate[];
	selectedInstancePath: string;
	hasScanned: boolean;
	isLoading: boolean;
	isImporting: boolean;
}

export type InstallSubmitData = Partial<Instance>;
