export function isMacPlatform(): boolean {
	if (typeof navigator === "undefined") return false;
	return /Mac|iPhone|iPad|iPod/i.test(navigator.platform);
}

function normalizedCode(event: KeyboardEvent): string {
	if (event.code) return event.code;
	if (event.key.length === 1) return event.key.toUpperCase();
	return event.key;
}

export function chordFromKeyboardEvent(
	event: KeyboardEvent,
): string | undefined {
	const code = normalizedCode(event);
	if (
		!code ||
		["Meta", "Control", "Alt", "Shift"].includes(event.key) ||
		["MetaLeft", "MetaRight", "ControlLeft", "ControlRight", "AltLeft", "AltRight", "ShiftLeft", "ShiftRight"].includes(
			code,
		)
	) {
		return undefined;
	}

	const parts: string[] = [];
	const mac = isMacPlatform();
	if ((mac && event.metaKey) || (!mac && event.ctrlKey)) parts.push("Mod");
	if (mac && event.ctrlKey) parts.push("Ctrl");
	if (!mac && event.metaKey) parts.push("Meta");
	if (event.altKey) parts.push("Alt");
	if (event.shiftKey) parts.push("Shift");
	parts.push(code);
	return parts.join("+");
}

const KEY_LABELS: Record<string, string> = {
	ArrowLeft: "←",
	ArrowRight: "→",
	ArrowUp: "↑",
	ArrowDown: "↓",
	Backspace: "Backspace",
	Comma: ",",
	Delete: "Delete",
	Enter: "Enter",
	Escape: "Esc",
	Space: "Space",
	Tab: "Tab",
};

function displayCode(code: string): string {
	if (KEY_LABELS[code]) return KEY_LABELS[code];
	if (code.startsWith("Key")) return code.slice(3);
	if (code.startsWith("Digit")) return code.slice(5);
	if (code.startsWith("Numpad")) return `Num ${code.slice(6)}`;
	return code;
}

export function displayChord(chord: string | null | undefined): string {
	if (!chord) return "Unassigned";
	const mac = isMacPlatform();
	return chord
		.split("+")
		.map((part) => {
			if (part === "Mod") return mac ? "⌘" : "Ctrl";
			if (part === "Ctrl") return mac ? "⌃" : "Ctrl";
			if (part === "Meta") return mac ? "⌘" : "Meta";
			if (part === "Alt") return mac ? "⌥" : "Alt";
			if (part === "Shift") return mac ? "⇧" : "Shift";
			return displayCode(part);
		})
		.join(mac ? "" : "+");
}

export function ariaShortcut(chord: string | null | undefined): string | undefined {
	if (!chord) return undefined;
	return chord
		.split("+")
		.map((part) => {
			if (part === "Mod") return isMacPlatform() ? "Meta" : "Control";
			if (part === "Ctrl") return "Control";
			if (part.startsWith("Key")) return part.slice(3);
			if (part.startsWith("Digit")) return part.slice(5);
			return part;
		})
		.join("+");
}
