import type {
	InstalledResource,
	ManualSourceEvidence,
	RecognizedSource,
} from "@stores/resources";
import type { WorldDatapackSummary, WorldSummary } from "@stores/worlds";
import { describe, expect, it } from "vitest";
import {
	datapackManualSource,
	installedManualSource,
	worldManualSource,
} from "./manual-source-evidence";

const source: RecognizedSource = {
	platform: "modrinth",
	projectId: "project",
	versionId: "version",
	versionNumber: "1.0",
	displayName: "Pack",
	webUrl: "https://modrinth.com/resourcepack/project",
};
const evidence: ManualSourceEvidence = {
	originalSha1: "original",
	installedSha1: "installed",
	resourceType: "resourcepack",
	scope: { kind: "instance" },
	source,
};
const resource = (
	overrides: Partial<InstalledResource> = {},
): InstalledResource => ({
	id: 1,
	instance_id: 7,
	platform: "manual",
	remote_id: "",
	remote_version_id: "",
	resource_type: "resourcepack",
	local_path: "resourcepacks/pack.zip",
	display_name: "Local pack",
	current_version: "",
	release_type: "release",
	is_manual: true,
	is_enabled: true,
	last_updated: "",
	hash: "installed",
	manualSourceEvidence: evidence,
	...overrides,
});
const world = (overrides: Partial<WorldSummary> = {}): WorldSummary => ({
	ref: { instanceId: 7, directoryName: "World" },
	worldId: "world-id",
	instanceName: "Instance",
	folderName: "World",
	displayName: "World",
	lastPlayedAt: null,
	sizeBytes: 0,
	iconDataUrl: null,
	dataVersion: null,
	gameVersion: null,
	storageFamily: "unknown",
	levelStatus: "valid",
	metadataStatus: "valid",
	datapackCount: 0,
	managedDatapackCount: 0,
	running: false,
	...overrides,
});
const datapack = (
	manualSourceEvidence = {
		...evidence,
		resourceType: "datapack",
		scope: { kind: "world", worldId: "world-id" },
	} as ManualSourceEvidence,
): WorldDatapackSummary => ({
	resourceId: 1,
	fileName: "pack.zip",
	displayName: "Pack",
	entryKind: "file",
	platform: null,
	projectId: null,
	versionId: null,
	versionNumber: null,
	enabled: true,
	managed: false,
	readOnly: false,
	sizeBytes: 0,
	modifiedAt: null,
	manualSourceEvidence,
});

describe("manual source display boundaries", () => {
	it("shows original-source recognition without changing installed release identity", () => {
		const row = resource();
		expect(installedManualSource(row)).toEqual(source);
		expect(row.platform).toBe("manual");
		expect(row.remote_id).toBe("");
		expect(row.hash).toBe("installed");
	});
	it("rejects evidence for replaced bytes or missing integrity", () => {
		expect(
			installedManualSource(resource({ hash: "replaced" })),
		).toBeUndefined();
		expect(
			installedManualSource(resource({ hash: undefined })),
		).toBeUndefined();
	});
	it("matches installed hash case-insensitively", () => {
		expect(installedManualSource(resource({ hash: "INSTALLED" }))).toEqual(
			source,
		);
	});
	it("rejects the wrong type or scope", () => {
		expect(
			installedManualSource(resource({ resource_type: "shader" })),
		).toBeUndefined();
		expect(
			installedManualSource(
				resource({
					manualSourceEvidence: {
						...evidence,
						scope: { kind: "world", worldId: "world-id" },
					},
				}),
			),
		).toBeUndefined();
	});
	it("leaves unresolved and old rows without a displayed provider", () => {
		expect(
			installedManualSource(resource({ manualSourceEvidence: null })),
		).toBeUndefined();
		expect(
			installedManualSource(
				resource({ manualSourceEvidence: { ...evidence, source: null } }),
			),
		).toBeUndefined();
	});
	it("displays datapack recognition only in the bound world", () => {
		expect(datapackManualSource(datapack(), world())).toEqual(source);
		expect(
			datapackManualSource(datapack(), world({ worldId: "replacement" })),
		).toBeUndefined();
		expect(
			datapackManualSource(datapack(), world({ worldId: null })),
		).toBeUndefined();
	});
	it("does not render instance pack evidence as datapack provenance", () => {
		expect(datapackManualSource(datapack(evidence), world())).toBeUndefined();
	});
	it("displays world archive source only for the matching world identity", () => {
		const archiveEvidence = {
			originalSha1: "archive",
			installedContentSha1: "tree",
			worldId: "world-id",
			source,
		};
		expect(worldManualSource(world({ archiveEvidence }))).toEqual(source);
		expect(
			worldManualSource(world({ archiveEvidence, worldId: "another-world" })),
		).toBeUndefined();
		expect(worldManualSource(world())).toBeUndefined();
	});
});
