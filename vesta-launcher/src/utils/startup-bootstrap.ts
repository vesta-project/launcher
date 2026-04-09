import {
	INIT_STEPS,
	type InitStep,
	isGuestOrDemoAccountType,
	isSkippableAuthenticatedAccount,
	normalizeInitStep,
	shouldRecoverLegacyGuestCompletion,
} from "@components/pages/init/init-flow";
import { initTheme } from "@components/theming";
import { initializeInstances } from "@stores/instances";
import { invoke } from "@tauri-apps/api/core";

export type StartupTarget = "home" | "init";
export type StartupAtmosphereState = "active" | "fading" | "off";

export interface InitBootstrapState {
	initStep: InitStep;
	loginOnly: boolean;
	guideVisited: boolean;
	atmosphereState: StartupAtmosphereState;
}

export interface StartupBootstrapResult {
	target: StartupTarget;
}

let bootstrapPromise: Promise<StartupBootstrapResult> | null = null;
let initBootstrapState: InitBootstrapState | null = null;

function getForceLoginRequested(): boolean {
	const searchParams = new URLSearchParams(window.location.search);
	return searchParams.get("login") === "true";
}

function resolveAtmosphereState(step: InitStep): StartupAtmosphereState {
	return step <= INIT_STEPS.APPEARANCE ? "active" : "off";
}

function isRootPath(pathname: string): boolean {
	return pathname === "/" || pathname === "/index.html";
}

export function applyStartupRouteTarget(target: StartupTarget): void {
	const { pathname, search, hash } = window.location;

	if (!isRootPath(pathname)) {
		return;
	}

	if (target === "home") {
		if (pathname !== "/home") {
			window.history.replaceState(window.history.state, "", "/home");
		}
		return;
	}

	const nextPath = `/${search}${hash}`;
	if (`${pathname}${search}${hash}` !== nextPath) {
		window.history.replaceState(window.history.state, "", nextPath);
	}
}

export function consumeInitBootstrapState(): InitBootstrapState | null {
	const state = initBootstrapState;
	initBootstrapState = null;
	return state;
}

interface StartupConfig {
	setup_completed?: boolean;
	setup_step?: InitStep | number | null;
}

interface StartupAccount {
	account_type?: string | null;
}

async function resolveInitStateFromConfigAndAccount(
	config: StartupConfig,
	account: StartupAccount | null,
	forceLoginRequested: boolean,
): Promise<{ target: StartupTarget; initState: InitBootstrapState }> {
	const hasValidAccount = isSkippableAuthenticatedAccount(account);
	const forceGuestLoginOnly = forceLoginRequested && isGuestOrDemoAccountType(account?.account_type);
	let setupCompleted = Boolean(config.setup_completed);
	let setupStep = normalizeInitStep(config.setup_step);

	if (shouldRecoverLegacyGuestCompletion(setupCompleted, setupStep)) {
		try {
			await invoke("reset_onboarding");
			setupCompleted = false;
			setupStep = INIT_STEPS.WELCOME;
		} catch (error) {
			console.error("Failed to recover legacy guest completion state:", error);
		}
	}

	if (forceGuestLoginOnly) {
		return {
			target: "init",
			initState: {
				initStep: INIT_STEPS.LOGIN,
				loginOnly: true,
				guideVisited: false,
				atmosphereState: "off",
			},
		};
	}

	if (setupCompleted) {
		if (hasValidAccount && !forceLoginRequested) {
			return {
				target: "home",
				initState: {
					initStep: INIT_STEPS.LOGIN,
					loginOnly: false,
					guideVisited: false,
					atmosphereState: "off",
				},
			};
		}

		return {
			target: "init",
			initState: {
				initStep: INIT_STEPS.LOGIN,
				loginOnly: true,
				guideVisited: false,
				atmosphereState: "off",
			},
		};
	}

	let resumeStep = setupStep;
	if (resumeStep === INIT_STEPS.LOGIN && hasValidAccount) {
		resumeStep = INIT_STEPS.JAVA;
		await invoke("set_setup_step", { step: INIT_STEPS.JAVA });
	}

	return {
		target: "init",
		initState: {
			initStep: resumeStep,
			loginOnly: false,
			guideVisited: resumeStep === INIT_STEPS.GUIDE,
			atmosphereState: resolveAtmosphereState(resumeStep),
		},
	};
}

export async function bootstrapStartup(): Promise<StartupBootstrapResult> {
	if (bootstrapPromise) {
		return bootstrapPromise;
	}

	bootstrapPromise = (async () => {
		const forceLoginRequested = getForceLoginRequested();

		let config: Record<string, any> = {};
		try {
			const themedConfig = await initTheme();
			if (themedConfig) {
				config = themedConfig;
			} else {
				config = (await invoke("get_config")) as Record<string, any>;
			}
		} catch (error) {
			console.error("Failed to load startup config:", error);
		}

		let account: Record<string, any> | null = null;
		try {
			account = (await invoke("get_active_account")) as Record<string, any> | null;
		} catch (error) {
			console.error("Failed to load active account during startup:", error);
		}

		const resolved = await resolveInitStateFromConfigAndAccount(config, account, forceLoginRequested);
		const rootStartupPath = isRootPath(window.location.pathname);

		if (resolved.target === "home") {
			initBootstrapState = null;
			try {
				await initializeInstances();
			} catch (error) {
				console.error("Failed to preload instances during startup:", error);
			}
		} else if (rootStartupPath) {
			initBootstrapState = resolved.initState;
		} else {
			initBootstrapState = null;
		}

		return {
			target: resolved.target,
		};
	})();

	return bootstrapPromise;
}
