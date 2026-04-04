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
