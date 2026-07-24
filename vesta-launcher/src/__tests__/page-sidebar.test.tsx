/* @refresh skip */

import { PageSidebar } from "@components/page-sidebar/page-sidebar";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";

describe("PageSidebar", () => {
	it("keeps page chrome mounted while reporting preload intent and navigation", async () => {
		const onTabChange = vi.fn();
		const onTabIntent = vi.fn();

		render(() => (
			<PageSidebar
				tabs={[
					{ value: "home", label: "Home" },
					{ value: "settings", label: "Settings" },
				]}
				activeTab="home"
				onTabChange={onTabChange}
				onTabIntent={onTabIntent}
			>
				<div>Persistent page content</div>
			</PageSidebar>
		));

		const settingsTab = screen.getByRole("button", { name: "Settings" });

		await fireEvent.pointerEnter(settingsTab);
		expect(onTabIntent).toHaveBeenCalledWith("settings");
		expect(screen.getByText("Persistent page content")).toBeTruthy();

		await fireEvent.click(settingsTab);
		expect(onTabChange).toHaveBeenCalledWith("settings");
		expect(screen.getByRole("button", { name: "Home" })).toBeTruthy();
	});
});
