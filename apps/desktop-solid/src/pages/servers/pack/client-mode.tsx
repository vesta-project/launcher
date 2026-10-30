import { Badge, Button, Switch, toast } from '@vesta/ui';
import { For, Show, createSignal } from 'solid-js';
import { Icon } from '../../../components/icon';
import { sourceById } from '../../../features/browse/browse-model';
import { clientModeOptions, linkSourceKind, linkSourceLabel, type ClientModeNote, type ClientPackMode } from '../../../features/servers/modpack-area-model';
import type { ServerCommandError } from '../../../features/servers/native';
import { t } from '../../../localization';
import type { MessageId } from '../../../localization/messages';
import { ServerErrorNote } from '../parts';
import { useModpackArea } from './area';

const modeCopy: Record<ClientPackMode, { icon: string; title: MessageId; description: MessageId }> = {
  none: { icon: 'icons/actions/close', title: 'server-pack.mode-none', description: 'server-pack.mode-none-description' },
  'server-modpack': { icon: 'icons/content/server', title: 'server-pack.mode-server', description: 'server-pack.mode-server-description' },
  custom: { icon: 'icons/content/modpack', title: 'server-pack.mode-custom', description: 'server-pack.mode-custom-description' },
};

const noteCopy: Record<ClientModeNote, MessageId> = {
  'coming-soon': 'server-pack.mode-coming-soon',
  'needs-link': 'server-pack.mode-needs-link',
  'no-permission': 'server-pack.mode-no-permission',
};

/**
 * What players get, chosen independently of the server's own modpack. A pick is staged here
 * and saved explicitly; switching away from Custom keeps the custom workspace intact.
 */
export function ClientModePanel() {
  const area = useModpackArea();
  const [choice, setChoice] = createSignal<ClientPackMode | null>(null, { name: 'modpack-client:choice' });
  const [requireUpdate, setRequireUpdate] = createSignal<boolean | null>(null, { name: 'modpack-client:require' });
  const [busy, setBusy] = createSignal(false, { name: 'modpack-client:busy' });
  const [error, setError] = createSignal<ServerCommandError | null>(null, { name: 'modpack-client:error' });
  const options = () => clientModeOptions(area.workspace(), area.gates());
  const selected = () => choice() ?? area.clientMode();
  const required = () => requireUpdate() ?? area.workspace()?.clientPack?.requireUpdate ?? false;
  const [custom, setCustom] = createSignal<boolean | null>(null);
  const allowCustom = () => custom() ?? area.workspace()?.clientPack?.allowCustomContent ?? false;
  const dirty = () => allowCustom() !== (area.workspace()?.clientPack?.allowCustomContent ?? false) || selected() !== area.clientMode() || (selected() === 'server-modpack' && required() !== (area.workspace()?.clientPack?.requireUpdate ?? false));
  const linkName = () => {
    const source = area.link().source;
    if (!source) return '';
    const kind = linkSourceKind(source);
    return area.linkProject()?.name ?? (kind === 'upload' || kind === 'vesta' ? t(linkSourceLabel[kind]) : sourceById(kind).label);
  };
  const hasCustom = () => (area.workspace()?.publishedRevision ?? '0') !== '0';

  const reset = () => { setChoice(null); setRequireUpdate(null); setCustom(null); setError(null); };
  const save = async () => {
    setBusy(true); setError(null);
    try {
      await area.setClientMode(selected(), required(), allowCustom());
      reset();
      toast.show({ title: t('server-pack.mode-saved'), tone: 'success' });
    } catch (reason) { setError(reason as ServerCommandError); }
    finally { setBusy(false); }
  };

  const consequence = (): MessageId => {
    if (selected() === 'none') return hasCustom() ? 'server-pack.mode-change-none-kept' : 'server-pack.mode-change-none';
    if (selected() === 'custom') return hasCustom() ? 'server-pack.mode-change-custom' : 'server-pack.mode-change-custom-new';
    return 'server-pack.mode-change-server';
  };

  return (
    <section data-vesta="modpack-panel" data-panel="client-mode">
      <header data-vesta="modpack-panel-head">
        <h3>{t('server-pack.client-title')}</h3>
        <Badge size="sm" variant="soft" tone="neutral">{t('server-pack.optional')}</Badge>
      </header>
      <div data-vesta="modpack-panel-body">
        <p data-vesta="server-muted">{t('server-pack.client-description')}</p>
        <div data-vesta="modpack-modes" role="radiogroup" aria-label={t('server-pack.client-title')}>
          <For each={options()}>
            {(option) => {
              const copy = modeCopy[option.id];
              const current = () => area.clientMode() === option.id;
              return (
                <label data-vesta="modpack-mode" data-mode={option.id} data-selected={selected() === option.id ? '' : undefined}
                  data-disabled={!option.enabled && !current() ? '' : undefined}>
                  <input type="radio" name={`modpack-client-${area.id()}`} value={option.id} checked={selected() === option.id}
                    disabled={busy() || (!option.enabled && !current())} onChange={() => { setChoice(option.id); setError(null); }} />
                  <span data-vesta="modpack-mode-icon" aria-hidden="true"><Icon name={copy.icon} size={16} /></span>
                  <span data-vesta="modpack-mode-copy">
                    <span data-vesta="modpack-mode-title">
                      {t(copy.title)}
                      <Show when={current()}><Badge size="sm" variant="soft" tone="accent">{t('server-pack.mode-current')}</Badge></Show>
                      <Show when={option.note === 'coming-soon'}><Badge size="sm" variant="outline" tone="neutral">{t('server-pack.coming-soon')}</Badge></Show>
                    </span>
                    <span data-vesta="modpack-mode-description">
                      {option.id === 'server-modpack' && area.link().source ? t('server-pack.mode-server-linked', { name: linkName() }) : t(copy.description)}
                    </span>
                    <Show when={option.note && option.note !== 'coming-soon' ? option.note : undefined}>
                      {(note) => <span data-vesta="modpack-mode-note">{t(noteCopy[note()])}</span>}
                    </Show>
                    <Show when={option.note === 'coming-soon'}>
                      <span data-vesta="modpack-mode-note">{t('server-pack.mode-coming-soon')}</span>
                    </Show>
                  </span>
                </label>
              );
            }}
          </For>
        </div>
        <Show when={area.clientMode() === 'server-modpack' && options().find((option) => option.id === 'server-modpack')?.note === 'coming-soon'}>
          <p data-vesta="server-callout" data-tone="warning" role="status">{t('server-pack.mode-server-not-live')}</p>
        </Show>
        <Show when={selected() === 'server-modpack' && options().find((option) => option.id === 'server-modpack')?.enabled}>
          <Switch size="sm" checked={required()} onChange={setRequireUpdate} disabled={busy() || !area.gates().forceUpdate}
            label={t('server-pack.mode-require-update')} description={t('server-pack.mode-require-update-help')} />
        </Show>
        <Switch size="sm" checked={allowCustom()} onChange={setCustom} disabled={busy()} label="Allow players to add mods" />
        <Show when={dirty()}>
          <div data-vesta="modpack-mode-save" role="status">
            <span>{t(consequence(), { name: linkName() })}</span>
            <span data-vesta="modpack-inline-actions">
              <Button size="sm" variant="ghost" disabled={busy()} onClick={reset}>{t('common.cancel')}</Button>
              <Button size="sm" tone="accent" disabled={busy()} onClick={() => void save()}>{t('server-pack.mode-save')}</Button>
            </span>
          </div>
        </Show>
        <ServerErrorNote error={error()} />
      </div>
    </section>
  );
}
