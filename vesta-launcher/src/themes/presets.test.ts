import { describe, expect, it } from "vitest";
import { configToTheme } from "./presets";

describe("configToTheme", () => {
	it("does not use legacy theme_advanced_overrides as custom css fallback", () => {
		const theme = configToTheme({
			theme_id: "classic",
			theme_primary_hue: 210,
			theme_style: "flat",
			theme_gradient_enabled: false,
			theme_advanced_overrides: ":root { --legacy-leak: 1; }",
		} as any);

		expect(theme.customCss).toBeUndefined();
	});
});
