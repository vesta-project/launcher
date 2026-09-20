import FloatingSaveFooter from "@components/floating-save-footer/floating-save-footer";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@solidjs/testing-library";
import { invoke } from "@tauri-apps/api/core";
import { createSignal, Show } from "solid-js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	createGameOptionsEditor,
	GameOptionsEditor,
} from "./GameOptionsEditor";

function EditorHarness(props: { instanceId: number }) {
	const state = createGameOptionsEditor(props);
	return (
		<>
			<GameOptionsEditor state={state} />
			<FloatingSaveFooter
				show={state.dirtyCount() > 0}
				isSaving={state.saving()}
				onSave={() => {
					void state.save().catch(() => undefined);
				}}
				onCancel={state.discard}
			/>
		</>
	);
}

vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
	...(await importOriginal<typeof import("@tauri-apps/api/core")>()),
	invoke: vi.fn(),
}));
vi.mock("~/localization", () => ({
	t: (key: string, params?: Record<string, string | number>) =>
		params ? `${key} ${Object.values(params).join(" ")}` : key,
}));
vi.mock("@ui/slider/slider", () => {
	function Slider(props: {
		value?: number[];
		minValue?: number;
		maxValue?: number;
		step?: number;
		disabled?: boolean;
		"aria-label"?: string;
		onChange?: (value: number[]) => void;
		onChangeEnd?: (value: number[]) => void;
		children?: unknown;
	}) {
		return (
			<input
				type="number"
				role="spinbutton"
				aria-label={props["aria-label"]}
				min={props.minValue}
				max={props.maxValue}
				step={props.step}
				disabled={props.disabled}
				value={props.value?.[0] ?? ""}
				onInput={(event) => {
					const next = Number((event.currentTarget as HTMLInputElement).value);
					props.onChange?.([next]);
					props.onChangeEnd?.([next]);
				}}
			/>
		);
	}
	return {
		Slider,
		SliderTrack: (props: { children?: unknown }) => props.children,
		SliderFill: () => null,
		SliderThumb: () => null,
	};
});
vi.mock("@ui/switch/switch", () => {
	function Switch(props: {
		checked?: boolean;
		disabled?: boolean;
		"aria-label"?: string;
		onCheckedChange?: (checked: boolean) => void;
		children?: unknown;
	}) {
		return (
			<input
				type="checkbox"
				role="switch"
				aria-label={props["aria-label"]}
				aria-checked={Boolean(props.checked)}
				checked={Boolean(props.checked)}
				disabled={Boolean(props.disabled)}
				onChange={(event) => {
					props.onCheckedChange?.(
						(event.currentTarget as HTMLInputElement).checked,
					);
				}}
			/>
		);
	}
	return {
		Switch,
		SwitchLabel: () => null,
		SwitchControl: (props: { children?: unknown }) => props.children,
		SwitchThumb: () => null,
	};
});

const catalog = [
	{
		key: "fov",
		id: "fov",
		category: "video",
		kind: "integer",
		min: 30,
		max: 110,
		step: 1,
	},
];
const snapshot = {
	revision: "original",
	exists: true,
	values: { fov: "70", "mod.custom": "keep", version: "1" },
};

beforeEach(() => {
	vi.mocked(invoke).mockReset();
	vi.mocked(invoke).mockImplementation((command) =>
		Promise.resolve(
			command === "get_game_options_catalog" ? catalog : snapshot,
		),
	);
});
afterEach(cleanup);

