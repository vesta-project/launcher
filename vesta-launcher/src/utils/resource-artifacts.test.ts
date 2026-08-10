import { describe, expect, it } from "vitest";
import type { ResourceVersion } from "@stores/resources";
import {
	artifactBundleSummary,
	artifactRoleLabels,
	hasDatapackAndResourcePack,
	projectTypeLabel,
	versionsShareBundlePattern,
} from "./resource-artifacts";

const version = (
	files: ResourceVersion["files"],
): Pick<ResourceVersion, "files" | "download_url" | "file_name" | "hash"> => ({
	files,
	download_url: files?.[0]?.url ?? "",
	file_name: files?.[0]?.file_name ?? "pack.zip",
	hash: "",
});

describe("resource-artifacts", () => {
	it("detects combined datapack and resource pack versions", () => {
		const combined = version([
			{
				url: "https://example.invalid/dp.zip",
				file_name: "dp.zip",
				role: "datapack",
			},
			{
				url: "https://example.invalid/rp.zip",
				file_name: "rp.zip",
				role: "resourcepack",
			},
		]);

		expect(hasDatapackAndResourcePack(combined)).toBe(true);
		expect(artifactRoleLabels(combined)).toEqual([
			"Datapack",
			"Resource pack",
		]);
		expect(artifactBundleSummary(combined)).toBe(
			"Includes datapack & resource pack",
		);
	});

	it("returns null summary for single-artifact versions", () => {
		const datapackOnly = version([
			{
				url: "https://example.invalid/dp.zip",
				file_name: "dp.zip",
				role: "datapack",
			},
		]);
		expect(artifactBundleSummary(datapackOnly)).toBeNull();
		expect(artifactRoleLabels(datapackOnly)).toEqual(["Datapack"]);
	});

	it("finds a bundle pattern across version lists", () => {
		expect(
			versionsShareBundlePattern([
				version([
					{
						url: "https://example.invalid/dp.zip",
						file_name: "dp.zip",
						role: "datapack",
					},
				]),
				version([
					{
						url: "https://example.invalid/dp.zip",
						file_name: "dp.zip",
						role: "datapack",
					},
					{
						url: "https://example.invalid/rp.zip",
						file_name: "rp.zip",
						role: "resourcepack",
					},
				]),
			]),
		).toBe("Includes datapack & resource pack");
	});

	it("builds project type labels from artifact roles", () => {
		expect(
			projectTypeLabel({
				resource_type: "datapack",
				external_ids: { artifact_roles: "datapack,resourcepack" },
			}),
		).toBe("datapack · resource pack");
		expect(
			projectTypeLabel({ resource_type: "datapack" }, [
				version([
					{
						url: "https://example.invalid/dp.zip",
						file_name: "dp.zip",
						role: "datapack",
					},
					{
						url: "https://example.invalid/rp.zip",
						file_name: "rp.zip",
						role: "resourcepack",
					},
				]),
			]),
		).toBe("datapack · resource pack");
	});
});
