import { Button, TextArea, TextField, toast } from '@vesta/ui';
import { Show, createEffect, createSignal } from 'solid-js';
import { SettingRow } from '../../../components/setting-row';
import { t } from '../../../localization';
import { serverArt, initials } from '../../../features/servers/art';
import { gate } from '../../../features/servers/capabilities';
import { normalizeServerIcon } from '../../../features/servers/icon-image';
import { IntentMemo } from '../../../features/servers/model';
import type { ServerBranding } from '../../../features/servers/native-branding';
import type { ServerCommandError, ServerSnapshot } from '../../../features/servers/native';
import { serverCommand, serverIcon, setServerIcon } from '../../../features/servers/store';
import { ServerErrorNote } from '../parts';

const NAME_LIMIT = 128;
const DESCRIPTION_LIMIT = 1024;

/** Server-owned name, description and icon that every connected player sees. */
export function ServerProfilePanel(props: { snapshot: ServerSnapshot }) {
  const id = () => props.snapshot.connection.id;
  const [branding, setBranding] = createSignal<ServerBranding | null>(null, { name: 'server-profile:branding' });
  const [name, setName] = createSignal('', { name: 'server-profile:name' });
  const [description, setDescription] = createSignal('', { name: 'server-profile:description' });
  const [error, setError] = createSignal<ServerCommandError | null>(null, { name: 'server-profile:error' });
  const [busy, setBusy] = createSignal(false, { name: 'server-profile:busy' });
  const textIntents = new IntentMemo();
  const iconIntents = new IntentMemo();
  let picker: HTMLInputElement | undefined;
  const canEdit = () => gate(props.snapshot.capabilities, 'config.edit') !== 'denied';

  const apply = (value: ServerBranding) => {
    setBranding(value);
    setName(value.name);
    setDescription(value.description ?? '');
  };
  const load = async () => {
    setError(null);
    try { apply(await serverCommand((client) => client.branding(id()))); } catch (reason) { setError(reason as ServerCommandError); }
  };
  createEffect(id, () => { void load(); }, { name: 'server-profile:load' });

  const patch = () => {
    const current = branding();
    if (!current) return {};
    const next: { name?: string; description?: string } = {};
    if (name().trim() !== current.name) next.name = name().trim();
    if (description() !== (current.description ?? '')) next.description = description();
    return next;
  };
  const dirty = () => Object.keys(patch()).length > 0;
  const nameProblem = () => (!name().trim() ? t('servers.profile.name-required') : [...name()].length > NAME_LIMIT ? t('servers.profile.too-long', { max: NAME_LIMIT }) : undefined);
  const descriptionProblem = () => ([...description()].length > DESCRIPTION_LIMIT ? t('servers.profile.too-long', { max: DESCRIPTION_LIMIT }) : undefined);

  const save = async () => {
    const current = branding();
    const changes = patch();
    if (!current || !Object.keys(changes).length) return;
    const intentId = textIntents.idFor({ changes, revision: current.revision });
    setBusy(true); setError(null);
    try {
      apply(await serverCommand((client) => client.updateBranding(id(), changes, current.revision, intentId)));
      textIntents.settle();
      toast.show({ title: t('servers.profile.saved'), tone: 'success' });
    } catch (reason) {
      const failure = reason as ServerCommandError;
      textIntents.settle(failure);
      if (failure.code === 'stale_target') {
        toast.show({ title: t('servers.profile.stale'), tone: 'warning' });
        await load();
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

  const fallbackArt = () => serverArt(props.snapshot.connection.serverId || id(), initials(branding()?.name ?? props.snapshot.connection.name));

  return (
    <section data-vesta="settings-panel" data-server-profile>
      <h3>{t('servers.profile.title')}</h3>
      <div data-vesta="settings-panel-body">
        <ServerErrorNote error={error()} onRetry={branding() ? undefined : () => void load()} />
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
          <TextField size="sm" aria-label={t('servers.profile.name')} value={name()} disabled={!branding() || !canEdit()} error={nameProblem()} onChange={setName} />
        </SettingRow>
        <div data-vesta="server-setting-block">
          <div data-vesta="setting-row-copy">
            <span data-vesta="setting-row-label">{t('servers.profile.description')}</span>
            <span data-vesta="setting-row-description">{t('servers.profile.description-help')}</span>
          </div>
          <TextArea size="sm" aria-label={t('servers.profile.description')} value={description()} rows={3}
            disabled={!branding() || !canEdit()} error={descriptionProblem()} onChange={setDescription} />
        </div>
        <Show when={dirty()}>
          <div data-vesta="server-profile-actions">
            <Button size="sm" variant="ghost" disabled={busy()} onClick={() => { const current = branding(); if (current) apply(current); }}>{t('server-files.discard')}</Button>
            <Button size="sm" tone="accent" disabled={busy() || !canEdit() || !!nameProblem() || !!descriptionProblem()} onClick={() => void save()}>{t('server-files.save')}</Button>
          </div>
        </Show>
      </div>
    </section>
  );
}
