import { Button, IconButton, Menu, MenuItem, MenuSeparator } from '@vesta/ui';
import { Show, createSignal } from 'solid-js';
import { Icon } from '../../components/icon';
import { t } from '../../localization';
import { initials, serverArt } from '../../features/servers/art';
import { lifecycleControls, minecraftFactNow, statusDot } from '../../features/servers/model';
import { gate } from '../../features/servers/capabilities';
import { serverPressure, useServerResource } from '../../features/servers/resources';
import { sleepPolicyResource } from '../../features/servers/server-resources';
import { headerNotice, joinAddress, knownPlayerCount } from '../../features/servers/shell-model';
import { sleepingMessage } from '../../features/servers/sleep-model';
import { serverIcon, serverRefreshing, updateServer, useServersClock } from '../../features/servers/store';
import type { ServerSnapshot } from '../../features/servers/native';
import { actionIcons, actionLabels, useLifecycle, type Lifecycle, type SubmittableAction } from './lifecycle';
import { KillDialog, StartKillButton } from './kill';
import { Sensitive, StatusDot } from './parts';
import { refreshServerWithFeedback } from './refresh-button';
import { RemoveServerDialog } from './remove-dialog';


/** The instance header's layout: art banner, icon tile, title and meta, then actions, then one notice strip. */
export function ServerHeader(props: { snapshot: ServerSnapshot; compact: boolean; onOpenSettings: () => void }) {
  const now = useServersClock();
  const [removing, setRemoving] = createSignal(false, { name: 'server-header:removing' });
  const [copied, setCopied] = createSignal(false, { name: 'server-header:copied' });
  const lifecycle = useLifecycle(() => props.snapshot);
  const id = () => props.snapshot.connection.id;
  const art = () => serverArt(props.snapshot.connection.serverId || id());
  const sleeping = () => props.snapshot.state.phase === 'online' && props.snapshot.status?.lifecycle === 'sleeping';
  // Whether a join wakes it lives in the sleep policy; read it only while asleep.
  const sleepPolicy = useServerResource(id, sleepPolicyResource, { enabled: () => sleeping() && gate(props.snapshot.capabilities, 'config.view') === 'allowed' });
  const minecraft = () => {
    const fact = minecraftFactNow(props.snapshot, now());
    return sleeping() ? { ...fact, message: sleepingMessage(sleepPolicy.value()?.policy) } : fact;
  };
  const controls = () => lifecycleControls(props.snapshot);
  const players = () => knownPlayerCount(props.snapshot);
  const address = () => joinAddress(props.snapshot);
  const notice = () => headerNotice(props.snapshot, now(), serverPressure(id()));
  const copyAddress = async () => {
    const value = address();
    if (!value) return;
    await navigator.clipboard?.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <header data-vesta="instance-header" data-server-header data-compact={props.compact ? '' : undefined} style={{ '--header-image': `url("${art()}")` } as never}>
      <div data-vesta="instance-header-art" aria-hidden="true" />
      <div data-vesta="instance-header-main">
        <img data-vesta="instance-header-icon" src={serverIcon(id()) ?? serverArt(props.snapshot.connection.serverId || id(), initials(props.snapshot.connection.name))} alt="" draggable="false" />
        <div data-vesta="instance-header-copy">
          <h1 data-vesta="instance-header-title">{props.snapshot.connection.name}</h1>
          <p data-vesta="instance-header-meta">
            <span data-vesta="server-header-state" data-tone={minecraft().tone}>
              <StatusDot dot={statusDot(props.snapshot)} />
              {t(minecraft().message, minecraft().args)}
              <Show when={minecraft().seen}>{(seen) => <span>{t('servers.seen', { time: t(seen().message, { count: seen().count }) })}</span>}</Show>
            </span>
            <Show when={props.snapshot.info?.minecraftVersion}>{(version) => <span>{version()}</span>}</Show>
            <Show when={players() !== null}>
              <span>{t('servers.players.count', { count: players()! })}</span>
            </Show>
            <Show when={address()}>
              {(value) => (
                <span data-vesta="server-header-address">
                  <Sensitive label={t('servers.join-address')}>{value()}</Sensitive>
                  <IconButton size="sm" variant="ghost" label={copied() ? t('servers.copied') : t('servers.copy-join-address')}
                    icon={<Icon name={copied() ? 'icons/controls/check' : 'icons/actions/copy'} />} onClick={() => void copyAddress()} />
                </span>
              )}
            </Show>
          </p>
        </div>
        <div data-vesta="instance-header-actions">
          <IconButton variant="ghost" label={t('servers.settings.title')} icon={<Icon name="icons/content/gear" />} onClick={props.onOpenSettings} />
          <Menu
            placement="bottom-end"
            trigger={(menuProps) => (
              <IconButton {...menuProps} variant="ghost" label={t('servers.actions')} tooltip={false} icon={<Icon name="icons/content/ellipsis-v" />} />
            )}
          >
            <MenuItem disabled={serverRefreshing(id())} onSelect={() => void refreshServerWithFeedback(id())}>{t('servers.refresh')}</MenuItem>
            <MenuItem onSelect={props.onOpenSettings}>{t('servers.settings.title')}</MenuItem>
            <Show when={address()}>
              <MenuItem onSelect={() => void copyAddress()}>{t('servers.copy-join-address')}</MenuItem>
            </Show>
            <MenuItem onSelect={() => void updateServer(id(), { pinned: !props.snapshot.connection.pinned })}>
              {props.snapshot.connection.pinned ? t('common.unpin') : t('servers.pin')}
            </MenuItem>
            {/* Beside Sleep or Wake, a full Stop (listener off too) lives here, as in AMP. */}
            <Show when={controls().stop}>
              <MenuSeparator />
              <MenuItem
                icon={<Icon name="icons/actions/stop" />}
                disabled={!!lifecycle.busy() || lifecycle.pending('stop')}
                onSelect={() => void lifecycle.submit('stop')}
              >
                {t('servers.lifecycle.stop')}
              </MenuItem>
            </Show>
            <MenuSeparator />
            <MenuItem onSelect={() => setRemoving(true)}>{t('servers.remove')}</MenuItem>
          </Menu>
          <LifecycleBar snapshot={props.snapshot} lifecycle={lifecycle} />
        </div>
      </div>
      <Show when={notice()}>
        {(current) => (
          <div data-vesta="instance-notice" data-tone={current().tone} role={current().tone === 'danger' ? 'alert' : 'status'}>
            <Icon
              name={current().kind === 'connection' ? 'icons/status/connection-lost' : current().tone === 'danger' ? 'icons/status/error' : current().tone === 'warning' ? 'icons/controls/warning' : 'icons/status/info'}
              size={14}
            />
            <p>
              <strong>{t(current().title.message, current().title.args)}</strong>
              <Show when={current().text}>{(text) => <span>{t(text().message, text().args)}</span>}</Show>
            </p>
            <Show when={current().action === 'restart'}>
              <Button size="sm" variant="outline" disabled={!!lifecycle.busy() || lifecycle.pending('restart')} onClick={() => void lifecycle.submit('restart')}>
                {t('servers.notice.restart-now')}
              </Button>
            </Show>
            <Show when={current().action === 'retry'}>
              <Button size="sm" variant="outline" disabled={serverRefreshing(id())} onClick={() => void refreshServerWithFeedback(id())}>
                {t('servers.offline.retry')}
              </Button>
            </Show>
          </div>
        )}
      </Show>
      <RemoveServerDialog snapshot={props.snapshot} open={removing()} onOpenChange={setRemoving} />
    </header>
  );
}

