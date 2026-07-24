/* @refresh skip */

import { PageSidebar } from "@components/page-sidebar/page-sidebar";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
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

		const settingsTab = screen.getByRole("tab", { name: "Settings" });

		await fireEvent.pointerEnter(settingsTab);
		expect(onTabIntent).toHaveBeenCalledWith("settings");
		expect(screen.getByText("Persistent page content")).toBeTruthy();

		await fireEvent.click(settingsTab);
		expect(onTabChange).toHaveBeenCalledWith("settings");
		expect(screen.getByRole("tab", { name: "Home" })).toBeTruthy();
	});

	it("keeps an independent scroll position for each tab", async () => {
		const [activeTab, setActiveTab] = createSignal("home");

		render(() => (
			<PageSidebar
				tabs={[
					{ value: "home", label: "Home" },
					{ value: "settings", label: "Settings" },
				]}
				activeTab={activeTab()}
				onTabChange={setActiveTab}
			>
				<div>Scrollable page content</div>
			</PageSidebar>
		));

		const content = screen.getByRole("main");
		content.scrollTop = 600;

		await fireEvent.click(screen.getByRole("tab", { name: "Settings" }));

		expect(activeTab()).toBe("settings");
		expect(content.scrollTop).toBe(0);

		content.scrollTop = 240;
		await fireEvent.click(screen.getByRole("tab", { name: "Home" }));

		expect(activeTab()).toBe("home");
		expect(content.scrollTop).toBe(600);
	});
});
