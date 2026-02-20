import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock tauri invoke
vi.mock("@tauri-apps/api/core", () => ({
	invoke: vi.fn(),
}));

// Mock auth helper
vi.mock("@utils/auth", () => ({
	getActiveAccount: vi.fn(),
	ACCOUNT_TYPE_GUEST: "guest",
}));

// Mock router/page-viewer
vi.mock("@components/page-viewer/page-viewer", () => ({
	router: vi.fn(() => ({ navigate: vi.fn() })),
	setPageViewerOpen: vi.fn(),
}));

import { router } from "@components/page-viewer/page-viewer";
import { invoke } from "@tauri-apps/api/core";
import { getActiveAccount } from "@utils/auth";
import { handleDeepLink } from "../app";

beforeEach(() => {
	vi.clearAllMocks();
	(invoke as unknown as any).mockImplementation((cmd: string) => {
		if (cmd === "get_config") return Promise.resolve({ setup_completed: true });
		if (cmd === "parse_vesta_url")
			return Promise.resolve({ target: "install", params: { projectId: "1" } });
		if (cmd === "show_window_from_tray") return Promise.resolve();
		return Promise.resolve();
	});

	(getActiveAccount as unknown as any).mockResolvedValue({
		account_type: "mojang",
		is_expired: false,
	});
	(router as unknown as any).mockReturnValue({ navigate: vi.fn() });
});

describe("handleDeepLink", () => {
	it("invokes show_window_from_tray and navigates for install links", async () => {
		await handleDeepLink("vesta://install?projectId=1", {} as any);

		expect(invoke).toHaveBeenCalledWith("show_window_from_tray");
		expect(invoke).toHaveBeenCalledWith("parse_vesta_url", {
			url: "vesta://install?projectId=1",
		});
		expect(router().navigate).toHaveBeenCalledWith("/install", {
			projectId: "1",
		});
	});
});
