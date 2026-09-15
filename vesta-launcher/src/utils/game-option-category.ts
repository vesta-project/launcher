export type GameOptionCategory =
	| "video"
	| "mouse"
	| "sound"
	| "language"
	| "chat"
	| "controls"
	| "accessibility"
	| "skin"
	| "other"
	| "keybindings"
	| "custom";

export type ObservedOption = {
	key: string;
	category: GameOptionCategory;
	labelId: string;
	kind: "boolean" | "number" | "text";
	min: number | null;
	max: number | null;
};

type VanillaSpec = {
	category: Exclude<GameOptionCategory, "keybindings" | "custom">;
	kind: "boolean" | "number" | "text";
	min?: number;
	max?: number;
};

const boolean = (
	category: VanillaSpec["category"],
): VanillaSpec => ({ category, kind: "boolean" });
const text = (
	category: VanillaSpec["category"],
): VanillaSpec => ({ category, kind: "text" });
const number = (
	category: VanillaSpec["category"],
	min: number,
	max: number,
): VanillaSpec => ({ category, kind: "number", min, max });
const unit = (category: VanillaSpec["category"]) => number(category, 0, 1);

const VANILLA: Record<string, VanillaSpec> = {
	ao: boolean("video"),
	biomeBlendRadius: number("video", 0, 16),
	chunkSectionFadeInTime: number("video", 0, 5),
	cutoutLeaves: boolean("video"),
	enableVsync: boolean("video"),
	entityDistanceScaling: number("video", 0.5, 5),
	entityShadows: boolean("video"),
	fov: number("video", -1, 1),
	fovEffectScale: unit("video"),
	darknessEffectScale: unit("video"),
	glintSpeed: unit("video"),
	glintStrength: unit("video"),
	preferredGraphicsBackend: text("video"),
	graphicsPreset: text("video"),
	prioritizeChunkUpdates: number("video", 0, 2),
	fullscreen: boolean("video"),
	exclusiveFullscreen: boolean("video"),
	guiScale: number("video", 0, 10),
	maxAnisotropyBit: number("video", 0, 16),
	textureFiltering: number("video", 0, 16),
	maxFps: number("video", 10, 260),
	improvedTransparency: boolean("video"),
	inactivityFpsLimit: text("video"),
	mipmapLevels: number("video", 0, 4),
	particles: number("video", 0, 2),
	renderClouds: text("video"),
	cloudRange: number("video", 0, 256),
	renderDistance: number("video", 2, 256),
	simulationDistance: number("video", 2, 128),
	screenEffectScale: unit("video"),
	vignette: boolean("video"),
	weatherRadius: number("video", 0, 64),
	bobView: boolean("video"),
	darkMojangStudiosBackground: boolean("video"),
	hideLightningFlashes: boolean("video"),
	hideSplashTexts: boolean("video"),
	panoramaScrollSpeed: unit("video"),
	menuBackgroundBlurriness: number("video", 0, 20),

	discrete_mouse_scroll: boolean("mouse"),
	invertXMouse: boolean("mouse"),
	invertYMouse: boolean("mouse"),
	mouseSensitivity: unit("mouse"),
	mouseWheelSensitivity: number("mouse", 0.01, 10),
	rawMouseInput: boolean("mouse"),
	allowCursorChanges: boolean("mouse"),

	soundDevice: text("sound"),
	musicToast: text("sound"),
	musicFrequency: text("sound"),

	forceUnicodeFont: boolean("language"),
	japaneseGlyphVariants: boolean("language"),
	lang: text("language"),

	autoSuggestions: boolean("chat"),
	chatColors: boolean("chat"),
	chatLinks: boolean("chat"),
	chatLinksPrompt: boolean("chat"),
	chatVisibility: number("chat", 0, 2),
	chatOpacity: unit("chat"),
	chatLineSpacing: unit("chat"),
	textBackgroundOpacity: unit("chat"),
	backgroundForChatOnly: boolean("chat"),
	hideServerAddress: boolean("chat"),
	chatHeightFocused: unit("chat"),
	chatDelay: number("chat", 0, 6),
	chatHeightUnfocused: unit("chat"),
	chatScale: unit("chat"),
	chatWidth: unit("chat"),
	onlyShowSecureChat: boolean("chat"),
	saveChatDrafts: boolean("chat"),

	autoJump: boolean("controls"),
	rotateWithMinecart: boolean("controls"),
	operatorItemsTab: boolean("controls"),
	toggleCrouch: boolean("controls"),
	toggleSprint: boolean("controls"),
	toggleAttack: boolean("controls"),
	toggleUse: boolean("controls"),
	sprintWindow: number("controls", 0, 20),
	mainHand: text("controls"),
	attackIndicator: number("controls", 0, 2),

	narrator: number("accessibility", 0, 3),
	reducedDebugInfo: boolean("accessibility"),
	showSubtitles: boolean("accessibility"),
	directionalAudio: boolean("accessibility"),
	highContrast: boolean("accessibility"),
	highContrastBlockOutline: boolean("accessibility"),
	narratorHotkey: boolean("accessibility"),
	damageTiltStrength: unit("accessibility"),
	onboardAccessibility: boolean("accessibility"),

	realmsNotifications: boolean("other"),
	advancedItemTooltips: boolean("other"),
	pauseOnLostFocus: boolean("other"),
	useNativeTransport: boolean("other"),
	glDebugVerbosity: number("other", 0, 4),
	skipMultiplayerWarning: boolean("other"),
	hideMatchedNames: boolean("other"),
	syncChunkWrites: boolean("other"),
	showAutosaveIndicator: boolean("other"),
	allowServerListing: boolean("other"),
	inGameNotification: boolean("other"),
	sharePresence: text("other"),
	telemetryOptInExtra: boolean("other"),
	notificationDisplayTime: number("other", 0, 10),
	lastServer: text("other"),
	startedCleanly: boolean("other"),
	tutorialStep: text("other"),
	joinedFirstServer: boolean("other"),
};

