import { Button, Dialog, IconButton, Menu, MenuItem, Switch as Toggle, TextArea, TextField, toast } from '@vesta/ui';
import { For, Show, createSignal, untrack } from 'solid-js';
import { Icon } from '../../../components/icon';
import { SettingRow } from '../../../components/setting-row';
import { t } from '../../../localization';
import { gate } from '../../../features/servers/capabilities';
import { toServerError } from '../../../features/servers/errors';
import {
  bindProblem, hasOwnKey, hostOf, mayOwn, portProblem, publicKeyComment, publicKeyProblem, reasonMessage, sftpLoopbackOnly,
} from '../../../features/servers/hosting-model';
import type { SftpKey, SftpStatus } from '../../../features/servers/hosting-native';
import { IntentMemo, newIntentId } from '../../../features/servers/model';
import type { ServerCommandError, ServerSnapshot } from '../../../features/servers/native';
import { readServerResource, seedServerResource, useServerResource } from '../../../features/servers/resources';
import { sftpKeysResource, sftpResource } from '../../../features/servers/server-resources';
import { serverCommand } from '../../../features/servers/store';
import { CopyValue } from '../settings-parts';
import { Hint, HostingError } from './parts';
import './hosting.css';

type View = 'details' | 'keys';

const failureTitle = (error: ServerCommandError) => t(reasonMessage(error.reason) ?? 'server-hosting.sftp-open-failed');

/**
 * Files toolbar: one SFTP button that opens the default SFTP client. Nothing is read until
 * it's pressed. A dialog appears only when there's something to set up first, or when the
 * menu beside it asks for the connection details or keys.
 */
export function SftpButton(props: { snapshot: ServerSnapshot }) {
  const [view, setView] = createSignal<View | null>(null, { name: 'server-sftp:view' });
  const [opening, setOpening] = createSignal(false, { name: 'server-sftp:opening' });
  const id = () => props.snapshot.connection.id;
  const owner = () => mayOwn(props.snapshot.connection.role);
  const keysAllowed = () => owner() && gate(props.snapshot.capabilities, 'credentials.manage') !== 'denied';

  const open = async () => {
    if (opening()) return;
    setOpening(true);
    try {
      const status = await readServerResource(id(), sftpResource);
      if (!status.running) { setView('details'); return; }
      if (keysAllowed()) {
        const keys = await readServerResource(id(), sftpKeysResource).catch(() => null);
        if (keys && !hasOwnKey(keys, status.username, Date.now())) { setView('keys'); return; }
      }
      await serverCommand((client) => client.sftpOpen(id()));
    } catch (reason) {
      const error = toServerError(reason);
      if (error.reason === 'sftp_disabled' || error.reason === 'sftp_no_handler') setView('details');
      else toast.show({ title: failureTitle(error), tone: 'danger' });
    } finally { setOpening(false); }
  };

  return (
    <span data-vesta="server-sftp-button">
      <Button size="sm" variant="outline" icon={<Icon name="icons/actions/external-link" />} disabled={opening()} onClick={() => void open()}>
        {t('server-hosting.sftp')}
      </Button>
      <Menu placement="bottom-end" trigger={(menuProps) => (
        <IconButton {...menuProps} size="sm" variant="ghost" label={t('server-hosting.sftp-more')} icon={<Icon name="icons/controls/chevron-down" />} />
      )}>
        <MenuItem icon={<Icon name="icons/content/help" />} onSelect={() => setView('details')}>{t('server-hosting.sftp-details')}</MenuItem>
        <Show when={keysAllowed()}>
          <MenuItem icon={<Icon name="icons/security/lock" />} onSelect={() => setView('keys')}>{t('server-hosting.sftp-keys')}</MenuItem>
        </Show>
      </Menu>
      <Show when={view()}>
        {(current) => <SftpDialog snapshot={props.snapshot} view={current()} keysAllowed={keysAllowed()} onClose={() => setView(null)} />}
      </Show>
    </span>
  );
}

