import { supportedWindowEffects } from "../../../features/settings/window-effects";
import {
  presetUpdates,
  resolveThemeTokens,
  splitThemeUpdates,
  themeDefinition,
  themePresets,
  type ThemeValues,
} from "../../../features/settings/theme-model";
import { Button, SegmentedControl, Select, Slider } from "@vesta/ui";
import { For, Show, createMemo, createSignal } from "solid-js";

import { resolvedScheme } from "../../../app/preferences";
import { Icon } from "../../../components/icon";
import { SettingRow } from "../../../components/setting-row";
import { setting, updateSetting, flushSettings } from "../../../features/settings/config";
import { t } from "../../../localization";
import { Card, Reveal, ToggleRow } from "../parts";
import "./appearance.css";

type Preset = (typeof themePresets)[number];

const materialLabels = {
  glass: 'prefs.appearance.style-glass',
  frosted: 'prefs.appearance.style-frosted',
  flat: 'prefs.appearance.style-flat',
} as const;

/** The live theme settings, in the shape the token resolver takes. */
function currentTheme(): ThemeValues {
  return {
    id: setting("theme_id"),
    mode: setting("theme"),
    hue: setting("theme_primary_hue"),
    material: setting("theme_style"),
    translucency: setting("theme_translucency"),
    grain: setting("theme_grain"),
    gradient: setting("theme_gradient_enabled"),
    gradientType: setting("theme_gradient_type"),
    gradientAngle: setting("theme_gradient_angle"),
    gradientHarmony: setting("theme_gradient_harmony"),
    borderWidth: setting("theme_border_width"),
  };
}

/**
 * A compact material swatch drawn with the theme's real tokens. The theme's resolved inputs
 * are set inline and the element carries data-vesta-scheme, so the launcher palette re-derives
 * inside it exactly as it does on :root, in the current colour mode.
 */
function ThemePreview(props: {
  tokens: Record<string, string>;
  neutral: boolean;
  material: string;
}) {
  return (
    <span
      data-vesta="prefs-theme-preview"
      data-vesta-scheme={resolvedScheme()}
      data-vesta-accent={props.neutral ? "neutral" : "hue"}
      data-material={props.material}
      style={props.tokens}
      aria-hidden="true"
    >
      <span data-vesta="prefs-theme-preview-rail"><i /><i /><i /></span>
      <span data-vesta="prefs-theme-preview-board">
        <span data-vesta="prefs-theme-preview-card" data-accent=""><i /></span>
        <span data-vesta="prefs-theme-preview-card"><i /></span>
      </span>
    </span>
  );
}

/**
 * The theme presets as live previews; choosing one applies it at once. Shared with the
 * welcome flow, which shows the same grid on its theme step.
 */
export function ThemeGrid() {
  const definition = () => themeDefinition(setting("theme_id"));
  const choose = (preset: Preset) => {
    // Colour mode and window effect are launcher-wide: a preset never changes them.
    for (const [key, value] of Object.entries(presetUpdates(preset.definition)))
      updateSetting(key as Parameters<typeof updateSetting>[0], value as never);
    flushSettings();
  };
  /*
   * Each preview shows what choosing it gives: the live settings for the current theme, and for
   * the others the live settings with that preset's overrides (exactly what choose() writes).
   */
  const previews = createMemo(
    () => {
      const current = currentTheme();
      return Object.fromEntries(
        themePresets.map((preset) => {
          const values =
            preset.id === current.id
              ? current
              : ({
                  ...current,
                  ...splitThemeUpdates(presetUpdates(preset.definition)).theme,
                } as ThemeValues);
          return [preset.id, { tokens: resolveThemeTokens(values), material: values.material }];
        }),
      );
    },
    { name: "themePreviews" },
  );
  return (
    <ul data-vesta="prefs-themes">
      <For each={themePresets}>
        {(preset) => {
          const selected = () => definition().id === preset.id;
          const preview = () => previews()[preset.id]!;
          return (
            <li>
              <button
                type="button"
                data-vesta="prefs-theme"
                data-theme={preset.id}
                aria-pressed={selected() ? "true" : "false"}
                onClick={() => choose(preset)}
              >
                <span data-vesta="prefs-theme-frame">
                  <ThemePreview
                    tokens={preview().tokens}
                    material={preview().material}
                    neutral={preset.definition.accentChroma.dark === 0}
                  />
                  <Show when={selected()}>
                    <span data-vesta="prefs-theme-check" aria-hidden="true">
                      <Icon name="icons/controls/check" size={11} />
                    </span>
                  </Show>
                </span>
                <span data-vesta="prefs-theme-caption">
                  <span data-vesta="prefs-theme-name">{preset.name}</span>
                  <span data-vesta="prefs-theme-material">
                    {t(materialLabels[preview().material as keyof typeof materialLabels] ?? 'prefs.appearance.style-glass')}
                  </span>
                </span>
              </button>
            </li>
          );
        }}
      </For>
    </ul>
  );
}

