import { type ThemeConfig, type ThemeVariableValue } from "../../../../../themes/presets";

export interface SettingsTabProps {
	// Root state signals passed down
	backgroundHue: () => number;
	setBackgroundHue: (val: number) => void;
	opacity: () => number;
	setOpacity: (val: number) => void;
	gradientEnabled: () => boolean;
	setGradientEnabled: (val: boolean) => void;
	rotation: () => number;
	setRotation: (val: number) => void;
	gradientType: () => "linear" | "radial";
	setGradientType: (val: "linear" | "radial") => void;
	gradientHarmony: () => any;
	setGradientHarmony: (val: any) => void;
	themeId: () => string;
	setThemeId: (val: string) => void;
	borderThickness: () => number;
	setBorderThickness: (val: number) => void;
	backgroundOpacity: () => number;
	setBackgroundOpacity: (val: number) => void;
	windowEffect: () => string;
	setWindowEffect: (val: string) => void;
	userVariables: Record<string, ThemeVariableValue>;
	setUserVariables: (updater: any) => void;

	// Handlers
	handlePresetSelect: (id: string) => Promise<void>;
	handleHueChange: (values: number[], live?: boolean) => Promise<void>;
	handleStyleModeChange: (mode: ThemeConfig["style"]) => Promise<void>;
	handleOpacityChange: (val: number[], live?: boolean) => Promise<void>;
	handleGradientToggle: (enabled: boolean) => Promise<void>;
	handleRotationChange: (values: number[], live?: boolean) => Promise<void>;
	handleBorderThicknessChange: (values: number[], live?: boolean) => Promise<void>;
	handleBackgroundOpacityChange: (values: number[], live?: boolean) => Promise<void>;
	handleWindowEffectChange: (val: string) => Promise<void>;
	handleGradientTypeChange: (type: "linear" | "radial") => Promise<void>;
	handleGradientHarmonyChange: (harmony: any) => Promise<void>;
	handleVariableChange: (key: string, value: ThemeVariableValue, live?: boolean) => Promise<void>;

	// Catalog state
	filteredThemeCatalog: () => ThemeConfig[];
	themeSearchQuery: () => string;
	setThemeSearchQuery: (val: string) => void;
	themeFilterMode: () => string;
	setThemeFilterMode: (val: any) => void;
	themeViewMode: () => "grid" | "list";
	setThemeViewMode: (val: any) => void;
	hasImportedThemes: () => boolean;
	refreshThemeCatalog: () => Promise<void>;

	// General settings
	reducedMotion: () => boolean;
	handleReducedMotionToggle: (checked: boolean) => Promise<void>;
}
