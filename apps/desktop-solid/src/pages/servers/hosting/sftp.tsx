import { errorMessage } from '../../../features/servers/errors';
import { Badge, Button, Dialog, Skeleton, Switch as Toggle, TextArea, TextField, toast } from '@vesta/ui';
import { For, Show, createSignal, untrack } from 'solid-js';
import { isTauri } from '@tauri-apps/api/core';
import { transitionTo } from '../../../app/transition';
import { Icon } from '../../../components/icon';
import { SettingRow } from '../../../components/setting-row';
import { t } from '../../../localization';
import { gate } from '../../../features/servers/capabilities';
import { stableConnectionId } from '../../../features/servers/connection-id';
import { toServerError } from '../../../features/servers/errors';
import {
  bindProblem, hasOwnKey, hostOf, mayOwn, portProblem, publicKeyComment, publicKeyProblem, reasonMessage, sftpLink, sftpLoopbackOnly,
} from '../../../features/servers/hosting-model';
import type { SftpKey, SftpStatus } from '../../../features/servers/hosting-native';
import { IntentMemo, newIntentId } from '../../../features/servers/model';
import type { ServerCommandError, ServerSnapshot } from '../../../features/servers/native';
import { invalidateServerResources, seedServerResource, useServerResource } from '../../../features/servers/resources';
import { sftpKeysResource, sftpResource } from '../../../features/servers/server-resources';
import { serverPath } from '../../../features/servers/shell-model';
import { serverCommand } from '../../../features/servers/store';
import { Sensitive } from '../parts';
import { CopyValue, SettingsColumns, SettingsPage, SettingsPanel } from '../settings-parts';
import { Hint, HostingError } from './parts';
import './hosting.css';

const failureTitle = (error: ServerCommandError) => t(reasonMessage(error.reason) ?? 'server-hosting.sftp-open-failed');
const mayConfigure = (snapshot: ServerSnapshot) => mayOwn(snapshot.connection.role) && gate(snapshot.capabilities, 'security.manage') === 'allowed';
const mayManageKeys = (snapshot: ServerSnapshot) => mayOwn(snapshot.connection.role) && gate(snapshot.capabilities, 'credentials.manage') === 'allowed';
const linkFor = (snapshot: ServerSnapshot, status: SftpStatus, path = '') =>
  sftpLink({ host: hostOf(snapshot.connection.endpoint), port: status.config.port, username: status.username, path });

// ------------------------------------------------------------------ files toolbar

/**
 * Files toolbar: "Open in SFTP" shows the link for the folder being browsed, with Copy,
 * Open and a way to the SFTP settings. Nothing is read until it's pressed.
 */
export function SftpButton(props: { snapshot: ServerSnapshot; path: string }) {
  const [open, setOpen] = createSignal(false, { name: 'server-sftp:dialog-open' });
  return (
    <>
      <Button size="sm" variant="outline" icon={<Icon name="icons/actions/external-link" />} onClick={() => setOpen(true)}>
        {t('server-hosting.sftp-open-here')}
      </Button>
      <Show when={open()}>
        <SftpDialog snapshot={props.snapshot} path={props.path} onClose={() => setOpen(false)} />
      </Show>
    </>
  );
}