export function AppearanceSettings() {
  const [advanced, setAdvanced] = createSignal(false);
  const glassy = () => setting("theme_style") !== "flat";
  const frosted = () => setting("theme_style") === "frosted";
  const effects = supportedWindowEffects;
  const definition = () => themeDefinition(setting("theme_id"));
  const hue = () => setting("theme_primary_hue");

  return (
    <>
      <Card title={t("prefs.appearance.theme")}>
        <ThemeGrid />
      </Card>

      <Card title={t("prefs.appearance.colour")}>
        <SettingRow label={t("prefs.appearance.color-mode")}>
          <SegmentedControl
            size="sm"
            aria-label={t("prefs.appearance.color-mode")}
            value={setting("theme")}
            onChange={(value) => updateSetting("theme", value as never)}
            options={[
              { value: "system", label: t("prefs.appearance.mode-system") },
              { value: "light", label: t("prefs.appearance.mode-light") },
              { value: "dark", label: t("prefs.appearance.mode-dark") },
            ]}
          />
        </SettingRow>
        <Show when={definition().hueAdjustable}>
          <SettingRow
            label={t("prefs.appearance.hue")}
            description={t("prefs.appearance.hue-description")}
          >
            <div data-vesta="prefs-slider" class="prefs-hue">
              <Slider
                onChangeEnd={flushSettings}
                size="sm"
                aria-label={t("prefs.appearance.hue")}
                min={0}
                max={360}
                step={1}
                showValue
                value={[hue()]}
                onChange={([value]) => {
                  updateSetting("theme_primary_hue", value);
                }}
              />
            </div>
          </SettingRow>
        </Show>
      </Card>

      <Card title={t("prefs.appearance.material")}>
        <SettingRow
          label={t("prefs.appearance.window-effect")}
          description={t("prefs.appearance.window-effect-description")}
        >
          <Select
            size="sm"
            aria-label={t("prefs.appearance.window-effect")}
            value={
              effects().includes(setting("theme_window_effect") as never)
                ? setting("theme_window_effect")
                : "none"
            }
            onChange={(value) => updateSetting("theme_window_effect", value)}
            options={effects().map((effect) => ({
              value: effect,
              label: t(`prefs.appearance.effect-${effect.replaceAll("_", "-")}` as never),
            }))}
          />
        </SettingRow>
        <Show when={!glassy() && effects().length > 1}>
          <p data-vesta="prefs-material-note">{t("prefs.appearance.window-effect-flat-note")}</p>
        </Show>
      </Card>

      <Card title={t("prefs.appearance.surfaces")}>
        <SettingRow label={t("prefs.appearance.style")}>
          <SegmentedControl
            size="sm"
            aria-label={t("prefs.appearance.style")}
            value={setting("theme_style")}
            onChange={(value) => updateSetting("theme_style", value as never)}
            options={[
              { value: "glass", label: t("prefs.appearance.style-glass") },
              { value: "frosted", label: t("prefs.appearance.style-frosted") },
              { value: "flat", label: t("prefs.appearance.style-flat") },
            ]}
          />
        </SettingRow>
      </Card>

      <Card
        title={t("prefs.appearance.advanced")}
        action={
          <Button
            size="sm"
            variant="ghost"
            aria-expanded={advanced() ? "true" : "false"}
            onClick={() => setAdvanced(!advanced())}
            icon={
              <Icon
                name={advanced() ? "icons/controls/chevron-up" : "icons/controls/chevron-down"}
              />
            }
          >
            {advanced() ? t("prefs.hide") : t("prefs.show")}
          </Button>
        }
      >
        <Show when={advanced()}>
          <Reveal>
            <Show when={glassy()}>
              <SettingRow label={t("prefs.appearance.translucency")}>
                <div data-vesta="prefs-slider">
                  <Slider
                    onChangeEnd={flushSettings}
                    size="sm"
                    aria-label={t("prefs.appearance.translucency")}
                    min={0}
                    max={100}
                    step={1}
                    showValue
                    getValueLabel={([v]) => `${v}%`}
                    value={[setting("theme_translucency")]}
                    onChange={([value]) => updateSetting("theme_translucency", value)}
                  />
                </div>
              </SettingRow>
            </Show>
            <Show when={frosted()}>
              <SettingRow label={t("prefs.appearance.grain")}>
                <div data-vesta="prefs-slider">
                  <Slider
                    onChangeEnd={flushSettings}
                    size="sm"
                    aria-label={t("prefs.appearance.grain")}
                    min={0}
                    max={100}
                    step={1}
                    showValue
                    getValueLabel={([v]) => `${v}%`}
                    value={[setting("theme_grain")]}
                    onChange={([value]) => updateSetting("theme_grain", value)}
                  />
                </div>
              </SettingRow>
            </Show>
            <Show when={definition().background !== "none"}>
              <ToggleRow
                label={t("prefs.appearance.gradient")}
                checked={setting("theme_gradient_enabled")}
                onChange={(value) => updateSetting("theme_gradient_enabled", value)}
              />
              <Show when={setting("theme_gradient_enabled")}>
                <SettingRow label={t("prefs.appearance.gradient-type")}>
                  <SegmentedControl
                    size="sm"
                    aria-label={t("prefs.appearance.gradient-type")}
                    value={setting("theme_gradient_type")}
                    onChange={(value) => updateSetting("theme_gradient_type", value as never)}
                    options={[
                      { value: "linear", label: t("prefs.appearance.linear") },
                      {
                        value: "radial",
                        label: t("prefs.appearance.circular"),
                      },
                    ]}
                  />
                </SettingRow>
                <SettingRow label={t("prefs.appearance.rotation")}>
                  <div data-vesta="prefs-slider">
                    <Slider
                      onChangeEnd={flushSettings}
                      size="sm"
                      aria-label={t("prefs.appearance.rotation")}
                      min={0}
                      max={360}
                      step={1}
                      showValue
                      getValueLabel={([v]) => `${v}°`}
                      value={[setting("theme_gradient_angle")]}
                      onChange={([value]) => updateSetting("theme_gradient_angle", value)}
                    />
                  </div>
                </SettingRow>
                <Show when={!definition().fixedHues}>
                  <SettingRow label={t("prefs.appearance.harmony")}>
                    <Select
                      size="sm"
                      aria-label={t("prefs.appearance.harmony")}
                      value={setting("theme_gradient_harmony")}
                      onChange={(value) => updateSetting("theme_gradient_harmony", value as never)}
                      options={[
                        {
                          value: "none",
                          label: t("prefs.appearance.harmony-none"),
                        },
                        {
                          value: "complementary",
                          label: t("prefs.appearance.harmony-complement"),
                        },
                        {
                          value: "analogous",
                          label: t("prefs.appearance.harmony-analogous"),
                        },
                        {
                          value: "triadic",
                          label: t("prefs.appearance.harmony-triadic"),
                        },
                      ]}
                    />
                  </SettingRow>
                </Show>
              </Show>
            </Show>
            <SettingRow
              label={t("prefs.appearance.border")}
              description={t("prefs.appearance.border-description")}
            >
              <div data-vesta="prefs-slider">
                <Slider
                  onChangeEnd={flushSettings}
                  size="sm"
                  aria-label={t("prefs.appearance.border")}
                  min={0}
                  max={6}
                  step={0.5}
                  showValue
                  getValueLabel={([v]) => `${v}px`}
                  value={[setting("theme_border_width")]}
                  onChange={([value]) => updateSetting("theme_border_width", value)}
                />
              </div>
            </SettingRow>
          </Reveal>
        </Show>
      </Card>
    </>
  );
}
