import { Button, Dialog, Select } from '@vesta/ui';
import { Show, createMemo, createSignal, onCleanup, untrack } from 'solid-js';
import { Icon } from '../../../components/icon';
import { sourceById } from '../../../features/browse/browse-model';
import { loadVersions, peekVersions } from '../../../features/browse/browse-projects';
import { clearModpackPick, type ModpackPick } from '../../../features/servers/modpack-handoff';
import { linkProvider, pickProviderVersion } from '../../../features/servers/modpack-area-model';
import { t } from '../../../localization';
import { useModpackArea } from './area';

/**
 * A modpack chosen in Browse (or "Change version") for this server: pick the version, then the
 * link review installs its server-side content. Linking the same project again is an update.
 * What players get is a separate choice on Client pack.
 */
export function ProviderPickDialog(props: { pick: ModpackPick }) {
  const area = useModpackArea();
  const [versionId, setVersionId] = createSignal<string | null>(untrack(() => props.pick.versionId), { name: 'modpack-pick:version' });
  const [loading, setLoading] = createSignal(false, { name: 'modpack-pick:loading' });
  const [failed, setFailed] = createSignal(false, { name: 'modpack-pick:failed' });
  let disposed = false;
  onCleanup(() => { disposed = true; });
  const load = async () => {
    setLoading(true); setFailed(false);
    try { await loadVersions(props.pick.provider, props.pick.projectId); }
    catch { if (!disposed) setFailed(true); }
    finally { if (!disposed) setLoading(false); }
  };
  untrack(() => void load());
  const versions = () => peekVersions(props.pick.provider, props.pick.projectId) ?? [];
  const chosen = createMemo(() => versionId() ?? pickProviderVersion(versions(), area.workspace()?.serverMinecraftVersion ?? '')?.id ?? null, { name: 'modpack-pick:chosen' });
  const current = () => linkProvider(area.link().source);
  const sameProject = () => current()?.provider === props.pick.provider && current()?.projectId === props.pick.projectId;
  const replacing = () => area.link().phase !== 'unlinked' && !sameProject();
  const blocked = () => !area.gates().installOnServer ? 'server-pack.link-no-permission' as const : !area.link().canChange ? 'server-pack.link-wait-restart' as const : null;
  const close = () => clearModpackPick(props.pick.serverId);

  const go = () => {
    const id = chosen();
    if (!id || blocked()) return;
    close();
    area.openServer();
    area.startInstall({
      source: { source: 'provider', provider: props.pick.provider, projectId: props.pick.projectId, versionId: id },
      name: props.pick.name, mode: sameProject() ? 'update' : 'link',
    });
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) close(); }} closeLabel={t('nav.close')} size="md"
      title={t('server-pack.pick-title', { name: props.pick.name, title: area.snapshot().connection.name })}
      description={t('server-pack.pick-description', { provider: sourceById(props.pick.provider).label })}
      footer={<>
        <Button variant="ghost" onClick={close}>{t('common.cancel')}</Button>
        <Button tone="accent" disabled={!chosen() || !!blocked() || chosen() === current()?.versionId && sameProject()} onClick={go}>
          {t(sameProject() ? 'server-pack.pick-review-update' : 'server-pack.pick-review-link')}
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
        <Select size="sm" label={t('server-pack.pick-version')} value={chosen() ?? undefined} onChange={setVersionId}
          placeholder={t(loading() ? 'server-pack.loading-versions' : failed() ? 'server-pack.versions-failed' : 'server-pack.versions-empty')}
          options={versions().map((version) => ({
            value: version.id, label: version.version_number,
            description: `${version.game_versions.slice(0, 3).join(', ')} · ${version.loaders.join(', ')}`,
          }))} />
        <Show when={failed()}>
          <p data-vesta="server-callout" data-tone="warning" role="alert">{t('server-pack.versions-failed')}
            <Button size="sm" variant="ghost" disabled={loading()} onClick={() => void load()}>{t('common.retry')}</Button>
          </p>
        </Show>
        <span data-vesta="sr-only" role="status">{loading() ? t('server-pack.loading-versions') : ''}</span>
        <p data-vesta="modpack-check-line"><Icon name="icons/controls/check" size={12} />{t('server-pack.pick-point-server')}</p>
        <p data-vesta="modpack-check-line"><Icon name="icons/controls/check" size={12} />{t('server-pack.pick-point-players')}</p>
        <Show when={replacing()}>
          <p data-vesta="server-callout" data-tone="warning">{t('server-pack.pick-replaces')}</p>
        </Show>
        <Show when={blocked()}>{(reason) => <p data-vesta="server-callout" data-tone="neutral">{t(reason())}</p>}</Show>
      </div>
    </Dialog>
  );
}