export const HIDDEN_GAME_OPTION_KEYS = new Set([
	"version",
	"resourcePacks",
	"incompatibleResourcePacks",
	"lastServer",
	"startedCleanly",
	"tutorialStep",
	"joinedFirstServer",
	"onboardAccessibility",
	"soundDevice",
	"fullscreenResolution",
	"overrideWidth",
	"overrideHeight",
]);

function inferCategory(key: string): GameOptionCategory {
	if (key.startsWith("key_")) return "keybindings";
	const known = VANILLA[key];
	if (known) return known.category;
	if (key.startsWith("soundCategory_")) return "sound";
	if (key.startsWith("modelPart_")) return "skin";

	const lower = key.toLowerCase();
	if (/(mouse|cursor|discrete_mouse)/.test(lower)) return "mouse";
	if (/(lang|unicode|glyph)/.test(lower)) return "language";
	if (/(sound|music)/.test(lower)) return "sound";
	if (lower.includes("chat")) return "chat";
	if (/(narrator|subtitle|contrast|accessibility)/.test(lower))
		return "accessibility";
	if (
		/(^toggle|autojump|sprintwindow|mainhand|attackindicator|operatoritems)/.test(
			lower,
		)
	)
		return "controls";
	if (
		/(fov|render|chunk|biome|fullscreen|maxfps|graphics|cloud|particle|mipmap|vsync|guiscale|anisotropy|texture|vignette|glint|entity|simulation|^ao$|cutout|transparency)/.test(
			lower,
		)
	)
		return "video";
	return "custom";
}

function inferKind(
	key: string,
	value: string,
	spec?: VanillaSpec,
): Pick<ObservedOption, "kind" | "min" | "max"> {
	if (spec) {
		return {
			kind: spec.kind,
			min: spec.min ?? null,
			max: spec.max ?? null,
		};
	}
	if (key.startsWith("soundCategory_")) {
		return { kind: "number", min: 0, max: 1 };
	}
	if (key.startsWith("modelPart_") || ["true", "false"].includes(value)) {
		return { kind: "boolean", min: null, max: null };
	}
	if (value !== "" && Number.isFinite(Number(value)) && !value.includes(":")) {
		const parsed = Number(value);
		if (parsed >= 0 && parsed <= 1) {
			return { kind: "number", min: 0, max: 1 };
		}
	}
	return { kind: "text", min: null, max: null };
}

export function classifyGameOptionCategory(key: string): GameOptionCategory {
	return inferCategory(key);
}

export function describeObservedOption(
	key: string,
	value: string,
): ObservedOption {
	const spec = VANILLA[key];
	return {
		key,
		category: inferCategory(key),
		labelId: "",
		...inferKind(key, value, spec),
	};
}

export const GAME_OPTION_CATEGORY_ORDER = [
	"video",
	"mouse",
	"sound",
	"language",
	"chat",
	"controls",
	"accessibility",
	"skin",
	"other",
	"custom",
] as const;
