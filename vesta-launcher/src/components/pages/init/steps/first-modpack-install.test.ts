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
		const queueInstall = vi.fn(() => {
			order.push("install");
			return Promise.resolve(42);
		});

		await expect(
			installFirstModpack(project, {
				getVersions: async () => [beta, stable],
				queueInstall,
				completeOnboarding: () => {
					order.push("complete");
					return Promise.resolve();
				},
				goNext: () => {
					order.push("next");
					return Promise.resolve();
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
				queueInstall: () => Promise.reject(new Error("queue failed")),
				completeOnboarding,
				goNext,
			}),
		).rejects.toThrow("queue failed");

		expect(completeOnboarding).not.toHaveBeenCalled();
		expect(goNext).not.toHaveBeenCalled();
	});

	it("finishes onboarding without queuing twice after an accepted install", async () => {
		const getVersions = vi.fn(async () => [stable]);
		const queueInstall = vi.fn(async () => 42);
		const completeOnboarding = vi
			.fn<() => Promise<void>>()
			.mockRejectedValueOnce(new Error("setup failed"))
			.mockResolvedValueOnce(undefined);
		const goNext = vi.fn(() => Promise.resolve());
		let acceptedInstanceId: number | undefined;

		await expect(
			installFirstModpack(project, {
				getVersions,
				queueInstall,
				completeOnboarding,
				goNext,
				onInstallAccepted: (instanceId) => {
					acceptedInstanceId = instanceId;
				},
			}),
		).rejects.toThrow("setup failed");

		await expect(
			installFirstModpack(project, {
				getVersions,
				queueInstall,
				completeOnboarding,
				goNext,
				acceptedInstanceId,
			}),
		).resolves.toBe(42);

		expect(getVersions).toHaveBeenCalledTimes(1);
		expect(queueInstall).toHaveBeenCalledTimes(1);
		expect(completeOnboarding).toHaveBeenCalledTimes(2);
		expect(goNext).toHaveBeenCalledTimes(1);
	});
});
