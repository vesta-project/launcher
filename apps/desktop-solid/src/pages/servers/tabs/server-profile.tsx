import { EditConflictNotice, useEditRevision } from '../edit-conflict';
import { Button, Switch, Skeleton, TextArea, TextField, toast } from '@vesta/ui';
import { Show, createSignal } from 'solid-js';
import { SettingRow } from '../../../components/setting-row';
import { t } from '../../../localization';
import { serverArt, initials } from '../../../features/servers/art';
import { gate } from '../../../features/servers/capabilities';
import { stableConnectionId } from '../../../features/servers/connection-id';
import { normalizeServerIcon } from '../../../features/servers/icon-image';
import { IntentMemo } from '../../../features/servers/model';
import { seedServerResource, useServerResource } from '../../../features/servers/resources';
import { brandingResource, eulaResource } from '../../../features/servers/server-resources';
import type { ServerCommandError, ServerSnapshot } from '../../../features/servers/native';
import { serverCommand, serverIcon, setServerIcon } from '../../../features/servers/store';
import { ServerErrorNote } from '../parts';
import { SaveBar, SettingsPage, SettingsPanel } from '../settings-parts';

const NAME_LIMIT = 128;
const DESCRIPTION_LIMIT = 1024;

/** General: the server-owned name, description and icon that every connected player sees. */
export function ServerProfilePanel(props: { snapshot: ServerSnapshot }) {
  const id = stableConnectionId(() => props.snapshot);
  const eula = useServerResource(id, eulaResource);
  const branding = useServerResource(id, brandingResource);
  const editRevision = useEditRevision(() => branding.value()?.revision);
  // Null drafts read through to the saved profile.
  const [nameDraft, setNameDraft] = createSignal<string | null>(null, { name: 'server-profile:name' });
  const [descriptionDraft, setDescriptionDraft] = createSignal<string | null>(null, { name: 'server-profile:description' });
  const [error, setError] = createSignal<ServerCommandError | null>(null, { name: 'server-profile:error' });
  const [busy, setBusy] = createSignal(false, { name: 'server-profile:busy' });
  const textIntents = new IntentMemo();
  const iconIntents = new IntentMemo();
  const eulaIntents = new IntentMemo();
  let picker: HTMLInputElement | undefined;
  const canEdit = () => gate(props.snapshot.capabilities, 'config.edit') === 'allowed';

  const name = () => nameDraft() ?? branding.value()?.name ?? '';
  const description = () => descriptionDraft() ?? branding.value()?.description ?? '';
  const discard = () => { editRevision.reset(); setError(null); setNameDraft(null); setDescriptionDraft(null); };

  const patch = () => {
    const current = branding.value();
    if (!current) return {};
    const next: { name?: string; description?: string } = {};
    if (name().trim() !== current.name) next.name = name().trim();
    if (description() !== (current.description ?? '')) next.description = description();
    return next;
  };
  const changeCount = () => Object.keys(patch()).length;
  const nameProblem = () => (!name().trim() ? t('servers.profile.name-required') : [...name()].length > NAME_LIMIT ? t('servers.profile.too-long', { max: NAME_LIMIT }) : undefined);
  const descriptionProblem = () => ([...description()].length > DESCRIPTION_LIMIT ? t('servers.profile.too-long', { max: DESCRIPTION_LIMIT }) : undefined);

  const save = async () => {
    const current = branding.value();
    const changes = patch();
    if (!current || !Object.keys(changes).length || editRevision.conflict()) return;
    const intentId = textIntents.idFor({ changes, revision: current.revision });
    setBusy(true); setError(null);
    try {
      seedServerResource(id(), brandingResource, await serverCommand((client) => client.updateBranding(id(), changes, current.revision, intentId)));
      textIntents.settle();
      discard();
      toast.show({ title: t('servers.profile.saved'), tone: 'success' });
    } catch (reason) {
      const failure = reason as ServerCommandError;
      textIntents.settle(failure);
      if (failure.code === 'stale_target' || failure.code === 'conflict') {
        setError(failure);
        toast.show({ title: t('servers.profile.stale'), tone: 'warning' });
        await branding.refresh();
      } else setError(failure);
    } finally { setBusy(false); }
  };

  const reconcileIcon = async () => {
    try { setServerIcon(id(), await serverCommand((client) => client.icon(id()))); } catch { /* keep the cached icon */ }
  };
  const writeIcon = async (run: (intentId: string) => Promise<void>, key: unknown, next: string | null) => {
    const intentId = iconIntents.idFor(key);
    setBusy(true); setError(null);
    try {
      await run(intentId);
      iconIntents.settle();
      setServerIcon(id(), next);
    } catch (reason) {
      const failure = reason as ServerCommandError;
      iconIntents.settle(failure);
      setError(failure);
      // Uncertain or stale writes are reconciled from the server before the next attempt.
      await reconcileIcon();
    } finally { setBusy(false); }
  };
  const pick = async (file: File | undefined) => {
    if (!file) return;
    let png: string;
    try { png = await normalizeServerIcon(file); } catch {
      toast.show({ title: t('servers.profile.icon-unreadable'), tone: 'danger' });
      return;
    }
    await writeIcon((intentId) => serverCommand((client) => client.setIcon(id(), png, intentId)), { set: png }, png);
  };
  const clear = () => writeIcon((intentId) => serverCommand((client) => client.clearIcon(id(), intentId)), { clear: true }, null);

  const setEula = async (accepted: boolean) => {
    if (busy()) return;
    setBusy(true); setError(null);
    const intent = eulaIntents.idFor({ accepted });
    try { seedServerResource(id(), eulaResource, await serverCommand(client => client.eulaUpdate(id(), accepted, intent))); eulaIntents.settle(); }
    catch (reason) { const failure = reason as ServerCommandError; eulaIntents.settle(failure); setError(failure); }
    finally { setBusy(false); }
  };
  const fallbackArt = () => serverArt(props.snapshot.connection.serverId || id(), initials(branding.value()?.name ?? props.snapshot.connection.name));

  return (
    <SettingsPage saveBar={
      <SaveBar show={changeCount() > 0} label={t('server-settings.unsaved', { count: changeCount() })} busy={busy()}
        disabled={editRevision.conflict() || !canEdit() || !!nameProblem() || !!descriptionProblem()} onDiscard={discard} onSave={() => void save()} />
    }>
      <SettingsPanel title={t('servers.profile.title')} name="profile">
        <SettingRow label={t('servers.eula.title')} description={t('servers.eula.setting-description')}>
          <Switch checked={eula.value()?.accepted ?? false} disabled={busy() || !canEdit() || !eula.value()} onChange={value => void setEula(value)} aria-label={t('servers.eula.title')} />
        </SettingRow>
        <ServerErrorNote error={eula.error()} onRetry={() => void eula.refresh()} />

        <EditConflictNotice id={id()} resource="branding" show={editRevision.conflict()} current={branding.value()} onReview={editRevision.review} />
        <ServerErrorNote error={error() ?? branding.error()} onRetry={() => void branding.refresh()} />
        <Show when={branding.value()} fallback={<Show when={!branding.error()}><Skeleton height={180} radius={0} /></Show>}>
          <div data-vesta="settings-panel-body" data-server-profile>
            <SettingRow label={t('servers.profile.icon')} description={t('servers.profile.icon-description')}>
              <img data-vesta="server-profile-icon" src={serverIcon(id()) ?? fallbackArt()} alt="" draggable="false" />
              <input ref={picker} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden
                onChange={(event) => { const input = event.currentTarget; void pick(input.files?.[0]); input.value = ''; }} />
              <Button size="sm" variant="outline" disabled={!canEdit() || busy()} onClick={() => picker?.click()}>{t('servers.profile.icon-upload')}</Button>
              <Show when={serverIcon(id())}>
                <Button size="sm" variant="ghost" disabled={!canEdit() || busy()} onClick={() => void clear()}>{t('servers.profile.icon-remove')}</Button>
              </Show>
            </SettingRow>
            <SettingRow label={t('servers.profile.name')} description={t('servers.profile.name-description')}>
              <TextField size="sm" aria-label={t('servers.profile.name')} value={name()} disabled={!canEdit()} error={nameProblem()} onChange={value => { editRevision.begin(); setNameDraft(value); }} />
            </SettingRow>
            <div data-vesta="server-setting-block">
              <div data-vesta="setting-row-copy">
                <span data-vesta="setting-row-label">{t('servers.profile.description')}</span>
                <span data-vesta="setting-row-description">{t('servers.profile.description-help')}</span>
              </div>
              <TextArea size="sm" aria-label={t('servers.profile.description')} value={description()} rows={3}
                disabled={!canEdit()} error={descriptionProblem()} onChange={value => { editRevision.begin(); setDescriptionDraft(value); }} />
            </div>
          </div>
        </Show>
      </SettingsPanel>
    </SettingsPage>
  );
}
