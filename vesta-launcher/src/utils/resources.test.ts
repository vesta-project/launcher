import type { Instance } from "@stores/instances";
import type { ResourceProject, ResourceVersion } from "@stores/resources";
import {
	getCompatibilityForInstance,
	getProjectCompatibilityForInstance,
} from "@utils/resources";
import { describe, expect, it } from "vitest";

const project = {
	id: "mixed-project",
	source: "modrinth",
	resource_type: "mod",
	categories: ["fabric"],
} as ResourceProject;
const vanilla = {
	minecraftVersion: "1.21.1",
	modloader: "vanilla",
} as Instance;
const datapackVersion = {
	id: "datapack",
	version_number: "1.0.0",
	game_versions: ["1.21.1"],
	loaders: ["datapack"],
} as ResourceVersion;

describe("resource compatibility intent", () => {
	it("allows a mixed Modrinth project on vanilla when browsed as a datapack", () => {
		expect(getProjectCompatibilityForInstance(project, vanilla).type).toBe(
			"incompatible",
		);
		expect(
			getProjectCompatibilityForInstance(project, vanilla, "datapack").type,
		).toBe("compatible");
		expect(
			getCompatibilityForInstance(
				project,
				datapackVersion,
				vanilla,
				"datapack",
			).type,
		).toBe("compatible");
	});
});
