// Machine settings: servers removed from this Vesta Server that can still come back, how long
// the machine keeps them, and deleting one for good. Owners only; each part shows only when
// the machine advertises it, so older machines keep the page they had.
import { Button, Dialog, Select, Switch, TextField, toast } from '@vesta/ui';
import { For, Show, createSignal, onSettled } from 'solid-js';
import { Icon } from '../../components/icon';
import { SettingRow } from '../../components/setting-row';
import { t } from '../../localization';
import { attemptKeys, nameMatches } from '../../features/servers/host-remove';
import {
  formatStorage, hostHas, lifecycleProblem, lifecycleProblemLines, purgeIn, retentionChoices, retentionDays, sortRemoved,
  type LifecycleProblem,
} from '../../features/servers/host-removed';
import { hostCommand, hostInfo, loadHostInfo, restoreHostServer, vestaHost } from '../../features/servers/hosts-store';
import type { RemovedServer } from '../../features/servers/native-hosts';
import { refreshServers, useServersClock } from '../../features/servers/store';
import { Card as Panel } from '../settings/parts';
import './host-removed.css';

/** "7 days", for the remove dialog and the retention setting. */
export const daysLabel = (count: number) => t('vesta-server.removed.days', { count });

export function RemovedServersPanel(props: { hostId: string; onChanged?: () => void }) {
  const now = useServersClock();
  const info = () => hostInfo(props.hostId);
  const listed = () => hostHas(info(), 'removed-servers');
  const [servers, setServers] = createSignal<RemovedServer[] | null>(null, { name: 'host-removed:servers' });
  const [next, setNext] = createSignal<string | null>(null, { name: 'host-removed:next' });
  const [busy, setBusy] = createSignal<string | null>(null, { name: 'host-removed:busy' });
  const [problem, setProblem] = createSignal<{ name: string; why: LifecycleProblem } | null>(null, { name: 'host-removed:problem' });
  const [purging, setPurging] = createSignal<RemovedServer | null>(null, { name: 'host-removed:purging' });
  const [saving, setSaving] = createSignal(false, { name: 'host-removed:saving' });
  const restoreKeys = new Map<string, string>();

  const load = async (cursor: string | null = null) => {
    if (!listed()) return;
    try {
      const reply = await hostCommand((client) => client.removedServers(props.hostId, cursor));
      setServers((current) => (cursor ? [...(current ?? []), ...reply.servers] : reply.servers));
      setNext(reply.nextCursor);
    } catch (reason) {
      setProblem({ name: '', why: lifecycleProblem(reason) });
      if (!cursor) setServers([]);
    }
  };
  onSettled(() => void load());

  const restore = async (server: RemovedServer) => {
    if (busy()) return;
    setBusy(server.serverId);
    setProblem(null);
    // One key per server until it succeeds, so a retry after a lost answer is the same restore.
    const key = restoreKeys.get(server.serverId) ?? crypto.randomUUID();
    restoreKeys.set(server.serverId, key);
    try {
      const receipt = await restoreHostServer(props.hostId, server.serverId, key);
      restoreKeys.delete(server.serverId);
      void refreshServers();
      const renamed = receipt.name !== server.name;
      toast.show({
        tone: 'success',
        title: t('vesta-server.removed.restored', { name: server.name }),
        description: renamed ? t('vesta-server.removed.restored-as', { server: receipt.name, port: String(receipt.gamePort) }) : undefined,
      });
      await load();
      props.onChanged?.();
    } catch (reason) {
      setProblem({ name: server.name, why: lifecycleProblem(reason) });
      if (lifecycleProblem(reason) === 'gone' || lifecycleProblem(reason) === 'purging') await load();
    } finally { setBusy(null); }
  };

  const setRetention = async (days: number) => {
    if (saving() || days === retentionDays(info())) return;
    setSaving(true);
    try {
      await hostCommand((client) => client.update(props.hostId, { removedServerRetentionDays: days }));
      await loadHostInfo(props.hostId);
    } catch (reason) { setProblem({ name: '', why: lifecycleProblem(reason) }); }
    finally { setSaving(false); }
  };

  const machine = () => vestaHost(props.hostId)?.name ?? t('servers.host-remove.your-machine');

  return (
    <Show when={listed() || hostHas(info(), 'removed-server-retention')}>
      <Panel title={t('vesta-server.removed.title')} description={t('vesta-server.removed.help')}>
        <Show when={hostHas(info(), 'removed-server-retention')}>
          <SettingRow label={t('vesta-server.removed.retention')} description={t('vesta-server.removed.retention-help')}>
            <Select size="sm" aria-label={t('vesta-server.removed.retention')} disabled={saving()}
              value={String(retentionDays(info()))}
              options={retentionChoices(retentionDays(info())).map((days) => ({ value: String(days), label: daysLabel(days) }))}
              onChange={(value) => void setRetention(Number(value))} />
          </SettingRow>
        </Show>
        <Show when={listed()}>
          <Show when={servers()} fallback={<p data-vesta="server-muted" class="server-panel-note">{t('vesta-server.host.checking')}</p>}>
            {(list) => (
              <Show when={list().length} fallback={<p data-vesta="server-muted" class="server-panel-note">{t('vesta-server.removed.empty')}</p>}>
                <ul data-vesta="host-removed-list">
                  <For each={sortRemoved(list())}>
                    {(server) => {
                      const left = () => purgeIn(server.restoreUntil, now());
                      const facts = () => [
                        server.minecraftVersion,
                        server.bytes != null ? formatStorage(server.bytes) : null,
                      ].filter(Boolean).join(' · ');
                      return (
                        <li data-vesta="host-removed-row" data-state={server.state}>
                          <Icon name="icons/rail/servers" size={16} />
                          <div data-vesta="host-removed-text">
                            <span data-vesta="host-removed-name" data-tip-overflow>{server.name}</span>
                            <span data-vesta="host-removed-meta">
                              <Show when={facts()}>{(text) => <span>{text()}</span>}</Show>
                              <span data-vesta="host-removed-deadline">
                                {server.state === 'purging' ? t('vesta-server.removed.purging')
                                  : server.state === 'restoring' ? t('vesta-server.removed.restoring')
                                  : left() ? t('vesta-server.removed.purge-in', { time: t(left()!.message, { count: left()!.count }) })
                                  : t('vesta-server.removed.purge-soon')}
                              </span>
                            </span>
                          </div>
                          <Show when={server.state === 'restorable'}>
                            <div data-vesta="host-removed-actions">
                              <Show when={hostHas(info(), 'server-purge')}>
                                <Button size="sm" variant="ghost" tone="danger" disabled={!!busy()} onClick={() => setPurging(server)}>{t('vesta-server.removed.delete')}</Button>
                              </Show>
                              <Button size="sm" variant="outline" disabled={!!busy()} icon={<Icon name="icons/actions/reload" />}
                                onClick={() => void restore(server)}>
                                {busy() === server.serverId ? t('vesta-server.removed.restoring') : t('vesta-server.removed.restore')}
                              </Button>
                            </div>
                          </Show>
                        </li>
                      );
                    }}
                  </For>
                </ul>
                <Show when={next()}>
                  {(cursor) => <Button size="sm" variant="ghost" onClick={() => void load(cursor())}>{t('vesta-server.removed.more')}</Button>}
                </Show>
              </Show>
            )}
          </Show>
        </Show>
        <Show when={problem()}>
          {(current) => (
            <p data-vesta="server-callout" data-tone="danger" role="alert">
              {t(lifecycleProblemLines[current().why], { name: current().name, machine: machine() })}
            </p>
          )}
        </Show>
      </Panel>
      <Show when={purging()} keyed>
        {(server) => (
          <PurgeDialog hostId={props.hostId} name={server.name} bytes={server.bytes}
            run={(confirmName, keepBackups, key) => hostCommand((client) => client.purgeRemovedServer(props.hostId, server.serverId, confirmName, keepBackups, key))}
            onClose={(done) => { setPurging(null); if (done) { void load(); props.onChanged?.(); } }} />
        )}
      </Show>
    </Show>
  );
}

