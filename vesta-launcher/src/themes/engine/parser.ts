import type {
	GradientHarmony,
	StyleMode,
	ThemeDataPayload,
	ThemeVariable,
	ThemeVariableType,
	ThemeVariableValue,
} from "../types";

export function isObjectLike(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getNumber(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string") {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : undefined;
	}
	return undefined;
}

export function getBoolean(value: unknown): boolean | undefined {
	if (typeof value === "boolean") return value;
	if (typeof value === "string") {
		if (value === "true" || value === "1") return true;
		if (value === "false" || value === "0") return false;
	}
	return undefined;
}

export function getString(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

export function parseVariableDefinitions(
	value: unknown,
): ThemeVariable[] | undefined {
	if (!Array.isArray(value)) return undefined;

	const parsed: ThemeVariable[] = [];
	for (const entry of value) {
		if (!isObjectLike(entry)) continue;

		const name = getString(entry.name);
		const key = getString(entry.key);
		const type = getString(entry.type) as ThemeVariableType | undefined;
		if (!name || !key || !type) continue;

		if (type === "number") {
			const min = getNumber(entry.min);
			const max = getNumber(entry.max);
			const def = getNumber(entry.default);
			if (min === undefined || max === undefined || def === undefined) continue;
			parsed.push({
				name,
				key,
				type,
				min,
				max,
				default: def,
				step: getNumber(entry.step),
				unit: getString(entry.unit),
				description: getString(entry.description),
			});
			continue;
		}

		if (type === "color") {
			const def = getString(entry.default);
			if (!def) continue;
			parsed.push({
				name,
				key,
				type,
				default: def,
				description: getString(entry.description),
			});
			continue;
		}

		if (type === "boolean") {
			const def = getBoolean(entry.default);
			if (def === undefined) continue;
			parsed.push({
				name,
				key,
				type,
				default: def,
				description: getString(entry.description),
			});
			continue;
		}

		if (type === "select") {
			const def = getString(entry.default);
			if (!def || !Array.isArray(entry.options)) continue;
			const options = entry.options
				.filter((opt): opt is Record<string, unknown> => isObjectLike(opt))
				.map((opt) => ({
					label: getString(opt.label) || getString(opt.value) || "Option",
					value: getString(opt.value) || "",
				}))
				.filter((opt) => opt.value.length > 0);
			if (options.length === 0) continue;
			parsed.push({
				name,
				key,
				type,
				default: def,
				options,
				description: getString(entry.description),
			});
		}
	}

	return parsed.length > 0 ? parsed : undefined;
}

export function parseUserVariables(
	value: unknown,
): Record<string, ThemeVariableValue> | undefined {
	if (!isObjectLike(value)) return undefined;

	const parsed: Record<string, ThemeVariableValue> = {};
	for (const [key, val] of Object.entries(value)) {
		if (
			typeof val === "number" ||
			typeof val === "string" ||
			typeof val === "boolean"
		) {
			parsed[key] = val;
		}
	}

	return Object.keys(parsed).length > 0 ? parsed : undefined;
}

export function parseThemeData(raw: unknown): Partial<ThemeDataPayload> {
	let source: unknown = raw;
	if (typeof raw === "string") {
		try {
			source = JSON.parse(raw);
		} catch (e) {
			console.error("Failed to parse theme_data JSON:", e);
			return {};
		}
	}

	if (!isObjectLike(source)) return {};

	const out: Partial<ThemeDataPayload> = {};
	out.id = getString(source.id);
	out.name = getString(source.name);
	out.author = getString(source.author);
	out.description = getString(source.description);
	out.primaryHue = getNumber(source.primaryHue ?? source.primary_hue);
	out.primarySat = getNumber(source.primarySat ?? source.primary_sat);
	out.primaryLight = getNumber(source.primaryLight ?? source.primary_light);
	out.opacity = getNumber(source.opacity);
	out.style = getString(source.style) as StyleMode | undefined;
	out.gradientEnabled = getBoolean(
		source.gradientEnabled ?? source.gradient_enabled,
	);
	out.rotation = getNumber(source.rotation);
	out.gradientType = getString(source.gradientType ?? source.gradient_type) as
		| "linear"
		| "radial"
		| undefined;
	out.gradientHarmony = getString(
		source.gradientHarmony ?? source.gradient_harmony,
	) as GradientHarmony | undefined;
	out.borderWidth = getNumber(source.borderWidth ?? source.border_width);
	out.backgroundOpacity = getNumber(
		source.backgroundOpacity ?? source.background_opacity,
	);
	out.windowEffect = getString(source.windowEffect ?? source.window_effect);
	out.customCss = getString(source.customCss ?? source.custom_css);
	out.variables = parseVariableDefinitions(source.variables ?? source.params);
	out.userVariables = parseUserVariables(
		source.userVariables ??
			source.user_variables ??
			source.userParams ??
			source.user_params,
	);

	return out;
}

export function serializeThemeData(payload: ThemeDataPayload): string {
	return JSON.stringify(payload);
}
