import { Skeleton } from '@vesta/ui';
import { Show } from 'solid-js';
import { SettingRow } from '../../../components/setting-row';
import { t } from '../../../localization';
import { stableConnectionId } from '../../../features/servers/connection-id';
import type { ServerSnapshot } from '../../../features/servers/native';
import { useServerResource } from '../../../features/servers/resources';
import { worldResource } from '../../../features/servers/server-resources';
import { CopyValue, SettingsPage, SettingsPanel } from '../settings-parts';
import { HostingError } from './parts';
import './hosting.css';

/** Settings → World: the world Minecraft loads and its seed. */
export function WorldSection(props: { snapshot: ServerSnapshot }) {
  const id = stableConnectionId(() => props.snapshot);
  const world = useServerResource(id, worldResource);

  return (
    <SettingsPage>
      <SettingsPanel title={t('server-hosting.world')} description={t('server-hosting.world-help')} name="world">
        <HostingError error={world.error()} onRetry={() => void world.refresh()} />
        <Show when={world.value()} fallback={<Show when={!world.error()}><Skeleton height={132} radius={0} /></Show>}>
          {(current) => (
            <div data-vesta="settings-panel-body">
              <SettingRow label={t('server-hosting.world-name')}>
                <span data-vesta="server-setting-value">{current().name}</span>
              </SettingRow>
              <SettingRow label={t('server-hosting.seed')} description={t('server-hosting.seed-description')}>
                <Show when={current().seed} fallback={<span data-vesta="server-setting-value">{t('server-hosting.seed-pending')}</span>}>
                  {(seed) => <CopyValue value={seed()} label={t('server-hosting.copy-seed')} />}
                </Show>
              </SettingRow>
              <SettingRow label={t('server-hosting.configured-seed')} description={t('server-hosting.configured-seed-description')}>
                <span data-vesta="server-setting-value">{current().configuredSeed || t('server-hosting.seed-random')}</span>
              </SettingRow>
            </div>
          )}
        </Show>
      </SettingsPanel>

    </SettingsPage>
  );
}
