/**
 * Tests for the native drop bridge.
 *
 * These use MOCKED Tauri getters, listeners, scale factors and drag payloads. They
 * verify this module's wiring only: flag and label guards, conversion before the
 * controller, pointer publishing, and cleanup. They are NOT proof of native OS
 * drag-and-drop behaviour, and native behaviour stays unverified until run on real
 * builds.
 */
import type { PhysicalPosition } from "@tauri-apps/api/dpi";
import type { DragDropEvent } from "@tauri-apps/api/webview";
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	type Mock,
	vi,
} from "vitest";
import type { DropController } from "./drop-controller";

const mocks = vi.hoisted(() => ({
	getCurrentWebview: vi.fn(),
	getCurrentWindow: vi.fn(),
	hasTauriRuntime: vi.fn(),
	classify: vi.fn(),
}));

vi.mock("@tauri-apps/api/webview", () => ({
	getCurrentWebview: mocks.getCurrentWebview,
}));
vi.mock("@tauri-apps/api/window", () => ({
	getCurrentWindow: mocks.getCurrentWindow,
}));
vi.mock("@utils/tauri-runtime", () => ({
	hasTauriRuntime: mocks.hasTauriRuntime,
}));
vi.mock("@utils/file-drop/classify", () => ({
	classifyDroppedPaths: mocks.classify,
}));

type BridgeModule = typeof import("@utils/file-drop/native-bridge");
type BridgeTestWindow = Window & {
	__VESTA_NATIVE_FILE_DROP_PROBE__?: unknown;
	__VESTA_OS__?: string;
};
type DragHandler = (event: { payload: DragDropEvent }) => void;
type ScaleHandler = (event: { payload: { scaleFactor: number } }) => void;

let bridge: BridgeModule;

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const pos = (x: number, y: number) => ({ x, y }) as unknown as PhysicalPosition;

function installTauri({ label = "main", scaleFactor = 2 } = {}) {
	const dragHandlers: DragHandler[] = [];
	const scaleHandlers: ScaleHandler[] = [];
	const dropUnlisteners: Mock[] = [];
	const scaleUnlisteners: Mock[] = [];

	const webview = {
		label,
		onDragDropEvent: vi.fn((handler: DragHandler) => {
			dragHandlers.push(handler);
			const unlisten = vi.fn();
			dropUnlisteners.push(unlisten);
			return Promise.resolve(unlisten);
		}),
	};
	const appWindow = {
		label,
		scaleFactor: vi.fn(() => Promise.resolve(scaleFactor)),
		onScaleChanged: vi.fn((handler: ScaleHandler) => {
			scaleHandlers.push(handler);
			const unlisten = vi.fn();
			scaleUnlisteners.push(unlisten);
			return Promise.resolve(unlisten);
		}),
	};

	mocks.getCurrentWebview.mockReturnValue(webview);
	mocks.getCurrentWindow.mockReturnValue(appWindow);

	return {
		webview,
		appWindow,
		dragHandlers,
		scaleHandlers,
		dropUnlisteners,
		scaleUnlisteners,
	};
}

function fakeController() {
	return {
		register: vi.fn(() => () => undefined),
		handle: vi.fn(),
		cancel: vi.fn(),
		dispose: vi.fn(),
	};
}

const emitDrag = (handlers: DragHandler[], payload: DragDropEvent) =>
	handlers.at(-1)?.({ payload });

beforeEach(async () => {
	vi.resetModules();
	vi.resetAllMocks();
	mocks.hasTauriRuntime.mockReturnValue(true);
	mocks.classify.mockResolvedValue([]);
	(window as BridgeTestWindow).__VESTA_NATIVE_FILE_DROP_PROBE__ = true;
	(window as BridgeTestWindow).__VESTA_OS__ = "windows";
	bridge = await import("@utils/file-drop/native-bridge");
});

afterEach(() => {
	delete (window as BridgeTestWindow).__VESTA_NATIVE_FILE_DROP_PROBE__;
	delete (window as BridgeTestWindow).__VESTA_OS__;
});