function SftpDialog(props: { snapshot: ServerSnapshot; view: View; keysAllowed: boolean; onClose: () => void }) {
  const id = () => props.snapshot.connection.id;
  const status = useServerResource(id, sftpResource);
  const owner = () => mayOwn(props.snapshot.connection.role) && gate(props.snapshot.capabilities, 'security.manage') !== 'denied';
  const [opening, setOpening] = createSignal(false, { name: 'server-sftp:dialog-opening' });
  const [openError, setOpenError] = createSignal<ServerCommandError | null>(null, { name: 'server-sftp:open-error' });
  const running = () => !!status.value()?.running;
  const host = () => hostOf(props.snapshot.connection.endpoint);

  const launch = async () => {
    setOpening(true); setOpenError(null);
    try { await serverCommand((client) => client.sftpOpen(id())); props.onClose(); }
    catch (reason) { setOpenError(toServerError(reason)); }
    finally { setOpening(false); }
  };

  return (
    <Dialog
      open
      size="sm"
      onOpenChange={(open) => { if (!open) props.onClose(); }}
      title={t('server-hosting.sftp-title')}
      description={running() ? t('server-hosting.sftp-running-description') : t('server-hosting.sftp-off-description')}
      footer={
        <>
          <Button variant="ghost" onClick={props.onClose}>{t('nav.close')}</Button>
          <Show when={running()}>
            <Button tone="accent" icon={<Icon name="icons/actions/external-link" />} disabled={opening()} onClick={() => void launch()}>{t('server-hosting.sftp-open')}</Button>
          </Show>
        </>
      }
    >
      <div data-vesta="server-hosting-form" data-server-sftp={props.view}>
        <HostingError error={status.error()} onRetry={() => void status.refresh()} />
        <Show when={status.value()}>
          {(current) => (
            <>
              <Show when={running()}>
                <div data-vesta="server-hosting-details">
                  <SettingRow label={t('server-hosting.sftp-host')}><CopyValue value={host()} label={t('server-hosting.copy')} /></SettingRow>
                  <SettingRow label={t('server-hosting.sftp-port')}><CopyValue value={String(current().config.port)} label={t('server-hosting.copy')} /></SettingRow>
                  <SettingRow label={t('server-hosting.sftp-username')}><CopyValue value={current().username} label={t('server-hosting.copy')} /></SettingRow>
                  <Show when={current().hostKeyFingerprint}>
                    {(fingerprint) => <SettingRow label={t('server-hosting.sftp-host-key')}><CopyValue value={fingerprint()} label={t('server-hosting.copy')} /></SettingRow>}
                  </Show>
                </div>
                <p data-vesta="server-hosting-hint">{t('server-hosting.sftp-sign-in-help')}</p>
                <Hint when={sftpLoopbackOnly(current())}>{t('server-hosting.sftp-loopback')}</Hint>
                <Show when={openError()}>
                  {(error) => <p data-vesta="server-callout" data-tone="warning">{error().reason === 'sftp_no_handler' ? t('server-hosting.sftp-no-handler') : failureTitle(error())}</p>}
                </Show>
              </Show>
              <Show when={owner()} fallback={<Show when={!running()}><p data-vesta="server-hosting-hint">{t('server-hosting.sftp-ask-owner')}</p></Show>}>
                <SftpSetup snapshot={props.snapshot} status={current()} />
              </Show>
              <Show when={props.keysAllowed}>
                <SftpKeys snapshot={props.snapshot} status={current()} />
              </Show>
            </>
          )}
        </Show>
      </div>
    </Dialog>
  );
}

