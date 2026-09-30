import { beforeEach, describe, expect, it } from "vitest";
import {
	applyLanguagePreference,
	effectiveLocale,
	formatNumber,
	languagePreference,
	resolveLocale,
	SYSTEM_LANGUAGE,
	t,
	tPlain,
} from "./index";

describe("localization", () => {
	beforeEach(() => {
		applyLanguagePreference("en", ["en-AU"]);
	});

	it("resolves exact and base-language preferences", () => {
		expect(resolveLocale("en-AU")).toBe("en");
		expect(resolveLocale("EN_us")).toBe("en");
	});

	it("uses the system locale and falls back to English", () => {
		expect(resolveLocale(SYSTEM_LANGUAGE, ["en-AU"])).toBe("en");
		expect(resolveLocale(SYSTEM_LANGUAGE, ["zz-ZZ"])).toBe("en");
	});

	it("tracks the preference separately from the effective locale", () => {
		applyLanguagePreference(SYSTEM_LANGUAGE, ["en-AU"]);

		expect(languagePreference()).toBe(SYSTEM_LANGUAGE);
		expect(effectiveLocale()).toBe("en");
		expect(document.documentElement.lang).toBe("en");
		expect(document.documentElement.dir).toBe("ltr");
	});

	it("canonicalizes unsupported persisted preferences", () => {
		applyLanguagePreference("removed-locale", ["zz-ZZ"]);

		expect(languagePreference()).toBe("en");
		expect(effectiveLocale()).toBe("en");
	});

	it("formats catalog messages and exposes missing keys safely", () => {
		expect(t("settings-language-label")).toBe("Launcher language");
		expect(t("missing-message-id")).toBe("missing-message-id");
	});

	it("removes Fluent isolation marks from plain values only", () => {
		expect(t("action-duplicate-instance-default-name", { instanceName: "World" }))
			.toContain("\u2068World\u2069");
		expect(tPlain("action-duplicate-instance-default-name", { instanceName: "World" }))
			.toBe("World (Copy)");
		expect(tPlain("settings-language-label")).toBe("Launcher language");
	});

	it("formats numbers with the effective locale", () => {
		expect(formatNumber(1234)).toBe(new Intl.NumberFormat("en").format(1234));
	});
});
