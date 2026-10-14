/* @refresh skip */
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import type { ManualDropRequest } from "@stores/manual-resource-drops";
import { createSignal, Show } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	submit: vi.fn(),
	pick: vi.fn(),
	open: vi.fn(),
}));
const [request, setRequest] = createSignal<ManualDropRequest | null>(null);
const [submitting, setSubmitting] = createSignal(false);
vi.mock("@stores/manual-resource-drops", () => ({
	manualDropRequest: () => request(),
	manualDropSubmitting: () => submitting(),
	submitManualDropChoice: (...args: unknown[]) => mocks.submit(...args),
}));
vi.mock("@components/page-viewer/page-viewer", () => ({
	openMiniPage: mocks.open,
}));
vi.mock("@components/pages/mini-pages/install/install-entry-actions", () => ({
	pickLocalModpackFile: mocks.pick,
}));
vi.mock("@ui/button/button", () => ({
	default: (props: any) => (
		<button type="button" disabled={props.disabled} onClick={props.onClick}>
			{props.children}
		</button>
	),
}));
vi.mock("@ui/dialog/dialog", () => ({
	Dialog: (props: any) => (
		<Show when={props.open}>
			<div>{props.children}</div>
		</Show>
	),
	DialogContent: (props: any) => <div>{props.children}</div>,
	DialogDescription: (props: any) => <p>{props.children}</p>,
	DialogHeader: (props: any) => <header>{props.children}</header>,
	DialogTitle: (props: any) => <h2>{props.children}</h2>,
}));
vi.mock("@components/worlds/WorldSelectionDialog", () => ({
	WorldSelectionDialog: (props: any) => (
		<Show when={props.isOpen}>
			<div>
				<h2>Existing world picker</h2>
				<span>{props.initialInstanceId}</span>
				<Show when={props.selectionError}>
					<p role="alert">{props.selectionError}</p>
				</Show>
				<button
					type="button"
					disabled={props.selectionPending}
					onClick={() =>
						props.onSelect({
							instanceId: props.initialInstanceId,
							directoryName: "World",
						})
					}
				>
					World
				</button>
				<button type="button" onClick={props.onClose}>
					Cancel world selection
				</button>
			</div>
		</Show>
	),
}));

import { ManualResourceDropDialog } from "./ManualResourceDropDialog";

