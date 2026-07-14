import type {
	InstalledResource,
	ResourceProject,
	ResourceVersion,
} from "@stores/resources";
import {
	findBestVersion,
	findInstalledResource,
	isGameVersionCompatible,
	isResourceUpdateAvailable,
} from "@utils/resource-install-intent";
import { describe, expect, it } from "vitest";

const project = (
	overrides: Partial<ResourceProject> = {},
): ResourceProject => ({
	id: "project-id",
	source: "modrinth",
	resource_type: "mod",
	name: "Example Mod",
	summary: "",
	description: null,
	icon_url: null,
	author: "",
	authors: [],
	download_count: 0,
	follower_count: 0,
	categories: [],
	web_url: "",
	external_ids: { curseforge: "1234" },
	gallery: [],
	published_at: null,
	updated_at: null,
	...overrides,
});

const installed = (
	overrides: Partial<InstalledResource> = {},
): InstalledResource => ({
	id: 1,
	instance_id: 2,
	platform: "modrinth",
	remote_id: "project-id",
	remote_version_id: "old-version",
	resource_type: "mod",
	local_path: "mods/example.jar",
	display_name: "Example Mod",
	current_version: "1.0.0",
	release_type: "release",
	is_manual: false,
	is_enabled: true,
	last_updated: "",
	...overrides,
});

const version = (
	overrides: Partial<ResourceVersion> = {},
): ResourceVersion => ({
	id: "new-version",
	project_id: "project-id",
	version_number: "2.0.0",
	game_versions: ["1.21.1"],
	loaders: ["fabric"],
	download_url: "",
	file_name: "example.jar",
	release_type: "release",
	hash: "new-hash",
	dependencies: [],
	...overrides,
});

describe("resource install intent", () => {
	it("matches exact, normalized, and explicit wildcard game versions", () => {
		expect(isGameVersionCompatible(["1.21.0"], "1.21")).toBe(true);
		expect(isGameVersionCompatible(["1.21.x"], "1.21.4")).toBe(true);
		expect(isGameVersionCompatible(["1.21"], "1.21.4")).toBe(false);
	});

	it("chooses exact stable versions before wildcard prereleases", () => {
		const selected = findBestVersion(
			[
				version({
					id: "wildcard",
					game_versions: ["1.21.x"],
					release_type: "beta",
				}),
				version({ id: "exact", game_versions: ["1.21.1"] }),
			],
			"1.21.1",
			"fabric",
			"beta",
			"mod",
		);

		expect(selected?.id).toBe("exact");
	});

	it("supports Fabric on Quilt and Forge on NeoForge", () => {
		const versions = [version({ loaders: ["fabric"] })];
		expect(
			findBestVersion(versions, "1.21.1", "quilt", "release", "mod"),
		).not.toBeNull();
		expect(
			findBestVersion(
				[version({ loaders: ["forge"] })],
				"1.21.1",
				"neoforge",
				"release",
				"mod",
			),
		).not.toBeNull();
	});

	it("rejects mods and shaders for vanilla instances", () => {
		expect(
			findBestVersion([version()], "1.21.1", "vanilla", "release", "mod"),
		).toBeNull();
		expect(
			findBestVersion(
				[version({ loaders: [] })],
				"1.21.1",
				null,
				"release",
				"shader",
			),
		).toBeNull();
	});

	it("matches installed resources by primary or external project id", () => {
		expect(findInstalledResource(project(), [installed()])).toBeDefined();
		expect(
			findInstalledResource(project(), [installed({ remote_id: "1234" })]),
		).toBeDefined();
	});

	it("falls back to normalized resource type and display name", () => {
		expect(
			findInstalledResource(project(), [
				installed({ remote_id: "unknown", display_name: "example mod" }),
			]),
		).toBeDefined();
	});

	it("uses hashes before platform-specific version identity", () => {
		expect(
			isResourceUpdateAvailable(
				project(),
				installed({ hash: "same" }),
				version({ hash: "same" }),
			),
		).toBe(false);
	});

	it("compares remote ids on the same platform and labels across platforms", () => {
		expect(isResourceUpdateAvailable(project(), installed(), version())).toBe(
			true,
		);
		expect(
			isResourceUpdateAvailable(
				project(),
				installed({ platform: "curseforge", current_version: "2.0.0" }),
				version(),
			),
		).toBe(false);
	});
});