function SftpDialog(props: { snapshot: ServerSnapshot; path: string; onClose: () => void }) {
  const id = stableConnectionId(() => props.snapshot);
  const status = useServerResource(id, sftpResource);
  const keys = useServerResource(id, sftpKeysResource, { enabled: () => mayManageKeys(props.snapshot) });
  const [opening, setOpening] = createSignal(false, { name: 'server-sftp:opening' });
  const [openError, setOpenError] = createSignal<ServerCommandError | null>(null, { name: 'server-sftp:open-error' });
  const running = () => !!status.value()?.running;
  const link = () => (status.value() ? linkFor(props.snapshot, status.value()!, props.path) : '');
  const needsKey = () => !!keys.value() && !!status.value() && !hasOwnKey(keys.value()!, status.value()!.username, Date.now());

  const settings = () => {
    props.onClose();
    transitionTo(serverPath(id(), { mode: 'settings', section: 'sftp' }));
  };
  // Native opens the server root from the trusted connection; the browser preview opens the link itself.
  const launch = async () => {
    setOpening(true); setOpenError(null);
    try {
      if (isTauri()) await serverCommand((client) => client.sftpOpen(id(), props.path));
      else window.open(link(), '_blank', 'noopener');
      props.onClose();
    } catch (reason) { setOpenError(toServerError(reason)); }
    finally { setOpening(false); }
  };

  return (
    <Dialog
      open
      size="sm"
      onOpenChange={(next) => { if (!next) props.onClose(); }}
      title={t('server-hosting.sftp-title')}
      description={status.value() ? t(running() ? 'server-hosting.sftp-here-description' : 'server-hosting.sftp-off-description') : undefined}
      footer={
        <>
          <Button variant={running() ? 'ghost' : 'solid'} tone={running() ? undefined : 'accent'} icon={<Icon name="icons/content/gear" />} onClick={settings}>
            {t('server-hosting.sftp-settings')}
          </Button>
          <Show when={running()}>
            <Button tone="accent" icon={<Icon name="icons/actions/external-link" />} disabled={opening()} onClick={() => void launch()}>{t('server-hosting.sftp-open')}</Button>
          </Show>
        </>
      }
    >
      <div data-vesta="server-hosting-form" data-server-sftp-dialog>
        <HostingError error={status.error()} onRetry={() => void status.refresh()} />
        <Show when={status.value()} fallback={<Show when={!status.error()}><Skeleton height={40} radius={8} /></Show>}>
          {(current) => (
            <Show when={running()} fallback={<p data-vesta="server-hosting-hint">{t(mayConfigure(props.snapshot) ? 'server-hosting.sftp-turn-on' : 'server-hosting.sftp-ask-owner')}</p>}>
              <div data-vesta="server-sftp-link">
                <CopyValue value={link()} label={t('server-hosting.sftp-copy-link')}><Sensitive>{link()}</Sensitive></CopyValue>
              </div>
              <Show when={current().hostKeyFingerprint}>
                {(fingerprint) => <p data-vesta="server-hosting-hint">{t('server-hosting.sftp-host-key-check', { value: fingerprint() })}</p>}
              </Show>
              <Hint when={needsKey()}>{t('server-hosting.key-needed')}</Hint>
              <Hint when={sftpLoopbackOnly(current())}>{t('server-hosting.sftp-loopback')}</Hint>
              <Show when={openError()}>
                {(error) => <p data-vesta="server-callout" data-tone="warning">{error().reason === 'sftp_no_handler' ? t('server-hosting.sftp-no-handler') : failureTitle(error())}</p>}
              </Show>
            </Show>
          )}
        </Show>
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------------ settings section

/** Settings → SFTP: the service, how to connect, and the SSH keys that may sign in. */
export function SftpSection(props: { snapshot: ServerSnapshot }) {
  const id = stableConnectionId(() => props.snapshot);
  const status = useServerResource(id, sftpResource);
  return (
    <SettingsPage>
      <HostingError error={status.error()} onRetry={() => void status.refresh()} />
      <Show when={status.value()} fallback={<Show when={!status.error()}><Skeleton height={160} radius={12} /><Skeleton height={120} radius={12} /></Show>}>
        {(current) => (
          <SettingsColumns aside={<Show when={mayManageKeys(props.snapshot)}><KeysPanel snapshot={props.snapshot} status={current()} /></Show>}>
            <ServicePanel snapshot={props.snapshot} status={current()} />
            <Show when={current().running}>
              <DetailsPanel snapshot={props.snapshot} status={current()} />
            </Show>
          </SettingsColumns>
        )}
      </Show>
    </SettingsPage>
  );
}

/** On/off, port and listen address. Saving disconnects open sessions. */
function ServicePanel(props: { snapshot: ServerSnapshot; status: SftpStatus }) {
  const id = () => props.snapshot.connection.id;
  const [port, setPort] = createSignal(untrack(() => String(props.status.config.port)), { name: 'server-sftp:port' });
  const [bind, setBind] = createSignal(untrack(() => props.status.config.bindAddress), { name: 'server-sftp:bind' });
  const [busy, setBusy] = createSignal(false, { name: 'server-sftp:busy' });
  const [error, setError] = createSignal<ServerCommandError | null>(null, { name: 'server-sftp:error' });
  const intents = new IntentMemo();
  const editable = () => mayConfigure(props.snapshot);
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
      toast.show({ title: t(enabled ? 'server-hosting.sftp-on' : 'server-hosting.sftp-off'), tone: 'success' });
    } catch (reason) {
      const failure = reason as ServerCommandError;
      intents.settle(failure);
      setError(failure);
    } finally { setBusy(false); }
  };

  return (
    <SettingsPanel
      title={t('server-hosting.sftp-service')}

      name="sftp-service"
      action={
        <Badge tone={props.status.running ? 'success' : 'neutral'} variant="soft">
          {props.status.running ? t('server-hosting.sftp-sessions', { count: props.status.activeSessions }) : t('server-hosting.sftp-status-off')}
        </Badge>
      }
    >
      <div data-vesta="settings-panel-body">
        <SettingRow label={t('server-hosting.sftp-enable')}>
          <Toggle size="sm" aria-label={t('server-hosting.sftp-enable')} checked={props.status.config.enabled}
            disabled={!editable() || busy() || (!props.status.config.enabled && !!problem())} onChange={(enabled: boolean) => void save(enabled)} />
        </SettingRow>
        <SettingRow label={t('server-hosting.sftp-port')}>
          <TextField size="sm" aria-label={t('server-hosting.sftp-port')} value={port()} inputmode="numeric" disabled={!editable() || busy()}
            error={portProblem(port()) ? t(portProblem(port())!) : undefined} onChange={setPort} />
        </SettingRow>
        <SettingRow label={t('server-hosting.sftp-bind')} description={t('server-hosting.sftp-bind-description')}>
          <TextField size="sm" aria-label={t('server-hosting.sftp-bind')} value={bind()} disabled={!editable() || busy()}
            error={bindProblem(bind()) ? t(bindProblem(bind())!) : undefined} onChange={setBind} />
        </SettingRow>
        <Hint when={!editable()}>{t('server-hosting.sftp-ask-owner')}</Hint>
        <Show when={editable() && props.status.config.enabled && changed()}>
          <div data-vesta="server-hosting-actions" data-server-sftp-save>
            <Show when={props.status.activeSessions > 0}><span data-vesta="server-hosting-hint">{t('server-hosting.sftp-disconnects')}</span></Show>
            <Button size="sm" variant="ghost" disabled={busy()} onClick={() => { setPort(String(props.status.config.port)); setBind(props.status.config.bindAddress); }}>{t('server-files.discard')}</Button>
            <Button size="sm" tone="accent" disabled={busy() || !!problem()} onClick={() => void save(true)}>{t('server-files.save')}</Button>
          </div>
        </Show>
        <HostingError error={error()} />
      </div>
    </SettingsPanel>
  );
}

