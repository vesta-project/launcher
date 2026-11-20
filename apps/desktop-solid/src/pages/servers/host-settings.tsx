// `/servers/host/<hostId>`: the machine itself. Name (owners rename it), address, your role,
// owners, linked devices, whether new devices need approval, Link a device, Add server, and
// forgetting the machine in this launcher.
import { Badge, Button, Dialog, IconButton, Switch, TextField } from '@vesta/ui';
import { For, Show, createEffect, createMemo, createSignal, onSettled } from 'solid-js';
import { Board } from '../../components/board';
import { EmptyState } from '../../components/empty-state';
import { Icon } from '../../components/icon';
import { SettingRow } from '../../components/setting-row';
import { transitionTo } from '../../app/transition';
import { t } from '../../localization';
import { copyText } from '../../platform/clipboard';
import { age } from '../../features/servers/model';
import { toServerError } from '../../features/servers/errors';
import { canManageHost, formatCode, hostIdOf, hostNameProblem, hostRoleLabel, importProblem, tidyHostName } from '../../features/servers/host-model';
import { forgetHost, hostCommand, hostInfo, hostProblem, loadHostInfo, refreshHosts, vestaHost } from '../../features/servers/hosts-store';
import type { HostDevice, HostOwner, VestaHost } from '../../features/servers/native-hosts';
import type { ServerCommandError } from '../../features/servers/native';
import { refreshServers, serverSnapshots, useServersClock } from '../../features/servers/store';
import { Card as Panel } from '../settings/parts';
import { ServerErrorNote } from './parts';
import { RemovedServersPanel } from './host-removed';
import { StoragePanel } from './host-storage';
import { SettingsColumns } from './settings-parts';
import '../library/instance/settings-tab.css';
import './vesta-server.css';

export function HostSettings(props: { hostId: string }) {
  return (
    <Show when={vestaHost(props.hostId)} fallback={
      <Board>
        <EmptyState icon="icons/rail/servers" title={t('vesta-server.missing')}>
          <Button onClick={() => transitionTo('/servers')}>{t('servers.done.all-servers')}</Button>
        </EmptyState>
      </Board>
    }>
      {(host) => <HostSettingsContent host={host()} />}
    </Show>
  );
}

