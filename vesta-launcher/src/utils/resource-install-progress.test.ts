import {
	installingIdsFromTargets,
	installTargetMatchesTaskId,
	parseInstallTargetKey,
	reconcileInstalledInstanceTargets,
} from "./resource-install-progress";
import { describe, expect, it } from "vitest";

describe("resource install progress", () => {
	it("parses world directory names containing colons", () => {
		expect(
			parseInstallTargetKey("modrinth:pack:version:world:7:World:Copy"),
		).toEqual({
			source: "modrinth",
			projectId: "pack",
			versionId: "version",
			target: { kind: "world", instanceId: 7, directoryName: "World:Copy" },
		});
	});

	it("clears only the completed instance target", () => {
		const keys = [
			"modrinth:pack:version:instance:7",
			"modrinth:pack:version:instance:8",
			"modrinth:pack:version:world:7:World One",
			"curseforge:pack:version:instance:7",
		];
		expect(
			reconcileInstalledInstanceTargets(keys, 7, [
				{
					platform: "modrinth",
					remote_id: "pack",
					remote_version_id: "version",
				},
			]),
		).toEqual(keys.slice(1));
	});

	it("derives project and version state from remaining targets", () => {
		const ids = installingIdsFromTargets([
			"modrinth:one:v1:instance:7",
			"modrinth:two:v2:world:7:World One",
		]);
		expect([...ids.projects]).toEqual(["one", "two"]);
		expect([...ids.versions]).toEqual(["v1", "v2"]);
	});

	it("matches backend task ids without splitting project or version ids", () => {
		expect(
			installTargetMatchesTaskId(
				"modrinth:project_with_underscores:version_with_underscores:instance:7",
				"download_instance-7_project_with_underscores_version_with_underscores",
			),
		).toBe(true);
		expect(
			installTargetMatchesTaskId(
				"modrinth:project:version:world:7:World/Copy",
				"download_world-7-World_Copy_project_version",
			),
		).toBe(true);
	});
});