const choice = (
	overrides: Partial<ManualDropRequest> = {},
): ManualDropRequest => ({
	operationId: "op",
	decisionId: "choice",
	instanceId: 7,
	instanceName: "Example",
	phase: "resources",
	candidates: [{ id: "a", name: "Pack", kinds: ["resourcePack"] }],
	dependencies: [],
	notes: [],
	expiresAt: "2099-01-01T00:00:00Z",
	...overrides,
});
beforeEach(() => {
	vi.resetAllMocks();
	setRequest(null);
	setSubmitting(false);
	mocks.submit.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe("manual drop decisions", () => {
	it("submits selected resource candidate IDs rather than filesystem paths", async () => {
		const current = choice();
		setRequest(current);
		render(() => <ManualResourceDropDialog />);
		await fireEvent.click(
			screen.getByRole("button", { name: "Add selected resources" }),
		);
		expect(mocks.submit).toHaveBeenCalledWith(current, {
			selections: [{ candidateId: "a", kind: "resourcePack" }],
		});
	});

	it("routes a datapack batch directly to the existing one-world picker", async () => {
		const current = choice({
			candidates: [
				{ id: "a", name: "A", kinds: ["dataPack"] },
				{ id: "b", name: "B", kinds: ["dataPack"] },
			],
		});
		setRequest(current);
		render(() => <ManualResourceDropDialog />);
		expect(
			screen.getByRole("heading", { name: "Existing world picker" }),
		).toBeTruthy();
		expect(
			screen.queryByRole("heading", { name: "Choose resources to add" }),
		).toBeNull();
		await fireEvent.click(screen.getByRole("button", { name: "World" }));
		expect(mocks.submit).toHaveBeenCalledWith(current, {
			selections: [
				{
					candidateId: "a",
					kind: "dataPack",
					world: { instanceId: 7, directoryName: "World" },
				},
				{
					candidateId: "b",
					kind: "dataPack",
					world: { instanceId: 7, directoryName: "World" },
				},
			],
		});
	});

	it("shows inspection warnings before choosing a datapack world", async () => {
		setRequest(
			choice({
				candidates: [{ id: "a", name: "Pack", kinds: ["dataPack"] }],
				notes: ["Another dropped file could not be inspected."],
			}),
		);
		render(() => <ManualResourceDropDialog />);
		expect(
			screen.getByText("Another dropped file could not be inspected."),
		).toBeTruthy();
		expect(
			screen.queryByRole("heading", { name: "Existing world picker" }),
		).toBeNull();
		await fireEvent.click(
			screen.getByRole("button", { name: "Add selected resources" }),
		);
		expect(
			screen.getByRole("heading", { name: "Existing world picker" }),
		).toBeTruthy();
	});

	it("keeps backend world selection errors visible and permits retry", async () => {
		setRequest(
			choice({ candidates: [{ id: "a", name: "Pack", kinds: ["dataPack"] }] }),
		);
		mocks.submit.mockRejectedValueOnce(new Error("World is unavailable"));
		render(() => <ManualResourceDropDialog />);
		await fireEvent.click(screen.getByRole("button", { name: "World" }));
		expect((await screen.findByRole("alert")).textContent).toBe(
			"World is unavailable",
		);
		await fireEvent.click(screen.getByRole("button", { name: "World" }));
		expect(mocks.submit).toHaveBeenCalledTimes(2);
	});

	it("records dependency consent only with the remember checkbox", async () => {
		const current = choice({
			phase: "dependencies",
			candidates: [],
			dependencies: [{ id: "dep", name: "Required API", version: "1.0" }],
		});
		setRequest(current);
		render(() => <ManualResourceDropDialog />);
		await fireEvent.click(
			screen.getByRole("checkbox", {
				name: "Remember my choice for manual mod drops",
			}),
		);
		await fireEvent.click(
			screen.getByRole("button", { name: "Download dependencies" }),
		);
		expect(mocks.submit).toHaveBeenCalledWith(current, {
			downloadDependencies: true,
			remember: true,
		});
	});

	it("lets users decline without remembering and resets state for the next choice", async () => {
		const current = choice({ phase: "dependencies", candidates: [] });
		setRequest(current);
		render(() => <ManualResourceDropDialog />);
		await fireEvent.click(screen.getByRole("checkbox"));
		setRequest({ ...current, decisionId: "next" });
		await fireEvent.click(
			screen.getByRole("button", { name: "Keep only dropped mods" }),
		);
		expect(mocks.submit).toHaveBeenCalledWith(
			expect.objectContaining({ decisionId: "next" }),
			{ downloadDependencies: false, remember: false },
		);
	});

	it("disables choices during submission", () => {
		setRequest(choice());
		setSubmitting(true);
		render(() => <ManualResourceDropDialog />);
		expect(
			screen.getByRole("button", { name: "Add selected resources" }),
		).toHaveProperty("disabled", true);
	});

	it("adds independent resources from a mixed drop while excluding the modpack", async () => {
		const current = choice({
			candidates: [
				{ id: "pack", name: "Modpack", kinds: ["modpack"] },
				{ id: "resource", name: "Resource pack", kinds: ["resourcePack"] },
			],
		});
		setRequest(current);
		render(() => <ManualResourceDropDialog />);
		expect(screen.getByRole("checkbox", { name: "Modpack" })).toHaveProperty(
			"checked",
			false,
		);
		expect(
			screen.getByRole("checkbox", { name: "Resource pack" }),
		).toHaveProperty("checked", true);
		await fireEvent.click(
			screen.getByRole("button", { name: "Add selected resources" }),
		);
		expect(mocks.submit).toHaveBeenCalledWith(current, {
			selections: [{ candidateId: "resource", kind: "resourcePack" }],
		});
		expect(mocks.pick).not.toHaveBeenCalled();
		expect(mocks.open).not.toHaveBeenCalled();
	});

	it("never applies a recognized modpack over the target instance", async () => {
		const current = choice({
			candidates: [{ id: "pack", name: "Modpack", kinds: ["modpack"] }],
		});
		setRequest(current);
		render(() => <ManualResourceDropDialog />);
		expect(
			screen.getByRole("button", { name: "Add selected resources" }),
		).toHaveProperty("disabled", true);
		expect(screen.getByRole("checkbox", { name: "Modpack" })).toHaveProperty(
			"disabled",
			true,
		);
		expect(
			screen.getByText(/Modpacks cannot be added to an existing instance/),
		).toBeTruthy();
		expect(
			screen.queryByRole("button", { name: /Import as a new instance/ }),
		).toBeNull();
		await fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
		expect(mocks.submit).toHaveBeenCalledWith(current, { cancel: true });
		expect(mocks.pick).not.toHaveBeenCalled();
		expect(mocks.open).not.toHaveBeenCalled();
	});
});
