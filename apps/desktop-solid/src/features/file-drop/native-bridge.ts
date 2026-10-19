/**
 * Native file-drop bridge for the main window.
 *
 * Owns one getCurrentWebview().onDragDropEvent listener and a cached scale factor.
 * Event handlers are synchronous: no awaits and no scale IPC inside them. Positions
 * are converted to CSS pixels and fed to the shared drop controller. The controller's
 * classify call starts IPC but is not awaited by the handler.
 *
 * Ported from the original launcher; native OS behaviour still needs hardware verification.
 */
import type { UnlistenFn } from "@tauri-apps/api/event";
import { type DragDropEvent, getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { createSignal } from "solid-js";
import { detectPlatform } from "../../app/platform";
import { t } from "../../localization";
import { nativeInstances, reportInstanceError } from "../instances/native-service";
import { classifyDroppedPaths } from "./classify";
import {
	type DragCoordinateUnit,
	dragCoordinateUnitForOs,
	nativeToCssPoint,
} from "./coordinates";
import {
	createDropController,
	type DropController,
	type Point,
} from "./drop-controller";


type WebviewHandle = ReturnType<typeof getCurrentWebview>;
type WindowHandle = ReturnType<typeof getCurrentWindow>;

const MAIN_WEBVIEW_LABEL = "main";

export interface NativeDropPointer {
	cssX: number;
	cssY: number;
	os: string;
	unit: DragCoordinateUnit;
	scaleFactor: number | null;
	devicePixelRatio: number;
	/** False after leave or drop. Ends the pointer observation. */
	visible: boolean;
}

const [pointerSignal, setPointer] = createSignal<NativeDropPointer | null>(
	null,
);
/** Converted pointer for diagnostics. Null when the bridge is not running. */
export const nativeDropPointer = pointerSignal;

export interface NativeFileDropOptions {
	/** Test seam. Defaults to the shared controller. */
	controller?: DropController;
}

let sharedController: DropController | null = null;

/** The shared controller used by every DropZone. Created lazily, with no Tauri calls. */
export function getDropController(): DropController {
	if (!sharedController) {
		sharedController = createDropController({
			classify: classifyDroppedPaths,
			elementsFromPoint: (x, y) =>
				typeof document.elementsFromPoint === "function"
					? document.elementsFromPoint(x, y)
					: [],
		});
	}
	return sharedController;
}

interface BridgeSession {
	closed: boolean;
	controller: DropController;
	appWindow: WindowHandle;
	scaleFactor: number | null;
	unlisteners: UnlistenFn[];
}

/** The single live bridge. A duplicate start while it is live is a no-op. */
let activeBridge: BridgeSession | null = null;

const noop = (): void => undefined;

/**
 * Starts the bridge. Synchronous: returns a disposer at once, while listener
 * registration completes in the background. Idempotent. Does nothing unless the
 * native host is present and the current webview is "main".
 */
export function startNativeFileDrop(
	options: NativeFileDropOptions = {},
): () => void {
	if (activeBridge || !nativeInstances) {
		return noop;
	}

	const session: BridgeSession = {
		closed: false,
		controller: options.controller ?? getDropController(),
		appWindow: null as unknown as WindowHandle,
		scaleFactor: null,
		unlisteners: [],
	};
	try {
		const webview = getCurrentWebview();
		if (webview.label !== MAIN_WEBVIEW_LABEL) {
			return noop;
		}
		const appWindow = getCurrentWindow();
		session.appWindow = appWindow;
		activeBridge = session;
		void registerListeners(session, webview, appWindow);
		return () => closeBridge(session);
	} catch {
		closeBridge(session);
		return noop;
	}
}

// Vite HMR replaces this module's state, so release the live listener first.
if (import.meta.hot) {
	import.meta.hot.dispose(() => {
		if (activeBridge) {
			closeBridge(activeBridge);
		}
	});
}

async function registerListeners(
	session: BridgeSession,
	webview: WebviewHandle,
	appWindow: WindowHandle,
): Promise<void> {
	try {
		const unlistenDrag = await webview.onDragDropEvent((event) => {
			handleNativeEvent(session, event.payload);
		});
		if (!adoptListener(session, unlistenDrag)) return;

		const scaleFactor = await appWindow.scaleFactor();
		if (session.closed) return;
		session.scaleFactor = scaleFactor;

		const unlistenScale = await appWindow.onScaleChanged((event) => {
			if (!session.closed) {
				session.scaleFactor = event.payload.scaleFactor;
			}
		});
		adoptListener(session, unlistenScale);
	} catch {
		reportInstanceError(t('drop.start-failed'));
		closeBridge(session);
	}
}

// Synchronous. Reads only cached state.
function handleNativeEvent(
	session: BridgeSession,
	payload: DragDropEvent,
): void {
	if (session.closed) return;

	const os = readOs();
	const unit = dragCoordinateUnitForOs(os);

	switch (payload.type) {
		case "enter": {
			const cssPoint = toCss(payload.position, unit, session.scaleFactor);
			publishPointer(cssPoint, os, unit, session.scaleFactor, true);
			session.controller.handle({
				type: "enter",
				paths: payload.paths,
				position: cssPoint,
			});
			return;
		}
		case "over": {
			const cssPoint = toCss(payload.position, unit, session.scaleFactor);
			publishPointer(cssPoint, os, unit, session.scaleFactor, true);
			session.controller.handle({ type: "over", position: cssPoint });
			return;
		}
		case "drop": {
			const cssPoint = toCss(payload.position, unit, session.scaleFactor);
			publishPointer(cssPoint, os, unit, session.scaleFactor, false);
			focusWindow(session);
			session.controller.handle({
				type: "drop",
				paths: payload.paths,
				position: cssPoint,
			});
			return;
		}
		case "leave": {
			setPointer((current) =>
				current ? { ...current, visible: false } : null,
			);
			session.controller.handle({ type: "leave" });
			return;
		}
	}
}

/**
 * A drag from the file manager hovers a window that may not be focused. Bring it
 * forward on drop so the result (a notification, a navigation) is actually seen.
 * Fire and forget: the handler stays synchronous and a refused focus is harmless.
 */
function focusWindow(session: BridgeSession): void {
	try {
		void session.appWindow.setFocus().catch(() => undefined);
	} catch {
		// Focus is best effort.
	}
}

function toCss(
	position: { x: number; y: number },
	unit: DragCoordinateUnit,
	scaleFactor: number | null,
): Point {
	return nativeToCssPoint({ x: position.x, y: position.y }, unit, scaleFactor);
}

function publishPointer(
	cssPoint: Point,
	os: string,
	unit: DragCoordinateUnit,
	scaleFactor: number | null,
	visible: boolean,
): void {
	setPointer({
		cssX: cssPoint.x,
		cssY: cssPoint.y,
		os,
		unit,
		scaleFactor,
		devicePixelRatio: window.devicePixelRatio,
		visible,
	});
}

function readOs(): string {
	return detectPlatform();
}

/** Keeps a listener so teardown can release it. If the session already closed, releases it now. */
function adoptListener(session: BridgeSession, unlisten: UnlistenFn): boolean {
	if (session.closed) {
		unlisten();
		return false;
	}
	session.unlisteners.push(unlisten);
	return true;
}

/**
 * Idempotent per session. A stale disposer for a closed session does nothing, so it
 * cannot tear down a newer owner. Releases every listener, cancels in-flight drags
 * and clears the pointer, but only for the session that was live.
 */
function closeBridge(session: BridgeSession): void {
	if (session.closed) return;
	session.closed = true;
	const wasActive = activeBridge === session;
	if (wasActive) {
		activeBridge = null;
	}
	for (const unlisten of session.unlisteners.splice(0)) {
		try {
			unlisten();
		} catch {
			// Teardown is best effort.
		}
	}
	if (wasActive) {
		session.controller.cancel();
		setPointer(null);
	}
}
