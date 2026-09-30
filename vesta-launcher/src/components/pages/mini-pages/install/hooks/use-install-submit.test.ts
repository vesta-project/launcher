import { createRoot } from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { installModpackFromUrl } = vi.hoisted(() => ({
	installModpackFromUrl: vi.fn(),
}));

vi.mock("@stores/resources", () => ({ resources: { install: vi.fn() } }));
vi.mock("@ui/toast/toast", () => ({ showToast: vi.fn() }));
vi.mock("@utils/instances", () => ({
	createInstance: vi.fn(),
	getInstance: vi.fn(),
	installInstance: vi.fn(),
}));
vi.mock("@utils/modpacks", () => ({
	installModpackFromUrl,
	installModpackFromZip: vi.fn(),
}));

import { useInstallSubmit } from "./use-install-submit";

describe("modpack install submission", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		installModpackFromUrl.mockResolvedValue(42);
	});

	it("waits for the concrete release and merges its version ID before queuing", async () => {
		let resolveVersion!: (version: any) => void;
		const concreteVersion = new Promise<any>((resolve) => {
			resolveVersion = resolve;
		});

		await new Promise<void>((done) => {
			createRoot((dispose) => {
				const submit = useInstallSubmit({
					navigateHome: vi.fn(),
					isModpackMode: () => true,
					modpackUrl: () => "",
					modpackPath: () => "",
					modpackInfo: () => undefined,
					resolveConcreteModpackVersion: () => concreteVersion,
				});
				const pending = submit.handleInstall({
					name: "Pack",
					modpackVersionId: null,
				});

				expect(submit.isInstalling()).toBe(true);
				expect(installModpackFromUrl).not.toHaveBeenCalled();
				resolveVersion({
					id: "resolved-version",
					download_url: "https://example.test/pack.mrpack",
				});

				void pending.then(() => {
					expect(installModpackFromUrl).toHaveBeenCalledTimes(1);
					expect(installModpackFromUrl).toHaveBeenCalledWith(
						"https://example.test/pack.mrpack",
						expect.objectContaining({
							name: "Pack",
							modpackVersionId: "resolved-version",
						}),
						undefined,
					);
					dispose();
					done();
				});
			});
		});
	});
});