function HostSettingsContent(props: { host: VestaHost }) {
  const id = () => props.host.id;
  const info = () => hostInfo(id());
  const role = () => info()?.role;
  const owner = () => canManageHost(role());
  const servers = createMemo(() => serverSnapshots().filter((snapshot) => hostIdOf(snapshot) === props.host.id), { name: 'host-settings:servers' });
  const [devices, setDevices] = createSignal<HostDevice[] | null>(null, { name: 'host-settings:devices' });
  const [error, setError] = createSignal<ServerCommandError | null>(null, { name: 'host-settings:error' });
  const [linking, setLinking] = createSignal(false, { name: 'host-settings:linking' });
  const [unlinking, setUnlinking] = createSignal<HostDevice | null>(null, { name: 'host-settings:unlinking' });
  const [removing, setRemoving] = createSignal(false, { name: 'host-settings:removing' });
  const [copied, setCopied] = createSignal(false, { name: 'host-settings:copied' });
  const [owners, setOwners] = createSignal<HostOwner[] | null>(null, { name: 'host-settings:owners' });
  const [renaming, setRenaming] = createSignal(false, { name: 'host-settings:renaming' });
  const [draft, setDraft] = createSignal('', { name: 'host-settings:name-draft' });
  const [saving, setSaving] = createSignal<'name' | 'approval' | null>(null, { name: 'host-settings:saving' });
  const nameProblem = () => hostNameProblem(draft());
  /** Bumped when a restore or delete changes what the machine stores, so Storage reads again. */
  const [changes, setChanges] = createSignal(0, { name: 'host-settings:changes' });

  const loadDevices = async () => {
    try {
      const reply = await hostCommand((client) => client.devices(id()));
      setDevices(reply.devices.filter((device) => !device.revoked));
    } catch (reason) { setError(toServerError(reason)); }
  };
  const loadOwners = async () => {
    try { setOwners((await hostCommand((client) => client.owners(id()))).owners); }
    catch (reason) { setError(toServerError(reason)); }
  };
  const load = async () => {
    setError(null);
    let current;
    try { current = await loadHostInfo(id()); } catch (reason) { setError(toServerError(reason)); return; }
    // Devices and owners are for owners only; the role comes from this read, not the signal.
    if (canManageHost(current.role)) await Promise.all([loadDevices(), loadOwners()]);
  };
  onSettled(() => void load());

  const startRename = () => {
    setDraft(props.host.name);
    setRenaming(true);
  };
  const saveName = async () => {
    const name = tidyHostName(draft());
    if (nameProblem() || name === props.host.name || saving()) return;
    setSaving('name');
    setError(null);
    try {
      await hostCommand((client) => client.update(id(), { name }));
      setRenaming(false);
      await loadHostInfo(id());
      await refreshHosts({ servers: false });
    } catch (reason) { setError(toServerError(reason)); }
    finally { setSaving(null); }
  };
  const setApproval = async (on: boolean) => {
    if (saving()) return;
    setSaving('approval');
    setError(null);
    try {
      await hostCommand((client) => client.update(id(), { newDeviceSignIn: on ? 'approval' : 'account' }));
      await loadHostInfo(id());
    } catch (reason) { setError(toServerError(reason)); }
    finally { setSaving(null); }
  };

  const copyAddress = async () => {
    await copyText(props.host.endpoints[0] ?? '').catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Board class="servers-board">
      <div data-vesta="vesta-host" data-vesta-host-settings>
        <header data-vesta="vesta-host-header">
          <Button size="sm" variant="ghost" icon={<Icon name="icons/navigation/arrow-back" />} onClick={() => transitionTo('/servers')}>{t('servers.done.all-servers')}</Button>
          <div>
            <h1>{props.host.name}</h1>
          </div>
        </header>
        <Show when={error() ?? hostProblem(id())}>
          {(problem) => <ServerErrorNote error={problem()} onRetry={() => void load()} />}
        </Show>
        <SettingsColumns aside={
          <Panel title={t('vesta-server.host.danger')} danger>
            <SettingRow label={t('vesta-server.host.remove')} description={t('vesta-server.host.remove-help')}>
              <Button size="sm" tone="danger" variant="outline" onClick={() => setRemoving(true)}>{t('vesta-server.host.remove-short')}</Button>
            </SettingRow>
          </Panel>
        }>
          <Panel title={t('vesta-server.host.about')}>
            <SettingRow label={t('vesta-server.host.name')}>
              <Show when={renaming()} fallback={
                <span data-vesta="vesta-host-name">
                  <span data-vesta="server-setting-value">{props.host.name}</span>
                  <Show when={owner()}>
                    <IconButton size="sm" variant="ghost" label={t('vesta-server.host.rename')} icon={<Icon name="icons/actions/edit" />} onClick={startRename} />
                  </Show>
                </span>
              }>
                <form data-vesta="vesta-host-rename" onSubmit={(event) => { event.preventDefault(); void saveName(); }}>
                  <TextField size="sm" aria-label={t('vesta-server.host.name')} value={draft()} onChange={setDraft} maxlength={63} spellcheck={false}
                    ref={(input: HTMLInputElement) => requestAnimationFrame(() => input.select())}
                    onKeyDown={(event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); setRenaming(false); } }}
                    error={nameProblem() === 'long' ? t('vesta-server.host.name-long') : undefined} />
                  <Button size="sm" variant="ghost" disabled={saving() === 'name'} onClick={() => setRenaming(false)}>{t('common.cancel')}</Button>
                  <Button size="sm" tone="accent" type="submit" disabled={saving() === 'name' || !!nameProblem() || tidyHostName(draft()) === props.host.name}>{t('servers.save')}</Button>
                </form>
              </Show>
            </SettingRow>
            <SettingRow label={t('vesta-server.host.address')}>
              <span data-vesta="server-setting-value">{props.host.endpoints[0] ?? ''}</span>
              <IconButton size="sm" variant="ghost" label={copied() ? t('servers.copied') : t('servers.copy-address')}
                icon={<Icon name={copied() ? 'icons/controls/check' : 'icons/actions/copy'} />} onClick={() => void copyAddress()} />
            </SettingRow>
            <SettingRow label={t('vesta-server.host.role')}>
              <span data-vesta="server-setting-value">{role() ? t(hostRoleLabel(role())) : t('vesta-server.host.checking')}</span>
            </SettingRow>
            <SettingRow label={t('vesta-server.host.servers')} description={t('vesta-server.host.servers-count', { count: servers().length })}>
              <Show when={owner()}>
                <Button size="sm" tone="accent" icon={<Icon name="icons/actions/add" />} onClick={() => transitionTo(`/servers/host/${id()}/add`)}>{t('vesta-server.host.add-server')}</Button>
              </Show>
            </SettingRow>
          </Panel>

          <Show when={owner()}>
            <Panel title={t('vesta-server.host.owners')}>
              <Show when={owners()} fallback={<p data-vesta="server-muted" class="server-panel-note">{t('vesta-server.host.checking')}</p>}>
                {(list) => (
                  <ul data-vesta="vesta-devices">
                    <For each={list()}>
                      {(person) => (
                        <li>
                          <Icon name="icons/content/people" size={16} />
                          <span data-vesta="vesta-device-name">{person.name ?? t('vesta-server.host.owner-unknown')}</span>
                          <Show when={person.accountId === props.host.accountId}>
                            <Badge variant="soft">{t('vesta-server.host.you')}</Badge>
                          </Show>
                          <Badge variant="soft">{t(hostRoleLabel(person.role))}</Badge>
                        </li>
                      )}
                    </For>
                  </ul>
                )}
              </Show>
            </Panel>
          </Show>

          <Show when={owner()}>
            <Panel title={t('vesta-server.host.devices')} action={
              <Button size="sm" icon={<Icon name="icons/content/link" />} onClick={() => setLinking(true)}>{t('vesta-server.link.action')}</Button>
            }>
              <Show when={info()?.newDeviceSignIn}>
                {(policy) => (
                  <SettingRow label={t('vesta-server.host.approval')} description={t('vesta-server.host.approval-help')}>
                    <Switch size="sm" aria-label={t('vesta-server.host.approval')} checked={policy() === 'approval'} disabled={saving() === 'approval'}
                      onChange={(on: boolean) => void setApproval(on)} />
                  </SettingRow>
                )}
              </Show>
              <Show when={devices()} fallback={<p data-vesta="server-muted" class="server-panel-note">{t('vesta-server.host.checking')}</p>}>
                {(list) => (
                  <ul data-vesta="vesta-devices">
                    <For each={list()}>
                      {(device) => (
                        <li>
                          <Icon name="icons/content/monitor" size={16} />
                          <span data-vesta="vesta-device-name">{device.name}</span>
                          <Show when={device.deviceId === props.host.deviceId} fallback={
                            <Button size="sm" variant="ghost" onClick={() => setUnlinking(device)}>{t('vesta-server.host.unlink')}</Button>
                          }>
                            <Badge variant="soft">{t('vesta-server.host.this-device')}</Badge>
                          </Show>
                        </li>
                      )}
                    </For>
                  </ul>
                )}
              </Show>
            </Panel>
          </Show>

          <Show when={owner()}>
            <RemovedServersPanel hostId={id()} onChanged={() => { setChanges((count) => count + 1); void refreshServers(); }} />
            <StoragePanel hostId={id()} refresh={changes()} />
          </Show>
        </SettingsColumns>
      </div>

      <Show when={linking()}>
        <LinkDeviceDialog host={props.host} onClose={() => { setLinking(false); void loadDevices(); }} />
      </Show>
      <Dialog open={!!unlinking()} onOpenChange={(open) => { if (!open) setUnlinking(null); }} size="sm"
        title={t('vesta-server.host.unlink-title', { name: unlinking()?.name ?? '' })}
        footer={
          <div data-vesta="vesta-dialog-actions">
            <Button variant="ghost" onClick={() => setUnlinking(null)}>{t('common.cancel')}</Button>
            <Button tone="danger" onClick={() => {
              const device = unlinking();
              setUnlinking(null);
              if (device) void hostCommand((client) => client.deviceRevoke(id(), device.deviceId)).then(loadDevices, (reason) => setError(toServerError(reason)));
            }}>{t('vesta-server.host.unlink')}</Button>
          </div>
        }>
        <p>{t('vesta-server.host.unlink-help')}</p>
      </Dialog>
      <Dialog open={removing()} onOpenChange={setRemoving} size="sm" title={t('vesta-server.host.remove-title', { name: props.host.name })}
        footer={
          <div data-vesta="vesta-dialog-actions">
            <Button variant="ghost" onClick={() => setRemoving(false)}>{t('common.cancel')}</Button>
            <Button tone="danger" onClick={() => {
              setRemoving(false);
              void forgetHost(id()).then(() => { void refreshServers(); transitionTo('/servers'); }, (reason) => setError(toServerError(reason)));
            }}>{t('vesta-server.host.remove-short')}</Button>
          </div>
        }>
        <p>{t('vesta-server.host.remove-help')}</p>
      </Dialog>
    </Board>
  );
}

