import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { showToast } from "@ui/toast/toast";
import { createNotification } from "@utils/notifications";
import { createSignal } from "solid-js";

/**
 * Crash details from the backend crash detection system
 */
export interface CrashSuspect {
	display_name: string;
	mod_id?: string | null;
	reason?: string | null;
	suspect_kind: "affected_mod" | "missing_dependency" | string;
}

export interface CrashEvent {
	instance_id: string;
	crash_id?: string;
	crash_type: "runtime" | "launch_mod" | "launch_other" | "jvm";
	category?: string;
	title?: string;
	message: string;
	evidence?: string | null;
	suspected_resources?: string[];
	suspects?: CrashSuspect[];
	suggested_fixes?: string[];
	affected_mod_count?: number | null;
	report_path?: string;
	log_path?: string | null;
	timestamp: string;
	confidence?: number;
	mclogs_url?: string | null;
	analysis?: any;
}

/**
 * Store for tracking recent crashes by instance
 * Maps instance_id to crash event details
 */
const [crashedInstances, setCrashedInstances] = createSignal<Map<string, CrashEvent>>(new Map());

/**
 * Get crash details for a specific instance
 */
export function getCrashDetails(instanceId: string): CrashEvent | undefined {
	return crashedInstances().get(instanceId);
}

export function parseCrashDetails(raw: string | null | undefined, instanceId: string): CrashEvent | undefined {
	if (!raw) return undefined;
	try {
		const parsed = JSON.parse(raw);
		return normalizeCrashEvent({ ...parsed, instance_id: parsed.instance_id || instanceId });
	} catch {
		return undefined;
	}
}

export function normalizeCrashEvent(event: any): CrashEvent {
	return {
		instance_id: event.instance_id,
		crash_id: event.crash_id,
		crash_type: event.crash_type || "launch_other",
		category: event.category,
		title: event.title,
		message: event.message || "The instance crashed.",
		evidence: event.evidence ?? null,
		suspected_resources: Array.isArray(event.suspected_resources) ? event.suspected_resources : [],
		suspects: Array.isArray(event.suspects) ? event.suspects : [],
		suggested_fixes: Array.isArray(event.suggested_fixes) ? event.suggested_fixes : [],
		affected_mod_count:
			typeof event.affected_mod_count === "number" ? event.affected_mod_count : null,
		report_path: event.report_path ?? undefined,
		log_path: event.log_path ?? null,
		timestamp: event.timestamp || new Date().toISOString(),
		confidence: typeof event.confidence === "number" ? event.confidence : undefined,
		mclogs_url: event.mclogs_url ?? null,
		analysis: event.analysis,
	};
}

/**
 * Check if an instance has crashed
 */
export function isInstanceCrashed(instanceId: string): boolean {
	return crashedInstances().has(instanceId);
}

/**
 * Clear crash details for an instance (called when it launches successfully)
 */
export function clearCrashDetails(instanceId: string): void {
	const updated = new Map(crashedInstances());
	updated.delete(instanceId);
	setCrashedInstances(updated);
}

/**
 * Get a human-readable crash category label
 */
export function formatCrashCategory(category?: string): string {
	if (!category) return "Crash";
	return category
		.split("_")
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(" ");
}

/**
 * Get a human-readable crash type label
 */
function getCrashTypeLabel(crashType: string): string {
	switch (crashType) {
		case "runtime":
			return "Runtime Crash";
		case "launch_mod":
			return "Mod Incompatibility";
		case "launch_other":
			return "Launch Failed";
		case "jvm":
			return "Java Crash";
		default:
			return "Unknown Crash";
	}
}

/**
 * Get a crash description based on type and message
 */
function getCrashDescription(crashEvent: CrashEvent): string {
	const typeLabel = crashEvent.title || getCrashTypeLabel(crashEvent.crash_type);

	if (crashEvent.message) {
		return `${typeLabel}: ${crashEvent.message}`;
	}

	return typeLabel;
}

/**
 * Show a crash notification to the user
 */
async function showCrashNotification(crashEvent: CrashEvent): Promise<void> {
	const title = crashEvent.title || "Instance Crashed";
	const description = getCrashDescription(crashEvent);

	try {
		await createNotification({
			title,
			description,
			severity: "error",
			notification_type: "patient",
			dismissible: true,
			client_key: `crash-${crashEvent.instance_id}`,
			metadata: crashEvent,
			actions: [
				{
					id: "navigate",
					label: "Details",
					type: "primary",
					payload: {
						path: "/instance",
						params: {
							slug: crashEvent.instance_id,
							activeTab: "crash",
							crashId: crashEvent.crash_id,
						},
					},
				},
			],
			show_on_completion: true,
		});
	} catch (error) {
		console.error("Failed to create patient crash notification, falling back to toast", error);
		showToast({
			title,
			description,
			severity: "error",
			duration: 7000,
		});
	}
}

/**
 * Subscribe to crash events from the backend
 */
export async function subscribeToCrashEvents(): Promise<UnlistenFn> {
	const unlisten = await listen<CrashEvent>("core://instance-crashed", (event) => {
		const crashEvent = normalizeCrashEvent(event.payload);
		console.log("[CrashHandler] Crash detected:", crashEvent);

		// Store crash details in memory
		const updated = new Map(crashedInstances());
		updated.set(crashEvent.instance_id, crashEvent);
		setCrashedInstances(updated);

		// Show notification
		void showCrashNotification(crashEvent);
	});

	return unlisten;
}

/**
 * Get all crashed instances
 */
export function getAllCrashedInstances(): CrashEvent[] {
	return Array.from(crashedInstances().values());
}

/**
 * Clear all crash details
 */
export function clearAllCrashDetails(): void {
	setCrashedInstances(new Map());
}
