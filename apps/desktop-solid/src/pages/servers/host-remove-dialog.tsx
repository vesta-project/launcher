// Remove a server that lives on a Vesta Server, from the launcher. Owners of the machine only.
// The machine stops it and keeps it for 7 days, so the dialog says that, and asks for the
// server's name typed exactly before the button wakes up. Each attempt keeps one key, so
// pressing Remove again after a dropped answer can't remove twice.
import { Button, Dialog, Switch, TextField, toast } from '@vesta/ui';
import { Show, createSignal, untrack } from 'solid-js';
import { SettingRow } from '../../components/setting-row';
import { transitionTo } from '../../app/transition';
import { route } from '../../app/router';
import { t } from '../../localization';
import { attemptKeys, canRemoveFromMachine, nameMatches, removeProblem, removeProblemLines, type RemoveProblem } from '../../features/servers/host-remove';
import { hostHas, retentionDays } from '../../features/servers/host-removed';
import { ensureHostInfo, hostInfo, hostOffersRemove, purgeHostServer, removeHostServer, restoreHostServer, vestaHost } from '../../features/servers/hosts-store';
import { refreshServers } from '../../features/servers/store';
import { daysLabel } from './host-removed';
import { hideServer, removeServer } from '../../features/servers/store';

/** How long the server's machine keeps removed servers, as words ("7 days"). */
const keptFor = (hostId: string | undefined) => daysLabel(retentionDays(hostId ? hostInfo(hostId) : undefined));
import type { ServerSnapshot } from '../../features/servers/native';
import './host-remove.css';

/** `hostId:serverId` connections belong to a Vesta Server machine. */
export function machineRef(snapshot: ServerSnapshot): { hostId: string; serverId: string } | null {
  const connection = snapshot.connection;
  if (connection.signInMethod !== 'host' || !connection.serverId) return null;
  const suffix = `:${connection.serverId}`;
  return connection.id.endsWith(suffix) ? { hostId: connection.id.slice(0, -suffix.length), serverId: connection.serverId } : null;
}

export function HostRemoveDialog(props: { snapshot: ServerSnapshot; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [typed, setTyped] = createSignal('', { name: 'host-remove:typed' });
  const [busy, setBusy] = createSignal(false, { name: 'host-remove:busy' });
  const [problem, setProblem] = createSignal<RemoveProblem | null>(null, { name: 'host-remove:problem' });
  /** Delete for good now instead of keeping it in the removed list (machines with `server-purge`). */
  const [forever, setForever] = createSignal(false, { name: 'host-remove:forever' });
  const [keepBackups, setKeepBackups] = createSignal(true, { name: 'host-remove:keep-backups' });
  const keys = attemptKeys();
  const name = () => props.snapshot.connection.name;
  const ref = () => machineRef(props.snapshot);
  const machine = () => { const current = ref(); return (current && vestaHost(current.hostId)?.name) || t('servers.host-remove.your-machine'); };
  const ready = () => nameMatches(typed(), name()) && !busy() && problem() !== 'older';
  const canPurge = () => { const current = ref(); return !!current && hostHas(hostInfo(current.hostId), 'server-purge'); };
  const canRestore = () => { const current = ref(); return !!current && hostHas(hostInfo(current.hostId), 'removed-servers'); };

  const close = () => {
    if (busy()) return;
    setTyped('');
    setProblem(null);
    setForever(false);
    setKeepBackups(true);
    keys.reset();
    props.onOpenChange(false);
  };

  const remove = async () => {
    const current = ref();
    if (!current || !ready()) return;
    const id = props.snapshot.connection.id;
    const server = name();
    const where = machine();
    setBusy(true);
    setProblem(null);
    try {
      const permanent = forever() && canPurge();
      // A different choice is a different request, so it gets its own key.
      const key = keys.for(`${typed()}\u0000${permanent}\u0000${keepBackups()}`);
      if (permanent) await purgeHostServer(current.hostId, current.serverId, typed(), keepBackups(), key);
      else await removeHostServer(current.hostId, current.serverId, typed(), key);
    } catch (reason) {
      const why = removeProblem(reason);
      // Already gone from the machine (removed elsewhere, or an earlier answer was lost): finish as removed.
      if (why !== 'gone') {
        setProblem(why);
        setBusy(false);
        return;
      }
    }
    setBusy(false);
    const permanent = forever() && canPurge();
    const restorable = !permanent && canRestore();
    hideServer(id);
    setTyped('');
    setForever(false);
    setKeepBackups(true);
    keys.reset();
    props.onOpenChange(false);
    if (route().section === id) transitionTo('/servers');
    if (permanent) toast.show({ title: t('vesta-server.purge.done', { name: server, machine: where }), tone: 'success' });
    else toast.show({
      title: t('servers.host-remove.done', { name: server, machine: where }),
      description: t('servers.host-remove.done-help', { machine: where, time: keptFor(current.hostId) }),
      tone: 'success',
      duration: 10_000,
      // The way back: the machine kept it, so Restore brings it straight back.
      actions: restorable ? [{ label: t('servers.host-remove.undo'), onClick: () => {
        void restoreHostServer(current.hostId, current.serverId, crypto.randomUUID())
          .then((receipt) => { void refreshServers(); toast.show({ tone: 'success', title: t('vesta-server.removed.restored', { name: server }), description: receipt.name !== server ? t('vesta-server.removed.restored-as', { server: receipt.name, port: String(receipt.gamePort) }) : undefined }); })
          .catch(() => toast.show({ tone: 'danger', title: t('vesta-server.removed.error-other') }));
      } }] : undefined,
    });
    // The machine no longer has it: drop the saved connection too.
    void removeServer(id).catch(() => { /* Hidden already, and the machine's list no longer has it. */ });
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => { if (!open) close(); }}
      title={t('servers.host-remove.title', { name: name() })}
      description={forever() && canPurge() ? t('vesta-server.purge.description', { machine: machine() }) : t('servers.host-remove.description', { machine: machine(), time: keptFor(ref()?.hostId) })}
      size="sm"
      footer={
        <>
          <Button variant="ghost" disabled={busy()} onClick={close}>{t('common.cancel')}</Button>
          <Button tone="danger" disabled={!ready()} onClick={() => void remove()}>
            {busy() ? t('servers.host-remove.removing') : forever() && canPurge() ? t('vesta-server.purge.action') : t('servers.host-remove.action')}
          </Button>
        </>
      }
    >
      <form data-vesta="host-remove" onSubmit={(event) => { event.preventDefault(); void remove(); }}>
        <TextField label={t('servers.host-remove.type', { name: name() })} value={typed()} disabled={busy()} autocomplete="off" spellcheck={false}
          onChange={(value) => { setTyped(value); if (problem() === 'name') setProblem(null); }} />
        <Show when={canPurge()}>
          <SettingRow label={t('servers.host-remove.forever')} description={t('servers.host-remove.forever-help')}>
            <Switch size="sm" aria-label={t('servers.host-remove.forever')} checked={forever()} disabled={busy()} onChange={setForever} />
          </SettingRow>
          <Show when={forever()}>
            <SettingRow label={t('vesta-server.purge.keep-backups')} description={t('vesta-server.purge.keep-backups-help')}>
              <Switch size="sm" aria-label={t('vesta-server.purge.keep-backups')} checked={keepBackups()} disabled={busy()} onChange={setKeepBackups} />
            </SettingRow>
          </Show>
        </Show>
        <Show when={problem()}>
          {(why) => (
            <p data-vesta="server-callout" data-tone={why() === 'older' ? 'warning' : 'danger'} role="alert">
              {t(removeProblemLines[why()], { name: name(), machine: machine() })}
            </p>
          )}
        </Show>
      </form>
    </Dialog>
  );
}

