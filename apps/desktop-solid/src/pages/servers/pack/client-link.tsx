import { Button, Dialog, IconButton, Menu, MenuItem, Select } from '@vesta/ui';
import { For, Show, createEffect, createMemo, createSignal } from 'solid-js';
import { Icon } from '../../../components/icon';
import { projectPath, sourceById } from '../../../features/browse/browse-model';
import { initials, serverArt } from '../../../features/servers/art';
import { browseForServer } from '../../../features/browse/browse-store';
import { loadVersions, peekProject, peekVersions, prefetchProject } from '../../../features/browse/browse-projects';
import { IntentMemo } from '../../../features/servers/model';
import type { PackImport } from '../../../features/servers/native-pack';
import type { ServerCommandError } from '../../../features/servers/native';
import { serverCommand } from '../../../features/servers/store';
import { t } from '../../../localization';
import { ServerErrorNote } from '../parts';
import { useModpackArea } from './area';
import { ModpackLinkCard } from './link-card';

export function ClientModpackPanel() {
  const area = useModpackArea();
  const link = createMemo(() => area.workspace()?.draft.manifest.modpackLink, {
    name: 'client-link:source',
    equals: (a, b) => a?.provider === b?.provider && a?.projectId === b?.projectId && a?.versionId === b?.versionId,
  });
  const [unlinking, setUnlinking] = createSignal(false, { name: 'client-link:unlinking' });
  const [choice, setChoice] = createSignal<'keep_everything' | 'keep_resources' | 'remove_everything'>('keep_everything', { name: 'client-link:choice' });
  const [busy, setBusy] = createSignal(false, { name: 'client-link:busy' });
  const [error, setError] = createSignal<ServerCommandError | null>(null, { name: 'client-link:error' });
  const intents = new IntentMemo();
  createEffect(link, value => { if (value) { prefetchProject(value.provider, value.projectId); void loadVersions(value.provider, value.projectId).catch(() => {}); } }, { name: 'client-link:versions' });
  const run = async (request: PackImport) => {
    if (busy()) return;
    setBusy(true); setError(null);
    try { const draft = await serverCommand(api => api.packImport(area.id(), request, intents.idFor(request))); intents.settle(); area.applyDraft(draft); setUnlinking(false); }
    catch (reason) { intents.settle(reason as ServerCommandError); setError(reason as ServerCommandError); }
    finally { setBusy(false); }
  };
  const versions = () => {
    const current = link();
    if (!current) return [];
    const releases = peekVersions(current.provider, current.projectId) ?? [];
    const rows = releases.filter(v => v.game_versions.includes(area.workspace()!.serverMinecraftVersion)).map(v => ({ value: v.id, label: v.version_number }));
    return rows.some(v => v.value === current.versionId) ? rows : [{ value: current.versionId, label: releases.find(v => v.id === current.versionId)?.version_number ?? current.versionId }, ...rows];
  };
  const browse = () => browseForServer({ id: area.id(), name: area.snapshot().connection.name, type: 'modpack', destination: 'modpack', minecraftVersion: area.workspace()!.serverMinecraftVersion, loader: null });
  return <>
      <Show when={link()} fallback={<Button size="sm" variant="outline" disabled={!area.gates().edit} onClick={browse}>{t('server-pack.client-link-use')}</Button>}>
        {value => {
          const project = () => peekProject(value().provider, value().projectId);
          const name = () => project()?.name ?? value().projectId;
          const version = () => peekVersions(value().provider, value().projectId)?.find(v => v.id === value().versionId)?.version_number ?? value().versionId;
          return <ModpackLinkCard phase="installed" path={projectPath(value().provider, value().projectId)}
            icon={project()?.icon_url ?? serverArt(`${value().provider}:${value().projectId}`, initials(name()))}
            name={name()} source={value().provider} sourceName={sourceById(value().provider).label}
            metadata={<><span>{t('server-pack.link-installed', { version: version() })}</span><span>{t('server-pack.minecraft', { version: area.workspace()!.serverMinecraftVersion })}</span></>}
            actions={<>
          <span data-vesta="pack-current"><Icon name="icons/controls/check" size={12} />{t('server-pack.client-link-title')}</span>
          <Select size="sm" aria-label={t('server-pack.pick-version')} style={{ width: '180px' }} value={value().versionId} disabled={busy() || !area.gates().edit}
            options={versions()}
            onChange={versionId => { if (versionId !== value().versionId) void run({ source: 'provider', expectedRevision: area.workspace()!.draft.revision, provider: value().provider, projectId: value().projectId, versionId }); }} />
          <Menu placement="bottom-end" trigger={menuProps => <IconButton {...menuProps} size="sm" variant="ghost" label={t('server-pack.link-actions')} icon={<Icon name="icons/controls/ellipsis-horizontal" size={16} />} />}>
            <MenuItem tone="danger" icon={<Icon name="icons/actions/close" />} disabled={busy() || !area.gates().edit} onSelect={() => setUnlinking(true)}>{t('server-pack.unlink')}</MenuItem>
          </Menu>
            </>}
          />;
        }}
      </Show>
      <ServerErrorNote error={error()} />
    <Dialog open={unlinking()} onOpenChange={open => { if (!busy()) setUnlinking(open); }} closeLabel={t('nav.close')} size="sm"
      title={t('server-pack.client-link-unlink')} description={t('server-pack.client-link-help')}
      footer={<><Button variant="ghost" disabled={busy()} onClick={() => setUnlinking(false)}>{t('common.cancel')}</Button><Button tone="danger" disabled={busy()} onClick={() => void run({ source: 'unlink', expectedRevision: area.workspace()!.draft.revision, choice: choice() })}>{t('server-pack.unlink')}</Button></>}>
      <div data-vesta="modpack-modes" role="radiogroup" aria-label={t('server-pack.client-link-unlink')}>
        <For each={[
          { id: 'keep_everything' as const, label: 'server-pack.client-link-keep' as const },
          { id: 'keep_resources' as const, label: 'server-pack.client-link-resources' as const },
          { id: 'remove_everything' as const, label: 'server-pack.client-link-remove' as const },
        ]}>{option => <label data-vesta="modpack-mode" data-selected={choice() === option.id ? '' : undefined}><input type="radio" name="client-pack-unlink" checked={choice() === option.id} disabled={busy()} onChange={() => setChoice(option.id)} /><span data-vesta="modpack-mode-copy"><strong>{t(option.label)}</strong></span></label>}</For>
      </div><ServerErrorNote error={error()} />
    </Dialog>
  </>;
}
