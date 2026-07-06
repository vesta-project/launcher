import { describe, expect, it } from "vitest";
import {
	getCanonicalBackStep,
	getNextOnboardingStep,
	getPreviousOnboardingStep,
	isGuestOrDemoAccountType,
	isSkippableAuthenticatedAccount,
	normalizeOnboardingStep,
	ONBOARDING_STEP,
	shouldRecoverLegacyGuestCompletion,
} from "./init-flow";

describe("init-flow", () => {
	it("normalizes invalid step values to splash", () => {
		expect(normalizeOnboardingStep(undefined)).toBe(ONBOARDING_STEP.SPLASH);
		expect(normalizeOnboardingStep("not-a-number")).toBe(
			ONBOARDING_STEP.SPLASH,
		);
		expect(normalizeOnboardingStep(-12)).toBe(ONBOARDING_STEP.SPLASH);
	});

	it("normalizes out-of-range values to boundaries", () => {
		expect(normalizeOnboardingStep(999)).toBe(ONBOARDING_STEP.COMPLETE);
		expect(normalizeOnboardingStep(3.9)).toBe(ONBOARDING_STEP.LEARN);
	});

	it("returns bounded next and previous steps", () => {
		expect(getNextOnboardingStep(ONBOARDING_STEP.SPLASH)).toBe(
			ONBOARDING_STEP.CREDITS,
		);
		expect(getNextOnboardingStep(ONBOARDING_STEP.COMPLETE)).toBe(
			ONBOARDING_STEP.COMPLETE,
		);

		expect(getPreviousOnboardingStep(ONBOARDING_STEP.AUTH)).toBe(
			ONBOARDING_STEP.CREDITS,
		);
		expect(getPreviousOnboardingStep(ONBOARDING_STEP.SPLASH)).toBe(
			ONBOARDING_STEP.SPLASH,
		);
	});

	it("routes auth back to splash even when learn was already visited", () => {
		expect(getCanonicalBackStep(ONBOARDING_STEP.AUTH, false)).toBe(
			ONBOARDING_STEP.SPLASH,
		);
		expect(getCanonicalBackStep(ONBOARDING_STEP.AUTH, true)).toBe(
			ONBOARDING_STEP.SPLASH,
		);
	});

	it("detects stale guest completion states for recovery", () => {
		expect(
			shouldRecoverLegacyGuestCompletion(true, ONBOARDING_STEP.SPLASH),
		).toBe(true);
		expect(
			shouldRecoverLegacyGuestCompletion(true, ONBOARDING_STEP.CREDITS),
		).toBe(true);
		expect(shouldRecoverLegacyGuestCompletion(true, ONBOARDING_STEP.AUTH)).toBe(
			true,
		);
		expect(
			shouldRecoverLegacyGuestCompletion(true, ONBOARDING_STEP.THEME),
		).toBe(false);
		expect(
			shouldRecoverLegacyGuestCompletion(false, ONBOARDING_STEP.AUTH),
		).toBe(false);
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
