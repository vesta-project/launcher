import type { ResourceVersion } from "@stores/resources";
import { createRoot, createSignal } from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getVersions } = vi.hoisted(() => ({ getVersions: vi.fn() }));
vi.mock("@stores/resources", () => ({ resources: { getVersions } }));
vi.mock("@ui/toast/toast", () => ({ showToast: vi.fn() }));

import {
	createJoinableProjectVersionLookup,
	selectConcreteProjectVersion,
	useProjectVersions,
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
	beforeEach(() => {
		vi.clearAllMocks();
	});

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

	it("exposes a failed lookup and clears it when the visible retry succeeds", async () => {
		getVersions
			.mockRejectedValueOnce(new Error("offline"))
			.mockResolvedValueOnce([version("stable")]);

		await new Promise<void>((done) => {
			createRoot((dispose) => {
				const [selectedId, setSelectedId] = createSignal("");
				const [url, setUrl] = createSignal("");
				const lookup = useProjectVersions({
					isModpackMode: () => true,
					modpackPath: () => "",
					modpackUrl: url,
					modpackInfo: () => ({
						modpackId: "pack",
						modpackPlatform: "modrinth",
					}),
					selectedModpackVersionId: selectedId,
					setSelectedModpackVersionId: setSelectedId,
					setModpackUrl: setUrl,
				});

				void vi
					.waitFor(() => {
						expect(lookup.versionLookupError()?.message).toBe("offline");
					})
					.then(async () => {
						await lookup.retryProjectVersions();
						expect(lookup.versionLookupError()).toBeUndefined();
						expect(selectedId()).toBe("stable");
						expect(url()).toBe("https://example.test/stable.mrpack");
						dispose();
						done();
					});
			});
		});
	});
});