/** Start / Stop / Restart; Force kill replaces Stop while a stop hangs, and arms on the Starting button. */
function LifecycleBar(props: { snapshot: ServerSnapshot; lifecycle: Lifecycle }) {
  const [killOpen, setKillOpen] = createSignal(false, { name: 'server-lifecycle:kill-open' });
  const controls = () => lifecycleControls(props.snapshot);
  const { busy, pending, submit, uncertain } = props.lifecycle;
  // A submitted start shows Starting before the snapshot reports it.
  const startProgress = (): 'starting' | 'waking' | null =>
    controls().progress ?? (busy() === 'start' || pending('start') ? 'starting' : null);

  return (
    <div data-vesta="server-lifecycle">
      {/* Offline and needs-attention are explained by the notice strip. */}
      <Show when={!controls().primary && controls().blocked !== 'servers.lifecycle.offline' && controls().blocked !== 'servers.lifecycle.needs-attention' ? controls().blocked : null}>
        {(blocked) => <span data-vesta="server-lifecycle-note">{t(blocked())}</span>}
      </Show>
      <Show when={uncertain()}>
        <span data-vesta="server-lifecycle-note" role="status">{t('servers.operation.uncertain-retry')}</span>
      </Show>
      <Show when={controls().restart}>
        <Button variant="outline" icon={<Icon name="icons/actions/reload" />} disabled={!!busy() || pending('restart')} onClick={() => void submit('restart')}>
          {t('servers.lifecycle.restart')}
        </Button>
      </Show>
      <Show when={startProgress()}>
        {(progress) => <StartKillButton progress={progress()} canKill={controls().primary === 'kill'} onKill={() => setKillOpen(true)} />}
      </Show>
      <Show when={!startProgress() && controls().primary}>
        {(primary) => (
          <Show
            when={primary() === 'kill'}
            fallback={
              <Button
                tone={primary() === 'start' || primary() === 'wake' ? 'accent' : 'neutral'}
                icon={<Icon name={actionIcons[primary()]} />}
                disabled={!!busy() || pending(primary())}
                onClick={() => void submit(primary() as SubmittableAction)}
              >
                {busy() === primary() ? t('servers.lifecycle.sending') : t(actionLabels[primary()])}
              </Button>
            }
          >
            <Button tone="danger" icon={<Icon name="icons/actions/stop" />} onClick={() => setKillOpen(true)}>{t('servers.lifecycle.kill')}</Button>
          </Show>
        )}
      </Show>
      <KillDialog open={killOpen()} onOpenChange={setKillOpen} snapshot={props.snapshot} />
    </div>
  );
}
