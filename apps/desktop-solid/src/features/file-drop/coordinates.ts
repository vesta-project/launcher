/**
 * Converts native drag-drop positions into CSS pixels.
 *
 * Per-OS units, from the pinned wry-0.55.1 sources:
 * - macOS: src/wkwebview/drag_drop.rs reports AppKit points with y flipped to a
 *   top-left origin. Points are CSS pixels, so the unit is "css".
 * - Linux: src/webkitgtk/drag_drop.rs reports GTK widget coordinates, which are
 *   CSS pixels, so the unit is "css".
 * - Windows: src/webview2/drag_drop.rs reports ScreenToClient coordinates in
 *   PHYSICAL pixels, so the unit is "physical" and must be divided by the scale factor.
 *
 * wry casts macOS positions to integers (`as i32`), so sub-pixel precision is lost there.
 *
 * The macOS mapping is pending real-hardware calibration. tauri-apps/tauri#10744
 * reports a ~28px offset with a titlebar and wrong values with DevTools open.
 * No offset is applied here; verify the mapping on real builds.
 */

export type DragCoordinateUnit = "css" | "physical";

export function dragCoordinateUnitForOs(
	os: string | undefined,
): DragCoordinateUnit {
	return os === "windows" ? "physical" : "css";
}

export function nativeToCssPoint(
	position: { x: number; y: number },
	unit: DragCoordinateUnit,
	scaleFactor: number | null,
): { x: number; y: number } {
	if (unit === "css") {
		return { x: position.x, y: position.y };
	}
	const divisor = resolveDivisor(scaleFactor);
	return { x: position.x / divisor, y: position.y / divisor };
}

function resolveDivisor(scaleFactor: number | null): number {
	if (isUsableScale(scaleFactor)) {
		return scaleFactor;
	}
	const devicePixelRatio =
		typeof window === "undefined" ? undefined : window.devicePixelRatio;
	if (isUsableScale(devicePixelRatio)) {
		return devicePixelRatio;
	}
	return 1;
}

function isUsableScale(value: number | null | undefined): value is number {
	return typeof value === "number" && Number.isFinite(value) && value > 0;
}
