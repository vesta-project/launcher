import {
	isGuestOrDemoAccountType,
	isSkippableAuthenticatedAccount,
	normalizeOnboardingStep,
	ONBOARDING_STEP,
	type OnboardingStep,
	shouldRecoverLegacyGuestCompletion,
} from "@components/pages/init/init-flow";
import { initTheme } from "@components/theming";
import { initializeInstances } from "@stores/instances";
import { invoke } from "@tauri-apps/api/core";
import { initializeLocalization } from "~/localization";

export type StartupTarget = "home" | "init";
export type StartupAtmosphereState = "active" | "fading" | "off";

export interface InitBootstrapState {
	initStep: OnboardingStep;
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

function resolveAtmosphereState(step: OnboardingStep): StartupAtmosphereState {
	return step <= ONBOARDING_STEP.THEME ? "active" : "off";
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
	setup_step?: OnboardingStep | number | null;
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
	const forceGuestLoginOnly =
		forceLoginRequested && isGuestOrDemoAccountType(account?.account_type);
	let setupCompleted = Boolean(config.setup_completed);
	let setupStep = normalizeOnboardingStep(config.setup_step);

	if (shouldRecoverLegacyGuestCompletion(setupCompleted, setupStep)) {
		try {
			await invoke("reset_onboarding");
			setupCompleted = false;
			setupStep = ONBOARDING_STEP.SPLASH;
		} catch (error) {
			console.error("Failed to recover legacy guest completion state:", error);
		}
	}

	if (forceGuestLoginOnly) {
		return {
			target: "init",
			initState: {
				initStep: ONBOARDING_STEP.AUTH,
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
					initStep: ONBOARDING_STEP.AUTH,
					loginOnly: false,
					guideVisited: false,
					atmosphereState: "off",
				},
			};
		}

		return {
			target: "init",
			initState: {
				initStep: ONBOARDING_STEP.AUTH,
				loginOnly: true,
				guideVisited: false,
				atmosphereState: "off",
			},
		};
	}

	let resumeStep = setupStep;
	if (resumeStep === ONBOARDING_STEP.AUTH && hasValidAccount) {
		resumeStep = ONBOARDING_STEP.THEME;
		await invoke("set_setup_step", { step: ONBOARDING_STEP.THEME });
	}

	return {
		target: "init",
		initState: {
			initStep: resumeStep,
			loginOnly: false,
			guideVisited: resumeStep === ONBOARDING_STEP.LEARN,
			atmosphereState: resolveAtmosphereState(resumeStep),
		},
	};
}

export async function bootstrapStartup(): Promise<StartupBootstrapResult> {
	if (bootstrapPromise) {
		return await bootstrapPromise;
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

		initializeLocalization(config.language);

		let account: Record<string, any> | null = null;
		try {
			account = (await invoke("get_active_account")) as Record<
				string,
				any
			> | null;
		} catch (error) {
			console.error("Failed to load active account during startup:", error);
		}

		const resolved = await resolveInitStateFromConfigAndAccount(
			config,
			account,
			forceLoginRequested,
		);
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

	return await bootstrapPromise;
}
