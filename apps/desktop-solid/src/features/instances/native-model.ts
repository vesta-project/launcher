import type { InstanceCardState } from "./instance-card";
import type { InstancePreferences } from "./preferences";

export interface NativeInstance {
	id: number;
	name: string;
	minecraftVersion: string;
	modloader: string | null;
	modloaderVersion: string | null;
	javaPath: string | null;
	javaArgs: string | null;
	gameDirectory: string | null;
	minMemory: number;
	maxMemory: number;
	iconPath: string | null;
	lastPlayed: string | null;
	totalPlaytimeMinutes: number;
	createdAt: string | null;
	updatedAt: string | null;
	// The backend appends the failure reason (`failed:<reason>`), so this must
	// remain a string rather than a closed union of the base status names.
	installationStatus?: string | null;
	crashed?: boolean;
	crashDetails?: string | null;
	modpackId: string | null;
	modpackVersionId: string | null;
	modpackPlatform: string | null;
	modpackIconUrl: string | null;
	iconData: number[] | null;

	// Instance Defaults & Linking
	useGlobalResolution: boolean;
	useGlobalJavaArgs: boolean;
	useGlobalJavaPath: boolean;
	useGlobalHooks: boolean;
	useGlobalEnvironmentVariables: boolean;
	useGlobalGameDir: boolean;
	useGlobalLauncherAction: boolean;
	launcherActionOnLaunch:
		| "stay-open"
		| "minimize"
		| "hide-to-tray"
		| "quit"
		| null;
	gameWidth: number;
	gameHeight: number;
	environmentVariables: string | null;
	preLaunchHook: string | null;
	postExitHook: string | null;
	wrapperCommand: string | null;

	useGlobalSandbox: boolean;
	sandboxPreset: string | null;
	sandboxWrapperNesting: string | null;
	sandboxExtraPaths: string;

	/**
	 * Identifier of the last lifecycle operation performed on this instance.
	 *
	 * This is set by the backend/task manager whenever a significant operation
	 * is executed for the instance, and can be used by the frontend to show
	 * contextual status or history in the UI.
	 *
	 * Common values include:
	 * - "install"      — initial installation of the instance/modpack
	 * - "repair"       — repair or re-apply the instance files
	 * - "hard-reset"   — full reset of the instance to a clean state
	 * - "update"       — update of the instance or its modpack
	 *
	 * May be `null` or `undefined` if no tracked operation has been performed yet,
	 * or if the backend does not report an operation for this instance.
	 */
	lastOperation?: string | null;
}


export function instanceSlug(name: string): string {
  // Match Rust sanitize_instance_name, including punctuation and non-ASCII runs.
  let result = '', dash = false;
  for (const char of name.trim().toLowerCase()) {
    if (/^[a-z0-9_-]$/.test(char)) { result += char; dash = false; }
    else if (!dash) { result += '-'; dash = true; }
  }
  return (result.replace(/^-+|-+$/g, '') || 'instance').slice(0, 64);
}

export function instanceState(instance: NativeInstance, runtime?: 'warming' | 'running'): InstanceCardState {
  if (runtime) return { kind: runtime };
  const status = instance.installationStatus;
  if (status === 'installing') return { kind: 'installing', label: instance.lastOperation || 'Installing' };
  if (status?.startsWith('failed')) return { kind: 'failed', reason: status.slice(7) || 'Installation failed' };
  if (status === 'interrupted' || !status || status === 'pending') return {
    kind: 'interrupted', initial: !status || status === 'pending', label: instance.lastOperation || 'Install', recovery: instance.lastOperation === 'update',
  };
  if (instance.crashed) {
    let summary = instance.crashDetails || undefined;
    try { const details = JSON.parse(summary || '{}'); summary = details.message || details.title || summary; } catch { /* legacy plain-text reason */ }
    return { kind: 'crashed', summary };
  }
  return { kind: 'idle' };
}