/**
 * Delete for good: the name typed exactly, and whether to keep backups (on by default, so a
 * server can still be created from them). Used from the removed list and from Remove.
 */
export function PurgeDialog(props: {
  hostId: string;
  name: string;
  bytes: number | null;
  run: (confirmName: string, keepBackups: boolean, key: string) => Promise<unknown>;
  onClose: (done: boolean) => void;
}) {
  const [typed, setTyped] = createSignal('', { name: 'purge:typed' });
  const [keep, setKeep] = createSignal(true, { name: 'purge:keep-backups' });
  const [busy, setBusy] = createSignal(false, { name: 'purge:busy' });
  const [problem, setProblem] = createSignal<LifecycleProblem | null>(null, { name: 'purge:problem' });
  const keys = attemptKeys();
  const machine = () => vestaHost(props.hostId)?.name ?? t('servers.host-remove.your-machine');
  const ready = () => nameMatches(typed(), props.name) && !busy();

  const close = (done = false) => { if (!busy()) props.onClose(done); };
  const purge = async () => {
    if (!ready()) return;
    setBusy(true);
    setProblem(null);
    try {
      await props.run(typed(), keep(), keys.for(`${typed()}\u0000${keep()}`));
    } catch (reason) {
      const why = lifecycleProblem(reason);
      // Already deleted (elsewhere, or an earlier answer was lost): finish as done.
      if (why !== 'gone') { setProblem(why); setBusy(false); return; }
    }
    setBusy(false);
    toast.show({ tone: 'success', title: t('vesta-server.purge.done', { name: props.name, machine: machine() }) });
    props.onClose(true);
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) close(); }} size="sm"
      title={t('vesta-server.purge.title', { name: props.name })}
      description={t('vesta-server.purge.description', { machine: machine() })}
      footer={
        <>
          <Button variant="ghost" disabled={busy()} onClick={() => close()}>{t('common.cancel')}</Button>
          <Button tone="danger" disabled={!ready()} onClick={() => void purge()}>
            {busy() ? t('vesta-server.purge.deleting') : t('vesta-server.purge.action')}
          </Button>
        </>
      }>
      <form data-vesta="host-remove" onSubmit={(event) => { event.preventDefault(); void purge(); }}>
        <Show when={props.bytes}>{(bytes) => <p data-vesta="server-muted">{t('vesta-server.purge.frees', { value: formatStorage(bytes()) })}</p>}</Show>
        <TextField label={t('servers.host-remove.type', { name: props.name })} value={typed()} disabled={busy()} autocomplete="off" spellcheck={false}
          onChange={(value) => { setTyped(value); if (problem() === 'name') setProblem(null); }} />
        <SettingRow label={t('vesta-server.purge.keep-backups')} description={t('vesta-server.purge.keep-backups-help')}>
          <Switch size="sm" aria-label={t('vesta-server.purge.keep-backups')} checked={keep()} disabled={busy()} onChange={setKeep} />
        </SettingRow>
        <Show when={problem()}>
          {(why) => <p data-vesta="server-callout" data-tone="danger" role="alert">{t(lifecycleProblemLines[why()], { name: props.name, machine: machine() })}</p>}
        </Show>
      </form>
    </Dialog>
  );
}