/** The machine's name when this person owns the server's Vesta Server and it offers removal here; else null. */
export function machineRemoval(snapshot: ServerSnapshot): string | null {
  const ref = machineRef(snapshot);
  if (ref) ensureHostInfo(ref.hostId);
  if (!ref || !hostOffersRemove(ref.hostId) || !canRemoveFromMachine(hostInfo(ref.hostId)?.role ?? snapshot.connection.role)) return null;
  return vestaHost(ref.hostId)?.name ?? t('servers.host-remove.your-machine');
}

/** Settings > General: one quiet row at the end, for owners of the server's Vesta Server. */
export function HostRemoveRow(props: { snapshot: ServerSnapshot }) {
  const [open, setOpen] = createSignal(false, { name: 'host-remove:row-open' });
  const olderHost = () => {
    const ref = machineRef(props.snapshot);
    if (!ref) return null;
    const info = hostInfo(ref.hostId);
    if (!info || !canRemoveFromMachine(info.role ?? props.snapshot.connection.role) || hostOffersRemove(ref.hostId)) return null;
    return vestaHost(ref.hostId)?.name ?? t('servers.host-remove.your-machine');
  };
  // Remembered once shown, so the dialog's "needs a newer Vesta Server" line stays readable.
  const [shown, setShown] = createSignal(untrack(() => machineRemoval(props.snapshot)), { name: 'host-remove:row-machine' });
  return (
    <Show when={machineRemoval(props.snapshot) ?? (open() ? shown() : null)} fallback={
      <Show when={olderHost()}>
        {(machine) => <SettingRow label={t('servers.host-remove.setting')} description={t(removeProblemLines.older, { machine: machine() })} children={null} />}
      </Show>
    }>
      {(machine) => (
        <div data-vesta="host-remove-row">
          <SettingRow label={t('servers.host-remove.setting')} description={t('servers.host-remove.setting-help', { machine: machine(), time: keptFor(machineRef(props.snapshot)?.hostId) })}>
            <Button size="sm" variant="outline" tone="danger" onClick={() => { setShown(machine()); setOpen(true); }}>{t('servers.host-remove.action')}</Button>
          </SettingRow>
          <HostRemoveDialog snapshot={props.snapshot} open={open()} onOpenChange={setOpen} />
        </div>
      )}
    </Show>
  );
}
