import type { JSX } from '@solidjs/web';
import { Show, createMemo, createSignal, onCleanup } from 'solid-js';
import { ContextMenu, ContextMenuItem, Tooltip } from '@vesta/ui';
import { Icon } from '../../components/icon';
import { t } from '../../localization';
import './instance-card.css';
import { InstanceActionItems } from './action-menu';

/**
 * What the card shows. Each value mirrors a state the old launcher card had.
 * The app decides which one applies; the card only renders it.
 */
export type InstanceCardState =
  | { kind: 'idle' }
  | { kind: 'installing'; label: string }
  | { kind: 'failed'; reason: string; retrying?: boolean }
  /** Unfinished installations and updates share the interrupted/resume flow. */
  | {
      kind: 'interrupted';
      label: string;
      recovery?: boolean;
      initial?: boolean;
      resuming?: boolean;
    }
  | { kind: 'warming' }
  | { kind: 'running' }
  | { kind: 'crashed'; summary?: string };

export interface InstanceCardData {
  id: string;
  name: string;
  minecraftVersion: string;
  modloader: 'vanilla' | 'fabric' | 'forge' | 'neoforge' | 'quilt' | string;
  /** Background art, a bundled asset URL. */
  image: string;
  pinned?: boolean;
}

export interface InstanceCardActions {
  /** Primary button: launch, stop, resume or open crash details, depending on state. */
  onPlay?: () => void;
  onOpen?: () => void;
  onOpenCrash?: () => void;
  onRetry?: () => void;
  onResume?: () => void;
  onOpenStandalone?: () => void;
  onAddContent?: () => void;
  onOpenFolder?: () => void;
  onTogglePin?: () => void;
  onRepair?: () => void;
  onDuplicate?: () => void;
  onExport?: () => void;
  onHardReset?: () => void;
  onUninstall?: () => void;
}

export interface InstanceCardProps extends InstanceCardActions {
  dropState?: 'active' | 'rejected';
  pending?: boolean;
  instance: InstanceCardData;
  state?: InstanceCardState;
}

const modloaderLogos: Record<string, string> = {
  fabric: 'branding/modloaders/fabric-logo',
  forge: 'branding/modloaders/forge-logo',
  neoforge: 'branding/modloaders/neoforge-logo',
  quilt: 'branding/modloaders/quilt-logo',
};

const statusTags: Partial<Record<InstanceCardState['kind'], string>> = {
  warming: 'Warming up',
  running: 'Running',
  crashed: 'Crashed',
};

/** The play button's look: one variant per state, like the old launcher's classes. */
type PlayVariant = 'launch' | 'kill' | 'resume' | 'crash' | 'busy';

function playVariant(state: InstanceCardState['kind']): PlayVariant {
  switch (state) {
    case 'running':
      return 'kill';
    case 'interrupted':
      return 'resume';
    case 'crashed':
      return 'crash';
    case 'warming':
    case 'installing':
      return 'busy';
    default:
      return 'launch';
  }
}

/** Which card tint applies. Matches the old launcher's warming/running/crashed/failed/interrupted looks. */
const cardTone: Partial<Record<InstanceCardState['kind'], string>> = {
  warming: 'warning',
  running: 'success',
  crashed: 'danger',
  failed: 'danger',
  interrupted: 'warning',
};

