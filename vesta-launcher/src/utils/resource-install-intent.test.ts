import type {
	InstalledResource,
	ResourceProject,
	ResourceVersion,
} from "@stores/resources";
import {
	classifyDatapackVersionCompatibility,
	findBestExactDatapackVersion,
	findBestVersion,
	findBestVersionForInstance,
	findInstalledResource,
	hasDownloadableArtifact,
	isGameVersionCompatible,
	isResourceUpdateAvailable,
	replacementResourceIdForWorld,
	requiresWorldTarget,
	resolveInstanceInstallDecision,
	versionMatchesResourceType,
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
	it("requires a world for datapacks and combined bundles", () => {
		expect(
			requiresWorldTarget(project({ resource_type: "datapack" }), version()),
		).toBe(true);
		expect(
			requiresWorldTarget(
				project({ resource_type: "resourcepack" }),
				version({
					files: [{ url: "", file_name: "data.zip", role: "datapack" }],
				}),
			),
		).toBe(true);
		expect(
			requiresWorldTarget(
				project({ resource_type: "resourcepack" }),
				version({
					files: [{ url: "", file_name: "resources.zip", role: "primary" }],
				}),
			),
		).toBe(false);
	});

	it("recognizes legacy and multi-artifact download locations", () => {
		expect(hasDownloadableArtifact(version())).toBe(false);
		expect(
			hasDownloadableArtifact(
				version({ download_url: "https://example.test/pack.zip" }),
			),
		).toBe(true);
		expect(
			hasDownloadableArtifact(
				version({
					files: [
						{
							url: "https://example.test/data.zip",
							file_name: "data.zip",
							role: "datapack",
						},
					],
				}),
			),
		).toBe(true);
		expect(
			hasDownloadableArtifact(
				version({ files: [{ url: "", file_name: "data.zip", role: "datapack" }] }),
			),
		).toBe(false);
	});

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

	it("selects the datapack release from a multi-platform project", () => {
		const selected = findBestVersion(
			[
				version({ id: "fabric", loaders: ["fabric"], file_name: "mod.jar" }),
				version({ id: "paper", loaders: ["paper"], file_name: "plugin.jar" }),
				version({
					id: "datapack",
					loaders: ["datapack"],
					file_name: "pack.zip",
				}),
			],
			"1.21.1",
			"vanilla",
			"release",
			"datapack",
			"modrinth",
		);

		expect(selected?.id).toBe("datapack");
	});

	it("uses explicit datapack intent when selecting for a vanilla instance", () => {
		const selected = findBestVersionForInstance(
			project(),
			[
				version({ id: "mod", loaders: ["fabric"] }),
				version({ id: "datapack", loaders: ["datapack"] }),
			],
			{ minecraftVersion: "1.21.1", modloader: "vanilla" },
			"release",
			"datapack",
		);

		expect(selected?.id).toBe("datapack");
	});

	it("chooses destination scope after selecting the bundle version", () => {
		const combined = version({
			id: "combined",
			loaders: [],
			files: [
				{ url: "", file_name: "resources.zip", role: "primary" },
				{ url: "", file_name: "data.zip", role: "datapack" },
			],
		});
		expect(
			resolveInstanceInstallDecision(
				project({ resource_type: "resourcepack" }),
				[combined],
				{ minecraftVersion: "1.21.1", modloader: "vanilla" },
				"resourcepack",
			),
		).toEqual({ kind: "world", version: combined });
		expect(
			resolveInstanceInstallDecision(
				project(),
				[version({ loaders: ["datapack"] })],
				{ minecraftVersion: "1.21.1", modloader: "vanilla" },
				"datapack",
			),
		).toEqual({ kind: "world" });
	});

	it("only quick-selects datapacks with an exact Minecraft version tag", () => {
		const versions = [
			version({
				id: "wildcard",
				loaders: ["datapack"],
				game_versions: ["1.21.x"],
			}),
			version({
				id: "same-line",
				loaders: ["datapack"],
				game_versions: ["1.21.4"],
			}),
		];
		expect(
			findBestExactDatapackVersion(versions, "1.21.1", "modrinth"),
		).toBeNull();
		expect(
			findBestExactDatapackVersion(
				[...versions, version({ id: "exact", loaders: ["datapack"] })],
				"1.21.1",
				"modrinth",
			)?.id,
		).toBe("exact");
	});

	it("classifies non-exact datapack tags as advisory", () => {
		expect(classifyDatapackVersionCompatibility(["1.21.4"], "1.21.1")).toBe(
			"sameRelease",
		);
		expect(classifyDatapackVersionCompatibility(["1.20.6"], "1.21.1")).toBe(
			"unlisted",
		);
		expect(classifyDatapackVersionCompatibility(["1.21.1"], null)).toBe(
			"unknown",
		);
	});

	it("replaces a managed datapack only when the selected world is its source", () => {
		const replacement = {
			resourceId: 42,
			world: { instanceId: 7, directoryName: "World One" },
		};
		expect(replacementResourceIdForWorld(replacement, replacement.world)).toBe(
			42,
		);
		expect(
			replacementResourceIdForWorld(replacement, {
				instanceId: 7,
				directoryName: "World Two",
			}),
		).toBeUndefined();
		expect(
			replacementResourceIdForWorld(replacement, {
				instanceId: 8,
				directoryName: "World One",
			}),
		).toBeUndefined();
	});

	it("uses explicit install intent when a Modrinth mod has datapack builds", () => {
		expect(requiresWorldTarget(project(), version(), "datapack")).toBe(true);
	});

	it("uses Modrinth's datapack loader to reject its mod and plugin variants", () => {
		expect(
			versionMatchesResourceType(
				"datapack",
				version({ file_name: "pack.zip", loaders: ["datapack"] }),
				"modrinth",
			),
		).toBe(true);
		expect(
			versionMatchesResourceType(
				"datapack",
				version({ file_name: "mod.jar", loaders: ["neoforge"] }),
				"modrinth",
			),
		).toBe(false);
	});

	it("uses CurseForge's datapack project class instead of loader tags", () => {
		expect(
			versionMatchesResourceType(
				"datapack",
				version({ file_name: "pack.zip", loaders: ["fabric"] }),
				"curseforge",
			),
		).toBe(true);
	});

	it("treats Smithed as a datapack project feed without loader tags", () => {
		expect(
			versionMatchesResourceType(
				"datapack",
				version({ file_name: "pack.zip", loaders: [] }),
				"smithed",
			),
		).toBe(true);
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

	it("matches cross-platform resources by project version hash", () => {
		expect(
			findInstalledResource(
				project(),
				[
					installed({
						platform: "curseforge",
						remote_id: "unknown",
						display_name: "Different Name",
						hash: "shared-hash",
					}),
				],
				[version({ hash: "shared-hash" })],
			),
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
