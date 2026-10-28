import { Badge, Button } from '@vesta/ui';
import { Show } from 'solid-js';
import { Icon } from '../../../components/icon';
import { sourceById } from '../../../features/browse/browse-model';
import { customizingProvider, diffChangeCount, packLoaderName } from '../../../features/servers/modpack-area-model';
import { t } from '../../../localization';
import { useModpackArea } from './area';

/** Pack identity and state, like an instance header but inside the server's Modpack tab. */
export function ModpackHeader() {
  const area = useModpackArea();
  const workspace = () => area.workspace()!;
  const manifest = () => workspace().draft.manifest;
  const provider = () => workspace().providerPack ?? null;
  const name = () => (area.kind() === 'provider' ? area.providerProject()?.name ?? manifest().name : manifest().name);
  const summary = () => (area.kind() === 'provider' ? area.providerProject()?.summary ?? manifest().summary : manifest().summary);
  const changes = () => { const preview = area.preview(); return preview ? diffChangeCount(preview.diff) : null; };
  const unpublished = () => area.kind() === 'custom' && workspace().pendingPublication;
  return (
    <header data-vesta="modpack-header" style={{ '--modpack-art': `url("${area.icon()}")` }}>
      <div data-vesta="modpack-header-art" aria-hidden="true" />
      <img data-vesta="modpack-header-icon" src={area.icon()} alt="" width={64} height={64} draggable="false" />
      <div data-vesta="modpack-header-copy">
        <div data-vesta="modpack-header-title-row">
          <h2 data-vesta="modpack-header-title">{name() || t('server-pack.untitled')}</h2>
          <Show when={area.kind() === 'provider' && provider()} fallback={
            <Badge size="sm" variant="soft" tone="neutral" icon={<Icon name="icons/content/modpack" size={11} />}>{t('server-pack.source-custom')}</Badge>
          }>
            {(value) => (
              <Badge size="sm" variant="soft" tone="accent" icon={<Icon name={sourceById(value().provider).icon} size={11} />}>
                {sourceById(value().provider).label}
              </Badge>
            )}
          </Show>
          <Show when={customizingProvider(workspace())}>
            <Badge size="sm" variant="outline" tone="warning">{t('server-pack.customizing')}</Badge>
          </Show>
        </div>
        <Show when={summary()}><p data-vesta="modpack-header-summary">{summary()}</p></Show>
        <div data-vesta="modpack-header-facts">
          <span data-tip={t('server-pack.minecraft-locked')}><Icon name="icons/security/lock" size={11} />{t('server-pack.minecraft', { version: workspace().serverMinecraftVersion })}</span>
          <span>{packLoaderName(manifest().loader)}{manifest().loaderVersion ? ` ${manifest().loaderVersion}` : ''}</span>
          <Show when={manifest().displayVersion && area.kind() === 'custom'}><span>{t('server-pack.display-version', { version: manifest().displayVersion })}</span></Show>
          <Show when={workspace().publishedRevision !== '0'} fallback={<span>{t('server-pack.never-published')}</span>}>
            <span>{t('server-pack.revision-facts', { published: workspace().publishedRevision, minimum: workspace().minimumRevision })}</span>
          </Show>
        </div>
      </div>
      <Show when={unpublished()}>
        <div data-vesta="modpack-header-draft" role="status">
          <span data-vesta="modpack-draft-dot" aria-hidden="true" />
          <span>{changes() === null ? t('server-pack.unpublished') : t('server-pack.unpublished-count', { count: changes()! })}</span>
          <Show when={area.gates().publish}>
            <Button size="sm" tone="accent" iconEnd={<Icon name="icons/navigation/arrow-forward" />} onClick={() => area.open('versions')}>{t('server-pack.review-publish')}</Button>
          </Show>
        </div>
      </Show>
    </header>
  );
}
