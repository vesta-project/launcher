// Starting points for a new workflow: the toolbar's "New workflow" menu and the suggestions
// shown where the list would be when a server has no workflows yet.
import { Button, MenuItem, MenuSeparator } from '@vesta/ui';
import { For, Show } from 'solid-js';
import { EmptyState } from '../../../components/empty-state';
import { Icon } from '../../../components/icon';
import { t } from '../../../localization';
import type { MessageId } from '../../../localization/messages';
import { TEMPLATES, type TemplateId } from '../../../features/servers/automation-model';

export const templateLabels: Record<TemplateId, { name: MessageId; description: MessageId; icon: string }> = {
  'nightly-backup': { name: 'server-automation.template-nightly', description: 'server-automation.template-nightly-help', icon: 'icons/content/storage' },
  'restart-every': { name: 'server-automation.template-restart', description: 'server-automation.template-restart-help', icon: 'icons/actions/reload' },
  'announce-join': { name: 'server-automation.template-announce', description: 'server-automation.template-announce-help', icon: 'icons/content/chat' },
  'clean-trash-weekly': { name: 'server-automation.template-clean-trash', description: 'server-automation.template-clean-trash-help', icon: 'icons/actions/delete' },
  blank: { name: 'server-automation.template-blank', description: 'server-automation.template-blank-help', icon: 'icons/actions/add' },
};

const SUGGESTED = TEMPLATES.filter((id) => id !== 'blank');

/** Template entries for a `Menu`, with "Blank workflow" set apart at the end. */
export function TemplateMenuItems(props: { onPick: (template: TemplateId) => void }) {
  return (
    <For each={TEMPLATES}>
      {(template) => (
        <>
          <Show when={template === 'blank'}><MenuSeparator /></Show>
          <MenuItem icon={<Icon name={templateLabels[template].icon} />} onSelect={() => props.onPick(template)}>
            <span data-vesta="server-automation-template">
              <span>{t(templateLabels[template].name)}</span>
              <small>{t(templateLabels[template].description)}</small>
            </span>
          </MenuItem>
        </>
      )}
    </For>
  );
}

/**
 * No workflows yet: what automation is for, then concrete starting points in place of the
 * list. People who can't create workflows are told who can instead.
 */
export function AutomationEmpty(props: { canManage: boolean; busy: boolean; onPick: (template: TemplateId) => void }) {
  return (
    <EmptyState
      variant="inline"
      icon="icons/content/timer"
      title={t('server-automation.empty-title')}
      description={t(props.canManage ? 'server-automation.empty-description' : 'server-automation.empty-view-only')}
      suggestionsLabel={props.canManage ? t('server-automation.templates') : undefined}
      suggestions={props.canManage ? SUGGESTED.map((template) => ({
        label: t(templateLabels[template].name),
        description: t(templateLabels[template].description),
        icon: templateLabels[template].icon,
        disabled: props.busy,
        onSelect: () => props.onPick(template),
      })) : undefined}
    >
      <Show when={props.canManage}>
        <Button variant="outline" icon={<Icon name="icons/actions/add" />} disabled={props.busy} onClick={() => props.onPick('blank')}>{t('server-automation.start-scratch')}</Button>
      </Show>
    </EmptyState>
  );
}
