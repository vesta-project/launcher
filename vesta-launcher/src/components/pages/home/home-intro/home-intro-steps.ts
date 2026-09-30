import { t } from "~/localization";
export interface IntroStep {
	id: string;
	kind: "modal" | "cards" | "ring";
	title: string;
	description: string;
	buttonText: string;
	targetSelector?: string;
	tooltipPlacement?: "right" | "left" | "top" | "bottom";
}

export function getIntroSteps(): IntroStep[] {
	return [
	{
		id: "welcome",
		kind: "modal",
		title: t("app-shell-welcome-title"),
		description:
			t("app-shell-welcome-description"),
		buttonText: t("app-shell-continue"),
	},
	{
		id: "instances",
		kind: "cards",
		title: t("app-shell-your-instances"),
		description:
			t("app-shell-your-instances-description"),
		buttonText: t("app-shell-continue"),
	},
	{
		id: "profiles",
		kind: "ring",
		title: t("app-shell-profiles"),
		description:
			t("app-shell-profiles-description"),
		buttonText: t("app-shell-continue"),
		targetSelector: "#profile-selector",
		tooltipPlacement: "right",
	},
	{
		id: "new-instance",
		kind: "ring",
		title: t("app-shell-new-instance"),
		description: t("app-shell-new-instance-description"),
		buttonText: t("app-shell-continue"),
		targetSelector: "#sidebar-new",
		tooltipPlacement: "right",
	},
	{
		id: "explore",
		kind: "ring",
		title: t("app-shell-explore"),
		description:
			t("app-shell-explore-description"),
		buttonText: t("app-shell-continue"),
		targetSelector: "#sidebar-explore",
		tooltipPlacement: "right",
	},
	{
		id: "notifications",
		kind: "ring",
		title: t("app-shell-notifications"),
		description:
			t("app-shell-notifications-description"),
		buttonText: t("app-shell-continue"),
		targetSelector: "#sidebar-notifications",
		tooltipPlacement: "right",
	},
	{
		id: "settings",
		kind: "ring",
		title: t("app-shell-settings"),
		description:
			t("app-shell-settings-description"),
		buttonText: t("app-shell-continue"),
		targetSelector: "#sidebar-settings",
		tooltipPlacement: "right",
	},
	{
		id: "ready",
		kind: "modal",
		title: t("app-shell-ready-title"),
		description: t("app-shell-ready-description"),
		buttonText: t("app-shell-enter"),
	},
	];
}
