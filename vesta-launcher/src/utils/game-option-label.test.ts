import { expect, it } from "vitest";
import { formatGameOptionName } from "./game-option-label";

it("formats camel case, separators and acronyms without losing namespace words", () => {
	for (const [key, expected] of [
		["chunkSectionFadeInTime", "Chunk section fade in time"],
		["biomeBlendRadius", "Biome blend radius"],
		["fovEffectScale", "FOV effect scale"],
		["maxFps", "Max FPS"],
		["guiScale", "GUI scale"],
		["invertYMouse", "Invert Y mouse"],
		["discrete_mouse_scroll", "Discrete mouse scroll"],
		["key_key.debug.showChunkBorders", "Debug show chunk borders"],
		["key_key.dynamic_fps.toggle_forced", "Dynamic FPS toggle forced"],
		["soundCategory_master", "Sound category master"],
		["", ""],
	])
		expect(formatGameOptionName(key)).toBe(expected);
});
