import {
	fireEvent,
	render,
	screen,
	waitFor,
	cleanup,
} from "@solidjs/testing-library";
import { invoke } from "@tauri-apps/api/core";
import { createSignal } from "solid-js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GameOptionsEditor } from "./GameOptionsEditor";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("~/localization", () => ({ t: (key: string) => key }));
const catalog = [
	{
		key: "fov",
		category: "video",
		labelId: "game-options-fov",
		kind: "number",
		min: -1,
		max: 1,
	},
];
const snapshot = {
	revision: "original",
	exists: true,
	values: { fov: "0", "mod.custom": "keep", version: "1" },
};
beforeEach(() => {
	vi.mocked(invoke).mockReset();
	vi.mocked(invoke).mockImplementation(async (command) =>
		command === "get_game_options_catalog" ? catalog : snapshot,
	);
});
afterEach(cleanup);

it("keeps unsupported numeric values visible while editing another key", async () => {
	vi.mocked(invoke).mockImplementation(async (command) =>
		command === "get_game_options_catalog"
			? catalog
			: { ...snapshot, values: { ...snapshot.values, fov: "legacy-value" } },
	);
	render(() => <GameOptionsEditor instanceId={7} />);
	const fov = await screen.findByRole("textbox", { name: "game-options-fov" });
	expect((fov as HTMLInputElement).value).toBe("legacy-value");
	fireEvent.input(screen.getByRole("textbox", { name: "mod.custom" }), {
		target: { value: "new" },
	});
	fireEvent.submit(screen.getByRole("form"));
	await waitFor(() =>
		expect(invoke).toHaveBeenCalledWith("save_instance_game_options", {
			instanceId: 7,
			patch: { revision: "original", changes: { "mod.custom": "new" } },
		}),
	);
});

it("sends only edited keys, converts FOV degrees, and hides protected keys", async () => {
	render(() => <GameOptionsEditor instanceId={7} />);
	const input = await screen.findByRole("spinbutton", {
		name: "game-options-fov",
	});
	expect((input as HTMLInputElement).value).toBe("70");
	expect(screen.queryByLabelText("version")).toBeNull();
	fireEvent.input(input, { target: { value: "90" } });
	fireEvent.submit(screen.getByRole("form"));
	await waitFor(() =>
		expect(invoke).toHaveBeenCalledWith("save_instance_game_options", {
			instanceId: 7,
			patch: { revision: "original", changes: { fov: "0.5" } },
		}),
	);
});

it("retains custom edits when saving fails and requires discard before reload", async () => {
	render(() => <GameOptionsEditor instanceId={7} />);
	const custom = await screen.findByRole("textbox", { name: "mod.custom" });
	fireEvent.input(custom, { target: { value: "changed" } });
	vi.mocked(invoke).mockRejectedValueOnce(new Error("Close the game"));
	fireEvent.submit(screen.getByRole("form"));
	await screen.findByRole("alert");
	expect((custom as HTMLInputElement).value).toBe("changed");
	expect(
		(
			screen.getByRole("button", {
				name: "game-options-reload",
			}) as HTMLButtonElement
		).disabled,
	).toBe(true);
	fireEvent.click(screen.getByRole("button", { name: "game-options-discard" }));
	expect((custom as HTMLInputElement).value).toBe("keep");
});

it("does not publish an old instance response into a newly selected instance", async () => {
	let finishOld!: (result: unknown) => void;
	vi.mocked(invoke).mockImplementation((command, args) => {
		if (command === "get_game_options_catalog") return Promise.resolve(catalog);
		if ((args as { instanceId: number }).instanceId === 1)
			return new Promise((resolve) => {
				finishOld = resolve;
			});
		return Promise.resolve({ ...snapshot, values: { fov: "0.5" } });
	});
	const [id, setId] = createSignal(1);
	render(() => <GameOptionsEditor instanceId={id()} />);
	setId(2);
	await screen.findByRole("spinbutton", { name: "game-options-fov" });
	finishOld(snapshot);
	await Promise.resolve();
	expect(
		(
			screen.getByRole("spinbutton", {
				name: "game-options-fov",
			}) as HTMLInputElement
		).value,
	).toBe("90");
});