/** Owner switch, port and (under More) bind address. Saving disconnects open sessions. */
function SftpSetup(props: { snapshot: ServerSnapshot; status: SftpStatus }) {
  const id = () => props.snapshot.connection.id;
  const [port, setPort] = createSignal(untrack(() => String(props.status.config.port)), { name: 'server-sftp:port' });
  const [bind, setBind] = createSignal(untrack(() => props.status.config.bindAddress), { name: 'server-sftp:bind' });
  const [more, setMore] = createSignal(false, { name: 'server-sftp:more' });
  const [busy, setBusy] = createSignal(false, { name: 'server-sftp:busy' });
  const [error, setError] = createSignal<ServerCommandError | null>(null, { name: 'server-sftp:error' });
  const intents = new IntentMemo();
  const changed = () => port().trim() !== String(props.status.config.port) || bind().trim() !== props.status.config.bindAddress;
  const problem = () => portProblem(port()) ?? bindProblem(bind());

  const save = async (enabled: boolean) => {
    if (enabled && problem()) return;
    const patch = enabled ? { enabled, port: Number(port().trim()), bindAddress: bind().trim() } : { enabled };
    const intentId = intents.idFor(patch);
    setBusy(true); setError(null);
    try {
      seedServerResource(id(), sftpResource, await serverCommand((client) => client.sftpUpdate(id(), patch, intentId)));
      intents.settle();
      toast.show({ title: enabled ? t('server-hosting.sftp-on') : t('server-hosting.sftp-off'), tone: 'success' });
    } catch (reason) {
      const failure = reason as ServerCommandError;
      intents.settle(failure);
      setError(failure);
    } finally { setBusy(false); }
  };

  return (
    <section data-vesta="server-hosting-block" data-server-sftp-setup>
      <SettingRow label={t('server-hosting.sftp-enable')} description={t('server-hosting.sftp-enable-description')}>
        <Toggle size="sm" aria-label={t('server-hosting.sftp-enable')} checked={props.status.config.enabled} disabled={busy() || (!props.status.config.enabled && !!problem())}
          onChange={(enabled: boolean) => void save(enabled)} />
      </SettingRow>
      <SettingRow label={t('server-hosting.sftp-port')}>
        <TextField size="sm" aria-label={t('server-hosting.sftp-port')} value={port()} inputmode="numeric" disabled={busy()}
          error={portProblem(port()) ? t(portProblem(port())!) : undefined} onChange={setPort} />
      </SettingRow>
      <Show when={more()} fallback={<Button size="sm" variant="ghost" onClick={() => setMore(true)}>{t('server-hosting.more')}</Button>}>
        <SettingRow label={t('server-hosting.sftp-bind')} description={t('server-hosting.sftp-bind-description')}>
          <TextField size="sm" aria-label={t('server-hosting.sftp-bind')} value={bind()} disabled={busy()}
            error={bindProblem(bind()) ? t(bindProblem(bind())!) : undefined} onChange={setBind} />
        </SettingRow>
      </Show>
      <Show when={props.status.config.enabled && changed()}>
        <div data-vesta="server-hosting-actions">
          <Show when={props.status.activeSessions > 0}><span data-vesta="server-hosting-hint">{t('server-hosting.sftp-disconnects')}</span></Show>
          <Button size="sm" tone="accent" disabled={busy() || !!problem()} onClick={() => void save(true)}>{t('server-files.save')}</Button>
        </div>
      </Show>
      <HostingError error={error()} />
    </section>
  );
}

