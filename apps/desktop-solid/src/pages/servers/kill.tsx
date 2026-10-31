// Force kill, shared by the header, server cards and rail pins: the two-step dialog, and the
// primary button that shows a start in progress and arms Kill on hover or focus.
import { Button, Dialog, Tooltip } from '@vesta/ui';
import { Show, createSignal } from 'solid-js';
import { Icon } from '../../components/icon';
import { t } from '../../localization';
import { lifecycleControls, newIntentId } from '../../features/servers/model';
import { putOperations, serverCommand, useServersClock } from '../../features/servers/store';
import type { ServerCommandError, ServerSnapshot } from '../../features/servers/native';
import { ServerErrorNote } from './parts';

/** Hover, or keyboard focus, arms the control; a mouse click's focus alone does not. */
function useArmed() {
  const [hovered, setHovered] = createSignal(false, { name: 'server-start-kill:hovered' });
  const [focused, setFocused] = createSignal(false, { name: 'server-start-kill:focused' });
  const handlers = {
    onPointerEnter: () => setHovered(true),
    onPointerLeave: () => setHovered(false),
    onFocus: (event: FocusEvent) => setFocused((event.currentTarget as HTMLElement).matches(':focus-visible')),
    onBlur: () => setFocused(false),
  };
  return { armed: () => hovered() || focused(), handlers };
}

const progressLabel = (progress: 'starting' | 'waking') => t(progress === 'waking' ? 'servers.lifecycle.waking-short' : 'servers.lifecycle.starting-short');

/**
 * The header's primary while Minecraft comes up: spinner and "Starting", turning into a
 * destructive Kill on hover or focus. Both faces share one grid cell, so the button keeps
 * the wider face's width and never shifts. Without kill access it only reports progress.
 */
export function StartKillButton(props: { progress: 'starting' | 'waking'; canKill: boolean; onKill: () => void }) {
  const { armed, handlers } = useArmed();
  const live = () => props.canKill && armed();
  return (
    <Button
      {...(props.canKill ? handlers : {})}
      data-server-start-kill
      data-armed={live() ? '' : undefined}
      tone={live() ? 'danger' : 'neutral'}
      aria-label={live() ? t('servers.lifecycle.kill') : progressLabel(props.progress)}
      aria-disabled={props.canKill ? undefined : 'true'}
      aria-busy="true"
      icon={
        <span data-vesta="server-start-kill-stack">
          <span data-face="progress"><span data-vesta="server-lifecycle-spinner" /></span>
          <Show when={props.canKill}><span data-face="kill"><Icon name="icons/actions/stop" /></span></Show>
        </span>
      }
      onClick={() => { if (props.canKill) props.onKill(); }}
    >
      <span data-vesta="server-start-kill-stack" aria-hidden="true">
        <span data-face="progress">{progressLabel(props.progress)}</span>
        <Show when={props.canKill}><span data-face="kill">{t('servers.lifecycle.kill-short')}</span></Show>
      </span>
    </Button>
  );
}

/** The card's round quick action while starting: spinner, arming to a red stop on hover or focus. */
export function StartKillQuick(props: { progress: 'starting' | 'waking'; canKill: boolean; onKill: () => void }) {
  const { armed, handlers } = useArmed();
  const live = () => props.canKill && armed();
  return (
    <Tooltip
      content={live() ? t('servers.lifecycle.kill') : progressLabel(props.progress)}
      placement="top"
      trigger={(tooltip) => (
        <button
          {...tooltip}
          {...(props.canKill ? handlers : {})}
          type="button"
          data-vesta="instance-card-play"
          data-server-start-kill
          data-variant={live() ? 'kill' : 'busy'}
          data-armed={live() ? '' : undefined}
          aria-label={live() ? t('servers.lifecycle.kill') : progressLabel(props.progress)}
          aria-busy="true"
          disabled={!props.canKill}
          onClick={(event) => { event.stopPropagation(); if (props.canKill) props.onKill(); }}
        >
          <span data-vesta="server-start-kill-stack">
            <span data-face="progress"><span data-vesta="instance-card-spinner" /></span>
            <Show when={props.canKill}><span data-face="kill"><Icon name="icons/actions/stop" size={14} /></span></Show>
          </span>
        </button>
      )}
    />
  );
}

