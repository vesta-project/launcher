/* @refresh skip */

import { render, waitFor } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import { ResourceAvatar } from "./resource-avatar";

vi.mock("@tauri-apps/api/core", () => ({
	convertFileSrc: (path: string) =>
		`asset://localhost/${encodeURIComponent(path)}`,
	invoke: vi.fn().mockResolvedValue("/cache/player head.png"),
}));

vi.mock("@tauri-apps/api/event", () => ({
	listen: vi.fn().mockResolvedValue(() => undefined),
}));

describe("ResourceAvatar player heads", () => {
	it("renders a resolved player head as the avatar background", async () => {
		const { container } = render(() => (
			<ResourceAvatar name="Player" playerUuid="player-id" size={32} />
		));
		const avatar = container.firstElementChild as HTMLElement;

		await waitFor(() => {
			expect(avatar.style.backgroundImage).toContain(
				"asset://localhost/%2Fcache%2Fplayer%20head.png",
			);
		});
		expect(avatar.querySelector("img")).toBeNull();
		expect(avatar.textContent).toBe("");
	});

	it("continues to render ordinary resource icons as images", () => {
		const { container } = render(() => (
			<ResourceAvatar name="Pack" icon="https://example.com/icon.png" />
		));

		expect(container.querySelector("img")?.getAttribute("src")).toBe(
			"https://example.com/icon.png",
		);
	});
});
