import { supportedWindowEffects } from '../../../features/settings/window-effects';
import {
  effectiveHue,
  presetUpdates,
  themeDefinition,
  themePresets,
  type ThemeDefinition,
} from '../../../features/settings/theme-model';
import { Button, SegmentedControl, Select, Slider } from '@vesta/ui';
import { For, Show, createSignal } from 'solid-js';

import { Icon } from '../../../components/icon';
import { SettingRow } from '../../../components/setting-row';
import { setting, updateSetting, flushSettings } from '../../../features/settings/config';
import { t } from '../../../localization';
import { Card, Reveal, ToggleRow } from '../parts';
import './appearance.css';

/** Inline custom properties for a tile's live sample, from the theme's own definition. */
function sampleStyle(definition: ThemeDefinition) {
  const hue = effectiveHue(definition, definition.hue ?? 0);
  const neutralHue = definition.neutral.hue === 'accent' ? hue : definition.neutral.hue;
  const palette = definition.fixedHues ?? [hue, hue + 120, hue + 240];
  const glow = (h: number, l: number) => `oklch(${l} 0.14 ${h})`;
  const glowStrength = definition.background === 'none' ? 0 : 30;
  const mix = (color: string) => `color-mix(in oklab, ${color} ${glowStrength}%, transparent)`;
  const neutral = definition.accentChroma.dark === 0;
  return {
    '--tile-nh': String(neutralHue),
    '--tile-h': String(hue),
    '--tile-nc-dark': String(definition.neutral.chroma.dark),
    '--tile-nc-light': String(definition.neutral.chroma.light),
    '--tile-lift-dark': String(definition.neutral.lift?.dark ?? 0),
    '--tile-lift-light': String(definition.neutral.lift?.light ?? 0),
    '--tile-tint': String(definition.neutral.tint ?? 0.3),
    '--tile-ac-dark': String(definition.accentChroma.dark),
    '--tile-ac-light': String(definition.accentChroma.light),
    '--tile-al-dark': neutral ? '0.93' : '0.68',
    '--tile-al-light': neutral ? '0.2' : '0.55',
    '--tile-radius': `${Math.round(definition.radius * 8)}px`,
    '--tile-bg-a': mix(glow(palette[0]!, 0.74)),
    '--tile-bg-b': mix(glow(palette[1]!, 0.62)),
    '--tile-bg-c': mix(glow(palette[2]!, 0.76)),
  };
}