export function preferencesFromNative(instance: NativeInstance): InstancePreferences {
  return {
    java: instance.useGlobalJavaPath ? 'default' : instance.javaPath ? 'custom' : 'auto',
    javaPath: instance.javaPath ?? '', inheritMemory: false,
    minMemory: instance.minMemory, maxMemory: instance.maxMemory,
    inheritArgs: instance.useGlobalJavaArgs, args: instance.javaArgs ?? '',
    inheritResolution: instance.useGlobalResolution, width: instance.gameWidth, height: instance.gameHeight,
    inheritCommands: instance.useGlobalHooks, preLaunch: instance.preLaunchHook ?? '',
    postExit: instance.postExitHook ?? '', wrapper: instance.wrapperCommand ?? '',
    inheritEnvironment: instance.useGlobalEnvironmentVariables, environment: instance.environmentVariables ?? '',
    inheritLauncherAction: instance.useGlobalLauncherAction,
    launcherAction: ({ 'stay-open': 'keep', 'hide-to-tray': 'hide' } as Record<string, string>)[instance.launcherActionOnLaunch ?? ''] ?? instance.launcherActionOnLaunch ?? 'keep',
    inheritSandbox: instance.useGlobalSandbox, sandboxPreset: instance.sandboxPreset ?? 'modded',
    sandboxWrapper: !instance.sandboxWrapperNesting || instance.sandboxWrapperNesting.replaceAll('_', '-') === 'sandbox-outside',
  };
}

/** Patch a freshly loaded native record. Preserve all fields the form doesn't own. */
export function preferencesPatch(instance: NativeInstance, values: InstancePreferences): NativeInstance {
  if (!Number.isFinite(values.minMemory) || !Number.isFinite(values.maxMemory)
    || values.minMemory < 512 || values.maxMemory < values.minMemory) throw new Error('Invalid memory allocation');
  if (!values.inheritResolution && (!Number.isInteger(values.width) || !Number.isInteger(values.height) || values.width < 1 || values.height < 1)) throw new Error('Invalid game resolution');
  if (!['trusted', 'modded', 'paranoid'].includes(values.sandboxPreset) && !values.inheritSandbox) throw new Error('Invalid sandbox preset');
  if (values.java === 'custom' && !values.javaPath.trim()) throw new Error('Choose a Java executable');
  return { ...instance,
    useGlobalJavaPath: values.java === 'default', javaPath: values.java === 'custom' ? values.javaPath.trim() : null,
    minMemory: values.minMemory, maxMemory: values.maxMemory,
    useGlobalJavaArgs: values.inheritArgs, javaArgs: values.args || null,
    useGlobalResolution: values.inheritResolution, gameWidth: values.width, gameHeight: values.height,
    useGlobalHooks: values.inheritCommands, preLaunchHook: values.preLaunch || null,
    postExitHook: values.postExit || null, wrapperCommand: values.wrapper || null,
    useGlobalEnvironmentVariables: values.inheritEnvironment, environmentVariables: values.environment || null,
    useGlobalLauncherAction: values.inheritLauncherAction,
    launcherActionOnLaunch: values.launcherAction === 'keep' ? 'stay-open' : values.launcherAction === 'hide' ? 'hide-to-tray' : values.launcherAction === 'quit' ? 'quit' : 'minimize',
    useGlobalSandbox: values.inheritSandbox,
    sandboxPreset: values.inheritSandbox ? instance.sandboxPreset : values.sandboxPreset,
    sandboxWrapperNesting: values.inheritSandbox ? instance.sandboxWrapperNesting : values.sandboxWrapper ? 'sandbox-outside' : 'wrapper-outside',
  };
}

export function newNativeInstance(name: string, version: string, loader = 'vanilla', loaderVersion = ''): NativeInstance {
  if (loader !== 'vanilla' && !loaderVersion) throw new Error('Choose a compatible loader version');
  if (!name.trim() || !version) throw new Error('Choose an instance name and Minecraft version');
  return {
    id: 0, name: name.trim(), minecraftVersion: version, modloader: loader === 'vanilla' ? null : loader,
    modloaderVersion: loader === 'vanilla' ? null : loaderVersion, javaPath: null, javaArgs: null,
    gameDirectory: null, minMemory: 2048, maxMemory: 4096, gameWidth: 854, gameHeight: 480,
    iconPath: 'builtin:placeholder-1', iconData: null, lastPlayed: null, totalPlaytimeMinutes: 0,
    createdAt: null, updatedAt: null, installationStatus: null, crashed: false, crashDetails: null,
    modpackId: null, modpackVersionId: null, modpackPlatform: null, modpackIconUrl: null,
    useGlobalResolution: true, useGlobalJavaArgs: true, useGlobalJavaPath: true, useGlobalHooks: true,
    useGlobalEnvironmentVariables: true, useGlobalGameDir: true, useGlobalLauncherAction: true,
    launcherActionOnLaunch: null, environmentVariables: null, preLaunchHook: null, postExitHook: null,
    wrapperCommand: null, useGlobalSandbox: true, sandboxPreset: null, sandboxWrapperNesting: null,
    sandboxExtraPaths: '[]',
  };
}
