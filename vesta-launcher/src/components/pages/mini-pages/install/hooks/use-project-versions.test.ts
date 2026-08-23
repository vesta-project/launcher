import type { ResourceVersion } from "@stores/resources";
import { describe, expect, it, vi } from "vitest";

vi.mock("@stores/resources", () => ({ resources: { getVersions: vi.fn() } }));
vi.mock("@ui/toast/toast", () => ({ showToast: vi.fn() }));

import {
	createJoinableProjectVersionLookup,
	selectConcreteProjectVersion,
} from "./use-project-versions";

function version(
	id: string,
	releaseType: ResourceVersion["release_type"] = "release",
): ResourceVersion {
	return {
		id,
		project_id: "pack",
		version_number: id,
		game_versions: ["1.21.1"],
		loaders: ["fabric"],
		download_url: `https://example.test/${id}.mrpack`,
		file_name: `${id}.mrpack`,
		release_type: releaseType,
		hash: id,
		dependencies: [],
	};
}

describe("project version resolution", () => {
	it("joins an in-flight lookup when Install is clicked", async () => {
		let finish!: (versions: ResourceVersion[]) => void;
		const fetchVersions = vi.fn(
			() =>
				new Promise<ResourceVersion[]>((resolve) => {
					finish = resolve;
				}),
		);
		const lookup = createJoinableProjectVersionLookup(fetchVersions);
		const source = { id: "pack", platform: "modrinth" };

		const background = lookup(source);
		const installClick = lookup(source);

		expect(installClick).toBe(background);
		expect(fetchVersions).toHaveBeenCalledTimes(1);
		finish([version("stable")]);
		await expect(installClick).resolves.toEqual([version("stable")]);
	});

	it("permits a retry after a failed lookup", async () => {
		const fetchVersions = vi
			.fn<() => Promise<ResourceVersion[]>>()
			.mockRejectedValueOnce(new Error("offline"))
			.mockResolvedValueOnce([version("stable")]);
		const lookup = createJoinableProjectVersionLookup(fetchVersions);
		const source = { id: "pack", platform: "modrinth" };

		await expect(lookup(source)).rejects.toThrow("offline");
		await expect(lookup(source)).resolves.toEqual([version("stable")]);
		expect(fetchVersions).toHaveBeenCalledTimes(2);
	});

	it("prefers an explicitly requested release, then the latest stable download", () => {
		const beta = version("beta", "beta");
		const stable = version("stable");

		expect(
			selectConcreteProjectVersion([beta, stable], { selectedId: "beta" }),
		).toBe(beta);
		expect(selectConcreteProjectVersion([beta, stable], {})).toBe(stable);
	});
});