const LINK_POLL_MS = 2000;

/** Shows a link code, then asks to approve the device that used it. */
function LinkDeviceDialog(props: { host: VestaHost; onClose: () => void }) {
  const now = useServersClock();
  const [issued, setIssued] = createSignal<{ linkId: string; code: string; expiresAt: string } | null>(null, { name: 'link-device:issued' });
  const [request, setRequest] = createSignal<string | null>(null, { name: 'link-device:request' });
  const [state, setState] = createSignal<'code' | 'approve' | 'linked' | 'ended'>('code', { name: 'link-device:state' });
  const [error, setError] = createSignal<ServerCommandError | null>(null, { name: 'link-device:error' });
  const [busy, setBusy] = createSignal(false, { name: 'link-device:busy' });

  const issue = async () => {
    setError(null);
    setState('code');
    setRequest(null);
    try { setIssued(await hostCommand((client) => client.linkCode(props.host.id, props.host.accountId))); }
    catch (reason) { setError(toServerError(reason)); }
  };
  onSettled(() => void issue());

  const left = () => {
    const at = Date.parse(issued()?.expiresAt ?? '');
    return Number.isFinite(at) ? Math.max(0, at - now()) : null;
  };

  // Follow the code until a device uses it; then the owner approves here.
  createEffect(() => (state() === 'code' ? issued()?.linkId : undefined), (linkId) => {
    if (!linkId) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = async () => {
      try {
        const result = await hostCommand((client) => client.linkStatus(props.host.id, linkId));
        if (!live) return;
        if (result.state === 'approved') { setState('linked'); return; }
        if (['denied', 'rejected', 'expired', 'cancelled', 'revoked'].includes(result.state)) { setState('ended'); return; }
        if (result.requestHash) { setRequest(result.requestHash); setState('approve'); return; }
      } catch (reason) {
        if (!live) return;
        const problem = toServerError(reason);
        if (problem.code !== 'rate_limited' && problem.code !== 'server_busy' && problem.code !== 'unreachable') { setError(problem); return; }
      }
      timer = setTimeout(() => void check(), LINK_POLL_MS);
    };
    timer = setTimeout(() => void check(), LINK_POLL_MS);
    return () => { live = false; clearTimeout(timer); };
  }, { name: 'link-device:poll' });

  const approve = async () => {
    const linkId = issued()?.linkId;
    const hash = request();
    if (!linkId || !hash) return;
    setBusy(true);
    setError(null);
    try {
      await hostCommand((client) => client.linkApprove(props.host.id, linkId, hash));
      setState('linked');
    } catch (reason) { setError(toServerError(reason)); }
    finally { setBusy(false); }
  };

  const minutes = () => {
    const ms = left();
    return ms == null ? null : age(Date.now() - ms, Date.now());
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) props.onClose(); }} size="sm" title={t('vesta-server.link.title')}
      footer={
        <div data-vesta="vesta-dialog-actions">
          <Show when={state() === 'approve'} fallback={
            <Button tone={state() === 'linked' ? 'accent' : 'neutral'} onClick={props.onClose}>{t(state() === 'linked' ? 'servers.done' : 'common.cancel')}</Button>
          }>
            <Button variant="ghost" onClick={props.onClose}>{t('vesta-server.link.not-now')}</Button>
            <Button tone="accent" disabled={busy()} onClick={() => void approve()}>{t('vesta-server.link.approve')}</Button>
          </Show>
        </div>
      }>
      <div data-vesta="vesta-link">
        <Show when={state() === 'code'}>
          <p>{t('vesta-server.link.help', { name: props.host.name })}</p>
          <Show when={issued()} fallback={<Show when={!error()}><p data-vesta="server-muted">{t('vesta-server.host.checking')}</p></Show>}>
            {(code) => (
              <div data-vesta="vesta-link-code">
                <code aria-label={t('vesta-server.code.link-label')}>{formatCode(code().code) || code().code}</code>
                <IconButton size="sm" variant="ghost" label={t('servers.copy')} icon={<Icon name="icons/actions/copy" />} onClick={() => void copyText(code().code).catch(() => {})} />
              </div>
            )}
          </Show>
          <Show when={minutes()}>
            {(remaining) => (
              <p data-vesta="server-muted">{left() === 0 ? t('vesta-server.link.expired') : t('vesta-server.link.expires', { time: t(remaining().message, { count: remaining().count }) })}</p>
            )}
          </Show>
          <Show when={left() === 0}><Button size="sm" onClick={() => void issue()}>{t('vesta-server.link.new-code')}</Button></Show>
        </Show>
        <Show when={state() === 'approve'}>
          <p>{t('vesta-server.link.approve-question', { name: props.host.name })}</p>
        </Show>
        <Show when={state() === 'linked'}>
          <p data-vesta="server-callout" data-tone="success"><Icon name="icons/controls/success" /> {t('vesta-server.link.linked')}</p>
        </Show>
        <Show when={state() === 'ended'}>
          <p>{t('vesta-server.link.ended')}</p>
          <Button size="sm" onClick={() => void issue()}>{t('vesta-server.link.new-code')}</Button>
        </Show>
        <Show when={error()}>{(problem) => <p data-vesta="server-callout" data-tone="danger" role="alert">{t(importProblem(problem()))}</p>}</Show>
      </div>
    </Dialog>
  );
}
