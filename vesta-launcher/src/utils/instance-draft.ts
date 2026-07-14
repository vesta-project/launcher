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
