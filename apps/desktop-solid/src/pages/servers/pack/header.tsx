import { Button } from '@vesta/ui';
import { Show } from 'solid-js';
import { Icon } from '../../../components/icon';
import { diffChangeCount } from '../../../features/servers/modpack-area-model';
import { t } from '../../../localization';
import { useModpackArea } from './area';

/** Unpublished custom-pack changes, at the end of the client pack's section row. */
export function ModpackDraftStatus() {
  const area = useModpackArea();
  const changes = () => { const preview = area.preview(); return preview ? diffChangeCount(preview.diff) : null; };
  const unpublished = () => area.kind() === 'custom' && !!area.workspace()?.pendingPublication;
  return (
    <Show when={unpublished()}>
      <div data-vesta="modpack-draft" role="status">
        <span data-vesta="modpack-draft-dot" aria-hidden="true" />
        <span>{changes() === null ? t('server-pack.unpublished') : t('server-pack.unpublished-count', { count: changes()! })}</span>
        <Show when={area.gates().publish}>
          <Button size="sm" variant="outline" iconEnd={<Icon name="icons/navigation/arrow-forward" />} onClick={() => area.open('versions')}>{t('server-pack.review-publish')}</Button>
        </Show>
      </div>
    </Show>
  );
}
