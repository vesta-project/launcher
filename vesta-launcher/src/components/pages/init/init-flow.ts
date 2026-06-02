export const ONBOARDING_STEP = {
	SPLASH: 0,
	CREDITS: 1,
	AUTH: 2,
	LEARN: 3,
	THEME: 4,
	FIRST_INSTANCE: 5,
	COMPLETE: 6,
} as const;

export type OnboardingStep = (typeof ONBOARDING_STEP)[keyof typeof ONBOARDING_STEP];

const MIN_STEP = ONBOARDING_STEP.SPLASH;
const MAX_STEP = ONBOARDING_STEP.COMPLETE;

export function normalizeOnboardingStep(step: unknown): OnboardingStep {
	const numeric = Number(step);
	if (!Number.isFinite(numeric)) {
		return ONBOARDING_STEP.SPLASH;
	}
	const truncated = Math.trunc(numeric);
	if (truncated < MIN_STEP) {
		return MIN_STEP;
	}
	if (truncated > MAX_STEP) {
		return MAX_STEP;
	}
	return truncated as OnboardingStep;
}

export function getNextOnboardingStep(step: OnboardingStep): OnboardingStep {
	if (step >= MAX_STEP) {
		return MAX_STEP;
	}
	const next = (step + 1) as OnboardingStep;
	if (next === ONBOARDING_STEP.LEARN) {
		return (next + 1) as OnboardingStep;
	}
	return next;
}

export function getPreviousOnboardingStep(step: OnboardingStep): OnboardingStep {
	if (step <= MIN_STEP) {
		return MIN_STEP;
	}
	const prev = (step - 1) as OnboardingStep;
	if (prev === ONBOARDING_STEP.LEARN) {
		return (prev - 1) as OnboardingStep;
	}
	return prev;
}

export function getCanonicalBackStep(
	step: OnboardingStep,
	learnCompleted: boolean,
): OnboardingStep {
	if (step === ONBOARDING_STEP.AUTH) {
		return ONBOARDING_STEP.SPLASH;
	}
	return getPreviousOnboardingStep(step);
}

export function shouldRecoverLegacyGuestCompletion(
	setupCompleted: boolean,
	setupStep: unknown,
): boolean {
	if (!setupCompleted) {
		return false;
	}
	const normalized = normalizeOnboardingStep(setupStep);
	// Legacy steps: WELCOME(0), GUIDE(1), LOGIN(2) map roughly to SPLASH(0), LEARN(3), AUTH(2).
	// If setup is marked complete but step is very early, something is wrong.
	return normalized <= ONBOARDING_STEP.AUTH;
}

interface OnboardingAccountLike {
	is_expired?: boolean | null;
	account_type?: string | null;
}

export function isGuestOrDemoAccountType(accountType?: string | null): boolean {
	const normalized = String(accountType || "").trim().toLowerCase();
	return normalized === "guest" || normalized === "demo";
}

export function isSkippableAuthenticatedAccount(
	account: OnboardingAccountLike | null | undefined,
): boolean {
	if (!account || account.is_expired) {
		return false;
	}
	return !isGuestOrDemoAccountType(account.account_type);
}