/** Two-step force kill bound to the exact generation, with the server's expiry. */
export function KillDialog(props: { open: boolean; onOpenChange: (open: boolean) => void; snapshot: ServerSnapshot }) {
  const now = useServersClock();
  const [prepared, setPrepared] = createSignal<{ intentId: string; expiresAtMs: number; generation: string } | null>(null, { name: 'server-kill:prepared' });
  const [error, setError] = createSignal<ServerCommandError | null>(null, { name: 'server-kill:error' });
  const [busy, setBusy] = createSignal(false, { name: 'server-kill:busy' });
  const generation = () => props.snapshot.status?.generation ?? null;
  const starting = () => props.snapshot.status?.state === 'running';
  /** The kill only applies to the run it was prepared for, while that run still hangs or is coming up. */
  const stillKillable = () => {
    const status = props.snapshot.status;
    const target = prepared()?.generation ?? generation();
    return !!status && lifecycleControls(props.snapshot).primary === 'kill' && !!target && status.generation === target;
  };
  const remaining = () => Math.max(0, Math.ceil(((prepared()?.expiresAtMs ?? 0) - now()) / 1000));
  const expired = () => !!prepared() && remaining() === 0;
  const id = () => props.snapshot.connection.id;

  const prepare = async () => {
    const target = generation();
    if (!target) return;
    setBusy(true); setError(null);
    try {
      const intentId = newIntentId();
      const result = await serverCommand((client) => client.killPrepare(id(), target, intentId));
      setPrepared({ intentId, expiresAtMs: result.expiresAtMs, generation: target });
    } catch (reason) { setError(reason as ServerCommandError); }
    finally { setBusy(false); }
  };
  const confirm = async () => {
    const current = prepared();
    if (!current) return;
    setBusy(true); setError(null);
    try {
      const operation = await serverCommand((client) => client.killConfirm(id(), current.intentId));
      putOperations(id(), [{ ...operation, intent: operation.intent ?? 'lifecycle.kill' }]);
      setPrepared(null);
      props.onOpenChange(false);
    } catch (reason) {
      setError(reason as ServerCommandError);
      if ((reason as ServerCommandError).code === 'confirmation_expired') setPrepared(null);
    } finally { setBusy(false); }
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => { if (!open) { setPrepared(null); setError(null); } props.onOpenChange(open); }}
      title={t('servers.kill.title')}
      description={t(starting() ? 'servers.kill.description-starting' : 'servers.kill.description')}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={() => props.onOpenChange(false)}>{stillKillable() ? t('common.cancel') : t('nav.close')}</Button>
          <Show when={stillKillable()}>
            <Show
              when={prepared() && !expired()}
              fallback={<Button tone="danger" variant="outline" disabled={busy() || !generation()} onClick={() => void prepare()}>{t(expired() ? 'servers.kill.prepare-again' : 'servers.kill.prepare')}</Button>}
            >
              <Button tone="danger" disabled={busy()} onClick={() => void confirm()}>{t('servers.kill.confirm', { count: remaining() })}</Button>
            </Show>
          </Show>
        </>
      }
    >
      <dl data-vesta="server-add-facts">
        <dt>{t('servers.kill.target')}</dt>
        <dd><code>{(prepared()?.generation ?? generation() ?? '').slice(0, 12)}</code></dd>
      </dl>
      <Show
        when={stillKillable()}
        fallback={<p data-vesta="server-callout" data-tone="success" role="status">{t(starting() ? 'servers.kill.already-up' : 'servers.kill.no-longer-needed')}</p>}
      >
        <p data-vesta="server-callout" data-tone="warning">{t('servers.kill.warning')}</p>
      </Show>
      <ServerErrorNote error={error()} />
    </Dialog>
  );
}
