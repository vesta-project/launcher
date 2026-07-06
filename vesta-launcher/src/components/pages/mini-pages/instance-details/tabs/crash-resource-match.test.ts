import type { InstalledResource } from "@stores/resources";
import { describe, expect, it } from "vitest";
import {
	fileNameMatchesModId,
	getRequiredVersionIssue,
	matchSuspectToResource,
} from "./crash-resource-match";

const resource = (
	overrides: Partial<InstalledResource>,
): InstalledResource => ({
	id: 1,
	instance_id: 1,
	platform: "modrinth",
	remote_id: "project",
	remote_version_id: "version",
	resource_type: "mod",
	local_path: "/mods/example.jar",
	display_name: "Example",
	current_version: "1.0.0",
	release_type: "release",
	is_manual: false,
	is_enabled: true,
	last_updated: "2026-01-01T00:00:00Z",
	...overrides,
});

describe("crash resource matching", () => {
	it("does not match sodium-extra as sodium", () => {
		expect(fileNameMatchesModId("sodium-extra-0-8-7-mc26-1-1", "sodium")).toBe(
			false,
		);
		expect(fileNameMatchesModId("sodium-fabric-0-8-7-mc26-1-1", "sodium")).toBe(
			true,
		);
	});

	it("matches disabled dependency jars by mod id", () => {
		const match = matchSuspectToResource(
			{
				display_name: "Cloth Config",
				mod_id: "cloth-config",
				reason: "version 16.0.0 or later",
				suspect_kind: "missing_dependency",
			},
			[
				resource({
					local_path: "/mods/cloth-config-16.0.0-fabric.jar.disabled",
					display_name: "Cloth Config API",
					current_version: "16.0.0",
					is_enabled: false,
				}),
			],
		);

		expect(match?.display_name).toBe("Cloth Config API");
		expect(match?.is_enabled).toBe(false);
	});

	it("flags installed dependencies below the required version", () => {
		const issue = getRequiredVersionIssue(
			resource({ display_name: "Cloth Config API", current_version: "15.1.0" }),
			"version 16.0.0 or later",
		);

		expect(issue).toBe("Installed 15.1.0, needs 16.0.0+");
	});

	it("flags installed dependencies outside an x-version range", () => {
		const issue = getRequiredVersionIssue(
			resource({ display_name: "Sodium", current_version: "0.9.0" }),
			"any 0.8.x version",
		);

		expect(issue).toBe("Installed 0.9.0, needs 0.8.x");
	});

	it("flags installed dependencies above the supported version", () => {
		const issue = getRequiredVersionIssue(
			resource({ display_name: "Example", current_version: "2.1.0" }),
			"version 2.0.0 or earlier",
		);

		expect(issue).toBe("Installed 2.1.0, needs <=2.0.0");
	});

	it("flags installed dependencies outside a required version range", () => {
		const issue = getRequiredVersionIssue(
			resource({ display_name: "Example", current_version: "1.5.0" }),
			"between 1.2.0 and 1.4.9",
		);

		expect(issue).toBe("Installed 1.5.0, needs 1.2.0-1.4.9");
	});

	it("flags Fabric interval dependency ranges", () => {
		const issue = getRequiredVersionIssue(
			resource({ display_name: "Example", current_version: "1.1.0" }),
			"requires [[1.2.0,1.4.0)]",
		);

		expect(issue).toBe("Installed 1.1.0, needs 1.2.0-1.4.0");
	});
});
