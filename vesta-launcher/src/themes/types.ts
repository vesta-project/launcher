export type StyleMode = "glass" | "satin" | "flat" | "bordered" | "solid";

export type GradientHarmony =
	| "none"
	| "analogous"
	| "complementary"
	| "triadic";

export type ThemeVariableType = "number" | "color" | "boolean" | "select";

interface ThemeVariableBase {
	name: string;
	key: string;
	type: ThemeVariableType;
	description?: string;
}

export interface NumberThemeVariable extends ThemeVariableBase {
	type: "number";
	min: number;
	max: number;
	default: number;
	step?: number;
	unit?: string;
}

export interface ColorThemeVariable extends ThemeVariableBase {
	type: "color";
	default: string;
}

export interface BooleanThemeVariable extends ThemeVariableBase {
	type: "boolean";
	default: boolean;
}

export interface SelectThemeVariable extends ThemeVariableBase {
	type: "select";
	default: string;
	options: Array<{ label: string; value: string }>;
}

export type ThemeVariable =
	| NumberThemeVariable
	| ColorThemeVariable
	| BooleanThemeVariable
	| SelectThemeVariable;

export type ThemeVariableValue = number | string | boolean;

export type ThemeSource = "builtin" | "imported";

export interface ThemeConfig {
	id: string;
	name: string;
	libraryId?: string;
	author?: string;
	source?: ThemeSource;
	description?: string;
	primaryHue: number;
	primarySat?: number;
	primaryLight?: number;
	opacity: number;
	borderWidth?: number;
	style?: StyleMode;
	colorScheme?: "light" | "dark";
	gradientEnabled: boolean;
	rotation?: number;
	gradientType?: "linear" | "radial";
	gradientHarmony?: GradientHarmony;
	thumbnail?: string;
	customCss?: string;
	allowHueChange?: boolean;
	allowStyleChange?: boolean;
	allowBorderChange?: boolean;
	windowEffect?: string;
	backgroundOpacity?: number;
	variables?: ThemeVariable[];
	userVariables?: Record<string, ThemeVariableValue>;
}

export interface AppThemeConfig {
	theme_id: string;
	theme_mode?: string;
	theme_data?: string;
	theme_primary_hue: number;
	theme_primary_sat?: number;
	theme_primary_light?: number;
	theme_style: StyleMode;
	theme_gradient_enabled: boolean;
	theme_gradient_angle?: number;
	theme_gradient_type?: "linear" | "radial";
	theme_gradient_harmony?: GradientHarmony;
	theme_advanced_overrides?: string;
	theme_border_width?: number;
	theme_window_effect?: string;
	theme_background_opacity?: number;
	background_hue?: number;
}

export interface ThemeDataPayload {
	id?: string;
	name?: string;
	author?: string;
	description?: string;
	primaryHue?: number;
	primarySat?: number;
	primaryLight?: number;
	opacity?: number;
	style?: StyleMode;
	gradientEnabled?: boolean;
	rotation?: number;
	gradientType?: "linear" | "radial";
	gradientHarmony?: GradientHarmony;
	borderWidth?: number;
	backgroundOpacity?: number;
	windowEffect?: string;
	customCss?: string;
	variables?: ThemeVariable[];
	userVariables?: Record<string, ThemeVariableValue>;
}
