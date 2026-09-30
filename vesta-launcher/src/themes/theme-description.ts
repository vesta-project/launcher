import { t } from "~/localization";
import type { ThemeConfig } from "./types";

/** Resolve a theme's user-facing description, preserving imported theme text. */
export function getThemeDescription(theme: ThemeConfig): string | undefined {
	return (theme.descriptionId && t(theme.descriptionId)) || theme.description;
}
