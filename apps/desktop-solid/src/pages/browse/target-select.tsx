import { Select } from '@vesta/ui';
import { createMemo } from 'solid-js';
import { Icon } from '../../components/icon';
import type { ResourceType } from '../../features/browse/browse-model';
import { chooseTarget, targetId, type } from '../../features/browse/browse-store';
import { instances } from '../../features/instances/catalog';
import { t } from '../../localization';

/**
 * The instance installs go to. Picking one scopes results to its version and loader and makes
 * Install go straight into it; "Any instance" makes Install ask where. Modpacks always create
 * a new instance, so the control is disabled for them.
 */
export function TargetSelect(props: {
  class?: string;
  'aria-label'?: string;
  /** The resource type being installed; defaults to the Browse type. */
  kind?: ResourceType;
  /** Replaces the default (route) change, e.g. on a project page that must stay put. */
  onChange?: (id: string | undefined) => void;
}) {
  const modpack = () => (props.kind ?? type()) === 'modpack';
  const options = createMemo(
    () => [
      {
        value: '',
        label: t('browse.no-instance'),
        icon: () => (
          <span data-vesta="browse-target-icon" data-empty="">
            <Icon name="icons/content/cube" size={12} />
          </span>
        ),
      },
      ...instances().map((entry) => ({
        value: entry.instance.id,
        label: entry.instance.name,
        description: `${entry.instance.minecraftVersion} · ${entry.instance.modloader}`,
        // A function: the list and the trigger each need their own <img>.
        icon: () => <img data-vesta="browse-target-icon" src={entry.instance.image} alt="" decoding="async" />,
      })),
    ],
    { name: 'browseTargetOptions' },
  );
  return (
    <Select
      size="sm"
      class={props.class}
      aria-label={props['aria-label'] ?? t('browse.section-instance')}
      options={options()}
      value={modpack() ? '' : (targetId() ?? '')}
      onChange={(value) => (props.onChange ?? chooseTarget)(value || undefined)}
      disabled={modpack()}
    />
  );
}
