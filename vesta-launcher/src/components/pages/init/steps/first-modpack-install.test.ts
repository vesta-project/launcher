import { describe, expect, it, vi } from "vitest";
import {
	type FirstModpackProject,
	type FirstModpackVersion,
	installFirstModpack,
} from "./first-modpack-install";

const project: FirstModpackProject = {
	id: "pack",
	name: "A Pack",
	iconUrl: "https://example.test/icon.png",
	platform: "modrinth",
};

const beta: FirstModpackVersion = {
	id: "beta",
	game_versions: ["1.21.1"],
	loaders: ["fabric"],
	download_url: "https://example.test/beta.mrpack",
	release_type: "beta",
};

const stable: FirstModpackVersion = {
	...beta,
	id: "stable",
	download_url: "https://example.test/stable.mrpack",
	release_type: "release",
};

describe("first modpack onboarding install", () => {
	it("queues the latest stable release before completing onboarding", async () => {
		const order: string[] = [];
		const queueInstall = vi.fn(async () => {
			order.push("install");
			return 42;
		});

		await expect(
			installFirstModpack(project, {
				getVersions: async () => [beta, stable],
				queueInstall,
				completeOnboarding: async () => {
					order.push("complete");
				},
				goNext: async () => {
					order.push("next");
				},
			}),
		).resolves.toBe(42);

		expect(order).toEqual(["install", "complete", "next"]);
		expect(queueInstall).toHaveBeenCalledWith(
			stable.download_url,
			expect.objectContaining({
				name: project.name,
				minecraftVersion: "1.21.1",
				modloader: "fabric",
				minMemory: 2048,
				maxMemory: 4096,
				modpackId: project.id,
				modpackPlatform: project.platform,
				modpackVersionId: stable.id,
			}),
		);
	});

	it("does not complete onboarding when the backend rejects the install", async () => {
		const completeOnboarding = vi.fn();
		const goNext = vi.fn();

		await expect(
			installFirstModpack(project, {
				getVersions: async () => [stable],
				queueInstall: async () => {
					throw new Error("queue failed");
				},
				completeOnboarding,
				goNext,
			}),
		).rejects.toThrow("queue failed");

		expect(completeOnboarding).not.toHaveBeenCalled();
		expect(goNext).not.toHaveBeenCalled();
	});
});
