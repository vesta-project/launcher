import type { InstalledResource } from "@stores/resources";
import { parseDownloadTaskId } from "./resource-task-id";

export type ParsedInstallTargetKey = {
	source: string;
	projectId: string;
	versionId: string;
	target:
		| { kind: "instance"; instanceId: number }
		| { kind: "world"; instanceId: number; directoryName: string }
		| { kind: "modpack" };
};

export function parseInstallTargetKey(
	key: string,
): ParsedInstallTargetKey | null {
	const parts = key.split(":");
	if (parts.length < 4) return null;
	const [source, projectId, versionId, kind] = parts;
	if (!source || !projectId || !versionId) return null;
	if (kind === "modpack" && parts.length === 4) {
		return { source, projectId, versionId, target: { kind: "modpack" } };
	}
	const instanceId = Number(parts[4]);
	if (!Number.isInteger(instanceId) || instanceId <= 0) return null;
	if (kind === "instance" && parts.length === 5) {
		return {
			source,
			projectId,
			versionId,
			target: { kind: "instance", instanceId },
		};
	}
	if (kind === "world" && parts.length >= 6) {
		return {
			source,
			projectId,
			versionId,
			target: {
				kind: "world",
				instanceId,
				directoryName: parts.slice(5).join(":"),
			},
		};
	}
	return null;
}

export function reconcileInstalledInstanceTargets(
	keys: readonly string[],
	instanceId: number,
	rows: readonly Pick<
		InstalledResource,
		"platform" | "remote_id" | "remote_version_id"
	>[],
): string[] {
	const installed = new Set(
		rows.map(
			(row) =>
				`${row.platform.toLowerCase()}:${row.remote_id.toLowerCase()}:${row.remote_version_id}`,
		),
	);
	return keys.filter((key) => {
		const parsed = parseInstallTargetKey(key);
		if (
			!parsed ||
			parsed.target.kind !== "instance" ||
			parsed.target.instanceId !== instanceId
		) {
			return true;
		}
		return !installed.has(
			`${parsed.source.toLowerCase()}:${parsed.projectId.toLowerCase()}:${parsed.versionId}`,
		);
	});
}

export function installingIdsFromTargets(keys: readonly string[]) {
	const projects = new Set<string>();
	const versions = new Set<string>();
	for (const key of keys) {
		const parsed = parseInstallTargetKey(key);
		if (!parsed) continue;
		projects.add(parsed.projectId);
		versions.add(parsed.versionId);
	}
	return { projects, versions };
}

export function installTargetMatchesTaskId(key: string, taskId: string): boolean {
	const parsed = parseInstallTargetKey(key);
	if (!parsed || parsed.target.kind === "modpack") return false;
	const target =
		parsed.target.kind === "instance"
			? `instance-${parsed.target.instanceId}`
			: `world-${parsed.target.instanceId}-${parsed.target.directoryName.replaceAll("/", "_").replaceAll("\\", "_")}`;
	if (taskId.startsWith("download|")) {
		const task = parseDownloadTaskId(taskId);
		return Boolean(
			task &&
				task.target === target &&
				(!task.platform || task.platform === parsed.source.toLowerCase()) &&
				task.projectId === parsed.projectId &&
				task.versionId === parsed.versionId,
		);
	}
	return (
		taskId ===
		`download_${target}_${parsed.projectId}_${parsed.versionId}`
	);
}
