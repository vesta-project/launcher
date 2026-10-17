import { Select } from '@vesta/ui';
import { createMemo } from 'solid-js';
import { chooseTarget, targetId, type } from '../../features/browse/browse-store';
import { instances } from '../../features/instances/catalog';
import { t } from '../../localization';

/**
 * The instance installs go to. Picking one filters results by its version and loader and
 * makes Install go straight into it; "No instance" makes Install ask where. Modpacks always
 * create a new instance, so the control is disabled for them.
 */
export function TargetSelect(props: { class?: string }) {
  const options = createMemo(
    () => [
      { value: '', label: t('browse.no-instance') },
      ...instances().map((entry) => ({
        value: entry.instance.id,
        label: entry.instance.name,
        description: `${entry.instance.minecraftVersion} · ${entry.instance.modloader}`,
        icon: <img data-vesta="browse-target-icon" src={entry.instance.image} alt="" decoding="async" />,
      })),
    ],
    { name: 'browseTargetOptions' },
  );
  return (
    <Select
      size="sm"
      class={props.class}
      aria-label={t('browse.section-instance')}
      options={options()}
      value={type() === 'modpack' ? '' : (targetId() ?? '')}
      onChange={(value) => chooseTarget(value || undefined)}
      disabled={type() === 'modpack'}
    />
  );
}