export function AppearanceSettings() {
  const [advanced, setAdvanced] = createSignal(false);
  const glassy = () => setting('theme_style') !== 'flat';
  const frosted = () => setting('theme_style') === 'frosted';
  const effects = supportedWindowEffects;
  const definition = () => themeDefinition(setting('theme_id'));
  const choose = (preset: (typeof themePresets)[number]) => {
    // Colour mode and window effect are launcher-wide: a preset never changes them.
    for (const [key, value] of Object.entries(presetUpdates(preset.definition)))
      updateSetting(key as Parameters<typeof updateSetting>[0], value as never);
    flushSettings();
  };
  const hue = () => setting('theme_primary_hue');

  return (
    <>
      <Card title={t('prefs.appearance.theme')}>
        <ul data-vesta="prefs-themes">
          <For each={themePresets}>
            {(preset) => (
              <li>
                <button
                  type="button"
                  data-vesta="prefs-theme"
                  data-theme={preset.id}
                  aria-pressed={definition().id === preset.id ? 'true' : 'false'}
                  style={sampleStyle(preset.definition)}
                  onClick={() => choose(preset)}
                >
                  <span data-vesta="prefs-theme-swatch" aria-hidden="true">
                    <span data-vesta="prefs-theme-sample-surface" />
                    <span data-vesta="prefs-theme-sample-accent" />
                    <Show when={definition().id === preset.id}>
                      <span data-vesta="prefs-theme-check" title={t('prefs.appearance.theme-selected')}>
                        <Icon name="icons/controls/check" size={12} />
                      </span>
                    </Show>
                  </span>
                  <span data-vesta="prefs-theme-name">{preset.name}</span>
                </button>
              </li>
            )}
          </For>
        </ul>
      </Card>

      <Card title={t('prefs.appearance.colour')}>
        <SettingRow label={t('prefs.appearance.color-mode')}>
          <SegmentedControl
            size="sm"
            aria-label={t('prefs.appearance.color-mode')}
            value={setting('theme')}
            onChange={(value) => updateSetting('theme', value as never)}
            options={[
              { value: 'system', label: t('prefs.appearance.mode-system') },
              { value: 'light', label: t('prefs.appearance.mode-light') },
              { value: 'dark', label: t('prefs.appearance.mode-dark') },
            ]}
          />
        </SettingRow>
        <Show when={definition().hueAdjustable}>
          <SettingRow label={t('prefs.appearance.hue')} description={t('prefs.appearance.hue-description')}>
            <div data-vesta="prefs-slider" class="prefs-hue">
              <Slider
                onChangeEnd={flushSettings}
                size="sm"
                aria-label={t('prefs.appearance.hue')}
                min={0}
                max={360}
                step={1}
                showValue
                value={[hue()]}
                onChange={([value]) => {
                  updateSetting('theme_primary_hue', value);
                }}
              />
            </div>
          </SettingRow>
        </Show>
      </Card>

      <Card title={t('prefs.appearance.material')}>
        <SettingRow
          label={t('prefs.appearance.window-effect')}
          description={t('prefs.appearance.window-effect-description')}
        >
          <Select
            size="sm"
            aria-label={t('prefs.appearance.window-effect')}
            value={
              effects().includes(setting('theme_window_effect') as never) ? setting('theme_window_effect') : 'none'
            }
            onChange={(value) => updateSetting('theme_window_effect', value)}
            options={effects().map((effect) => ({
              value: effect,
              label: t(`prefs.appearance.effect-${effect.replaceAll('_', '-')}` as never),
            }))}
          />
        </SettingRow>
        <Show when={!glassy() && effects().length > 1}>
          <p data-vesta="prefs-material-note">{t('prefs.appearance.window-effect-flat-note')}</p>
        </Show>
      </Card>

      <Card title={t('prefs.appearance.surfaces')}>
        <SettingRow label={t('prefs.appearance.style')}>
          <SegmentedControl
            size="sm"
            aria-label={t('prefs.appearance.style')}
            value={setting('theme_style')}
            onChange={(value) => updateSetting('theme_style', value as never)}
            options={[
              { value: 'glass', label: t('prefs.appearance.style-glass') },
              { value: 'frosted', label: t('prefs.appearance.style-frosted') },
              { value: 'flat', label: t('prefs.appearance.style-flat') },
            ]}
          />
        </SettingRow>
      </Card>

      <Card
        title={t('prefs.appearance.advanced')}
        action={
          <Button
            size="sm"
            variant="ghost"
            aria-expanded={advanced() ? 'true' : 'false'}
            onClick={() => setAdvanced(!advanced())}
            icon={<Icon name={advanced() ? 'icons/controls/chevron-up' : 'icons/controls/chevron-down'} />}
          >
            {advanced() ? t('prefs.hide') : t('prefs.show')}
          </Button>
        }
      >
        <Show when={advanced()}>
          <Reveal>
            <Show when={glassy()}>
              <SettingRow label={t('prefs.appearance.translucency')}>
                <div data-vesta="prefs-slider">
                  <Slider
                    onChangeEnd={flushSettings}
                    size="sm"
                    aria-label={t('prefs.appearance.translucency')}
                    min={0}
                    max={100}
                    step={1}
                    showValue
                    getValueLabel={([v]) => `${v}%`}
                    value={[setting('theme_translucency')]}
                    onChange={([value]) => updateSetting('theme_translucency', value)}
                  />
                </div>
              </SettingRow>
            </Show>
            <Show when={frosted()}>
              <SettingRow label={t('prefs.appearance.grain')}>
                <div data-vesta="prefs-slider">
                  <Slider
                    onChangeEnd={flushSettings}
                    size="sm"
                    aria-label={t('prefs.appearance.grain')}
                    min={0}
                    max={100}
                    step={1}
                    showValue
                    getValueLabel={([v]) => `${v}%`}
                    value={[setting('theme_grain')]}
                    onChange={([value]) => updateSetting('theme_grain', value)}
                  />
                </div>
              </SettingRow>
            </Show>
            <Show when={definition().background !== 'none'}>
              <ToggleRow
                label={t('prefs.appearance.gradient')}
                checked={setting('theme_gradient_enabled')}
                onChange={(value) => updateSetting('theme_gradient_enabled', value)}
              />
              <Show when={setting('theme_gradient_enabled')}>
                <SettingRow label={t('prefs.appearance.gradient-type')}>
                  <SegmentedControl
                    size="sm"
                    aria-label={t('prefs.appearance.gradient-type')}
                    value={setting('theme_gradient_type')}
                    onChange={(value) => updateSetting('theme_gradient_type', value as never)}
                    options={[
                      { value: 'linear', label: t('prefs.appearance.linear') },
                      {
                        value: 'radial',
                        label: t('prefs.appearance.circular'),
                      },
                    ]}
                  />
                </SettingRow>
                <SettingRow label={t('prefs.appearance.rotation')}>
                  <div data-vesta="prefs-slider">
                    <Slider
                      onChangeEnd={flushSettings}
                      size="sm"
                      aria-label={t('prefs.appearance.rotation')}
                      min={0}
                      max={360}
                      step={1}
                      showValue
                      getValueLabel={([v]) => `${v}°`}
                      value={[setting('theme_gradient_angle')]}
                      onChange={([value]) => updateSetting('theme_gradient_angle', value)}
                    />
                  </div>
                </SettingRow>
                <Show when={!definition().fixedHues}>
                  <SettingRow label={t('prefs.appearance.harmony')}>
                    <Select
                      size="sm"
                      aria-label={t('prefs.appearance.harmony')}
                      value={setting('theme_gradient_harmony')}
                      onChange={(value) => updateSetting('theme_gradient_harmony', value as never)}
                      options={[
                        {
                          value: 'none',
                          label: t('prefs.appearance.harmony-none'),
                        },
                        {
                          value: 'complementary',
                          label: t('prefs.appearance.harmony-complement'),
                        },
                        {
                          value: 'analogous',
                          label: t('prefs.appearance.harmony-analogous'),
                        },
                        {
                          value: 'triadic',
                          label: t('prefs.appearance.harmony-triadic'),
                        },
                      ]}
                    />
                  </SettingRow>
                </Show>
              </Show>
            </Show>
            <SettingRow label={t('prefs.appearance.border')} description={t('prefs.appearance.border-description')}>
              <div data-vesta="prefs-slider">
                <Slider
                  onChangeEnd={flushSettings}
                  size="sm"
                  aria-label={t('prefs.appearance.border')}
                  min={0}
                  max={6}
                  step={0.5}
                  showValue
                  getValueLabel={([v]) => `${v}px`}
                  value={[setting('theme_border_width')]}
                  onChange={([value]) => updateSetting('theme_border_width', value)}
                />
              </div>
            </SettingRow>
          </Reveal>
        </Show>
      </Card>
    </>
  );
}
