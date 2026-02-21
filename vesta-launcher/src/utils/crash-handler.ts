import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { showToast } from "@ui/toast/toast";
import { createNotification } from "@utils/notifications";
import { createSignal } from "solid-js";

/**
 * Crash details from the backend crash detection system
 */
export interface CrashEvent {
	instance_id: string;
	crash_type: "runtime" | "launch_mod" | "launch_other" | "jvm";
	message: string;
	report_path?: string;
	timestamp: string;
}

/**
 * Store for tracking recent crashes by instance
 * Maps instance_id to crash event details
 */
const [crashedInstances, setCrashedInstances] = createSignal<
	Map<string, CrashEvent>
>(new Map());

/**
 * Get crash details for a specific instance
 */
export function getCrashDetails(instanceId: string): CrashEvent | undefined {
	return crashedInstances().get(instanceId);
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
	const typeLabel = getCrashTypeLabel(crashEvent.crash_type);

	if (crashEvent.message) {
		return `${typeLabel}: ${crashEvent.message}`;
	}

	return typeLabel;
}

/**
 * Show a crash notification to the user
 */
async function showCrashNotification(crashEvent: CrashEvent): Promise<void> {
	const title = "Instance Crashed";
	const description = getCrashDescription(crashEvent);

	try {
		await createNotification({
			title,
			description,
			severity: "error",
			notification_type: "patient",
			dismissible: true,
			client_key: `crash-${crashEvent.instance_id}`,
			metadata: JSON.stringify(crashEvent),
			show_on_completion: true,
		});
	} catch (error) {
		console.error(
			"Failed to create patient crash notification, falling back to toast",
			error,
		);
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
	const unlisten = await listen<CrashEvent>(
		"core://instance-crashed",
		(event) => {
			const crashEvent = event.payload;
			console.log("[CrashHandler] Crash detected:", crashEvent);

			// Store crash details in memory
			const updated = new Map(crashedInstances());
			updated.set(crashEvent.instance_id, crashEvent);
			setCrashedInstances(updated);

			// Show notification
			void showCrashNotification(crashEvent);
		},
	);

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
