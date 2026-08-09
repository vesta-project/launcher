import type { Instance } from "@stores/instances";
import type { ResourceProject, ResourceVersion } from "@stores/resources";
import { describe, expect, it } from "vitest";
import {
	currentPeerProject,
	minecraftGameVersions,
	renderVersionChangelog,
	resourceProjectKey,
	summarizeGameVersions,
	versionsSupportedByInstance,
} from "./resource-version-view";

const project = (resourceType: ResourceProject["resource_type"] = "mod") =>
	({ resource_type: resourceType }) as ResourceProject;

const instance = (minecraftVersion: string, modloader: string) =>
	({ minecraftVersion, modloader }) as Instance;

const version = (
	id: string,
	gameVersions: string[],
	loaders: string[],
): ResourceVersion => ({
	id,
	project_id: "project",
	version_number: id,
	game_versions: gameVersions,
	loaders,
	download_url: "https://example.invalid/file.jar",
	file_name: `${id}.jar`,
	release_type: "release",
	hash: id,
	dependencies: [],
});

describe("versionsSupportedByInstance", () => {
	const versions = [
		version("fabric-121", ["1.21"], ["fabric"]),
		version("forge-121", ["1.21"], ["forge"]),
		version("quilt-121", ["1.21"], ["quilt"]),
		version("fabric-120", ["1.20.1"], ["fabric"]),
	];

	it("filters by the selected instance game version and loader", () => {
		expect(
			versionsSupportedByInstance(
				project(),
				versions,
				instance("1.21", "fabric"),
			).map((item) => item.id),
		).toEqual(["fabric-121"]);
	});

	it("retains Fabric releases as supported-with-warning on Quilt", () => {
		expect(
			versionsSupportedByInstance(
				project(),
				versions,
				instance("1.21", "quilt"),
			).map((item) => item.id),
		).toEqual(["fabric-121", "quilt-121"]);
	});

	it("retains Forge releases as supported-with-warning on NeoForge", () => {
		expect(
			versionsSupportedByInstance(
				project(),
				versions,
				instance("1.21", "neoforge"),
			).map((item) => item.id),
		).toEqual(["forge-121"]);
	});

	it("does not filter without an instance or for modpacks", () => {
		expect(versionsSupportedByInstance(project(), versions, null)).toEqual(
			versions,
		);
		expect(
			versionsSupportedByInstance(
				project("modpack"),
				versions,
				instance("1.21", "fabric"),
			),
		).toEqual(versions);
	});

	it("shows only datapack builds from a multi-platform project", () => {
		const mixedVersions = [
			version("fabric", ["1.21"], ["fabric"]),
			version("paper", ["1.21"], ["paper"]),
			version("datapack", ["1.21"], ["datapack"]),
		];

		expect(
			versionsSupportedByInstance(project("datapack"), mixedVersions, null).map(
				(item) => item.id,
			),
		).toEqual(["datapack"]);
		expect(
			versionsSupportedByInstance(
				project("datapack"),
				mixedVersions,
				instance("1.21", "vanilla"),
			).map((item) => item.id),
		).toEqual(["datapack"]);
	});
});

describe("summarizeGameVersions", () => {
	it("uses a compact range for long version lists", () => {
		expect(summarizeGameVersions(["1.20", "1.21.1", "1.19.4", "1.21"])).toBe(
			"MC 1.19.4 — 1.21.1",
		);
	});

	it("excludes CurseForge client and server environment labels", () => {
		expect(
			minecraftGameVersions(["Client", "1.21.1", "Server", "1.21.1"]),
		).toEqual(["1.21.1"]);
		expect(summarizeGameVersions(["client", "server"])).toBe(
			"No MC version listed",
		);
	});
});

describe("currentPeerProject", () => {
	const curseForgeProject = {
		id: "current-project",
		source: "curseforge",
	} as ResourceProject;
	const modrinthPeer = {
		id: "correct-peer",
		source: "modrinth",
	} as ResourceProject;

	it("rejects a peer retained from a previous resource lookup", () => {
		expect(
			currentPeerProject(curseForgeProject, {
				ownerKey: "curseforge:previous-project",
				peer: { id: "fabric-api", source: "modrinth" } as ResourceProject,
			}),
		).toBeNull();
	});

	it("returns a peer only for the current project identity", () => {
		expect(
			currentPeerProject(curseForgeProject, {
				ownerKey: resourceProjectKey(curseForgeProject),
				peer: modrinthPeer,
			}),
		).toBe(modrinthPeer);
	});
});

describe("renderVersionChangelog", () => {
	it("renders Markdown and sanitizes executable markup", () => {
		const rendered = renderVersionChangelog(
			"## Changes\n\n<script>alert('x')</script><a href=\"https://example.com\" onclick=\"alert('x')\">Details</a>",
			"markdown",
		);

		expect(rendered).toContain("<h2>Changes</h2>");
		expect(rendered).toContain("Details");
		expect(rendered).not.toContain("<script");
		expect(rendered).not.toContain("onclick");
	});

	it("sanitizes provider HTML directly", () => {
		const rendered = renderVersionChangelog(
			'<p>Safe</p><img src="x" onerror="alert(1)">',
			"html",
		);

		expect(rendered).toContain("<p>Safe</p>");
		expect(rendered).not.toContain("onerror");
	});
});
