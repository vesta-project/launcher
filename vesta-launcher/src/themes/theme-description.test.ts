import { describe, expect, it } from "vitest";
import { applyLanguagePreference } from "~/localization";
import { getThemeDescription } from "./theme-description";

describe("getThemeDescription", () => {
	it("resolves localized descriptions for built-in themes", () => {
		applyLanguagePreference("en");

		expect(
			getThemeDescription({
				id: "solar",
				name: "Solar",
				descriptionId: "settings-appearance-theme-solar-description",
				primaryHue: 30,
				opacity: 0,
				gradientEnabled: true,
			}),
		).toBe("Signature warm orange frosted finish with soft diffusion");
	});

	it("preserves literal descriptions for imported themes", () => {
		expect(
			getThemeDescription({
				id: "imported-example",
				name: "Imported Example",
				description: "My imported theme description",
				primaryHue: 30,
				opacity: 0,
				gradientEnabled: true,
			}),
		).toBe("My imported theme description");
	});
});
