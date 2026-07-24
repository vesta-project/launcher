import type { InstalledResource } from "@stores/resources";
import { invoke } from "@tauri-apps/api/core";
import {
	markPerformance,
	measurePerformance,
} from "@utils/performance-trace";

export interface ResourceProjectRef {
	platform: "modrinth" | "curseforge";
	id: string;
}

export interface ResourceProjectOverviewRecord {
	id: string;
	source: string;
	name: string;
	summary: string;
	description?: string | null;
	icon_url?: string | null;
	has_cached_icon: boolean;
	project_type: string;
	last_updated: string;
	metadata_synced_at?: string | null;
	icon_synced_at?: string | null;
}

export interface InstanceResourceUpdateSnapshot {
	checkedAt: string;
	resourceUpdates: Array<{
		resourceId: number;
		version: unknown;
	}>;
	modpackVersions: unknown[];
	isStale: boolean;
}

export interface InstanceResourceOverview {
	instanceId: number;
	resources: InstalledResource[];
	projectRecords: ResourceProjectOverviewRecord[];
	missingProjectRefs: ResourceProjectRef[];
	updateSnapshot: InstanceResourceUpdateSnapshot | null;
	metadataStatus: "complete" | "partial";
	repairStatus: "notChecked" | "notRequired" | "required";
	revision: string;
}

interface CacheEntry {
	value: InstanceResourceOverview;
	updatedAt: number;
}

const MAX_CACHED_INSTANCES = 12;
const overviewCache = new Map<number, CacheEntry>();
const inFlight = new Map<number, Promise<InstanceResourceOverview>>();

function retain(instanceId: number, value: InstanceResourceOverview) {
	overviewCache.delete(instanceId);
	overviewCache.set(instanceId, { value, updatedAt: Date.now() });
	while (overviewCache.size > MAX_CACHED_INSTANCES) {
		const oldest = overviewCache.keys().next().value;
		if (oldest === undefined) break;
		overviewCache.delete(oldest);
	}
}

export function getCachedInstanceResourceOverview(instanceId: number) {
	return overviewCache.get(instanceId)?.value;
}

export async function loadInstanceResourceOverview(
	instanceId: number,
	options: { force?: boolean } = {},
): Promise<InstanceResourceOverview> {
	const cached = overviewCache.get(instanceId);
	if (!options.force && cached) {
		return cached.value;
	}

	const pending = inFlight.get(instanceId);
	if (pending) return pending;

	const startMark = `instance-resources:${instanceId}:overview-start`;
	const endMark = `instance-resources:${instanceId}:overview-end`;
	markPerformance(startMark, { instanceId });
	const request = invoke<InstanceResourceOverview>(
		"get_instance_resource_overview",
		{ instanceId },
	)
		.then((overview) => {
			retain(instanceId, overview);
			markPerformance(endMark, {
				instanceId,
				resources: overview.resources.length,
				metadata: overview.projectRecords.length,
			});
			measurePerformance(
				"instance-resources:overview",
				startMark,
				endMark,
				{ instanceId },
			);
			return overview;
		})
		.finally(() => {
			inFlight.delete(instanceId);
		});

	inFlight.set(instanceId, request);
	return request;
}

export function updateCachedInstanceResources(
	instanceId: number,
	resources: InstalledResource[],
) {
	const cached = overviewCache.get(instanceId);
	if (!cached) return;
	retain(instanceId, { ...cached.value, resources });
}

export function invalidateInstanceResourceOverview(instanceId: number) {
	overviewCache.delete(instanceId);
}

export function projectRecordMap(
	records: ResourceProjectOverviewRecord[],
): Record<string, ResourceProjectOverviewRecord> {
	const map: Record<string, ResourceProjectOverviewRecord> = {};
	for (const record of records) {
		map[`${record.source.toLowerCase()}:${record.id}`] = record;
	}
	return map;
}
