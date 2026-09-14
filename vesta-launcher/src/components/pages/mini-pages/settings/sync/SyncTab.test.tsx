import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@solidjs/testing-library";
import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { categories, type Snapshot } from "~/settings-sync/model";
import { GameKeybindings } from "@components/settings/GameKeybindings";
import { SyncSettingsTab } from "./SyncTab";

vi.mock("@tauri-apps/api/core", async (original) => ({
	...(await original<typeof import("@tauri-apps/api/core")>()),
	invoke: vi.fn(),
}));
vi.mock("@stores/instances", () => ({
	initializeInstances: () => Promise.resolve(),
	instancesError: () => null,
	instances: () => [
		{
			id: 1,
			name: "Source",
			minecraftVersion: "1.21",
			modloader: null,
			iconPath: null,
		},
		{
			id: 2,
			name: "Local",
			minecraftVersion: "1.21",
			modloader: null,
			iconPath: null,
		},
	],
}));
vi.mock("~/localization", () => ({
	t: (key: string, params?: Record<string, string>) =>
		params ? key + " " + Object.values(params).join(" ") : key,
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
	}) {
		return (
			<input
				type="number"
				role="slider"
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
const gameOptionKeys = [
	"fov",
	"fullscreen",
	"bobView",
	"invertYMouse",
	"mouseSensitivity",
	"soundCategory_master",
	"soundCategory_music",
	"lang",
	"renderDistance",
];
let state: Snapshot[];
beforeEach(() => {
	const computedStyle = window.getComputedStyle.bind(window);
	vi.spyOn(window, "getComputedStyle").mockImplementation((element) => {
		const style = computedStyle(element);
		Object.defineProperty(style, "animationName", {
			value: "none",
			configurable: true,
		});
		return style;
	});
	vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
	state = categories.map((category) => ({
		category,
		sharedValues: {
			fov: "90",
			fullscreen: "false",
			bobView: "true",
			invertYMouse: "false",
			mouseSensitivity: "0.5",
			soundCategory_master: "1",
			soundCategory_music: "0.5",
			lang: "en_us",
			renderDistance: "12",
		},
		catalog: gameOptionKeys.map((key) => ({
			key,
			category: "video",
			labelId: "sync-option-" + key,
			kind: key === "fov" ? ("decimal" as const) : ("text" as const),
			min: 30,
			max: 110,
			step: 1,
		})),
		revision: 0,
		preferences: { enabled: false, sourceInstanceId: null, instanceIds: [] },
	}));
	vi.mocked(invoke).mockReset();
	vi.mocked(invoke).mockImplementation((command, args: any) => {
		if (command === "get_settings_sync")
			return Promise.resolve(structuredClone(state));
		if (command === "save_settings_sync") {
			const current = state.find((item) => item.category === args.category);
			const next = {
				...current,
				...args,
				revision: args.revision + 1,
				sharedValues: {
					...current?.sharedValues,
					...args.changes,
				},
			};
			state = state.map((item) =>
				item.category === next.category ? next : item,
			);
			return Promise.resolve(next);
		}
		throw new Error("Unexpected file command: " + command);
	});
});
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

it("does not enable a category when source selection is cancelled", async () => {
	render(() => <SyncSettingsTab />);
	const toggle = await screen.findByRole("switch", {
		name: "sync-gameOptions-title",
	});
	fireEvent.click(toggle);
	const dialog = await screen.findByRole("dialog");
	fireEvent.keyDown(dialog, { key: "Escape" });
	expect(state[0].preferences.enabled).toBe(false);
	expect(invoke).toHaveBeenCalledTimes(1);
});

it("enables servers immediately without asking for a source", async () => {
	render(() => <SyncSettingsTab />);
	fireEvent.click(
		await screen.findByRole("switch", { name: "sync-servers-title" }),
	);
	await waitFor(() =>
		expect(state.find((s) => s.category === "servers")!.preferences).toEqual({
			enabled: true,
			sourceInstanceId: null,
			instanceIds: [],
		}),
	);
	expect(screen.queryByRole("dialog")).toBeNull();
});

it("re-enables an initialized bundle without asking for its former source", async () => {
	state[0] = { ...state[0], initialized: true };
	render(() => <SyncSettingsTab />);
	fireEvent.click(
		await screen.findByRole("switch", { name: "sync-gameOptions-title" }),
	);
	await waitFor(() => expect(state[0].preferences.enabled).toBe(true));
	expect(state[0].preferences.sourceInstanceId).toBeNull();
	expect(screen.queryByRole("dialog")).toBeNull();
});

async function openSharedOptions() {
	fireEvent.click(
		await screen.findByRole("button", {
			name: "sync-edit sync-gameOptions-title",
		}),
	);
	fireEvent.click(screen.getByRole("button", { name: "sync-edit-shared" }));
}

it("keeps shared editing on its own page and unavailable while sync is off", async () => {
	render(() => <SyncSettingsTab />);
	fireEvent.click(
		await screen.findByRole("button", {
			name: "sync-edit sync-gameOptions-title",
		}),
	);
	expect(
		screen
			.getByRole("button", { name: "sync-edit-shared" })
			.hasAttribute("disabled"),
	).toBe(true);
	expect(
		screen.queryByRole("button", { name: "sync-option-label sync-option-fov" }),
	).toBeNull();
});

it("selects individual options and all or none without changing membership", async () => {
	state[0] = {
		...state[0],
		initialized: true,
		preferences: { ...state[0].preferences, enabled: true, instanceIds: [1] },
	};
	render(() => <SyncSettingsTab />);
	await openSharedOptions();
	expect(
		screen.queryByRole("switch", { name: "sync-all-instances" }),
	).toBeNull();
	fireEvent.click(
		screen.getByRole("button", { name: "sync-option-label sync-option-fov" }),
	);
	await waitFor(() =>
		expect(state[0].preferences.selectedKeys).toEqual(
			gameOptionKeys.filter((key) => key !== "fov"),
		),
	);
	fireEvent.click(screen.getByRole("button", { name: "sync-all" }));
	await waitFor(() =>
		expect(state[0].preferences.selectedKeys).toEqual(gameOptionKeys),
	);
	fireEvent.click(screen.getByRole("button", { name: "sync-unsync-all" }));
	await waitFor(() => expect(state[0].preferences.selectedKeys).toEqual([]));
	expect(state[0].preferences.instanceIds).toEqual([1]);
	expect(state[0].preferences.enabled).toBe(true);
});

it("keeps the prior selection when saving fails", async () => {
	state[0].preferences.enabled = true;
	render(() => <SyncSettingsTab />);
	await openSharedOptions();
	vi.mocked(invoke).mockRejectedValueOnce(new Error("Changed elsewhere"));
	fireEvent.click(screen.getByRole("button", { name: "sync-unsync-all" }));
	expect(await screen.findByRole("alert")).toBeTruthy();
	expect(state[0].preferences.selectedKeys ?? gameOptionKeys).toEqual(
		gameOptionKeys,
	);
});

it("saves a shared value in its native format and keeps absent values unavailable", async () => {
	state[0].preferences.enabled = true;
	delete state[0].sharedValues?.lang;
	render(() => <SyncSettingsTab />);
	await openSharedOptions();
	const fov = screen.getByRole("slider", {
		name: "sync-value-label sync-option-fov",
	});
	fireEvent.input(fov, { target: { value: "100" } });
	fireEvent.blur(fov);
	await waitFor(() => expect(state[0].sharedValues?.fov).toBe("100"));
	expect(
		screen.queryByRole("textbox", {
			name: "sync-value-label sync-option-lang",
		}),
	).toBeNull();
});

it("freezes instance membership while sync is paused", async () => {
	render(() => <SyncSettingsTab />);
	fireEvent.click(
		await screen.findByRole("button", {
			name: "sync-edit sync-gameOptions-title",
		}),
	);
	const all = screen.getByRole("button", { name: "sync-all-instances" });
	const one = screen.getByRole("button", { name: "sync-instance-label Local" });
	expect(all.hasAttribute("disabled")).toBe(true);
	expect(one.hasAttribute("disabled")).toBe(true);
	fireEvent.click(all);
	fireEvent.click(one);
	expect(state[0].preferences.instanceIds).toEqual([]);
});

it("seeds defaults once, then tracks membership without showing a source", async () => {
	render(() => <SyncSettingsTab />);
	fireEvent.click(
		await screen.findByRole("switch", { name: "sync-gameOptions-title" }),
	);
	fireEvent.click(await screen.findByRole("button", { name: /Source/ }));
	await waitFor(() =>
		expect(state[0].preferences).toEqual({
			enabled: true,
			sourceInstanceId: 1,
			instanceIds: [1],
		}),
	);
	await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	fireEvent.click(
		screen.getByRole("button", { name: "sync-edit sync-gameOptions-title" }),
	);
	expect(screen.getByRole("button", { name: "sync-back" })).toBeTruthy();
	expect(screen.queryByText("sync-source-badge")).toBeNull();
	expect(
		screen.queryByRole("button", { name: "sync-choose-source" }),
	).toBeNull();
	fireEvent.click(
		screen.getByRole("button", { name: "sync-instance-label Local" }),
	);
	await waitFor(() => expect(state[0].preferences.instanceIds).toEqual([1, 2]));
	fireEvent.click(
		screen.getByRole("button", { name: "sync-instance-label Source" }),
	);
	await waitFor(() => expect(state[0].preferences.instanceIds).toEqual([2]));
	expect(state[1].preferences.enabled).toBe(false);
	expect(state[2].preferences.enabled).toBe(false);
	cleanup();
	render(() => <SyncSettingsTab />);
	expect(
		(
			await screen.findByRole("switch", { name: "sync-gameOptions-title" })
		).getAttribute("aria-checked"),
	).toBe("true");
});

it("keybinds asks for an owner and uses the shared recorder", async () => {
	state[1].sharedValues = { "key_key.forward": "key.keyboard.w" };
	render(() => <SyncSettingsTab />);
	fireEvent.click(
		await screen.findByRole("switch", { name: "sync-keybinds-title" }),
	);
	expect(await screen.findByRole("dialog")).toBeTruthy();
	fireEvent.click(screen.getByText("Source"));
	await waitFor(() => expect(state[1].preferences.sourceInstanceId).toBe(1));
	await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	fireEvent.click(
		screen.getByRole("button", { name: "sync-edit sync-keybinds-title" }),
	);
	fireEvent.click(screen.getByRole("button", { name: "sync-edit-shared" }));
	fireEvent.click(
		await screen.findByRole("button", {
			name: "game-options-key-change Forward",
		}),
	);
	fireEvent.keyDown(window, { code: "KeyQ", key: "q" });
	await waitFor(() =>
		expect(state[1].sharedValues?.["key_key.forward"]).toBe("key.keyboard.q"),
	);
	fireEvent.click(
		screen.getByRole("button", { name: "game-options-key-change Forward" }),
	);
	fireEvent.mouseDown(window, { button: 2 });
	await waitFor(() =>
		expect(state[1].sharedValues?.["key_key.forward"]).toBe("key.mouse.right"),
	);
	expect(state[0].preferences.enabled).toBe(false);
});
it("resource packs remain preferences only and need no owner", async () => {
	render(() => <SyncSettingsTab />);
	fireEvent.click(
		await screen.findByRole("switch", { name: "sync-resourcePacks-title" }),
	);
	await waitFor(() => expect(state[3].preferences.enabled).toBe(true));
	expect(state[3].preferences.sourceInstanceId).toBeNull();
	expect(screen.queryByRole("dialog")).toBeNull();
});

it("switching or cancelling a recorder does not bind the control click", () => {
	const change = vi.fn();
	render(() => (
		<GameKeybindings
			state={{
				rows: () => [
					{ key: "forward", category: "keybinds" },
					{ key: "back", category: "keybinds" },
				],
				value: () => "key.keyboard.w",
				label: (row) => row.key,
				busy: () => false,
				change,
			}}
		/>
	));
	const forward = screen.getByRole("button", {
		name: "game-options-key-change forward",
	});
	const back = screen.getByRole("button", {
		name: "game-options-key-change back",
	});
	fireEvent.click(forward);
	fireEvent.mouseDown(back, { button: 0 });
	fireEvent.click(back);
	expect(change).not.toHaveBeenCalled();
	fireEvent.keyDown(window, { code: "KeyS", key: "s" });
	expect(change).toHaveBeenCalledWith("back", "key.keyboard.s");
	change.mockClear();
	fireEvent.click(forward);
	fireEvent.mouseDown(forward, { button: 0 });
	fireEvent.click(forward);
	expect(change).not.toHaveBeenCalled();
	expect(forward.getAttribute("aria-pressed")).toBe("false");
	fireEvent.click(forward);
	fireEvent.mouseDown(window, { button: 0 });
	expect(change).toHaveBeenCalledWith("forward", "key.mouse.left");
});
