import { createSignal } from "solid-js";
import { createFluentBundle, formatLocalizedMessage, type TranslationArgs } from "./catalog";
import type { MessageId } from "./messages";

export const SYSTEM_LANGUAGE = "system" as const;
export type TextDirection = "ltr" | "rtl";
export type Locale = "en";
export type LocalePreference = typeof SYSTEM_LANGUAGE | Locale;

export interface LocaleDefinition {
  code: Locale;
  name: string;
  nativeName: string;
  direction: TextDirection;
}

export const supportedLocales: readonly LocaleDefinition[] = [
  { code: "en", name: "English", nativeName: "English", direction: "ltr" },
];

const sourceLocale: Locale = "en";
const preferenceStorageKey = "vesta:language-preference";
const catalogSources = import.meta.glob<string>("./locales/*/*.ftl", {
  query: "?raw",
  import: "default",
  eager: true,
});

const [locale, setEffectiveLocale] = createSignal<Locale>(sourceLocale, {
  name: "locale",
});
const [languagePreference, setLanguagePreference] =
  createSignal<LocalePreference>(SYSTEM_LANGUAGE, { name: "languagePreference" });
const bundles = new Map<string, ReturnType<typeof createFluentBundle>>();

function normalizeLocaleCode(code: string): string {
  return code.trim().replaceAll("_", "-").toLowerCase();
}

function findSupportedLocale(candidate: string): Locale | undefined {
  const normalized = normalizeLocaleCode(candidate);
  const exact = supportedLocales.find(
    (item) => item.code.toLowerCase() === normalized,
  );
  if (exact) return exact.code;
  const language = normalized.split("-")[0];
  return supportedLocales.find((item) => item.code.toLowerCase() === language)
    ?.code;
}

export function resolveLocale(
  preference: string | null | undefined,
  systemLocales: readonly string[] =
    typeof navigator === "undefined" ? [] : navigator.languages,
): Locale {
  if (preference && preference !== SYSTEM_LANGUAGE) {
    return findSupportedLocale(preference) ?? sourceLocale;
  }
  for (const candidate of systemLocales) {
    const match = findSupportedLocale(candidate);
    if (match) return match;
  }
  return sourceLocale;
}

function bundleFor(activeLocale: Locale) {
  const cached = bundles.get(activeLocale);
  if (cached) return cached;

  const marker = `/locales/${activeLocale}/`;
  const sources = Object.entries(catalogSources)
    .filter(([path]) => path.includes(marker))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, source]) => source);
  const bundle = createFluentBundle(activeLocale, sources);
  bundles.set(activeLocale, bundle);
  return bundle;
}

function applyDocumentLocale(activeLocale: Locale): void {
  if (typeof document === "undefined") return;
  const definition = supportedLocales.find((item) => item.code === activeLocale);
  document.documentElement.lang = activeLocale;
  document.documentElement.dir = definition?.direction ?? "ltr";
}

function readPreference(): string | null {
  if (typeof localStorage === "undefined") return null;
  try {
    return localStorage.getItem(preferenceStorageKey);
  } catch {
    return null;
  }
}

function persistPreference(preference: LocalePreference): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(preferenceStorageKey, preference);
  } catch {
    // Locale remains available for this session when storage is unavailable.
  }
}

export function initializeLocalization(
  preference: string | null | undefined = readPreference(),
): void {
  applyLanguagePreference(preference, true);
}

function applyLanguagePreference(
  preference: string | null | undefined,
  persist = false,
): void {
  const normalized: LocalePreference =
    !preference || preference === SYSTEM_LANGUAGE
      ? SYSTEM_LANGUAGE
      : (findSupportedLocale(preference) ?? sourceLocale);
  const activeLocale = resolveLocale(normalized);
  bundleFor(sourceLocale);
  bundleFor(activeLocale);
  setLanguagePreference(normalized);
  setEffectiveLocale(activeLocale);
  applyDocumentLocale(activeLocale);
  if (persist) persistPreference(normalized);
}

/** Change and persist the user's language preference (`system` follows the OS). */
export function setLocale(preference: LocalePreference): void {
  applyLanguagePreference(preference, true);
}

export function t(messageId: MessageId, args?: TranslationArgs): string {
  const activeLocale = locale();
  const value = formatLocalizedMessage(
    bundleFor(activeLocale),
    activeLocale === sourceLocale ? undefined : bundleFor(sourceLocale),
    messageId,
    args,
  );
  if (value === messageId && import.meta.env.DEV) {
    console.warn(`Missing localization message: ${messageId}`);
  }
  return value;
}

export function getSupportedLocales(): readonly LocaleDefinition[] {
  return supportedLocales;
}

export function formatNumber(
  value: number | bigint,
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(locale(), options).format(value);
}

export function formatDate(
  value: Date | number | string,
  options?: Intl.DateTimeFormatOptions,
): string {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat(locale(), options).format(date);
}

export { locale, languagePreference };