it("keeps unsupported numeric values visible while editing another key", async () => {
	vi.mocked(invoke).mockImplementation(async (command) =>
		command === "get_game_options_catalog"
			? catalog
			: { ...snapshot, values: { ...snapshot.values, fov: "legacy-value" } },
	);
	render(() => <EditorHarness instanceId={7} />);
	const fov = await screen.findByRole("textbox", { name: "FOV" });
	expect((fov as HTMLInputElement).value).toBe("legacy-value");
	fireEvent.input(screen.getByRole("textbox", { name: "Mod custom" }), {
		target: { value: "new" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
	await waitFor(() =>
		expect(invoke).toHaveBeenCalledWith("save_instance_game_options", {
			instanceId: 7,
			editorValues: true,
			patch: { revision: "original", changes: { "mod.custom": "new" } },
		}),
	);
});

it("sends only edited keys, converts FOV degrees, and hides protected keys", async () => {
	render(() => <EditorHarness instanceId={7} />);
	const input = await screen.findByRole("spinbutton", {
		name: "FOV",
	});
	expect((input as HTMLInputElement).value).toBe("70");
	expect(screen.queryByLabelText("version")).toBeNull();
	fireEvent.input(input, { target: { value: "90" } });
	fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
	await waitFor(() =>
		expect(invoke).toHaveBeenCalledWith("save_instance_game_options", {
			instanceId: 7,
			editorValues: true,
			patch: { revision: "original", changes: { fov: "90" } },
		}),
	);
});

it("retains custom edits when saving fails and requires discard before reload", async () => {
	render(() => <EditorHarness instanceId={7} />);
	const custom = await screen.findByRole("textbox", { name: "Mod custom" });
	fireEvent.input(custom, { target: { value: "changed" } });
	vi.mocked(invoke).mockRejectedValueOnce(new Error("Close the game"));
	fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
	await screen.findByRole("alert");
	expect(
		(screen.getByRole("textbox", { name: "Mod custom" }) as HTMLInputElement)
			.value,
	).toBe("changed");
	expect(
		(
			screen.getByRole("button", {
				name: "game-options-reload",
			}) as HTMLButtonElement
		).disabled,
	).toBe(true);
	fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
	expect(
		(screen.getByRole("textbox", { name: "Mod custom" }) as HTMLInputElement)
			.value,
	).toBe("keep");
});

it("does not publish an old instance response into a newly selected instance", async () => {
	let finishOld!: (result: unknown) => void;
	vi.mocked(invoke).mockImplementation((command, args) => {
		if (command === "get_game_options_catalog") return Promise.resolve(catalog);
		if ((args as { instanceId: number }).instanceId === 1)
			return new Promise((resolve) => {
				finishOld = resolve;
			});
		return Promise.resolve({ ...snapshot, values: { fov: "90" } });
	});
	const [id, setId] = createSignal(1);
	render(() => <EditorHarness instanceId={id()} />);
	setId(2);
	await screen.findByRole("spinbutton", { name: "FOV" });
	finishOld(snapshot);
	await Promise.resolve();
	expect(
		(screen.getByRole("spinbutton", { name: "FOV" }) as HTMLInputElement).value,
	).toBe("90");
});

it("keeps the shared footer dirty while the editor page is unmounted", async () => {
	const [visible, setVisible] = createSignal(true);
	function Page() {
		const state = createGameOptionsEditor({ instanceId: 7 });
		return (
			<>
				<Show when={visible()}>
					<GameOptionsEditor state={state} />
				</Show>
				<FloatingSaveFooter
					show={state.dirtyCount() > 0}
					onSave={() => {
						void state.save();
					}}
					onCancel={state.discard}
				/>
			</>
		);
	}
	render(() => <Page />);
	fireEvent.input(await screen.findByRole("textbox", { name: "Mod custom" }), {
		target: { value: "new" },
	});
	setVisible(false);
	expect(screen.getByRole("button", { name: "Save Changes" })).toBeTruthy();
	fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
	setVisible(true);
	expect(
		(screen.getByRole("textbox", { name: "Mod custom" }) as HTMLInputElement)
			.value,
	).toBe("keep");
	expect(screen.queryByRole("button", { name: "Save Changes" })).toBeNull();
});

it("uses a switch for boolean settings and keeps custom labels readable", async () => {
	vi.mocked(invoke).mockImplementation(async (command) =>
		command === "get_game_options_catalog"
			? [
					{
						key: "fullscreen",
						id: "fullscreen",
						category: "video",
						labelId: "game-options-fullscreen",
						kind: "boolean",
						min: null,
						max: null,
					},
				]
			: {
					...snapshot,
					values: { fullscreen: "false", "mod.fastMode": "true" },
				},
	);
	render(() => <EditorHarness instanceId={7} />);
	const toggle = await screen.findByRole("switch", {
		name: "game-options-fullscreen",
	});
	expect(toggle.getAttribute("aria-checked")).toBe("false");
	expect(screen.getByRole("switch", { name: "Mod fast mode" })).toBeTruthy();
	fireEvent.click(toggle);
	expect(toggle.getAttribute("aria-checked")).toBe("true");
});

it("does not render catalog aliases absent from the instance file", async () => {
	vi.mocked(invoke).mockImplementation(async (command) =>
		command === "get_game_options_catalog"
			? [
					...catalog,
					{
						key: "sound",
						id: "master_volume",
						category: "sound",
						kind: "decimal",
						min: 0,
						max: 1,
						step: 0.01,
					},
				]
			: snapshot,
	);
	render(() => <EditorHarness instanceId={7} />);
	await screen.findByRole("spinbutton", { name: "FOV" });
	expect(screen.queryByRole("spinbutton", { name: "Master volume" })).toBeNull();
});

it("shows percent options as 0-100 and rounds to two decimals", async () => {
	vi.mocked(invoke).mockImplementation(async (command) =>
		command === "get_game_options_catalog"
			? [
					{
						key: "chatOpacity",
						id: "chat_opacity",
						category: "chat",
						kind: "decimal",
						min: 0,
						max: 1,
						step: 0.01,
						unit: "percent",
					},
				]
			: {
					revision: "original",
					exists: true,
					values: { chatOpacity: "0.4375" },
				},
	);
	render(() => <EditorHarness instanceId={7} />);
	const slider = await screen.findByRole("spinbutton", {
		name: "Chat opacity",
	});
	expect((slider as HTMLInputElement).value).toBe("43.75");
	expect(screen.getByText("43.75%")).toBeTruthy();
	fireEvent.input(slider, { target: { value: "50" } });
	fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
	await waitFor(() =>
		expect(invoke).toHaveBeenCalledWith("save_instance_game_options", {
			instanceId: 7,
			editorValues: true,
			patch: { revision: "original", changes: { chatOpacity: "0.5" } },
		}),
	);
});
