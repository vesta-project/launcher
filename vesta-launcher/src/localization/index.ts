import {
	FluentBundle,
	FluentResource,
	type FluentVariable,
} from "@fluent/bundle";
import { invoke } from "@tauri-apps/api/core";
import { hasTauriRuntime } from "@utils/tauri-runtime";
import { createSignal } from "solid-js";
import localeManifest from "../../locales/manifest.json";

export const SYSTEM_LANGUAGE = "system";

export type TextDirection = "ltr" | "rtl";
export type TranslationArgs = Record<string, FluentVariable>;

export interface LocaleDefinition {
	code: string;
	name: string;
	nativeName: string;
	direction: TextDirection;
	enabled: boolean;
}

export interface LocaleState {
	preference: string;
	effectiveLocale: string;
}

interface LocaleManifest {
	sourceLocale: string;
	locales: LocaleDefinition[];
}

const manifest = localeManifest as LocaleManifest;
const catalogSources = import.meta.glob<string>("../../locales/*/*.ftl", {
	query: "?raw",
	import: "default",
	eager: true,
});

const bundles = new Map<string, FluentBundle>();
const supportedLocaleMap = new Map(
	manifest.locales
		.filter((locale) => locale.enabled)
		.map((locale) => [locale.code.toLowerCase(), locale]),
);

const [languagePreference, setLanguagePreference] =
	createSignal<string>(SYSTEM_LANGUAGE);
const [effectiveLocale, setEffectiveLocale] = createSignal(
	manifest.sourceLocale,
);
const [catalogRevision, setCatalogRevision] = createSignal(0);

function normalizeLocaleCode(locale: string): string {
	return locale.trim().replaceAll("_", "-").toLowerCase();
}

function buildBundle(locale: string): FluentBundle | undefined {
	const existing = bundles.get(locale);
	if (existing) return existing;

	const bundle = new FluentBundle(locale, { useIsolating: true });
	const catalogMarker = `/locales/${locale}/`;
	const sources = Object.entries(catalogSources)
		.filter(([path]) => path.includes(catalogMarker))
		.sort(([left], [right]) => left.localeCompare(right));

	if (sources.length === 0) return undefined;

	for (const [path, source] of sources) {
		const errors = bundle.addResource(new FluentResource(source));
		if (errors.length > 0) {
			console.error(`Failed to load localization catalog ${path}`, errors);
		}
	}

	bundles.set(locale, bundle);
	return bundle;
}

function matchSupportedLocale(candidate: string): string | undefined {
	const normalized = normalizeLocaleCode(candidate);
	const exact = supportedLocaleMap.get(normalized);
	if (exact) return exact.code;

	const baseLanguage = normalized.split("-")[0];
	return supportedLocaleMap.get(baseLanguage)?.code;
}

export function resolveLocale(
	preference: string | null | undefined,
	systemLocales: readonly string[] = globalThis.navigator?.languages ?? [],
): string {
	if (preference && preference !== SYSTEM_LANGUAGE) {
		return matchSupportedLocale(preference) ?? manifest.sourceLocale;
	}

	for (const locale of systemLocales) {
		const supported = matchSupportedLocale(locale);
		if (supported) return supported;
	}

	return manifest.sourceLocale;
}

function applyDocumentLocale(locale: string): void {
	if (typeof document === "undefined") return;

	const definition =
		supportedLocaleMap.get(normalizeLocaleCode(locale)) ??
		supportedLocaleMap.get(normalizeLocaleCode(manifest.sourceLocale));
	document.documentElement.lang = locale;
	document.documentElement.dir = definition?.direction ?? "ltr";
}

export function applyLanguagePreference(
	preference: string | null | undefined,
	systemLocales?: readonly string[],
): LocaleState {
	const normalizedPreference =
		!preference || preference === SYSTEM_LANGUAGE
			? SYSTEM_LANGUAGE
			: (matchSupportedLocale(preference) ?? manifest.sourceLocale);
	const resolved = resolveLocale(normalizedPreference, systemLocales);

	buildBundle(manifest.sourceLocale);
	buildBundle(resolved);
	setLanguagePreference(normalizedPreference);
	setEffectiveLocale(resolved);
	applyDocumentLocale(resolved);
	setCatalogRevision((revision) => revision + 1);

	return {
		preference: normalizedPreference,
		effectiveLocale: resolved,
	};
}

export function initializeLocalization(
	preference: string | null | undefined,
): LocaleState {
	return applyLanguagePreference(preference);
}

function formatFromBundle(
	bundle: FluentBundle | undefined,
	messageId: string,
	args?: TranslationArgs,
): string | undefined {
	const message = bundle?.getMessage(messageId);
	if (!message?.value) return undefined;

	const errors: Error[] = [];
	const value = bundle?.formatPattern(message.value, args, errors);
	if (errors.length > 0) {
		console.error(`Failed to format localization message ${messageId}`, errors);
	}
	return value;
}

export function t(messageId: string, args?: TranslationArgs): string {
	catalogRevision();

	const activeLocale = effectiveLocale();
	const activeValue = formatFromBundle(
		buildBundle(activeLocale),
		messageId,
		args,
	);
	if (activeValue !== undefined) return activeValue;

	const fallbackValue = formatFromBundle(
		buildBundle(manifest.sourceLocale),
		messageId,
		args,
	);
	if (fallbackValue !== undefined) return fallbackValue;

	if (import.meta.env.DEV) {
		console.warn(`Missing localization message: ${messageId}`);
	}
	return messageId;
}

export async function changeLanguagePreference(
	preference: string,
): Promise<LocaleState> {
	if (!hasTauriRuntime()) {
		return applyLanguagePreference(preference);
	}

	const state = await invoke<LocaleState>("set_language", { preference });
	return applyLanguagePreference(state.preference, [state.effectiveLocale]);
}

export function getSupportedLocales(): readonly LocaleDefinition[] {
	return manifest.locales.filter((locale) => locale.enabled);
}

export function formatNumber(
	value: number | bigint,
	options?: Intl.NumberFormatOptions,
): string {
	return new Intl.NumberFormat(effectiveLocale(), options).format(value);
}

export function formatDate(
	value: Date | number | string,
	options?: Intl.DateTimeFormatOptions,
): string {
	const date = value instanceof Date ? value : new Date(value);
	return new Intl.DateTimeFormat(effectiveLocale(), options).format(date);
}

export { effectiveLocale, languagePreference };