describe("coordinate conversion before the controller", () => {
	it("halves Windows physical positions by the scale factor", async () => {
		const { dragHandlers } = installTauri({ scaleFactor: 2 });
		const controller = fakeController();
		bridge.startNativeFileDrop({
			controller: controller as unknown as DropController,
		});
		await flush();

		emitDrag(dragHandlers, {
			type: "enter",
			paths: ["/a.zip"],
			position: pos(200, 100),
		});
		expect(controller.handle).toHaveBeenLastCalledWith({
			type: "enter",
			paths: ["/a.zip"],
			position: { x: 100, y: 50 },
		});

		emitDrag(dragHandlers, { type: "over", position: pos(300, 150) });
		expect(controller.handle).toHaveBeenLastCalledWith({
			type: "over",
			position: { x: 150, y: 75 },
		});

		emitDrag(dragHandlers, {
			type: "drop",
			paths: ["/a.zip"],
			position: pos(200, 100),
		});
		expect(controller.handle).toHaveBeenLastCalledWith({
			type: "drop",
			paths: ["/a.zip"],
			position: { x: 100, y: 50 },
		});

		emitDrag(dragHandlers, { type: "leave" });
		expect(controller.handle).toHaveBeenLastCalledWith({ type: "leave" });
	});

	it("passes macOS positions through unchanged, since they are already CSS pixels", async () => {
		(window as BridgeTestWindow).__VESTA_OS__ = "macos";
		const { dragHandlers } = installTauri({ scaleFactor: 2 });
		const controller = fakeController();
		bridge.startNativeFileDrop({
			controller: controller as unknown as DropController,
		});
		await flush();

		emitDrag(dragHandlers, { type: "over", position: pos(200, 100) });

		expect(controller.handle).toHaveBeenLastCalledWith({
			type: "over",
			position: { x: 200, y: 100 },
		});
	});

	it("uses the updated scale after onScaleChanged", async () => {
		const { dragHandlers, scaleHandlers } = installTauri({ scaleFactor: 2 });
		const controller = fakeController();
		bridge.startNativeFileDrop({
			controller: controller as unknown as DropController,
		});
		await flush();

		scaleHandlers[0]?.({ payload: { scaleFactor: 1 } });
		emitDrag(dragHandlers, { type: "over", position: pos(200, 100) });

		expect(controller.handle).toHaveBeenLastCalledWith({
			type: "over",
			position: { x: 200, y: 100 },
		});
	});
});

describe("calibration pointer", () => {
	it("publishes the converted pointer and hides it on leave and drop, then clears on dispose", async () => {
		const { dragHandlers } = installTauri({ scaleFactor: 2 });
		const controller = fakeController();
		const dispose = bridge.startNativeFileDrop({
			controller: controller as unknown as DropController,
		});
		await flush();
		expect(bridge.nativeDropPointer()).toBeNull();

		emitDrag(dragHandlers, {
			type: "enter",
			paths: ["/a.zip"],
			position: pos(200, 100),
		});
		expect(bridge.nativeDropPointer()).toMatchObject({
			cssX: 100,
			cssY: 50,
			os: "windows",
			unit: "physical",
			scaleFactor: 2,
			visible: true,
		});

		emitDrag(dragHandlers, { type: "over", position: pos(300, 150) });
		expect(bridge.nativeDropPointer()).toMatchObject({
			cssX: 150,
			cssY: 75,
			visible: true,
		});

		emitDrag(dragHandlers, {
			type: "drop",
			paths: ["/a.zip"],
			position: pos(200, 100),
		});
		expect(bridge.nativeDropPointer()).toMatchObject({
			cssX: 100,
			cssY: 50,
			visible: false,
		});

		emitDrag(dragHandlers, {
			type: "enter",
			paths: ["/b.zip"],
			position: pos(40, 20),
		});
		emitDrag(dragHandlers, { type: "leave" });
		expect(bridge.nativeDropPointer()).toMatchObject({ visible: false });

		dispose();
		expect(bridge.nativeDropPointer()).toBeNull();
	});
});

describe("guards", () => {
	it("makes no Tauri calls and returns a no-op when the probe flag is off", async () => {
		delete (window as BridgeTestWindow).__VESTA_NATIVE_FILE_DROP_PROBE__;
		const { webview, appWindow } = installTauri();
		const controller = fakeController();

		const dispose = bridge.startNativeFileDrop({
			controller: controller as unknown as DropController,
		});
		await flush();

		expect(mocks.getCurrentWebview).not.toHaveBeenCalled();
		expect(mocks.getCurrentWindow).not.toHaveBeenCalled();
		expect(webview.onDragDropEvent).not.toHaveBeenCalled();
		expect(appWindow.onScaleChanged).not.toHaveBeenCalled();
		expect(bridge.nativeDropPointer()).toBeNull();
		expect(() => dispose()).not.toThrow();
	});

	it("makes no Tauri calls outside the Tauri runtime", async () => {
		mocks.hasTauriRuntime.mockReturnValue(false);
		const { webview } = installTauri();

		const dispose = bridge.startNativeFileDrop({
			controller: fakeController() as unknown as DropController,
		});
		await flush();

		expect(mocks.getCurrentWebview).not.toHaveBeenCalled();
		expect(webview.onDragDropEvent).not.toHaveBeenCalled();
		expect(() => dispose()).not.toThrow();
	});

	it("registers nothing on a non-main webview", async () => {
		const { webview, appWindow } = installTauri({ label: "settings" });
		const controller = fakeController();

		bridge.startNativeFileDrop({
			controller: controller as unknown as DropController,
		});
		await flush();

		expect(webview.onDragDropEvent).not.toHaveBeenCalled();
		expect(mocks.getCurrentWindow).not.toHaveBeenCalled();
		expect(appWindow.onScaleChanged).not.toHaveBeenCalled();
		expect(controller.handle).not.toHaveBeenCalled();
	});
});

