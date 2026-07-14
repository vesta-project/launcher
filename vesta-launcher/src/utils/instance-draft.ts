import type { Instance } from "@utils/instances";

export type LauncherAction = Exclude<Instance["launcherActionOnLaunch"], null>;

export interface InstanceEditDraft {
	name: string;
	iconPath: string;
	minMemory: number;
	maxMemory: number;
	javaArgs: string;
	javaPath: string;
	gameWidth: number;
	gameHeight: number;
	useGlobalResolution: boolean;
	useGlobalJavaArgs: boolean;
	useGlobalJavaPath: boolean;
	useGlobalHooks: boolean;
	useGlobalEnvironmentVariables: boolean;
	useGlobalLauncherAction: boolean;
	launcherActionOnLaunch: LauncherAction;
	preLaunchHook: string;
	postExitHook: string;
	wrapperCommand: string;
	environmentVariables: string;
}

export interface InstanceEditDirty {
	name: boolean;
	icon: boolean;
	minMem: boolean;
	maxMem: boolean;
	jvm: boolean;
	javaPath: boolean;
	resolution: boolean;
	hooks: boolean;
	env: boolean;
	launchAction: boolean;
}

export interface InstanceInstallDirty {
	name?: boolean;
	version?: boolean;
	loader?: boolean;
	loaderVer?: boolean;
	icon?: boolean;
	memory?: boolean;
}

export interface InstanceInstallDraft {
	name: string;
	iconPath: string;
	minecraftVersion: string;
	modloader: string;
	modloaderVersion: string;
	minMemory: number;
	maxMemory: number;
	includeSnapshots: boolean;
	dirty: InstanceInstallDirty;
}

export interface InstanceInstallDraftInput {
	initialData?: Partial<Instance> & {
		includeSnapshots?: boolean;
		_dirty?: InstanceInstallDirty;
	};
	initialName?: string;
	initialIcon?: string;
	initialVersion?: string;
	initialModloader?: string;
	initialModloaderVersion?: string;
	initialMinMemory?: number;
	initialMaxMemory?: number;
	initialIncludeSnapshots?: boolean;
	defaultIcon: string;
	defaultMinMemory: number;
	defaultMaxMemory: number;
}

export interface InstanceInstallLink {
	isModpack: boolean;
	projectId?: string | null;
	platform?: string | null;
	versionId?: string | null;
}

export function createInstanceInstallDraft(
	input: InstanceInstallDraftInput,
): InstanceInstallDraft {
	const data = input.initialData;
	return {
		name: data?.name || input.initialName || "",
		iconPath: data?.iconPath || input.initialIcon || input.defaultIcon,
		minecraftVersion: data?.minecraftVersion || input.initialVersion || "",
		modloader: data?.modloader || input.initialModloader || "vanilla",
		modloaderVersion:
			data?.modloaderVersion || input.initialModloaderVersion || "",
		minMemory:
			data?.minMemory || input.initialMinMemory || input.defaultMinMemory,
		maxMemory:
			data?.maxMemory || input.initialMaxMemory || input.defaultMaxMemory,
		includeSnapshots:
			data?.includeSnapshots ?? input.initialIncludeSnapshots ?? false,
		dirty: { ...(data?._dirty || {}) },
	};
}

export function buildInstanceInstallPayload(
	draft: Omit<InstanceInstallDraft, "dirty" | "includeSnapshots">,
	link: InstanceInstallLink,
): Partial<Instance> {
	return {
		name: draft.name,
		iconPath: draft.iconPath,
		modpackIconUrl: draft.iconPath.startsWith("http") ? draft.iconPath : null,
		minecraftVersion: draft.minecraftVersion,
		modloader: draft.modloader,
		modloaderVersion: draft.modloaderVersion || null,
		minMemory: draft.minMemory,
		maxMemory: draft.maxMemory,
		javaArgs: null,
		useGlobalResolution: true,
		useGlobalJavaArgs: true,
		useGlobalJavaPath: true,
		useGlobalHooks: true,
		useGlobalEnvironmentVariables: true,
		preLaunchHook: null,
		wrapperCommand: null,
		postExitHook: null,
		modpackId: link.isModpack ? link.projectId || null : null,
		modpackPlatform: link.isModpack ? link.platform || null : null,
		modpackVersionId: link.isModpack ? link.versionId || null : null,
	};
}

export function isInstanceEditDirty(dirty: InstanceEditDirty): boolean {
	return Object.values(dirty).some(Boolean);
}

export function applyInstanceEditDraft(
	instance: Instance,
	draft: InstanceEditDraft,
): Instance {
	return {
		...instance,
		name: draft.name,
		iconPath: draft.iconPath,
		javaArgs: draft.javaArgs || null,
		javaPath: draft.javaPath || null,
		minMemory: draft.minMemory,
		maxMemory: draft.maxMemory,
		useGlobalResolution: draft.useGlobalResolution,
		gameWidth: draft.gameWidth,
		gameHeight: draft.gameHeight,
		useGlobalJavaArgs: draft.useGlobalJavaArgs,
		useGlobalJavaPath: draft.useGlobalJavaPath,
		useGlobalHooks: draft.useGlobalHooks,
		useGlobalEnvironmentVariables: draft.useGlobalEnvironmentVariables,
		useGlobalLauncherAction: draft.useGlobalLauncherAction,
		launcherActionOnLaunch: draft.useGlobalLauncherAction
			? null
			: draft.launcherActionOnLaunch,
		preLaunchHook: draft.preLaunchHook || null,
		postExitHook: draft.postExitHook || null,
		wrapperCommand: draft.wrapperCommand || null,
		environmentVariables: draft.environmentVariables || null,
	};
}

export function toInstanceEditHandoff(
	draft: InstanceEditDraft,
	dirty: InstanceEditDirty,
): Record<string, unknown> {
	return {
		initialName: draft.name,
		initialIconPath: draft.iconPath,
		initialMinMemory: draft.minMemory,
		initialMaxMemory: draft.maxMemory,
		initialJavaArgs: draft.javaArgs,
		initialJavaPath: draft.javaPath,
		initialGameWidth: draft.gameWidth,
		initialGameHeight: draft.gameHeight,
		initialUseGlobalResolution: draft.useGlobalResolution,
		initialUseGlobalJavaArgs: draft.useGlobalJavaArgs,
		initialUseGlobalJavaPath: draft.useGlobalJavaPath,
		initialUseGlobalHooks: draft.useGlobalHooks,
		initialUseGlobalEnvironmentVariables: draft.useGlobalEnvironmentVariables,
		initialUseGlobalLauncherAction: draft.useGlobalLauncherAction,
		initialLauncherActionOnLaunch: draft.launcherActionOnLaunch,
		initialPreLaunchHook: draft.preLaunchHook,
		initialPostExitHook: draft.postExitHook,
		initialWrapperCommand: draft.wrapperCommand,
		initialEnvironmentVariables: draft.environmentVariables,
		_dirty: { ...dirty },
	};
}
