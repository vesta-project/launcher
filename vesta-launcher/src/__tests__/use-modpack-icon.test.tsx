/* @refresh skip */

import { render, screen, waitFor } from "@solidjs/testing-library";
import { invoke } from "@tauri-apps/api/core";
import { Suspense } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import { useModpackIcon } from "../hooks/use-modpack-icon";

vi.mock("@tauri-apps/api/core", () => ({
	invoke: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);

const IconProbe = () => {
	const icon = useModpackIcon(() => ({
		modpackId: "pack-id",
		modpackPlatform: "modrinth",
		modpackIconUrl: "https://cdn.example/icon.png",
	}));

	return <span data-testid="icon">{icon() ?? "none"}</span>;
};

describe("useModpackIcon", () => {
	it("does not suspend its page while decorative icon hydration is pending", () => {
		mockedInvoke.mockReturnValueOnce(new Promise(() => {}));

		render(() => (
			<Suspense fallback={<span data-testid="fallback">Loading page</span>}>
				<IconProbe />
			</Suspense>
		));

		expect(screen.queryByTestId("fallback")).toBeNull();
		expect(screen.getByTestId("icon").textContent).toBe("none");
	});

	it("prefers hydrated icon data over a cached modpack icon URL", async () => {
		mockedInvoke.mockResolvedValueOnce([
			{ icon_url: "data:image/png;base64,hydrated" },
		]);

		render(() => <IconProbe />);

		expect(screen.getByTestId("icon").textContent).toBe("none");

		await waitFor(() => {
			expect(screen.getByTestId("icon").textContent).toBe(
				"data:image/png;base64,hydrated",
			);
		});
		expect(mockedInvoke).toHaveBeenCalledWith(
			"get_or_hydrate_resource_projects",
			{
				refs: [{ platform: "modrinth", id: "pack-id" }],
				allowNetwork: true,
				refreshStale: false,
			},
		);
	});

	it("falls back to the cached URL when no hydrated data is available", async () => {
		mockedInvoke.mockResolvedValueOnce([
			{ icon_url: "https://cdn.example/icon.png" },
		]);

		render(() => <IconProbe />);

		await waitFor(() => {
			expect(screen.getByTestId("icon").textContent).toBe(
				"https://cdn.example/icon.png",
			);
		});
	});
});