/** Public SSH keys that may sign in. Private keys are refused before anything is sent. */
function SftpKeys(props: { snapshot: ServerSnapshot; status: SftpStatus }) {
  const id = () => props.snapshot.connection.id;
  const keys = useServerResource(id, sftpKeysResource);
  const [text, setText] = createSignal('', { name: 'server-sftp:key-text' });
  const [label, setLabel] = createSignal('', { name: 'server-sftp:key-label' });
  const [busy, setBusy] = createSignal(false, { name: 'server-sftp:key-busy' });
  const [confirming, setConfirming] = createSignal<string | null>(null, { name: 'server-sftp:revoke-confirm' });
  const [error, setError] = createSignal<ServerCommandError | null>(null, { name: 'server-sftp:key-error' });
  const [refused, setRefused] = createSignal(false, { name: 'server-sftp:key-refused' });
  const intents = new IntentMemo();
  const active = () => (keys.value() ?? []).filter((key) => !key.revokedAtMs);
  const problem = () => (refused() ? t('server-hosting.key-private') : text().trim() && publicKeyProblem(text()) === 'format' ? t('server-hosting.key-format') : undefined);
  // A pasted private key is dropped at once: it is never kept, shown or sent.
  const input = (value: string) => {
    const isPrivate = publicKeyProblem(value) === 'private';
    setRefused(isPrivate);
    setText(isPrivate ? '' : value);
  };
  const mine = () => hasOwnKey(keys.value() ?? [], props.status.username, Date.now());

  const add = async () => {
    if (publicKeyProblem(text())) return;
    const payload = { publicKey: text().trim(), label: label().trim() || publicKeyComment(text()) || t('server-hosting.key-default-label') };
    const intentId = intents.idFor(payload);
    setBusy(true); setError(null);
    try {
      const key = await serverCommand((client) => client.sftpKeyAdd(id(), props.status.username, payload.label, payload.publicKey, null, intentId));
      intents.settle();
      seedServerResource(id(), sftpKeysResource, [key, ...(keys.value() ?? [])]);
      setText(''); setLabel('');
      toast.show({ title: t('server-hosting.key-added'), tone: 'success' });
    } catch (reason) {
      const failure = reason as ServerCommandError;
      intents.settle(failure);
      setError(failure);
    } finally { setBusy(false); }
  };
  const revoke = async (key: SftpKey) => {
    if (confirming() !== key.id) { setConfirming(key.id); return; }
    setBusy(true); setError(null);
    try {
      await serverCommand((client) => client.sftpKeyRevoke(id(), key.id, newIntentId()));
      seedServerResource(id(), sftpKeysResource, (keys.value() ?? []).map((entry) => (entry.id === key.id ? { ...entry, revokedAtMs: Date.now() } : entry)));
    } catch (reason) { setError(reason as ServerCommandError); }
    finally { setBusy(false); setConfirming(null); }
  };

  return (
    <section data-vesta="server-hosting-block" data-server-sftp-keys>
      <h4>{t('server-hosting.sftp-keys')}</h4>
      <Hint when={keys.value() && !mine()}>{t('server-hosting.key-needed')}</Hint>
      <HostingError error={keys.error()} onRetry={() => void keys.refresh()} />
      <Show when={active().length}>
        <ul data-vesta="server-hosting-keys">
          <For each={active()}>
            {(key) => (
              <li>
                <span data-vesta="server-hosting-key-copy">
                  <span>{key.label}</span>
                  <code>{key.fingerprint}</code>
                </span>
                <Button size="sm" variant="ghost" tone={confirming() === key.id ? 'danger' : undefined} disabled={busy()} onClick={() => void revoke(key)}>
                  {confirming() === key.id ? t('server-hosting.key-revoke-confirm') : t('server-hosting.key-revoke')}
                </Button>
              </li>
            )}
          </For>
        </ul>
      </Show>
      <TextArea size="sm" rows={2} label={t('server-hosting.key-add')} placeholder="ssh-ed25519 AAAA… name@computer" value={text()} disabled={busy()}
        description={t('server-hosting.key-help')} error={problem()} onChange={input} spellcheck={false} autocomplete="off" />
      <div data-vesta="server-hosting-actions">
        <TextField size="sm" aria-label={t('server-hosting.key-label')} placeholder={publicKeyComment(text()) || t('server-hosting.key-label')} value={label()} disabled={busy()} onChange={setLabel} />
        <Button size="sm" variant="outline" disabled={busy() || !!publicKeyProblem(text())} onClick={() => void add()}>{t('server-hosting.key-add-action')}</Button>
      </div>
      <HostingError error={error()} />
    </section>
  );
}