export function InstanceCard(props: InstanceCardProps) {
  const state = () => props.state ?? { kind: 'idle' as const };
  const kind = () => state().kind;
  // Narrowed views of the state, so markup never needs casts.
  const installing = () => {
    const current = state();
    return current.kind === 'installing' ? current : undefined;
  };
  const failed = () => {
    const current = state();
    return current.kind === 'failed' ? current : undefined;
  };
  const interrupted = () => {
    const current = state();
    return current.kind === 'interrupted' ? current : undefined;
  };
  const crashed = () => {
    const current = state();
    return current.kind === 'crashed' ? current : undefined;
  };
  const variant = () => playVariant(kind());
  const logo = createMemo(() => modloaderLogos[props.instance.modloader]);
  const busy = () => props.pending || kind() === 'installing' || kind() === 'warming';
  const overlay = () => kind() === 'installing' || kind() === 'failed' || kind() === 'interrupted';
  const overlayTone = () => (kind() === 'failed' ? 'danger' : kind() === 'interrupted' ? 'warning' : 'neutral');

  // Hover settles back to rest for a moment after the pointer leaves, like the old tile.
  const [leaving, setLeaving] = createSignal(false);
  let leaveTimer: number | undefined;
  onCleanup(() => window.clearTimeout(leaveTimer));

  const playLabel = (): string => {
    switch (kind()) {
      case 'installing':
        return `${installing()?.label}...`;
      case 'interrupted':
        if (interrupted()?.initial) return t('management.install');
        return interrupted()?.recovery
          ? 'Update recovery is incomplete. Click to resume recovery.'
          : `${interrupted()?.label} interrupted. Click to resume.`;
      case 'running':
        return 'Running (click to stop)';
      case 'warming':
        return 'Warming up...';
      case 'crashed':
        return 'Crash details';
      default:
        return 'Launch';
    }
  };

  const actionLabel = (): string => {
    switch (kind()) {
      case 'failed':
        return failed()?.retrying ? 'Retrying…' : 'Retry installation';
      case 'interrupted':
        if (interrupted()?.initial) return t('management.install');
        if (interrupted()?.resuming) return 'Resuming…';
        return interrupted()?.recovery ? 'Resume recovery' : 'Resume operation';
      default:
        return '';
    }
  };

  /** First menu item: the same action as the play button, named for the menu. */
  const menuPrimaryLabel = () => {
    switch (kind()) {
      case 'running':
        return t('instance.stop');
      case 'interrupted':
        return interrupted()?.initial ? t('management.install') : t('instance.resume');
      case 'crashed':
        return t('instance-actions.crash');
      case 'failed':
        return t('instance.retry-installation');
      default:
        return t('instance.play');
    }
  };

  const playIcon = () => {
    switch (variant()) {
      case 'kill':
        return 'icons/actions/stop';
      case 'crash':
        return 'icons/status/error';
      case 'resume':
        return 'icons/actions/play';
      case 'busy':
        return null;
      default:
        return 'icons/actions/play';
    }
  };

  const handlePlay = (event: MouseEvent) => {
    // The play button is nested in the card; its click must not also open the card.
    event.stopPropagation();
    if (busy()) return;
    props.onPlay?.();
  };

  const handleCardClick = () => {
    if (kind() === 'crashed') props.onOpenCrash?.();
    else props.onOpen?.();
  };

  const handleKey = (event: KeyboardEvent) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleCardClick();
    }
  };

  const handlePointerLeave = () => {
    setLeaving(true);
    window.clearTimeout(leaveTimer);
    leaveTimer = window.setTimeout(() => setLeaving(false), 250);
  };

  const renderCard = (triggerProps: Record<string, unknown>) => (
    <div
      {...triggerProps}
      data-vesta="instance-card"
      data-instance-id={props.instance.id}
      data-status={kind()}
      data-tone={cardTone[kind()] ?? 'neutral'}
      data-modloader={props.instance.modloader}
      data-leaving={leaving() ? '' : undefined}
      role="group"
      aria-label={props.instance.name}
      tabindex={0}
      style={
        {
          '--instance-card-image': `url('${props.instance.image}')`,
        } as JSX.CSSProperties
      }
      onClick={handleCardClick}
      onKeyDown={handleKey}
      onPointerLeave={handlePointerLeave}
    >
      <Show
        when={!overlay()}
        fallback={
          <div data-vesta="instance-card-overlay" data-tone={overlayTone()}>
            <Show
              when={kind() !== 'installing'}
              fallback={<span data-vesta="instance-card-spinner" aria-hidden="true" />}
            >
              <Icon name="icons/status/error" size={24} />
            </Show>
            <h3 data-vesta="instance-card-overlay-name">{props.instance.name}</h3>
            <Show when={kind() === 'installing'}>
              <p data-vesta="instance-card-overlay-text">{playLabel()}</p>
            </Show>
            <Show when={kind() === 'failed'}>
              <p data-vesta="instance-card-overlay-text" data-clamp="3">
                {failed()?.reason}
              </p>
            </Show>
            <Show when={kind() === 'interrupted'}>
              <p data-vesta="instance-card-overlay-text" data-clamp="3">
                {interrupted()?.initial ? t('management.ready-install') : interrupted()?.recovery
                  ? 'Recovery is incomplete. Resume to finish.'
                  : `${interrupted()?.label} was interrupted. Resume to finish.`}
              </p>
            </Show>
            <Show when={kind() === 'failed' || kind() === 'interrupted'}>
              <button
                type="button"
                data-vesta="instance-card-retry"
                disabled={failed() ? failed()?.retrying : interrupted()?.resuming}
                onClick={(event) => {
                  event.stopPropagation();
                  if (kind() === 'failed') props.onRetry?.();
                  else props.onResume?.();
                }}
              >
                <Icon name="icons/actions/play" size={12} />
                <span>{actionLabel()}</span>
              </button>
            </Show>
          </div>
        }
      >
        <div data-vesta="instance-card-top">
          <div data-vesta="instance-card-indicators">
            <Show when={statusTags[kind()]}>
              <span
                data-vesta="instance-card-tag"
                data-status={kind()}
                role={kind() === 'crashed' ? 'button' : undefined}
                tabindex={kind() === 'crashed' ? 0 : undefined}
                onClick={(event) => {
                  if (kind() !== 'crashed') return;
                  event.stopPropagation();
                  props.onOpenCrash?.();
                }}
                onKeyDown={(event) => {
                  if (kind() !== 'crashed' || (event.key !== 'Enter' && event.key !== ' ')) return;
                  // Handled here so the card's own Enter/Space handler does not also fire.
                  event.preventDefault();
                  event.stopPropagation();
                  props.onOpenCrash?.();
                }}
              >
                {statusTags[kind()]}
              </span>
            </Show>
          </div>
          <Tooltip
            content={playLabel()}
            placement="top"
            trigger={(triggerProps) => (
              <button
                {...triggerProps}
                type="button"
                data-vesta="instance-card-play"
                data-variant={variant()}
                aria-label={playLabel()}
                aria-busy={busy() ? 'true' : undefined}
                aria-pressed={kind() === 'running' ? 'true' : undefined}
                disabled={busy()}
                onClick={handlePlay}
              >
                <Show when={playIcon()} fallback={<span data-vesta="instance-card-spinner" aria-hidden="true" />}>
                  {(name) => <Icon name={name()} size={14} />}
                </Show>
              </button>
            )}
          />
        </div>

        <div data-vesta="instance-card-bottom">
          <h3 data-vesta="instance-card-name">{props.instance.name}</h3>
          <Show when={crashed()?.summary}>
            <p data-vesta="instance-card-crash">{crashed()?.summary}</p>
          </Show>
          <div data-vesta="instance-card-meta">
            <span>{props.instance.minecraftVersion}</span>
            <Show
              when={logo()}
              fallback={
                <Show when={props.instance.modloader !== 'vanilla'}>
                  <span data-vesta="instance-card-loader-text">{props.instance.modloader}</span>
                </Show>
              }
            >
              <span data-vesta="instance-card-loader">
                <Icon name={logo()} size={12} />
              </span>
            </Show>
          </div>
        </div>
      </Show>
      <Show when={props.dropState}>
        <span data-vesta="instance-card-drop-hint" data-state={props.dropState}>
          <Icon name="icons/actions/add" size={20} />
          <span>{t(props.dropState === 'active' ? 'drop.add-to-instance' : 'drop.supported-files')}</span>
        </span>
      </Show>
    </div>
  );

  return (
    <ContextMenu trigger={renderCard}>
      <ContextMenuItem onSelect={() => {
        if (kind() === 'crashed') props.onOpenCrash?.();
        else if (kind() === 'failed') props.onRetry?.();
        else if (kind() === 'interrupted') props.onResume?.();
        else props.onPlay?.();
      }} disabled={busy()}>
        {menuPrimaryLabel()}
      </ContextMenuItem>
      <InstanceActionItems {...props} context />
    </ContextMenu>
  );
}
