import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
	invoke: vi.fn(),
}));

vi.mock("@utils/auth", () => ({
	getActiveAccount: vi.fn(),
	ACCOUNT_TYPE_GUEST: "guest",
}));

const mockOpenMiniPage = vi.fn();

vi.mock("@components/page-viewer/page-viewer", () => ({
	openMiniPage: (...args: unknown[]) => mockOpenMiniPage(...args),
}));

vi.mock("@ui/toast/toast", () => ({
	showToast: vi.fn(),
}));

vi.mock("@utils/tauri-runtime", () => ({
	hasTauriRuntime: () => true,
}));

vi.mock("@utils/instances", () => ({
	launchInstance: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@stores/instances", () => ({
	instancesState: {
		instances: [{ slug: "my-pack", name: "My Pack" }],
	},
	setLaunching: vi.fn(),
	initializeInstances: vi.fn().mockResolvedValue(undefined),
}));

import { invoke } from "@tauri-apps/api/core";
import { getActiveAccount } from "@utils/auth";
import * as launchIntents from "@utils/launch-intents";

const {
	generateVestaDeepLink,
	handleDeepLink,
	handleDeepLinkMetadata,
	handleLaunchArgs,
	handleQueuedIntents,
	isModpackFilePath,
	resetProcessedIntentKeysForTests,
} = launchIntents;

beforeEach(() => {
	vi.clearAllMocks();
	resetProcessedIntentKeysForTests();
	(invoke as unknown as any).mockImplementation((cmd: string) => {
		if (cmd === "get_config") return Promise.resolve({ setup_completed: true });
		if (cmd === "show_window_from_tray") return Promise.resolve();
		if (cmd === "parse_vesta_url") {
			return Promise.resolve({ target: "install", params: { projectId: "1" } });
		}
		return Promise.resolve();
	});
	(getActiveAccount as unknown as any).mockResolvedValue({
		account_type: "mojang",
		is_expired: false,
	});
});

describe("handleDeepLink", () => {
	it("parses install links and opens the install page", async () => {
		await handleDeepLink("vesta://install?projectId=1");

		expect(invoke).toHaveBeenCalledWith("show_window_from_tray");
		expect(invoke).toHaveBeenCalledWith("parse_vesta_url", {
			url: "vesta://install?projectId=1",
		});
		expect(mockOpenMiniPage).toHaveBeenCalledWith("/install", {
			projectId: "1",
		});
	});

	it("deduplicates repeated deep links in the same session", async () => {
		await handleDeepLink("vesta://install?projectId=1");
		await handleDeepLink("vesta://install?projectId=1");

		expect(invoke).toHaveBeenCalledTimes(3);
		expect(mockOpenMiniPage).toHaveBeenCalledTimes(1);
	});
});

describe("launch intent helpers", () => {
	it("detects modpack file paths", () => {
		expect(isModpackFilePath("/tmp/pack.mrpack")).toBe(true);
		expect(isModpackFilePath("vesta://install?projectId=1")).toBe(false);
	});

	it("generates canonical instance links", () => {
		expect(generateVestaDeepLink("/instance", { slug: "my-pack" })).toBe(
			"vesta://open-instance?slug=my-pack",
		);
	});

	it("routes install deep links to the install page", async () => {
		await handleDeepLinkMetadata({
			target: "install",
			params: { projectId: "1", platform: "modrinth" },
		});
		expect(mockOpenMiniPage).toHaveBeenCalledWith("/install", {
			projectId: "1",
			platform: "modrinth",
		});
	});

	it("routes open-instance deep links to the instance page", async () => {
		await handleDeepLinkMetadata({
			target: "open-instance",
			params: { slug: "my-pack" },
		});
		expect(mockOpenMiniPage).toHaveBeenCalledWith("/instance", {
			slug: "my-pack",
		});
	});

	it("routes launch-instance deep links to launch flow", async () => {
		const { launchInstance } = await import("@utils/instances");
		await handleDeepLinkMetadata({
			target: "launch-instance",
			params: { slug: "my-pack" },
		});
		expect(launchInstance).toHaveBeenCalled();
	});

	it("routes allowed navigate links using path params", async () => {
		await handleDeepLinkMetadata({
			target: "navigate",
			params: { path: "/config" },
		});
		expect(mockOpenMiniPage).toHaveBeenCalledWith("/config", {});
	});

	it("rejects unsupported navigate paths", async () => {
		await expect(
			handleDeepLinkMetadata({
				target: "navigate",
				params: { path: "/debug-test" },
			}),
		).rejects.toThrow("Unsupported navigation path");
	});

	it("routes modpack file paths to install page", async () => {
		await handleLaunchArgs(["/tmp/pack.mrpack"]);
		expect(mockOpenMiniPage).toHaveBeenCalledWith("/install", {
			modpackPath: "/tmp/pack.mrpack",
			isModpack: true,
		});
	});

	it("preserves argv groups for CLI resource shortcuts", async () => {
		await handleQueuedIntents([
			{
				type: "argv",
				args: ["--open-resource", "modrinth", "fabric-api"],
			},
		]);
		expect(mockOpenMiniPage).toHaveBeenCalledWith("/resource-details", {
			platform: "modrinth",
			projectId: "fabric-api",
		});
	});
});
