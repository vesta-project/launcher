import { createSignal, onCleanup } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import {
	getCanonicalBackStep,
	getNextOnboardingStep,
	isGuestOrDemoAccountType,
	isSkippableAuthenticatedAccount,
	normalizeOnboardingStep,
	ONBOARDING_STEP,
	type OnboardingStep,
	shouldRecoverLegacyGuestCompletion,
} from "../init-flow";

type NavigationDirection = "forward" | "backward" | "direct";

export interface OnboardingFlowState {
	step: OnboardingStep;
	stepHistory: OnboardingStep[];
	learnCompleted: boolean;
	isLoginOnly: boolean;
	atmosphereState: "active" | "fading" | "off";
}

export interface OnboardingFlowActions {
	goToStep: (step: OnboardingStep) => Promise<void>;
	goNext: () => Promise<void>;
	goBack: () => Promise<void>;
	markLearnCompleted: () => void;
	exitLoginOnlyMode: () => void;
	fadeAtmosphere: () => void;
}

export function useOnboardingFlow(initialState: Partial<OnboardingFlowState> = {}) {
	const initialStep = initialState.step ?? ONBOARDING_STEP.SPLASH;
	const [step, setStep] = createSignal<OnboardingStep>(initialStep);
	const [stepHistory, setStepHistory] = createSignal<OnboardingStep[]>([initialStep]);
	const [learnCompleted, setLearnCompleted] = createSignal(initialState.learnCompleted ?? false);
	const [isLoginOnly, setIsLoginOnly] = createSignal(initialState.isLoginOnly ?? false);
	const [atmosphereState, setAtmosphereState] = createSignal<
		"active" | "fading" | "off"
	>(initialState.atmosphereState ?? "active");

	let atmosphereFadeTimer: ReturnType<typeof setTimeout> | null = null;

	const clearAtmosphereFadeTimer = () => {
		if (atmosphereFadeTimer) {
			clearTimeout(atmosphereFadeTimer);
			atmosphereFadeTimer = null;
		}
	};

	onCleanup(() => {
		clearAtmosphereFadeTimer();
	});

	const persistStep = async (s: OnboardingStep) => {
		if (isLoginOnly()) return;
		try {
			await invoke("set_setup_step", { step: s });
		} catch (error) {
			console.error("Failed to persist onboarding step:", error);
		}
	};

	const applyStep = async (
		s: OnboardingStep,
		options?: { replaceHistory?: boolean; recordHistory?: boolean; persist?: boolean },
	) => {
		setStep(s);

		if (s === ONBOARDING_STEP.LEARN) {
			setLearnCompleted(true);
		}

		if (options?.replaceHistory) {
			setStepHistory([s]);
		} else if (options?.recordHistory !== false) {
			setStepHistory((prev) => {
				if (prev[prev.length - 1] === s) return prev;
				return [...prev, s];
			});
		}

		if (options?.persist !== false) {
			await persistStep(s);
		}
	};

	const hasValidSession = async () => {
		try {
			const account = await invoke<any>("get_active_account");
			return isSkippableAuthenticatedAccount(account);
		} catch (error) {
			console.error("Failed to check active account:", error);
			return false;
		}
	};

	const getDirection = (from: OnboardingStep, to: OnboardingStep): NavigationDirection => {
		if (to > from) return "forward";
		if (to < from) return "backward";
		return "direct";
	};

	const resolveStepWithGuards = async (
		requestedStep: OnboardingStep,
		direction: NavigationDirection,
	): Promise<OnboardingStep> => {
		if (requestedStep !== ONBOARDING_STEP.AUTH) {
			return requestedStep;
		}

		if (isLoginOnly()) {
			return ONBOARDING_STEP.AUTH;
		}

		const validSession = await hasValidSession();
		if (!validSession) {
			return ONBOARDING_STEP.AUTH;
		}

		if (direction === "backward") {
			return learnCompleted() ? ONBOARDING_STEP.LEARN : ONBOARDING_STEP.SPLASH;
		}

		return ONBOARDING_STEP.THEME;
	};

	const goToStep = async (
		rawStep: number,
		options?: { replaceHistory?: boolean; recordHistory?: boolean },
	) => {
		const requestedStep = normalizeOnboardingStep(rawStep);
		const direction = getDirection(step(), requestedStep);
		const targetStep = await resolveStepWithGuards(requestedStep, direction);
		await applyStep(targetStep, {
			replaceHistory: options?.replaceHistory,
			recordHistory: options?.recordHistory,
		});
	};

	const goNext = async () => {
		const nextStep = getNextOnboardingStep(step());
		await goToStep(nextStep);
	};

	const goBack = async () => {
		if (isLoginOnly()) return;

		const history = stepHistory();
		if (history.length > 1) {
			const historyWithoutCurrent = history.slice(0, -1);
			const previousStep = historyWithoutCurrent[historyWithoutCurrent.length - 1];
			const guardedPreviousStep = await resolveStepWithGuards(previousStep, "backward");

			if (guardedPreviousStep !== previousStep) {
				const targetIndex = historyWithoutCurrent.lastIndexOf(guardedPreviousStep);
				if (targetIndex >= 0) {
					setStepHistory(historyWithoutCurrent.slice(0, targetIndex + 1));
				} else {
					setStepHistory([...historyWithoutCurrent, guardedPreviousStep]);
				}
			} else {
				setStepHistory(historyWithoutCurrent);
			}

			await applyStep(guardedPreviousStep, { recordHistory: false });
			return;
		}

		const fallbackStep = getCanonicalBackStep(step(), learnCompleted());
		const targetStep = await resolveStepWithGuards(fallbackStep, "backward");
		await applyStep(targetStep, { recordHistory: false });
	};

	const markLearnCompleted = () => {
		setLearnCompleted(true);
	};

	const exitLoginOnlyMode = () => {
		setIsLoginOnly(false);
	};

	const fadeAtmosphere = () => {
		if (atmosphereState() === "off") return;

		const reducedMotion = document.documentElement.getAttribute("data-reduced-motion") === "true";
		if (reducedMotion) {
			clearAtmosphereFadeTimer();
			setAtmosphereState("off");
			return;
		}

		if (atmosphereState() !== "fading") {
			setAtmosphereState("fading");
		}

		clearAtmosphereFadeTimer();
		atmosphereFadeTimer = setTimeout(() => {
			setAtmosphereState("off");
			atmosphereFadeTimer = null;
		}, 800);
	};

	const setLoginOnly = (value: boolean) => {
		setIsLoginOnly(value);
	};

	return {
		step,
		stepHistory,
		learnCompleted,
		isLoginOnly,
		atmosphereState,
		goToStep,
		goNext,
		goBack,
		markLearnCompleted,
		exitLoginOnlyMode,
		setLoginOnly,
		fadeAtmosphere,
	};
}
