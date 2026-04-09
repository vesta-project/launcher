/* @refresh skip */

import { SettingsField } from "@components/settings";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { confirm } from "@tauri-apps/plugin-dialog";
import { createSignal, Show } from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-dialog", () => ({
	confirm: vi.fn(),
}));

vi.mock("@ui/button/button", () => ({
	default: (props: any) => (
		<button onClick={props.onClick} disabled={props.disabled}>
			{props.children}
		</button>
	),
}));

vi.mock("@ui/help-trigger/help-trigger", () => ({
	HelpTrigger: (props: { topic: string }) => <span data-testid="help-trigger">{props.topic}</span>,
}));

describe("SettingsField", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		(confirm as unknown as any).mockResolvedValue(true);
	});

	it("renders headerRight and body slots", () => {
		render(() => (
			<SettingsField
				label="Allocation Range"
				description="Set minimum and maximum memory"
				headerRight={<button>Use Global</button>}
				body={<div>Memory Slider</div>}
			/>
		));

		expect(screen.getByText("Allocation Range")).toBeTruthy();
		expect(screen.getByText("Use Global")).toBeTruthy();
		expect(screen.getByText("Memory Slider")).toBeTruthy();
	});

	it("renders action fallback button when headerRight is not provided", () => {
		render(() => (
			<SettingsField label="Clear Cache" actionLabel="Clear Now" onAction={() => Promise.resolve()} />
		));

		expect(screen.getByRole("button", { name: "Clear Now" })).toBeTruthy();
	});

	it("runs confirmed actions", async () => {
		const onAction = vi.fn().mockResolvedValue(undefined);

		render(() => (
			<SettingsField
				label="Reset"
				actionLabel="Do Reset"
				onAction={onAction}
				confirmationDesc="Are you sure?"
			/>
		));

		await fireEvent.click(screen.getByRole("button", { name: "Do Reset" }));

		await waitFor(() => {
			expect(confirm).toHaveBeenCalledWith("Are you sure?", {
				title: "Confirm Action",
				kind: "info",
			});
			expect(onAction).toHaveBeenCalled();
		});
	});

	it("supports legacy stack control fallback", () => {
		render(() => (
			<SettingsField label="Legacy Field" layout="stack" control={<div>Legacy Stack Control</div>} />
		));

		expect(screen.getByText("Legacy Stack Control")).toBeTruthy();
	});

	it("supports global-toggle header pattern with conditional body", async () => {
		const Harness = () => {
			const [useGlobal, setUseGlobal] = createSignal(false);

			return (
				<SettingsField
					label="Allocation Range"
					headerRight={
						<button onClick={() => setUseGlobal((current) => !current)}>Toggle Global</button>
					}
					body={
						<Show when={!useGlobal()} fallback={<div>Using global memory</div>}>
							<div>Instance memory slider</div>
						</Show>
					}
				/>
			);
		};

		render(() => <Harness />);
		expect(screen.getByText("Instance memory slider")).toBeTruthy();

		await fireEvent.click(screen.getByRole("button", { name: "Toggle Global" }));
		expect(screen.getByText("Using global memory")).toBeTruthy();
	});
});
