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
					void state.save().catch(() => {});
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

const catalog = [
	{
		id: "fov",
		key: "fov",
		category: "video",
		kind: "decimal",
		min: 30,
		max: 110,
		step: 1,
	},
	{
		id: "fullscreen",
		key: "fullscreen",
		category: "video",
		kind: "boolean",
	},
];
const snapshot = {
	revision: "original",
	exists: true,
	values: { fov: "70", "mod.custom": "keep", version: "1" },
};

beforeEach(() => {
	vi.mocked(invoke).mockReset();
	vi.mocked(invoke).mockImplementation(async (command) =>
		command === "get_game_options_catalog" ? catalog : snapshot,
	);
});
afterEach(cleanup);

it("loads only after the hidden settings page is opened", async () => {
	const [enabled, setEnabled] = createSignal(false);
	function HiddenEditor() {
		const state = createGameOptionsEditor({
			instanceId: 7,
			get enabled() {
				return enabled();
			},
		});
		return (
			<Show when={enabled()}>
				<GameOptionsEditor state={state} />
			</Show>
		);
	}
	render(() => <HiddenEditor />);
	expect(invoke).not.toHaveBeenCalled();
	setEnabled(true);
	await screen.findByRole("spinbutton", {
		name: "FOV",
	});
	expect(invoke).toHaveBeenCalledWith("get_instance_game_options", {
		instanceId: 7,
		editorValues: true,
	});
});

it("sends only edited keys and hides protected keys", async () => {
	render(() => <EditorHarness instanceId={7} />);
	const input = await screen.findByRole("spinbutton", {
		name: "FOV",
	});
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

it("uses a switch to patch boolean options", async () => {
	vi.mocked(invoke).mockImplementation(async (command) =>
		command === "get_game_options_catalog"
			? catalog
			: { ...snapshot, values: { fullscreen: "false" } },
	);
	render(() => <EditorHarness instanceId={7} />);
	fireEvent.click(
		await screen.findByRole("switch", { name: "Fullscreen" }),
	);
	fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
	await waitFor(() =>
		expect(invoke).toHaveBeenCalledWith("save_instance_game_options", {
			instanceId: 7,
			editorValues: true,
			patch: { revision: "original", changes: { fullscreen: "true" } },
		}),
	);
});
