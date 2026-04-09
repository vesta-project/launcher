import { describe, expect, it } from "vitest";
import {
	getCanonicalBackStep,
	getNextInitStep,
	getPreviousInitStep,
	INIT_STEPS,
	isGuestOrDemoAccountType,
	isSkippableAuthenticatedAccount,
	normalizeInitStep,
	shouldRecoverLegacyGuestCompletion,
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
		expect(getCanonicalBackStep(INIT_STEPS.LOGIN, false)).toBe(INIT_STEPS.WELCOME);
		expect(getCanonicalBackStep(INIT_STEPS.LOGIN, true)).toBe(INIT_STEPS.GUIDE);
	});

	it("detects stale guest completion states for recovery", () => {
		expect(shouldRecoverLegacyGuestCompletion(true, INIT_STEPS.WELCOME)).toBe(true);
		expect(shouldRecoverLegacyGuestCompletion(true, INIT_STEPS.GUIDE)).toBe(true);
		expect(shouldRecoverLegacyGuestCompletion(true, INIT_STEPS.LOGIN)).toBe(true);
		expect(shouldRecoverLegacyGuestCompletion(true, INIT_STEPS.JAVA)).toBe(false);
		expect(shouldRecoverLegacyGuestCompletion(false, INIT_STEPS.LOGIN)).toBe(false);
	});

	it("treats guest and demo accounts as non-skippable auth sessions", () => {
		expect(
			isSkippableAuthenticatedAccount({
				account_type: "Guest",
				is_expired: false,
			}),
		).toBe(false);
		expect(
			isSkippableAuthenticatedAccount({
				account_type: "demo",
				is_expired: false,
			}),
		).toBe(false);
		expect(
			isSkippableAuthenticatedAccount({
				account_type: "Microsoft",
				is_expired: false,
			}),
		).toBe(true);
		expect(
			isSkippableAuthenticatedAccount({
				account_type: "Microsoft",
				is_expired: true,
			}),
		).toBe(false);
	});

	it("detects guest and demo account types case-insensitively", () => {
		expect(isGuestOrDemoAccountType("Guest")).toBe(true);
		expect(isGuestOrDemoAccountType("demo")).toBe(true);
		expect(isGuestOrDemoAccountType("Microsoft")).toBe(false);
		expect(isGuestOrDemoAccountType(null)).toBe(false);
	});
});