/** What an SFTP app needs: host, port, username, the host key, and the link for the game root. */
function DetailsPanel(props: { snapshot: ServerSnapshot; status: SftpStatus }) {
  const host = () => hostOf(props.snapshot.connection.endpoint);
  const link = () => linkFor(props.snapshot, props.status);
  const copy = t('server-hosting.copy');
  return (
    <SettingsPanel title={t('server-hosting.sftp-details')} name="sftp-details">
      <div data-vesta="settings-panel-body">
        <SettingRow label={t('server-hosting.sftp-link')}><CopyValue value={link()} label={t('server-hosting.sftp-copy-link')}><Sensitive>{link()}</Sensitive></CopyValue></SettingRow>
        <SettingRow label={t('server-hosting.sftp-host')}><CopyValue value={host()} label={copy}><Sensitive>{host()}</Sensitive></CopyValue></SettingRow>
        <SettingRow label={t('server-hosting.sftp-port')}><CopyValue value={String(props.status.config.port)} label={copy} /></SettingRow>
        <SettingRow label={t('server-hosting.sftp-username')}><CopyValue value={props.status.username} label={copy} /></SettingRow>
        <Show when={props.status.hostKeyFingerprint}>
          {(fingerprint) => <SettingRow label={t('server-hosting.sftp-host-key')}><CopyValue value={fingerprint()} label={copy}><Sensitive>{fingerprint()}</Sensitive></CopyValue></SettingRow>}
        </Show>
        <Show when={props.status.authentication.length}>
          <SettingRow label={t('server-hosting.sftp-sign-in')}><span data-vesta="server-setting-value">{props.status.authentication.join(', ')}</span></SettingRow>
        </Show>
        <Hint when={sftpLoopbackOnly(props.status)}>{t('server-hosting.sftp-loopback')}</Hint>
      </div>
    </SettingsPanel>
  );
}

