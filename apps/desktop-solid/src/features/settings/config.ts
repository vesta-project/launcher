import { defaultTheme, themeFields, themeSettings, THEME_MIRROR_KEY } from "./theme-model";
import { persistBuiltInTheme, refreshAuthorThemes } from './author-themes';
import { setLocale, type LocalePreference } from "../../localization";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { isEnabled, enable, disable } from "@tauri-apps/plugin-autostart";
import { listen } from "@tauri-apps/api/event";
import { createSignal, onSettled, untrack, createMemo, createRoot } from "solid-js";
import { CacheInvalidatedError, RequestCache } from "../../platform/cache/request-cache";
import { persistSettings } from "./native-config";
import { SettingsWriteQueue } from "./write-queue";
import { setScheme, type SchemePreference } from "../../app/preferences";

/**
 * Application settings consumed by the existing pages. General settings use AppConfig;
 * themeFields route to the independent rewrite theme document, never legacy theme columns.
 * Outside Tauri, versioned display mirrors keep browser previews usable.
 */
export interface LauncherConfig {
  language: string;
  reduced_motion: boolean;
  telemetry_enabled: boolean;
  discord_presence_enabled: boolean;
  use_dedicated_gpu: boolean;
  autostart_enabled: boolean;
  show_tray_icon: boolean;
  minimize_to_tray: boolean;
  debug_logging: boolean;
  /** Local-only: shows the Developer page. Never sent to the host. */
  developer_mode: boolean;
  /** Local-only: sites whose links open without asking first (see features/links). */
  trusted_link_domains: string[];

  max_download_threads: number;
  artifact_cache_max_bytes: number;
  auto_install_dependencies: boolean;
  manual_mod_dependency_policy: "ask" | "always" | "never";
  proxy_enabled: boolean;
  proxy_url: string | null;
  proxy_apply_to_games: boolean;

  auto_update_enabled: boolean;
  startup_check_updates: boolean;
  notification_enabled: boolean;
  notification_retention_days: number;

  theme: SchemePreference;
  theme_id: string;
  theme_primary_hue: number;
  theme_style: "glass" | "frosted" | "flat";
  theme_window_effect: string;
  theme_background_opacity: number;
  theme_translucency: number;
  theme_grain: number;
  theme_gradient_enabled: boolean;
  theme_gradient_type: "linear" | "radial";
  theme_gradient_angle: number;
  theme_gradient_harmony: "none" | "complementary" | "analogous" | "triadic";
  theme_border_width: number;

  default_width: number;
  default_height: number;
  default_min_memory: number;
  default_max_memory: number;
  default_launcher_action_on_launch: "stay-open" | "minimize" | "hide-to-tray" | "quit";
  default_java_args: string | null;
  default_environment_variables: string | null;
  default_pre_launch_hook: string | null;
  default_wrapper_command: string | null;
  default_post_exit_hook: string | null;
  default_sandbox_preset: "trusted" | "modded" | "paranoid";
  default_sandbox_wrapper_nesting: "sandbox-outside" | "wrapper-outside";
  default_sandbox_extra_paths: string[];
}

export const configDefaults: LauncherConfig = {
  language: "system",
  reduced_motion: false,
  telemetry_enabled: true,
  discord_presence_enabled: true,
  use_dedicated_gpu: true,
  autostart_enabled: false,
  show_tray_icon: true,
  minimize_to_tray: false,
  debug_logging: false,
  developer_mode: false,
  trusted_link_domains: [],

  max_download_threads: 4,
  artifact_cache_max_bytes: 1024 * 1024 * 1024,
  auto_install_dependencies: true,
  manual_mod_dependency_policy: "ask",
  proxy_enabled: false,
  proxy_url: null,
  proxy_apply_to_games: false,

  auto_update_enabled: true,
  startup_check_updates: true,
  notification_enabled: true,
  notification_retention_days: 30,

  theme: "system",
  theme_id: "vesta",
  theme_primary_hue: 207,
  theme_style: "glass",
  theme_window_effect: "none",
  theme_background_opacity: 100,
  theme_translucency: 60,
  theme_grain: 20,
  theme_gradient_enabled: true,
  theme_gradient_type: "radial",
  theme_gradient_angle: 135,
  theme_gradient_harmony: "analogous",
  theme_border_width: 1,

  default_width: 854,
  default_height: 480,
  default_min_memory: 2048,
  default_max_memory: 4096,
  default_launcher_action_on_launch: "stay-open",
  default_java_args: null,
  default_environment_variables: null,
  default_pre_launch_hook: null,
  default_wrapper_command: null,
  default_post_exit_hook: null,
  default_sandbox_preset: "trusted",
  default_sandbox_wrapper_nesting: "sandbox-outside",
  default_sandbox_extra_paths: [],
};

