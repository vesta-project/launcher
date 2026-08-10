import type { InstalledResource } from "@stores/resources";
import { invoke } from "@tauri-apps/api/core";
import { markPerformance, measurePerformance } from "@utils/performance-trace";

export interface ResourceProjectRef {
	platform: "modrinth" | "curseforge" | "smithed";
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
const rowsCache = new Map<number, InstalledResource[]>();
const inFlight = new Map<number, Promise<InstanceResourceOverview>>();
const rowsInFlight = new Map<number, Promise<InstalledResource[]>>();
const rowsTrailing = new Set<number>();
const rowsRevision = new Map<number, string>();

export function instanceOwnedResources(resources: InstalledResource[]) {
	return resources.filter(
		(resource) => resource.resource_type?.toLowerCase() !== "datapack",
	);
}

function evictCachedInstance(instanceId: number) {
	overviewCache.delete(instanceId);
	rowsCache.delete(instanceId);
	rowsRevision.delete(instanceId);
	rowsTrailing.delete(instanceId);
}

function retain(instanceId: number, value: InstanceResourceOverview) {
	const resources = instanceOwnedResources(value.resources);
	if (resources.length !== value.resources.length) {
		value = { ...value, resources };
	}
	rowsCache.set(instanceId, resources);
	overviewCache.delete(instanceId);
	overviewCache.set(instanceId, { value, updatedAt: Date.now() });
	while (overviewCache.size > MAX_CACHED_INSTANCES) {
		const oldest = overviewCache.keys().next().value;
		if (oldest === undefined) break;
		evictCachedInstance(oldest);
	}
	return value;
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
			overview = retain(instanceId, overview);
			markPerformance(endMark, {
				instanceId,
				resources: overview.resources.length,
				metadata: overview.projectRecords.length,
			});
			measurePerformance("instance-resources:overview", startMark, endMark, {
				instanceId,
			});
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
	resources = instanceOwnedResources(resources);
	rowsCache.set(instanceId, resources);
	const cached = overviewCache.get(instanceId);
	if (!cached) return;
	retain(instanceId, { ...cached.value, resources });
}

/**
 * Coalesces bursty watcher events into one local rows request plus at most one
 * trailing request when another event arrives while the first is in flight.
 */
export function refreshInstanceResourceRows(
	instanceId: number,
	revision?: string,
): Promise<InstalledResource[]> {
	const pending = rowsInFlight.get(instanceId);
	if (pending) {
		if (!revision || rowsRevision.get(instanceId) !== revision) {
			rowsTrailing.add(instanceId);
		}
		if (revision) rowsRevision.set(instanceId, revision);
		return pending;
	}
	if (revision && rowsRevision.get(instanceId) === revision) {
		const cachedRows = rowsCache.get(instanceId);
		if (cachedRows) return Promise.resolve(cachedRows);
	}
	if (revision) rowsRevision.set(instanceId, revision);

	const request = (async () => {
		let rows: InstalledResource[] = [];
		do {
			rowsTrailing.delete(instanceId);
			rows = instanceOwnedResources(await invoke<InstalledResource[]>("get_installed_resources", {
				instanceId,
			}));
			updateCachedInstanceResources(instanceId, rows);
		} while (rowsTrailing.delete(instanceId));
		return rows;
	})().finally(() => {
		rowsInFlight.delete(instanceId);
	});
	rowsInFlight.set(instanceId, request);
	return request;
}

export function invalidateInstanceResourceOverview(instanceId: number) {
	evictCachedInstance(instanceId);
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