/** Public SSH keys that may sign in. Private keys are refused before anything is sent. */
function KeysPanel(props: { snapshot: ServerSnapshot; status: SftpStatus }) {
  const id = () => props.snapshot.connection.id;
  const keys = useServerResource(id, sftpKeysResource);
  const [text, setText] = createSignal('', { name: 'server-sftp:key-text' });
  const [label, setLabel] = createSignal('', { name: 'server-sftp:key-label' });
  const [busy, setBusy] = createSignal(false, { name: 'server-sftp:key-busy' });
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
  const revoke = (key: SftpKey) => {
    const connection = id();
    toast.undo({ title: t('server-hosting.key-revoke'), undoLabel: 'Undo',
      apply: () => seedServerResource(connection, sftpKeysResource, (keys.value() ?? []).map(entry => entry.id === key.id ? { ...entry, revokedAtMs: Date.now() } : entry)),
      rollback: () => invalidateServerResources(connection, [sftpKeysResource.name]),
      commit: () => serverCommand(client => client.sftpKeyRevoke(connection, key.id, newIntentId())),
      onError: reason => toast.show({ title: t(errorMessage(reason)), tone: 'danger' }) });
  };

  return (
    <SettingsPanel title={t('server-hosting.sftp-keys')} name="sftp-keys">
      <div data-vesta="settings-panel-body" data-server-sftp-keys>
        <HostingError error={keys.error()} onRetry={() => void keys.refresh()} />
        <Hint when={keys.value() && !mine()}>{t('server-hosting.key-needed')}</Hint>
        <Show when={active().length}>
          <ul data-vesta="server-hosting-keys">
            <For each={active()}>
              {(key) => (
                <li>
                  <Icon name="icons/security/lock" size={14} />
                  <span data-vesta="server-hosting-key-copy">
                    <span>{key.label}</span>
                    <code>{key.fingerprint}</code>
                  </span>
                  <Button size="sm" variant="ghost" tone="danger" disabled={busy()} onClick={() => void revoke(key)}>
                    {t('server-hosting.key-revoke')}
                  </Button>
                </li>
              )}
            </For>
          </ul>
        </Show>
        <div data-vesta="server-sftp-key-add">
          <TextArea size="sm" rows={2} label={t('server-hosting.key-add')} placeholder="ssh-ed25519 AAAA… name@computer" value={text()} disabled={busy()}
            description={t('server-hosting.key-help')} error={problem()} onChange={input} spellcheck={false} autocomplete="off" />
          <div data-vesta="server-hosting-actions">
            <TextField size="sm" aria-label={t('server-hosting.key-label')} placeholder={publicKeyComment(text()) || t('server-hosting.key-label')} value={label()} disabled={busy()} onChange={setLabel} />
            <Button size="sm" variant="outline" disabled={busy() || !!publicKeyProblem(text())} onClick={() => void add()}>{t('server-hosting.key-add-action')}</Button>
          </div>
        </div>
        <HostingError error={error()} />
      </div>
    </SettingsPanel>
  );
}
