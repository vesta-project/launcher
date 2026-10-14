/* @refresh skip */

import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { Show } from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorldArchiveSelectionDialog } from "./WorldArchiveSelectionDialog";

const mocks = vi.hoisted(() => ({
	listener: undefined as
		| ((event: { payload: Record<string, any> }) => void)
		| undefined,
	closedListener: undefined as
		| ((event: { payload: { installId: string } }) => void)
		| undefined,
	submit: vi.fn().mockResolvedValue(undefined),
	unlisten: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
	listen: vi.fn(
		(
			event: string,
			listener: (event: { payload: Record<string, any> }) => void,
		) => {
			if (event === "core://world-install-selection-required")
				mocks.listener = listener;
			if (event === "core://world-install-selection-closed")
				mocks.closedListener = listener;
			return Promise.resolve(mocks.unlisten);
		},
	),
}));

vi.mock("@stores/worlds", () => ({
	registerWorldArchiveChoiceReadiness: () => () => undefined,
	submitWorldArchiveSelection: mocks.submit,
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

vi.mock("./WorldIcon", () => ({
	WorldIcon: (props: any) => <div data-testid="world-icon">{props.name}</div>,
}));

const request = {
	installId: "install-1",
	project: { name: "World Collection" },
	expiresAt: "2099-08-12T12:15:00Z",
	candidates: [
		{
			id: "first",
			name: "First World",
			folder: "First",
			sizeBytes: 1_024,
			iconDataUrl: null,
			dataVersion: 4440,
			gameVersion: "1.21.5",
		},
		{
			id: "second",
			name: "Second World",
			folder: "Second",
			sizeBytes: 2_048,
			iconDataUrl: null,
			dataVersion: null,
			gameVersion: null,
		},
	],
};

async function openRequest() {
	render(() => <WorldArchiveSelectionDialog />);
	await waitFor(() => expect(mocks.listener).toBeTypeOf("function"));
	mocks.listener?.({ payload: request });
	await screen.findByRole("heading", { name: "Choose worlds to install" });
}

describe("WorldArchiveSelectionDialog", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.listener = undefined;
		mocks.closedListener = undefined;
		mocks.submit.mockResolvedValue(undefined);
	});

	it("submits only the checked candidates", async () => {
		await openRequest();

		await fireEvent.click(
			screen.getByRole("checkbox", { name: /Second World/ }),
		);
		await fireEvent.click(
			screen.getByRole("button", { name: "Install selected" }),
		);

		expect(mocks.submit).toHaveBeenCalledWith("install-1", ["second"]);
	});

	it("submits every candidate from Install all", async () => {
		await openRequest();

		await fireEvent.click(screen.getByRole("button", { name: "Install all" }));

		expect(mocks.submit).toHaveBeenCalledWith("install-1", ["first", "second"]);
	});

	it("submits an empty selection when cancelled", async () => {
		await openRequest();

		await fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

		expect(mocks.submit).toHaveBeenCalledWith("install-1", []);
	});

	it("advances to the next queued archive after submission", async () => {
		await openRequest();
		mocks.listener?.({
			payload: {
				...request,
				installId: "install-2",
				project: { name: "Second Collection" },
			},
		});

		await fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

		await screen.findByText(/Second Collection/);
		expect(mocks.submit).toHaveBeenCalledWith("install-1", []);
	});

	it("retires external cancellation without cancelling the next request", async () => {
		await openRequest();
		mocks.listener?.({
			payload: {
				...request,
				installId: "install-2",
				project: { name: "Second Collection" },
			},
		});
		mocks.closedListener?.({ payload: { installId: "install-1" } });

		await screen.findByText(/Second Collection/);
		expect(mocks.submit).not.toHaveBeenCalled();
		mocks.closedListener?.({ payload: { installId: "install-1" } });
		expect(screen.getByText(/Second Collection/)).toBeTruthy();
	});

	it("does not let a stale submission advance an externally opened next request", async () => {
		await openRequest();
		let resolveSubmission!: () => void;
		mocks.submit.mockReturnValueOnce(
			new Promise<void>((resolve) => {
				resolveSubmission = resolve;
			}),
		);
		mocks.listener?.({
			payload: {
				...request,
				installId: "install-2",
				project: { name: "Second Collection" },
			},
		});
		await fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
		mocks.closedListener?.({ payload: { installId: "install-1" } });
		await screen.findByText(/Second Collection/);
		resolveSubmission();
		await waitFor(() =>
			expect(screen.getByRole("button", { name: "Cancel" })).toHaveProperty(
				"disabled",
				false,
			),
		);
		expect(screen.getByText(/Second Collection/)).toBeTruthy();
		expect(mocks.submit).toHaveBeenCalledTimes(1);
	});

	it("cancels current and queued requests and both subscriptions on cleanup", async () => {
		const { unmount } = render(() => <WorldArchiveSelectionDialog />);
		await waitFor(() => expect(mocks.closedListener).toBeTypeOf("function"));
		mocks.listener?.({ payload: request });
		mocks.listener?.({ payload: { ...request, installId: "install-2" } });
		unmount();
		expect(mocks.submit).toHaveBeenCalledWith("install-1", []);
		expect(mocks.submit).toHaveBeenCalledWith("install-2", []);
		expect(mocks.unlisten).toHaveBeenCalledTimes(2);
	});

	it("dismisses an expired backend request", async () => {
		render(() => <WorldArchiveSelectionDialog />);
		await waitFor(() => expect(mocks.listener).toBeTypeOf("function"));
		mocks.listener?.({
			payload: { ...request, expiresAt: "2000-01-01T00:00:00Z" },
		});

		await waitFor(() =>
			expect(mocks.submit).toHaveBeenCalledWith("install-1", []),
		);
		expect(
			screen.queryByRole("heading", { name: "Choose worlds to install" }),
		).toBeNull();
	});
});
