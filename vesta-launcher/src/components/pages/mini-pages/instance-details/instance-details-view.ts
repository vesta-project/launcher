export const INSTANCE_TABS = [
	"home",
	"resources",
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
	if (state.running) return { label: "Stop", icon: "stop" as const, tone: "destructive" as const };
	if (state.launching) return { label: "Starting…", icon: "spinner" as const, tone: "primary" as const };
	if (state.operationInProgress) {
		return { label: `${state.operationLabel || "Working"}…`, icon: "spinner" as const, tone: "primary" as const };
	}
	if (state.updateRecovery) return { label: "Resume recovery", icon: "error" as const, tone: "destructive" as const };
	if (state.interrupted) {
		const operation = state.lastOperation === "hard-reset" ? "reset" : state.lastOperation === "repair" ? "repair" : state.lastOperation === "update" ? "update" : "install";
		return { label: `Resume ${operation}`, icon: "recovery" as const, tone: "primary" as const };
	}
	if (state.needsInstallation) {
		return state.installationFailed
			? { label: "Retry install", icon: "error" as const, tone: "destructive" as const }
			: { label: "Install", icon: "play" as const, tone: "primary" as const };
	}
	if (state.hasCrash) return { label: "View crash", icon: "error" as const, tone: "destructive" as const };
	return { label: "Play", icon: "play" as const, tone: "primary" as const };
}

export function summarizeResources(resources: Array<{ source_kind?: string | null }>, knownUpdates?: number) {
	const bundled = resources.filter((resource) => resource.source_kind?.toLowerCase() === "modpack").length;
	const custom = resources.length - bundled;
	const parts = [`${resources.length} installed`];
	if (bundled > 0 && custom > 0) parts.push(`${bundled} bundled · ${custom} custom`);
	if (knownUpdates !== undefined && knownUpdates > 0) parts.push(`${knownUpdates} update${knownUpdates === 1 ? "" : "s"}`);
	return parts.join(" · ");
}
