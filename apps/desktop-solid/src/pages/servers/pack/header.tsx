import { Button, toast } from '@vesta/ui';
import { Show, createSignal } from 'solid-js';
import { Icon } from '../../../components/icon';
import { diffChangeCount } from '../../../features/servers/modpack-area-model';
import { errorMessage } from '../../../features/servers/errors';
import { t } from '../../../localization';
import { useModpackArea } from './area';

/** Unpublished custom-pack changes, at the end of the client pack's section row. */
export function ModpackDraftStatus() {
  const area = useModpackArea();
  const changes = () => { const preview = area.preview(); return preview ? diffChangeCount(preview.diff) : null; };
  const unpublished = () => area.kind() === 'custom' && !!area.workspace()?.pendingPublication;
  return (
    <>
      <PackDrift />
      <Show when={unpublished()}>
        <div data-vesta="modpack-draft" role="status">
          <span data-vesta="modpack-draft-dot" aria-hidden="true" />
          <span>{changes() === null ? t('server-pack.unpublished') : t('server-pack.unpublished-count', { count: changes()! })}</span>
          <Show when={area.gates().publish}>
            <Button size="sm" variant="outline" iconEnd={<Icon name="icons/navigation/arrow-forward" />} onClick={() => area.open('versions')}>{t('server-pack.review-publish')}</Button>
          </Show>
        </div>
      </Show>
    </>
  );
}

/**
 * The server moved to another Minecraft version: the whole pack follows it, so it is said once
 * here, beside the sections, with the fix, instead of on every tab.
 */
function PackDrift() {
  const area = useModpackArea();
  const [busy, setBusy] = createSignal(false, { name: 'modpack-drift:busy' });
  const version = () => area.workspace()?.serverMinecraftVersion ?? '';
  const update = async () => {
    const workspace = area.workspace();
    if (!workspace || busy()) return;
    setBusy(true);
    // The draft write answers with the draft; the workspace (and its drift flag) is re-read.
    try { await area.writeManifest({ ...workspace.draft.manifest, minecraftVersion: workspace.serverMinecraftVersion }); await area.reload(); }
    catch (reason) { toast.show({ title: t(errorMessage(reason)), tone: 'danger' }); }
    finally { setBusy(false); }
  };
  return (
    <Show when={area.workspace()?.minecraftDrift}>
      <div data-vesta="modpack-drift" role="status">
        <Icon name="icons/controls/warning" size={14} />
        <span>{t('server-pack.drift-short', { version: version() })}</span>
        <Show when={area.kind() === 'custom' && area.gates().edit}>
          <Button size="sm" variant="outline" disabled={busy()} onClick={() => void update()}>{t('server-pack.drift-update', { version: version() })}</Button>
        </Show>
      </div>
    </Show>
  );
}
