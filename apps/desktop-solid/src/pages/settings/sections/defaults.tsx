import { Button, NumberField, SegmentedControl, Slider, TextArea } from '@vesta/ui';
import { Show } from 'solid-js';
import { Icon } from '../../../components/icon';
import { SettingRow } from '../../../components/setting-row';
import { configDefaults, setting, updateSetting } from '../../../features/settings/config';
import { systemMemory } from '../../../features/settings/resources';
import { t } from '../../../localization';
import { Callout, Card } from '../parts';

const formatGb = (mb: number) => `${(mb / 1024).toFixed(mb % 1024 ? 1 : 0)} GB`;

/** Defaults every instance inherits until it is set to Custom in its own settings. */
export function DefaultsSettings() {
  const ram = () => systemMemory.data();
  const high = () => setting('default_max_memory') > ram() * 0.75;
  const actions = [
    {
      value: 'stay-open',
      label: t('prefs.defaults.action-stay'),
      icon: 'icons/rail/library',
    },
    {
      value: 'minimize',
      label: t('prefs.defaults.action-minimize'),
      icon: 'icons/controls/minus',
    },
    {
      value: 'hide-to-tray',
      label: t('prefs.defaults.action-tray'),
      icon: 'icons/content/monitor',
    },
    {
      value: 'quit',
      label: t('prefs.defaults.action-quit'),
      icon: 'icons/actions/close',
    },
  ];
  return (
    <>
      <Card
        title={t('prefs.defaults.window')}
        description={t('prefs.defaults.window-description')}
        action={
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              updateSetting('default_width', configDefaults.default_width);
              updateSetting('default_height', configDefaults.default_height);
            }}
          >
            {t('prefs.reset')}
          </Button>
        }
      >
        <SettingRow label={t('prefs.defaults.resolution')} description={t('prefs.defaults.resolution-description')}>
          <div data-vesta="prefs-resolution">
            <NumberField
              aria-label={t('prefs.defaults.width')}
              min={0}
              value={setting('default_width')}
              onChange={(value) => updateSetting('default_width', value)}
            />
            <span aria-hidden="true">×</span>
            <NumberField
              aria-label={t('prefs.defaults.height')}
              min={0}
              value={setting('default_height')}
              onChange={(value) => updateSetting('default_height', value)}
            />
            <span data-vesta="prefs-unit">px</span>
          </div>
        </SettingRow>
      </Card>

      <Card title={t('prefs.defaults.memory')} description={t('prefs.defaults.memory-description')}>
        <div data-vesta="prefs-memory">
          <Slider
            label={t('prefs.defaults.allocation')}
            min={512}
            max={Math.max(ram(), 4096)}
            step={512}
            minStepsBetweenThumbs={1}
            value={[setting('default_min_memory'), setting('default_max_memory')]}
            onChange={([low, high]) => {
              updateSetting('default_min_memory', low);
              updateSetting('default_max_memory', high);
            }}
            getValueLabel={([low, high]) => `${formatGb(low)} – ${formatGb(high)}`}
          />
          <div data-vesta="prefs-memory-scale">
            <span>512 MB</span>
            <span>{t('prefs.defaults.installed', { amount: formatGb(ram()) })}</span>
          </div>
          <dl data-vesta="prefs-readout">
            <div>
              <dt>{t('prefs.defaults.start')}</dt>
              <dd>{setting('default_min_memory')} MB</dd>
            </div>
            <div>
              <dt>{t('prefs.defaults.limit')}</dt>
              <dd>{setting('default_max_memory')} MB</dd>
            </div>
          </dl>
        </div>
        <Show when={high()}>
          <Callout tone="warning">{t('prefs.defaults.memory-warning')}</Callout>
        </Show>
      </Card>

      <Card title={t('prefs.defaults.after-launch')} description={t('prefs.defaults.after-launch-description')}>
        <div data-vesta="prefs-block">
          <SegmentedControl
            fill
            aria-label={t('prefs.defaults.after-launch')}
            value={setting('default_launcher_action_on_launch')}
            onChange={(value) => updateSetting('default_launcher_action_on_launch', value as never)}
            options={actions.map((action) => ({
              value: action.value,
              label: action.label,
              icon: <Icon name={action.icon} size={14} />,
            }))}
          />
        </div>
      </Card>

      <Card title={t('prefs.defaults.launch')}>
        <div data-vesta="prefs-block">
          <TextArea
            label={t('prefs.defaults.java-args')}
            description={t('prefs.defaults.java-args-description')}
            placeholder="-XX:+UseG1GC -XX:MaxGCPauseMillis=50"
            rows={3}
            value={setting('default_java_args') ?? ''}
            onChange={(value) => updateSetting('default_java_args', value.trim() ? value : null)}
          />
          <TextArea
            label={t('prefs.defaults.environment')}
            description={t('prefs.defaults.environment-description')}
            placeholder={'KEY=value\nOTHER_KEY=value'}
            rows={4}
            value={setting('default_environment_variables') ?? ''}
            onChange={(value) => updateSetting('default_environment_variables', value.trim() ? value : null)}
          />
        </div>
      </Card>
    </>
  );
}