describe("lifecycle", () => {
	it("is idempotent: a duplicate start registers once and returns a no-op", async () => {
		const { webview, dropUnlisteners, scaleUnlisteners } = installTauri();
		const controller = fakeController();

		const first = bridge.startNativeFileDrop({
			controller: controller as unknown as DropController,
		});
		const second = bridge.startNativeFileDrop({
			controller: controller as unknown as DropController,
		});
		await flush();

		expect(webview.onDragDropEvent).toHaveBeenCalledTimes(1);
		second();
		expect(dropUnlisteners[0]).not.toHaveBeenCalled();

		first();
		expect(dropUnlisteners[0]).toHaveBeenCalledTimes(1);
		expect(scaleUnlisteners[0]).toHaveBeenCalledTimes(1);
	});

	it("a stale disposer cannot tear down a newer owner", async () => {
		const { webview, dragHandlers, dropUnlisteners } = installTauri();
		const controllerOne = fakeController();
		const controllerTwo = fakeController();

		const disposeOld = bridge.startNativeFileDrop({
			controller: controllerOne as unknown as DropController,
		});
		await flush();
		disposeOld();

		bridge.startNativeFileDrop({
			controller: controllerTwo as unknown as DropController,
		});
		await flush();
		expect(webview.onDragDropEvent).toHaveBeenCalledTimes(2);

		disposeOld();
		expect(dropUnlisteners[1]).not.toHaveBeenCalled();

		emitDrag(dragHandlers, { type: "over", position: pos(10, 10) });
		expect(controllerTwo.handle).toHaveBeenCalledTimes(1);
	});

	it("disposing before registration resolves releases the late listener and ignores events", async () => {
		const { webview, appWindow, dragHandlers } = installTauri();
		const late = vi.fn();
		const resolvers: Array<() => void> = [];
		webview.onDragDropEvent.mockImplementation(
			(handler: DragHandler) =>
				new Promise((resolve) => {
					dragHandlers.push(handler);
					resolvers.push(() => resolve(late));
				}),
		);
		const controller = fakeController();

		const dispose = bridge.startNativeFileDrop({
			controller: controller as unknown as DropController,
		});
		dispose();
		expect(controller.cancel).toHaveBeenCalledTimes(1);

		resolvers[0]?.();
		await flush();

		expect(late).toHaveBeenCalledTimes(1);
		expect(appWindow.scaleFactor).not.toHaveBeenCalled();
		expect(appWindow.onScaleChanged).not.toHaveBeenCalled();

		emitDrag(dragHandlers, {
			type: "enter",
			paths: ["/late"],
			position: pos(1, 1),
		});
		expect(controller.handle).not.toHaveBeenCalled();
		expect(bridge.nativeDropPointer()).toBeNull();
	});

	it("late events after dispose are ignored, and dispose releases both listeners and cancels the controller", async () => {
		const { dragHandlers, dropUnlisteners, scaleUnlisteners } = installTauri();
		const controller = fakeController();

		const dispose = bridge.startNativeFileDrop({
			controller: controller as unknown as DropController,
		});
		await flush();
		dispose();

		expect(dropUnlisteners[0]).toHaveBeenCalledTimes(1);
		expect(scaleUnlisteners[0]).toHaveBeenCalledTimes(1);
		expect(controller.cancel).toHaveBeenCalledTimes(1);

		emitDrag(dragHandlers, {
			type: "drop",
			paths: ["/late"],
			position: pos(1, 1),
		});
		expect(controller.handle).not.toHaveBeenCalled();
	});

	it("a failed registration releases partial listeners, clears the pointer, and can start again", async () => {
		const harness = installTauri();
		harness.appWindow.scaleFactor.mockRejectedValueOnce(
			new Error("/Users/u/private"),
		);
		const controller = fakeController();

		bridge.startNativeFileDrop({
			controller: controller as unknown as DropController,
		});
		await flush();

		expect(harness.dropUnlisteners[0]).toHaveBeenCalledTimes(1);
		expect(bridge.nativeDropPointer()).toBeNull();

		bridge.startNativeFileDrop({
			controller: controller as unknown as DropController,
		});
		await flush();
		expect(harness.webview.onDragDropEvent).toHaveBeenCalledTimes(2);
		emitDrag(harness.dragHandlers, { type: "over", position: pos(5, 5) });
		expect(controller.handle).toHaveBeenCalledTimes(1);
	});
});

describe("shared controller", () => {
	it("is a lazily created singleton that tolerates hit-testing in environments without elementsFromPoint", () => {
		const first = bridge.getDropController();
		expect(bridge.getDropController()).toBe(first);
		expect(() =>
			first.handle({ type: "over", position: { x: 1, y: 1 } }),
		).not.toThrow();
	});
});
