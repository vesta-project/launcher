import { Button, Checkbox, Dialog, Select, toast } from '@vesta/ui';
import { Show, createMemo, createSignal, untrack } from 'solid-js';
import { Icon } from '../../../components/icon';
import { sourceById } from '../../../features/browse/browse-model';
import { loadVersions, peekVersions } from '../../../features/browse/browse-projects';
import { IntentMemo } from '../../../features/servers/model';
import { clearModpackPick, type ModpackPick } from '../../../features/servers/modpack-handoff';
import { pickProviderVersion } from '../../../features/servers/modpack-area-model';
import type { ServerCommandError } from '../../../features/servers/native';
import { serverCommand } from '../../../features/servers/store';
import { t } from '../../../localization';
import { ServerErrorNote } from '../parts';
import { useModpackArea } from './area';

/**
 * A modpack chosen in Browse for this server: link it as the server's modpack (a provider
 * pointer; nothing is hosted) and/or install it on the server through the reviewed plan.
 */
export function ProviderPickDialog(props: { pick: ModpackPick }) {
  const area = useModpackArea();
  const [versionId, setVersionId] = createSignal<string | null>(untrack(() => props.pick.versionId), { name: 'modpack-pick:version' });
  const [useAsModpack, setUseAsModpack] = createSignal(true, { name: 'modpack-pick:assign' });
  const [install, setInstall] = createSignal(area.gates().installOnServer, { name: 'modpack-pick:install' });
  const [busy, setBusy] = createSignal(false, { name: 'modpack-pick:busy' });
  const [error, setError] = createSignal<ServerCommandError | null>(null, { name: 'modpack-pick:error' });
  const intents = new IntentMemo();
  untrack(() => void loadVersions(props.pick.provider, props.pick.projectId).catch(() => {}));
  const versions = () => peekVersions(props.pick.provider, props.pick.projectId) ?? [];
  const chosen = createMemo(() => versionId() ?? pickProviderVersion(versions(), area.workspace()?.serverMinecraftVersion ?? '')?.id ?? null, { name: 'modpack-pick:chosen' });
  const close = () => clearModpackPick(props.pick.serverId);

  const go = async () => {
    const id = chosen();
    const workspace = area.workspace();
    if (!id || !workspace) return;
    const ref = { provider: props.pick.provider, projectId: props.pick.projectId, versionId: id };
    if (install()) {
      close();
      area.startInstall({ source: { source: 'provider', ...ref }, name: props.pick.name, setAsModpack: useAsModpack() });
      return;
    }
    setBusy(true); setError(null);
    const request = { ...ref, expectedRevision: workspace.publishedRevision, draftRevision: workspace.draft.revision, requiredUpdate: false, acknowledgeLowerVersion: false };
    try {
      await serverCommand((api) => api.packProviderPublish(area.id(), request, intents.idFor(request)));
      intents.settle();
      close();
      toast.show({ title: t('server-pack.linked', { name: props.pick.name }), tone: 'success' });
      await area.reload();
    } catch (reason) { intents.settle(reason as ServerCommandError); setError(reason as ServerCommandError); }
    finally { setBusy(false); }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy()) close(); }} closeLabel={t('nav.close')} size="md"
      title={t('server-pack.pick-title', { name: props.pick.name, title: area.snapshot().connection.name })}
      description={t('server-pack.pick-description', { provider: sourceById(props.pick.provider).label })}
      footer={<>
        <Button variant="ghost" disabled={busy()} onClick={close}>{t('common.cancel')}</Button>
        <Button tone="accent" disabled={busy() || !chosen() || (!install() && !useAsModpack())} onClick={() => void go()}>
          {t(install() ? 'server-pack.pick-review-install' : 'server-pack.pick-link')}
        </Button>
      </>}>
      <div data-vesta="modpack-pick">
        <div data-vesta="modpack-card-head">
          <Show when={props.pick.iconUrl} fallback={<span data-vesta="modpack-choice-icon"><Icon name="icons/content/modpack" size={18} /></span>}>
            {(src) => <img src={src()} alt="" width={40} height={40} />}
          </Show>
          <div>
            <p data-vesta="modpack-eyebrow"><Icon name={sourceById(props.pick.provider).icon} size={11} /> {sourceById(props.pick.provider).label}</p>
            <h3>{props.pick.name}</h3>
          </div>
        </div>
        <Select size="sm" label={t('server-pack.pick-version')} value={chosen() ?? undefined} onChange={setVersionId} placeholder={t('server-pack.loading-versions')}
          options={versions().map((version) => ({
            value: version.id, label: version.version_number,
            description: `${version.game_versions.slice(0, 3).join(', ')} · ${version.loaders.join(', ')}`,
          }))} />
        <Checkbox size="sm" checked={useAsModpack()} onChange={setUseAsModpack} disabled={busy()}
          label={t('server-pack.pick-assign', { title: area.snapshot().connection.name })} description={t('server-pack.pick-assign-help')} />
        <Show when={area.gates().installOnServer}>
          <Checkbox size="sm" checked={install()} onChange={setInstall} disabled={busy()}
            label={t('server-pack.also-install')} description={t('server-pack.also-install-help')} />
        </Show>
        <ServerErrorNote error={error()} />
      </div>
    </Dialog>
  );
}
