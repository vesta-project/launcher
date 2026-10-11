/**
 * Stage 0 native drop probe: diagnostics only.
 *
 * Records drag/drop event types, counts, raw positions and item counts from
 * Tauri's native drag-drop events. It never stores, exposes or logs dropped
 * paths, never routes or classifies them, and never dispatches DOM drops.
 *
 * Opt-in: the main window must be built in a debug build with
 * VESTA_NATIVE_FILE_DROP_PROBE=1, which sets window.__VESTA_NATIVE_FILE_DROP_PROBE__
 * (see src-tauri/src/startup/shell.rs).
 */
import type { UnlistenFn } from "@tauri-apps/api/event";
import { type DragDropEvent, getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { hasTauriRuntime } from "@utils/tauri-runtime";
import { createSignal } from "solid-js";

type ProbeWindow = Window & { __VESTA_NATIVE_FILE_DROP_PROBE__?: unknown };
type WebviewHandle = ReturnType<typeof getCurrentWebview>;
type WindowHandle = ReturnType<typeof getCurrentWindow>;

export interface NativeDropDiagnostic {
	status:
		| "starting"
		| "listening"
		| "error"
		| "enter"
		| "over"
		| "drop"
		| "leave";
	webviewLabel: string;
	scaleFactor: number | null;
	devicePixelRatio: number;
	/** Raw coordinates as Tauri reported them. Not converted or verified. */
	position: { x: number; y: number } | null;
	/** Number of dropped paths for enter/drop. Null for over/leave. */
	itemCount: number | null;
	counts: { enter: number; over: number; drop: number; leave: number };
	/** Reserved for later zone routing. Always null in the probe. */
	selectedZone: null;
	/** Short constant code. Never a raw error string. */
	reason: string;
}

const PROBE_WINDOW_LABEL = "main";
const PROBE_REASON = "probe-only-no-routing";
const SETUP_FAILED_REASON = "listener-setup-failed";

const [diagnosticSignal, setDiagnostic] =
	createSignal<NativeDropDiagnostic | null>(null);
export const nativeDropDiagnostic = diagnosticSignal;

interface ProbeSession {
	closed: boolean;
	webviewLabel: string;
	status: NativeDropDiagnostic["status"];
	reason: string;
	scaleFactor: number | null;
	position: { x: number; y: number } | null;
	itemCount: number | null;
	counts: NativeDropDiagnostic["counts"];
	unlisteners: UnlistenFn[];
}

/** The single live session. Duplicate inits while it is live are no-ops. */
let activeSession: ProbeSession | null = null;

const noop = (): void => {
	// Nothing to tear down: the probe is disabled, off-target, or already running.
};

export function isNativeDropProbeEnabled(): boolean {
	return (
		hasTauriRuntime() &&
		(window as ProbeWindow).__VESTA_NATIVE_FILE_DROP_PROBE__ === true
	);
}

/**
 * Starts the probe on the main webview. Synchronous: returns a disposer at once,
 * while listener registration completes in the background.
 *
 * Duplicate calls while a session is live return a no-op disposer, so only the
 * first owner can tear the listener down. Each disposer is bound to its own
 * session, so a stale disposer can never affect a newer owner.
 */
export function initializeNativeDropProbe(): () => void {
	if (!isNativeDropProbeEnabled() || activeSession) {
		return noop;
	}

	const session = createSession("unknown");
	try {
		const webview = getCurrentWebview();
		if (webview.label !== PROBE_WINDOW_LABEL) {
			return noop;
		}
		session.webviewLabel = webview.label;
		const appWindow = getCurrentWindow();

		activeSession = session;
		publish(session);
		void registerListeners(session, webview, appWindow);
		return () => disposeSession(session);
	} catch {
		failSession(session);
		return noop;
	}
}

// Vite HMR replaces this module's state, so release the live listener first.
if (import.meta.hot) {
	import.meta.hot.dispose(() => {
		if (activeSession) {
			disposeSession(activeSession);
		}
	});
}

async function registerListeners(
	session: ProbeSession,
	webview: WebviewHandle,
	appWindow: WindowHandle,
): Promise<void> {
	try {
		// One onDragDropEvent call. Tauri subscribes to enter/over/drop/leave internally.
		const unlistenDrop = await webview.onDragDropEvent((event) => {
			handleDragDropEvent(session, event.payload);
		});
		if (!adoptListener(session, unlistenDrop)) return;

		session.scaleFactor = await appWindow.scaleFactor();
		if (session.closed) return;

		const unlistenScale = await appWindow.onScaleChanged((event) => {
			handleScaleChanged(session, event.payload.scaleFactor);
		});
		if (!adoptListener(session, unlistenScale)) return;

		if (session.status === "starting") {
			session.status = "listening";
		}
		publish(session);
	} catch {
		failSession(session);
	}
}

// Event handlers are synchronous: no awaits and no IPC.
function handleDragDropEvent(
	session: ProbeSession,
	payload: DragDropEvent,
): void {
	if (session.closed) return;

	session.counts[payload.type] += 1;
	session.status = payload.type;
	session.reason = PROBE_REASON;

	switch (payload.type) {
		case "enter":
		case "drop":
			session.position = toPosition(payload.position);
			// Only the count is kept. The paths themselves are never stored.
			session.itemCount = payload.paths.length;
			break;
		case "over":
			session.position = toPosition(payload.position);
			session.itemCount = null;
			break;
		case "leave":
			session.position = null;
			session.itemCount = null;
			break;
	}
	publish(session);
}

function handleScaleChanged(session: ProbeSession, scaleFactor: number): void {
	if (session.closed) return;
	session.scaleFactor = scaleFactor;
	publish(session);
}

function toPosition(position: { x: number; y: number }): {
	x: number;
	y: number;
} {
	return { x: position.x, y: position.y };
}

function createSession(webviewLabel: string): ProbeSession {
	return {
		closed: false,
		webviewLabel,
		status: "starting",
		reason: PROBE_REASON,
		scaleFactor: null,
		position: null,
		itemCount: null,
		counts: { enter: 0, over: 0, drop: 0, leave: 0 },
		unlisteners: [],
	};
}

function toDiagnostic(session: ProbeSession): NativeDropDiagnostic {
	return {
		status: session.status,
		webviewLabel: session.webviewLabel,
		scaleFactor: session.scaleFactor,
		devicePixelRatio: window.devicePixelRatio,
		position: session.position,
		itemCount: session.itemCount,
		counts: { ...session.counts },
		selectedZone: null,
		reason: session.reason,
	};
}

function publish(session: ProbeSession): void {
	if (session.closed) return;
	setDiagnostic(toDiagnostic(session));
}

/** Keeps a listener so teardown can release it. If the session already closed, releases it now. */
function adoptListener(session: ProbeSession, unlisten: UnlistenFn): boolean {
	if (session.closed) {
		unlisten();
		return false;
	}
	session.unlisteners.push(unlisten);
	return true;
}

function closeSession(session: ProbeSession): void {
	session.closed = true;
	if (activeSession === session) {
		activeSession = null;
	}
	for (const unlisten of session.unlisteners.splice(0)) {
		try {
			unlisten();
		} catch {
			// Teardown is best effort. Raw errors are never surfaced.
		}
	}
}

function disposeSession(session: ProbeSession): void {
	if (session.closed) return;
	closeSession(session);
	setDiagnostic(null);
}

function failSession(session: ProbeSession): void {
	if (session.closed) return;
	session.status = "error";
	session.reason = SETUP_FAILED_REASON;
	closeSession(session);
	setDiagnostic(toDiagnostic(session));
}
