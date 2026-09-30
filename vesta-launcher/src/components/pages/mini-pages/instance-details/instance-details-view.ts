import { t } from "~/localization";

export const INSTANCE_TABS = [
	"home",
	"resources",
	"worlds",
	"console",
	"crash",
	"versioning",
	"settings",
] as const;

export type InstanceTab = (typeof INSTANCE_TABS)[number];

export function normalizeInstanceTab(value?: string | null): InstanceTab {
	if (value === "screenshots") return "home";
	return INSTANCE_TABS.includes(value as InstanceTab)
		? (value as InstanceTab)
		: "home";
}

export type PrimaryActionIcon = "play" | "stop" | "spinner" | "recovery" | "error";
export type PrimaryActionTone = "primary" | "destructive";

export interface PrimaryActionState {
	running?: boolean;
	launching?: boolean;
	operationInProgress?: boolean;
	operationLabel?: string;
	interrupted?: boolean;
	lastOperation?: string | null;
	needsInstallation?: boolean;
	installationFailed?: boolean;
	updateRecovery?: boolean;
	hasCrash?: boolean;
}

export function getInstancePrimaryAction(state: PrimaryActionState) {
	if (state.running) return { label: t("app-shell-stop"), icon: "stop" as const, tone: "destructive" as const };
	if (state.launching) return { label: t("instances-extra-primary-action-starting"), icon: "spinner" as const, tone: "primary" as const };
	if (state.operationInProgress) {
		return {
			label: state.operationLabel
				? t("instances-extra-primary-action-working", { operation: state.operationLabel })
				: t("instances-extra-primary-action-working-default"),
			icon: "spinner" as const,
			tone: "primary" as const,
		};
	}
	if (state.updateRecovery) return { label: t("common-resume-recovery"), icon: "error" as const, tone: "destructive" as const };
	if (state.interrupted) {
		const messageId = state.lastOperation === "hard-reset"
			? "instances-extra-primary-action-resume-reset"
			: state.lastOperation === "repair"
				? "instances-extra-primary-action-resume-repair"
				: state.lastOperation === "update"
					? "instances-extra-primary-action-resume-update"
					: "instances-extra-primary-action-resume-install";
		return { label: t(messageId), icon: "recovery" as const, tone: "primary" as const };
	}
	if (state.needsInstallation) {
		return state.installationFailed
			? { label: t("instances-extra-primary-action-retry-install"), icon: "error" as const, tone: "destructive" as const }
			: { label: t("app-shell-install"), icon: "play" as const, tone: "primary" as const };
	}
	if (state.hasCrash) return { label: t("instances-extra-primary-action-view-crash"), icon: "error" as const, tone: "destructive" as const };
	return { label: t("app-shell-play"), icon: "play" as const, tone: "primary" as const };
}

export function summarizeResources(resources: Array<{ source_kind?: string | null }>, knownUpdates?: number) {
	const bundled = resources.filter((resource) => resource.source_kind?.toLowerCase() === "modpack").length;
	const custom = resources.length - bundled;
	const parts = [t("instances-extra-resource-summary-installed", { count: resources.length })];
	if (bundled > 0 && custom > 0) {
		parts.push(t("instances-extra-resource-summary-ownership", { bundled, custom }));
	}
	if (knownUpdates !== undefined && knownUpdates > 0) {
		parts.push(t("instances-extra-resource-summary-updates", { count: knownUpdates }));
	}
	return parts.join(" · ");
}
