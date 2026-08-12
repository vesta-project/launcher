import { describe, expect, it } from "vitest";
import {
	installingIdsFromTargets,
	installTargetMatchesTaskId,
	parseInstallTargetKey,
	reconcileInstalledInstanceTargets,
} from "./resource-install-progress";

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

	it("matches provider-aware pipe task ids for instance and world targets", () => {
		expect(
			installTargetMatchesTaskId(
				"smithed:pack:1.0.0:instance:7",
				"download|v2|instance-7|smithed|cGFjaw|MS4wLjA",
			),
		).toBe(true);
		expect(
			installTargetMatchesTaskId(
				"modrinth:pro|ject:v1|extra:world:7:World|Copy",
				"download|v2|world-7-World|Copy|modrinth|cHJvfGplY3Q|djF8ZXh0cmE",
			),
		).toBe(true);
	});

	it("does not clear a different provider or destination", () => {
		const taskId = "download|v2|world-7-World One|smithed|cGFjaw|dmVyc2lvbg";
		expect(
			installTargetMatchesTaskId(
				"modrinth:pack:version:world:7:World One",
				taskId,
			),
		).toBe(false);
		expect(
			installTargetMatchesTaskId(
				"smithed:pack:version:world:7:World Two",
				taskId,
			),
		).toBe(false);
	});

	it("supports provider-less pipe task ids from interrupted older tasks", () => {
		expect(
			installTargetMatchesTaskId(
				"modrinth:pack:version:instance:7",
				"download|instance-7|cGFjaw|dmVyc2lvbg",
			),
		).toBe(true);
	});

	it("matches legacy world names ending in a provider name", () => {
		expect(
			installTargetMatchesTaskId(
				"modrinth:pack:version:world:7:My|smithed",
				"download|world-7-My|smithed|cGFjaw|dmVyc2lvbg",
			),
		).toBe(true);
	});
});
