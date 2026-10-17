import { splitThemeUpdates } from "./theme-model";
type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

/** The OS owns autostart. Restore its prior state if saving the config fails. */
export async function persistSettings(invoke: Invoke, updates: Record<string, unknown>, autostart?: {
  isEnabled: () => Promise<boolean>; enable: () => Promise<void>; disable: () => Promise<void>;
}) {
  const isEnabled = () => autostart ? autostart.isEnabled() : invoke<boolean>("plugin:autostart|is_enabled");
  const setAutostart = (enabled: boolean) => autostart
    ? enabled ? autostart.enable() : autostart.disable()
    : invoke<void>(enabled ? "plugin:autostart|enable" : "plugin:autostart|disable");
  const { config, theme } = splitThemeUpdates(updates);
  if (Object.keys(theme).length) await invoke("update_rewrite_theme", { updates: theme });
  if (!Object.keys(config).length) return;
  const requested = config.autostart_enabled;
  let previous: boolean | undefined;
  if (typeof requested === "boolean") {
    previous = await isEnabled();
    if (previous !== requested)
      await setAutostart(requested);
  }
  try {
    // Tray visibility is an OS side effect; the plain config command only persists it.
    if (typeof config.show_tray_icon === "boolean") {
      await invoke("set_tray_icon_visibility", { visible: config.show_tray_icon });
      delete config.show_tray_icon;
    }
    if (typeof config.minimize_to_tray === "boolean") {
      await invoke("set_minimize_to_tray", { enabled: config.minimize_to_tray });
      delete config.minimize_to_tray;
    }
    // These settings have host consumers listening for a per-field config event.
    for (const field of ["use_dedicated_gpu", "discord_presence_enabled", "telemetry_enabled"]) {
      if (field in config) {
        await invoke("update_config_field", { field, value: config[field] });
        delete config[field];
      }
    }
    if (Object.keys(config).length) await invoke("update_config_fields", { updates: config });
  } catch (error) {
    if (previous !== undefined && previous !== requested) {
      try {
        await setAutostart(previous);
      } catch {
        console.error("Unable to restore OS autostart state after a settings failure.");
      }
    }
    throw error;
  }
}
