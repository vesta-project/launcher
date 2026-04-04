import { describe, expect, it } from "vitest";
import {
    getCanonicalBackStep,
    getNextInitStep,
    getPreviousInitStep,
    INIT_STEPS,
    normalizeInitStep,
} from "./init-flow";

describe("init-flow", () => {
	it("normalizes invalid step values to welcome", () => {
		expect(normalizeInitStep(undefined)).toBe(INIT_STEPS.WELCOME);
		expect(normalizeInitStep("not-a-number")).toBe(INIT_STEPS.WELCOME);
		expect(normalizeInitStep(-12)).toBe(INIT_STEPS.WELCOME);
	});

	it("normalizes out-of-range values to boundaries", () => {
		expect(normalizeInitStep(999)).toBe(INIT_STEPS.FINISHED);
		expect(normalizeInitStep(3.9)).toBe(INIT_STEPS.JAVA);
	});

	it("returns bounded next and previous steps", () => {
		expect(getNextInitStep(INIT_STEPS.WELCOME)).toBe(INIT_STEPS.GUIDE);
		expect(getNextInitStep(INIT_STEPS.FINISHED)).toBe(INIT_STEPS.FINISHED);

		expect(getPreviousInitStep(INIT_STEPS.LOGIN)).toBe(INIT_STEPS.GUIDE);
		expect(getPreviousInitStep(INIT_STEPS.WELCOME)).toBe(INIT_STEPS.WELCOME);
	});

	it("routes login back target based on guide visitation", () => {
		expect(getCanonicalBackStep(INIT_STEPS.LOGIN, false)).toBe(
			INIT_STEPS.WELCOME,
		);
		expect(getCanonicalBackStep(INIT_STEPS.LOGIN, true)).toBe(
			INIT_STEPS.GUIDE,
		);
	});
});
