/* @refresh skip */

import InstanceSelectionDialog from "@components/instances/InstanceSelectionDialog";
import type { Instance } from "@stores/instances";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";

vi.mock("@ui/dialog/dialog", () => ({
	Dialog: (props: any) => (props.open ? <div>{props.children}</div> : null),
	DialogContent: (props: any) => <div>{props.children}</div>,
	DialogDescription: (props: any) => <p>{props.children}</p>,
	DialogHeader: (props: any) => <header>{props.children}</header>,
	DialogTitle: (props: any) => <h2>{props.children}</h2>,
}));

vi.mock("@utils/icon-animation", () => ({
	createAnimatedIconPreview: () => ({
		displaySource: () => null,
		activate: vi.fn(),
		deactivate: vi.fn(),
	}),
	iconBackgroundStyle: () => ({}),
}));

const instance = (
	id: number,
	name: string,
	lastPlayed: string | null,
): Instance =>
	({
		id,
		name,
		lastPlayed,
		minecraftVersion: "1.21.5",
		modloader: "fabric",
		iconPath: null,
	} as Instance);

describe("InstanceSelectionDialog", () => {
	it("sorts instances by recency and selects an eligible instance", async () => {
		const onSelect = vi.fn();
		render(() => (
			<InstanceSelectionDialog
				isOpen
				description="Choose a destination."
				options={[
					{ instance: instance(1, "Older", "2026-01-01T00:00:00Z") },
					{ instance: instance(2, "Recent", "2026-08-01T00:00:00Z") },
				]}
				onClose={vi.fn()}
				onSelect={onSelect}
			/>
		));

		const options = screen.getAllByRole("button");
		expect(options[0]?.textContent).toContain("Recent");
		expect(options[1]?.textContent).toContain("Older");

		await fireEvent.click(options[0]!);
		expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }));
	});

	it("shows caller-provided disabled feedback and footer action", async () => {
		const onSelect = vi.fn();
		const onCreate = vi.fn();
		render(() => (
			<InstanceSelectionDialog
				isOpen
				title="Move world"
				description="Choose a destination."
				options={[
					{
						instance: instance(1, "Running instance", null),
						disabled: true,
						detail: "Close Minecraft first.",
						badge: "Running",
						tone: "danger",
					},
				]}
				onClose={vi.fn()}
				onSelect={onSelect}
				footerAction={{ label: "Create New Instance", onSelect: onCreate }}
			/>
		));

		expect(screen.getByText("Move world")).toBeTruthy();
		expect(screen.getByText("Close Minecraft first.")).toBeTruthy();
		expect(screen.getByText("Running")).toBeTruthy();

		const runningOption = screen.getByRole("button", {
			name: /Running instance/,
		});
		expect((runningOption as HTMLButtonElement).disabled).toBe(true);
		await fireEvent.click(runningOption);
		expect(onSelect).not.toHaveBeenCalled();

		await fireEvent.click(
			screen.getByRole("button", { name: "Create New Instance" }),
		);
		expect(onCreate).toHaveBeenCalledOnce();
	});
});
