export const INIT_STEPS = {
	WELCOME: 0,
	GUIDE: 1,
	LOGIN: 2,
	JAVA: 3,
	APPEARANCE: 4,
	DATA_STORAGE: 5,
	INSTALLATION: 6,
	FINISHED: 7,
} as const;

export type InitStep = (typeof INIT_STEPS)[keyof typeof INIT_STEPS];

const MIN_INIT_STEP = INIT_STEPS.WELCOME;
const MAX_INIT_STEP = INIT_STEPS.FINISHED;

export function normalizeInitStep(step: unknown): InitStep {
	const numeric = Number(step);
	if (!Number.isFinite(numeric)) {
		return INIT_STEPS.WELCOME;
	}

	const truncated = Math.trunc(numeric);
	if (truncated < MIN_INIT_STEP) {
		return MIN_INIT_STEP;
	}
	if (truncated > MAX_INIT_STEP) {
		return MAX_INIT_STEP;
	}

	return truncated as InitStep;
}

export function getNextInitStep(step: InitStep): InitStep {
	if (step >= MAX_INIT_STEP) {
		return MAX_INIT_STEP;
	}
	return (step + 1) as InitStep;
}

export function getPreviousInitStep(step: InitStep): InitStep {
	if (step <= MIN_INIT_STEP) {
		return MIN_INIT_STEP;
	}
	return (step - 1) as InitStep;
}

export function getCanonicalBackStep(
	step: InitStep,
	guideVisited: boolean,
): InitStep {
	if (step === INIT_STEPS.LOGIN) {
		return guideVisited ? INIT_STEPS.GUIDE : INIT_STEPS.WELCOME;
	}

	return getPreviousInitStep(step);
}

/**
 * Recover from legacy guest-mode state where setup_completed was written
 * while onboarding was still on early steps (welcome/guide/login).
 */
export function shouldRecoverLegacyGuestCompletion(
	setupCompleted: boolean,
	setupStep: unknown,
): boolean {
	if (!setupCompleted) {
		return false;
	}

	return normalizeInitStep(setupStep) <= INIT_STEPS.LOGIN;
}

interface InitAccountLike {
	is_expired?: boolean | null;
	account_type?: string | null;
}

export function isGuestOrDemoAccountType(
	accountType?: string | null,
): boolean {
	const normalizedType = String(accountType || "")
		.trim()
		.toLowerCase();
	return normalizedType === "guest" || normalizedType === "demo";
}

export function isSkippableAuthenticatedAccount(
	account: InitAccountLike | null | undefined,
): boolean {
	if (!account || account.is_expired) {
		return false;
	}

	return !isGuestOrDemoAccountType(account.account_type);
}