const KEY = "vesta:launcher-config";
const hasWindow = typeof window !== "undefined";
const native = hasWindow && isTauri();

/** Never mirrored to localStorage: may embed credentials. */
const secret = new Set<keyof LauncherConfig>([
  "proxy_url",
  "default_java_args",
  "default_environment_variables",
  "default_pre_launch_hook",
  "default_wrapper_command",
  "default_post_exit_hook",
]);

/** Kept in the local mirror only; the host has no such field. */
const localOnly = new Set<keyof LauncherConfig>(["developer_mode", "trusted_link_domains"]);

/**
 * The last known configuration, read synchronously at startup so the Settings pages
 * paint with real values on the very first frame. In Tauri this is only a display mirror
 * of the host's copy, replaced as soon as `get_config` answers.
 */
function stored(): Partial<LauncherConfig> {
  if (!hasWindow) return {};
  try {
    const legacy = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    // Remove secrets left by older mirrors before using or retaining display data.
    for (const key of secret) delete legacy[key];
    try { localStorage.setItem(KEY, JSON.stringify(legacy)); }
    catch { /* Hydration still works when the mirror cannot be rewritten. */ }
    // Preserve unrelated preferences, but never hydrate themes from the legacy mirror.
    for (const key of Object.keys(themeFields)) delete legacy[key];
    let appearance = themeSettings(defaultTheme);
    try {
      const saved = JSON.parse(localStorage.getItem(THEME_MIRROR_KEY) ?? "null");
      if (saved?.schemaVersion === 1 && typeof saved.theme?.id === "string")
        appearance = themeSettings(saved.theme);
    } catch {
      /* New defaults remain usable when the display mirror is corrupt. */
    }
    return { ...legacy, ...appearance };
  } catch {
    return {};
  }
}

function persistMirror(all: LauncherConfig) {
  if (!hasWindow) return;
  const safe = Object.fromEntries(
    Object.entries(all).filter(([name]) => !secret.has(name as keyof LauncherConfig)),
  );
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify(
        Object.fromEntries(
          Object.entries(safe).filter(([key]) => !Object.hasOwn(themeFields, key)),
        ),
      ),
    );
    const theme = Object.fromEntries(
      Object.entries(themeFields).map(([key, field]) => [field, all[key as keyof LauncherConfig]]),
    );
    localStorage.setItem(THEME_MIRROR_KEY, JSON.stringify({ schemaVersion: 1, theme }));
  } catch {
    // Mirror is best-effort.
  }
}

let pendingMirror: LauncherConfig | undefined;
let mirrorTimer: ReturnType<typeof setTimeout> | undefined;
function mirror(all: LauncherConfig) {
  pendingMirror = all;
  clearTimeout(mirrorTimer);
  mirrorTimer = setTimeout(flushMirror, 160);
}
function flushMirror() {
  clearTimeout(mirrorTimer);
  if (pendingMirror) persistMirror(pendingMirror);
  pendingMirror = undefined;
}
if (hasWindow) window.addEventListener("pagehide", flushMirror);

const initialConfig = { ...configDefaults, ...stored() };
// Hydrate only the new theme mirror before the shell's first render, including browser previews.
setScheme(initialConfig.theme);
const [config, setConfig] = createSignal<LauncherConfig>(initialConfig, { name: "launcherConfig" });
export { config };

/** One setting's current value. Call inside a tracking scope, like any signal. */
// Field memos prevent an accent drag from invalidating every settings control.
const fields = createRoot(() =>
  Object.fromEntries(
    (Object.keys(configDefaults) as (keyof LauncherConfig)[]).map((key) => {
      const field = createMemo(() => config()[key], { name: `setting:${key}` });
      return [key, field];
    }),
  ),
) as unknown as { [K in keyof LauncherConfig]: () => LauncherConfig[K] };
export const setting = <K extends keyof LauncherConfig>(key: K): LauncherConfig[K] => fields[key]();

/** Optimistic edits remain overlaid while serialized, coalesced writes reach Rust. */
const writeQueue = new SettingsWriteQueue(
  (updates) => persistSettings(invoke, updates, { isEnabled, enable, disable }, persistBuiltInTheme),
  () => console.error("Unable to save launcher settings; reloading saved values."),
  () => void refreshConfig(true),
  200,
);

