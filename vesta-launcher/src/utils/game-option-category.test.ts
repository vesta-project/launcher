import { expect, it } from "vitest";
import {
	classifyGameOptionCategory,
	describeObservedOption,
} from "./game-option-category";

it("puts vanilla mouse settings in mouse instead of custom", () => {
	for (const key of [
		"discrete_mouse_scroll",
		"invertXMouse",
		"invertYMouse",
		"mouseSensitivity",
		"mouseWheelSensitivity",
		"rawMouseInput",
		"allowCursorChanges",
	])
		expect(classifyGameOptionCategory(key)).toBe("mouse");
});

it("keeps leftover mod keys in custom and bindings in keybindings", () => {
	expect(classifyGameOptionCategory("mod.custom")).toBe("custom");
	expect(classifyGameOptionCategory("key_key.attack")).toBe("keybindings");
	expect(classifyGameOptionCategory("key_zoomify.key.zoom")).toBe(
		"keybindings",
	);
});

it("groups the rest of a modern options.txt into gameplay categories", () => {
	expect(classifyGameOptionCategory("renderDistance")).toBe("video");
	expect(classifyGameOptionCategory("forceUnicodeFont")).toBe("language");
	expect(classifyGameOptionCategory("chatOpacity")).toBe("chat");
	expect(classifyGameOptionCategory("toggleSprint")).toBe("controls");
	expect(classifyGameOptionCategory("highContrast")).toBe("accessibility");
	expect(classifyGameOptionCategory("soundCategory_ui")).toBe("sound");
	expect(classifyGameOptionCategory("modelPart_cape")).toBe("skin");
	expect(classifyGameOptionCategory("advancedItemTooltips")).toBe("other");
});

it("types observed mouse and volume values for editors", () => {
	expect(describeObservedOption("invertXMouse", "false")).toMatchObject({
		kind: "boolean",
		category: "mouse",
	});
	expect(describeObservedOption("mouseWheelSensitivity", "1.0")).toMatchObject({
		kind: "number",
		min: 0.01,
		max: 10,
	});
	expect(describeObservedOption("soundCategory_hostile", "1.0")).toMatchObject({
		kind: "number",
		min: 0,
		max: 1,
		category: "sound",
	});
});
