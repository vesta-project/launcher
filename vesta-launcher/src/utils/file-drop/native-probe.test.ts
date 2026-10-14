/**
 * Tests for the Stage 0 native drop probe.
 *
 * These tests use MOCKED Tauri getters, listeners and drag-drop payloads. They
 * verify this module's bookkeeping only: registration, cleanup, counting and
 * the no-paths rule. They are NOT proof of native OS drag-and-drop behaviour.
 * Native behaviour stays unverified until the probe runs on real builds.
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

const mocks = vi.hoisted(() => ({
	getCurrentWebview: vi.fn(),
	getCurrentWindow: vi.fn(),
	hasTauriRuntime: vi.fn(),
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

type ProbeModule = typeof import("@utils/file-drop/native-probe");
type DragHandler = (event: { payload: DragDropEvent }) => void;
type ScaleHandler = (event: { payload: { scaleFactor: number } }) => void;
type ProbeTestWindow = Window & { __VESTA_NATIVE_FILE_DROP_PROBE__?: unknown };

let probe: ProbeModule;

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const position = (x: number, y: number) =>
	({ x, y }) as unknown as PhysicalPosition;

const enterEvent = (paths: string[]): DragDropEvent => ({
	type: "enter",
	paths,
	position: position(10, 20),
});
const overEvent = (): DragDropEvent => ({
	type: "over",
	position: position(11, 21),
});
const dropEvent = (paths: string[]): DragDropEvent => ({
	type: "drop",
	paths,
	position: position(12, 22),
});
const leaveEvent = (): DragDropEvent => ({ type: "leave" });

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

const emitDrag = (handlers: DragHandler[], payload: DragDropEvent) =>
	handlers.at(-1)?.({ payload });

beforeEach(async () => {
	vi.resetModules();
	vi.resetAllMocks();
	mocks.hasTauriRuntime.mockReturnValue(true);
	(window as ProbeTestWindow).__VESTA_NATIVE_FILE_DROP_PROBE__ = true;
	probe = await import("@utils/file-drop/native-probe");
});

afterEach(() => {
	delete (window as ProbeTestWindow).__VESTA_NATIVE_FILE_DROP_PROBE__;
});

describe("isNativeDropProbeEnabled", () => {
	it("requires both the Tauri runtime and the exact boolean flag", () => {
		expect(probe.isNativeDropProbeEnabled()).toBe(true);

		(window as ProbeTestWindow).__VESTA_NATIVE_FILE_DROP_PROBE__ = "true";
		expect(probe.isNativeDropProbeEnabled()).toBe(false);

		delete (window as ProbeTestWindow).__VESTA_NATIVE_FILE_DROP_PROBE__;
		expect(probe.isNativeDropProbeEnabled()).toBe(false);

		(window as ProbeTestWindow).__VESTA_NATIVE_FILE_DROP_PROBE__ = true;
		mocks.hasTauriRuntime.mockReturnValue(false);
		expect(probe.isNativeDropProbeEnabled()).toBe(false);
	});
});

describe("initializeNativeDropProbe guards", () => {
	it("calls no Tauri getters or listeners when the flag is missing", async () => {
		delete (window as ProbeTestWindow).__VESTA_NATIVE_FILE_DROP_PROBE__;
		const { webview, appWindow } = installTauri();

		const dispose = probe.initializeNativeDropProbe();
		await flush();

		expect(mocks.getCurrentWebview).not.toHaveBeenCalled();
		expect(mocks.getCurrentWindow).not.toHaveBeenCalled();
		expect(webview.onDragDropEvent).not.toHaveBeenCalled();
		expect(appWindow.onScaleChanged).not.toHaveBeenCalled();
		expect(probe.nativeDropDiagnostic()).toBeNull();
		expect(() => dispose()).not.toThrow();
	});

	it("calls no Tauri getters or listeners outside the Tauri runtime", async () => {
		mocks.hasTauriRuntime.mockReturnValue(false);
		const { webview, appWindow } = installTauri();

		const dispose = probe.initializeNativeDropProbe();
		await flush();

		expect(mocks.getCurrentWebview).not.toHaveBeenCalled();
		expect(mocks.getCurrentWindow).not.toHaveBeenCalled();
		expect(webview.onDragDropEvent).not.toHaveBeenCalled();
		expect(appWindow.onScaleChanged).not.toHaveBeenCalled();
		expect(probe.nativeDropDiagnostic()).toBeNull();
		expect(() => dispose()).not.toThrow();
	});

	it("registers nothing on a non-main webview", async () => {
		const { webview, appWindow } = installTauri({ label: "settings" });

		const dispose = probe.initializeNativeDropProbe();
		await flush();

		expect(webview.onDragDropEvent).not.toHaveBeenCalled();
		expect(mocks.getCurrentWindow).not.toHaveBeenCalled();
		expect(appWindow.onScaleChanged).not.toHaveBeenCalled();
		expect(probe.nativeDropDiagnostic()).toBeNull();
		expect(() => dispose()).not.toThrow();
	});
});

describe("drag-drop payloads", () => {
	it("records enter as a path count and never stores the paths", async () => {
		const { dragHandlers } = installTauri();
		probe.initializeNativeDropProbe();
		await flush();

		emitDrag(
			dragHandlers,
			enterEvent(["/home/u/secret-a.mp4", "/home/u/secret-b.mp4"]),
		);

		const diagnostic = probe.nativeDropDiagnostic();
		expect(diagnostic).toMatchObject({
			status: "enter",
			webviewLabel: "main",
			itemCount: 2,
			position: { x: 10, y: 20 },
			counts: { enter: 1, over: 0, drop: 0, leave: 0 },
			selectedZone: null,
			reason: "probe-only-no-routing",
		});
		expect(JSON.stringify(diagnostic)).not.toContain("secret");
	});

	it("records over without paths: itemCount is null", async () => {
		const { dragHandlers } = installTauri();
		probe.initializeNativeDropProbe();
		await flush();

		emitDrag(dragHandlers, overEvent());

		expect(probe.nativeDropDiagnostic()).toMatchObject({
			status: "over",
			itemCount: null,
			position: { x: 11, y: 21 },
			counts: { enter: 0, over: 1, drop: 0, leave: 0 },
		});
	});

	it("records drop as a path count and never stores the paths", async () => {
		const { dragHandlers } = installTauri();
		probe.initializeNativeDropProbe();
		await flush();

		emitDrag(dragHandlers, dropEvent(["/x/one", "/x/two", "/x/three"]));

		const diagnostic = probe.nativeDropDiagnostic();
		expect(diagnostic).toMatchObject({
			status: "drop",
			itemCount: 3,
			position: { x: 12, y: 22 },
			counts: { enter: 0, over: 0, drop: 1, leave: 0 },
		});
		expect(JSON.stringify(diagnostic)).not.toContain("/x/");
	});

	it("leave clears position and itemCount, and counts a full sequence", async () => {
		const { dragHandlers } = installTauri();
		probe.initializeNativeDropProbe();
		await flush();

		emitDrag(dragHandlers, enterEvent(["/a"]));
		emitDrag(dragHandlers, overEvent());
		emitDrag(dragHandlers, overEvent());
		emitDrag(dragHandlers, dropEvent(["/a"]));
		emitDrag(dragHandlers, leaveEvent());

		expect(probe.nativeDropDiagnostic()).toMatchObject({
			status: "leave",
			position: null,
			itemCount: null,
			counts: { enter: 1, over: 2, drop: 1, leave: 1 },
		});
	});
});

describe("lifecycle", () => {
	it("reports starting, then listening once registration resolves", async () => {
		installTauri({ scaleFactor: 2 });

		probe.initializeNativeDropProbe();
		expect(probe.nativeDropDiagnostic()).toMatchObject({
			status: "starting",
			webviewLabel: "main",
		});

		await flush();
		expect(probe.nativeDropDiagnostic()).toMatchObject({
			status: "listening",
			scaleFactor: 2,
			devicePixelRatio: window.devicePixelRatio,
			itemCount: null,
		});
	});

	it("duplicate initialization registers once and leaves the first owner in charge", async () => {
		const { webview, appWindow, dropUnlisteners, scaleUnlisteners } =
			installTauri();

		const disposeFirst = probe.initializeNativeDropProbe();
		const disposeSecond = probe.initializeNativeDropProbe();
		await flush();

		expect(webview.onDragDropEvent).toHaveBeenCalledTimes(1);
		expect(appWindow.onScaleChanged).toHaveBeenCalledTimes(1);

		disposeSecond();
		expect(dropUnlisteners[0]).not.toHaveBeenCalled();
		expect(probe.nativeDropDiagnostic()).not.toBeNull();

		disposeFirst();
		expect(dropUnlisteners[0]).toHaveBeenCalledTimes(1);
		expect(scaleUnlisteners[0]).toHaveBeenCalledTimes(1);
		expect(probe.nativeDropDiagnostic()).toBeNull();

		disposeFirst();
		expect(dropUnlisteners[0]).toHaveBeenCalledTimes(1);
	});

	it("a stale disposer from an old owner cannot tear down a newer owner", async () => {
		const { webview, dragHandlers, dropUnlisteners } = installTauri();

		const disposeOld = probe.initializeNativeDropProbe();
		await flush();
		disposeOld();

		const disposeNew = probe.initializeNativeDropProbe();
		await flush();
		expect(webview.onDragDropEvent).toHaveBeenCalledTimes(2);

		disposeOld();
		expect(dropUnlisteners[1]).not.toHaveBeenCalled();
		expect(probe.nativeDropDiagnostic()).toMatchObject({ status: "listening" });

		emitDrag(dragHandlers, overEvent());
		expect(probe.nativeDropDiagnostic()).toMatchObject({
			status: "over",
			counts: { enter: 0, over: 1, drop: 0, leave: 0 },
		});

		disposeNew();
		expect(dropUnlisteners[1]).toHaveBeenCalledTimes(1);
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

		const dispose = probe.initializeNativeDropProbe();
		dispose();
		expect(resolvers).toHaveLength(1);
		resolvers[0]?.();
		await flush();

		expect(late).toHaveBeenCalledTimes(1);
		expect(appWindow.scaleFactor).not.toHaveBeenCalled();
		expect(appWindow.onScaleChanged).not.toHaveBeenCalled();

		emitDrag(dragHandlers, enterEvent(["/late"]));
		expect(probe.nativeDropDiagnostic()).toBeNull();
	});

	it("scale changes update the cached scale, and dispose removes both listeners", async () => {
		const {
			appWindow,
			scaleHandlers,
			dragHandlers,
			dropUnlisteners,
			scaleUnlisteners,
		} = installTauri({ scaleFactor: 2 });

		const dispose = probe.initializeNativeDropProbe();
		await flush();

		scaleHandlers[0]?.({ payload: { scaleFactor: 1.5 } });
		expect(probe.nativeDropDiagnostic()).toMatchObject({
			status: "listening",
			scaleFactor: 1.5,
		});
		expect(appWindow.scaleFactor).toHaveBeenCalledTimes(1);

		dispose();
		expect(dropUnlisteners[0]).toHaveBeenCalledTimes(1);
		expect(scaleUnlisteners[0]).toHaveBeenCalledTimes(1);
		expect(probe.nativeDropDiagnostic()).toBeNull();

		scaleHandlers[0]?.({ payload: { scaleFactor: 3 } });
		emitDrag(dragHandlers, enterEvent(["/after"]));
		expect(probe.nativeDropDiagnostic()).toBeNull();
	});

	it("ignores late events after dispose and does not revive state", async () => {
		const { dragHandlers } = installTauri();

		const dispose = probe.initializeNativeDropProbe();
		await flush();
		dispose();

		emitDrag(dragHandlers, dropEvent(["/late"]));
		expect(probe.nativeDropDiagnostic()).toBeNull();
	});
});

describe("registration failure", () => {
	const failures: Array<
		[string, (harness: ReturnType<typeof installTauri>) => void]
	> = [
		[
			"onDragDropEvent",
			(harness) =>
				harness.webview.onDragDropEvent.mockRejectedValueOnce(
					new Error("/Users/u/private"),
				),
		],
		[
			"scaleFactor",
			(harness) =>
				harness.appWindow.scaleFactor.mockRejectedValueOnce(
					new Error("/Users/u/private"),
				),
		],
		[
			"onScaleChanged",
			(harness) =>
				harness.appWindow.onScaleChanged.mockRejectedValueOnce(
					new Error("/Users/u/private"),
				),
		],
	];

	it.each(
		failures,
	)("a %s failure reports error with a safe reason and releases what subscribed", async (_name, fail) => {
		const harness = installTauri();
		fail(harness);

		probe.initializeNativeDropProbe();
		await flush();

		const diagnostic = probe.nativeDropDiagnostic();
		expect(diagnostic).toMatchObject({
			status: "error",
			reason: "listener-setup-failed",
		});
		expect(JSON.stringify(diagnostic)).not.toContain("/Users/u/private");
		for (const unlisten of harness.dropUnlisteners) {
			expect(unlisten).toHaveBeenCalledTimes(1);
		}
	});

	it("a fresh initialization can start again after a failed setup", async () => {
		const harness = installTauri();
		harness.webview.onDragDropEvent.mockRejectedValueOnce(new Error("boom"));

		probe.initializeNativeDropProbe();
		await flush();
		expect(probe.nativeDropDiagnostic()).toMatchObject({ status: "error" });

		probe.initializeNativeDropProbe();
		expect(probe.nativeDropDiagnostic()).toMatchObject({ status: "starting" });
		await flush();
		expect(harness.webview.onDragDropEvent).toHaveBeenCalledTimes(2);
		expect(probe.nativeDropDiagnostic()).toMatchObject({ status: "listening" });
	});
});