/** Sliders render immediately; release commits their latest coalesced values. */
export function flushSettings() {
  writeQueue.flush();
  flushMirror();
}

/** Preview must not race an unacknowledged slider or preset write. */
export async function drainSettings() {
  await writeQueue.drain();
  flushMirror();
}

function sameValue(left: unknown, right: unknown): boolean {
  return (
    Object.is(left, right) ||
    (Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => Object.is(value, right[index])))
  );
}

export function updateSetting<K extends keyof LauncherConfig>(key: K, value: LauncherConfig[K]) {
  // Controlled widgets may report their current value after host hydration.
  // A no-op must never create another persistence/event/refresh cycle.
  if (sameValue(untrack(config)[key], value)) return;
  setConfig((current) => {
    const next = { ...current, [key]: value };
    mirror(next);
    return next;
  });
  if (key === "language") setLocale(value as LocalePreference);
  if (key === "theme") setScheme(value as SchemePreference);
  if (native && !localOnly.has(key)) {
    const persisted = key === "default_sandbox_extra_paths" ? JSON.stringify(value) : value;
    void writeQueue.enqueue(key, persisted);
  }
}

/** Decode only public settings. Optional host values fall back to usable UI defaults. */
function fromHost(value: Record<string, unknown>): Partial<LauncherConfig> {
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(configDefaults) as (keyof LauncherConfig)[]) {
    if (!(key in value)) continue;
    const entry = value[key];
    if (key === "default_sandbox_extra_paths") {
      try {
        const paths = typeof entry === "string" ? JSON.parse(entry) : entry;
        if (Array.isArray(paths) && paths.every((path) => typeof path === "string"))
          result[key] = paths;
      } catch {
        /* Invalid host paths retain the previous usable value. */
      }
    } else result[key] = entry ?? configDefaults[key];
  }
  return result as Partial<LauncherConfig>;
}

const hostCache = new RequestCache<Record<string, unknown>>({
  maxEntries: 1,
  staleTimeMs: 60_000,
  retentionMs: 600_000,
});

/** Reads the host config, sharing one request between callers and reusing a fresh result. */
export async function refreshConfig(force = false) {
  if (!native) return;
  if (force) hostCache.invalidate("config");
  try {
    const value = await hostCache.read("config", async () => {
      const [host, theme] = await Promise.all([
        invoke<Record<string, unknown>>("get_config"),
        refreshAuthorThemes(),
      ]);
      // Only the new theme store may supply these fields.
      // OS registration can change outside the launcher; it is authoritative.
      let autostart = host.autostart_enabled;
      try { autostart = await isEnabled(); }
      catch (error) { console.error("Unable to read OS autostart state:", error); }
      return { ...host, autostart_enabled: autostart, ...themeSettings(theme.builtIn) };
    });
    setConfig((current) => {
      const next = { ...current, ...fromHost(value), ...fromHost(writeQueue.pending()) };
      if (
        (Object.keys(next) as (keyof LauncherConfig)[]).every((key) =>
          sameValue(current[key], next[key]),
        )
      )
        return current;
      mirror(next);
      return next;
    });
    const current = untrack(config);
    setLocale(current.language as LocalePreference);
    setScheme(current.theme);
  } catch (reason) {
    if (!(reason instanceof CacheInvalidatedError))
      console.error("Unable to load launcher settings:", reason);
  }
}

/** Loads the host config at startup and follows `config-updated`. Call from the shell. */
export function useConfigSync() {
  if (!native) return;
  onSettled(() => {
    const stops: (() => void)[] = [];
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const scheduleRefresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!disposed) void refreshConfig(true);
      }, 50);
    };
    void Promise.all(
      ["config-updated", "rewrite-theme-updated"].map(async (event) => {
        const stop = await listen(event, scheduleRefresh);
        if (disposed) stop();
        else stops.push(stop);
      }),
    )
      .then(() => {
        if (!disposed) void refreshConfig(true);
      })
      .catch(() => {
        if (!disposed) void refreshConfig(true);
      });
    return () => {
      disposed = true;
      clearTimeout(timer);
      for (const stop of stops) stop();
    };
  });
}

/** Restores every setting to its default (Settings → About → Reset). */
export function resetConfig() {
  for (const key of Object.keys(configDefaults) as (keyof LauncherConfig)[])
    updateSetting(key, configDefaults[key] as never);
}
