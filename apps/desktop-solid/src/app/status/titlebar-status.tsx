import { Button, IconButton, Popover } from '@vesta/ui';
import { For, Match, Show, Switch, createSignal } from 'solid-js';
import { downloadUpdate, notificationKey, notifications, restartToUpdate, updaterState, type HostNotification } from '../../features/activity';
import { formatRelative } from '../../features/browse/browse-model';
import { Icon } from '../../components/icon';
import { locale, t } from '../../localization';
import { percentText } from './format';
import './titlebar-status.css';

/** An icon with the small accent dot that says "something is waiting here". */
function Badged(props: { icon: string; dot: boolean; tone?: 'danger' }) {
  return (
    <span data-vesta="titlebar-badge">
      <Icon name={props.icon} size={14} />
      <Show when={props.dot}>
        <i data-vesta="titlebar-dot" data-tone={props.tone} />
      </Show>
    </span>
  );
}

/**
 * Launcher self-update: a download button with a dot while an update is available, a ring
 * while it downloads, then a compact "Restart" chip. Hidden when there is nothing to do.
 */
export function UpdateControl() {
  const ready = () => {
    const state = updaterState();
    return state.state === 'ready' ? state : undefined;
  };
  const available = () => {
    const state = updaterState();
    return state.state === 'available' ? state : undefined;
  };
  const downloading = () => {
    const state = updaterState();
    return state.state === 'downloading' ? state : undefined;
  };
  // Command failures are on the state; keep the user's next step and put the reason in its name.
  const withError = (label: string, error: string | undefined) => (error ? `${label}. ${error}` : label);

  return (
    <Switch>
      <Match when={available()}>
        {(state) => (
          <span data-vesta="titlebar-status-item">
            <IconButton
              variant="ghost"
              size="sm"
              label={withError(t('activity.update-available', { version: state().version }), state().error)}
              icon={<Badged icon="icons/actions/download" dot tone={state().error ? 'danger' : undefined} />}
              onClick={() => void downloadUpdate().catch(() => undefined)}
            />
          </span>
        )}
      </Match>
      <Match when={downloading()}>
        {(state) => (
          <span
            data-vesta="titlebar-status-item"
            data-kind="update-progress"
            role="progressbar"
            aria-label={t('activity.update-downloading', { version: state().version })}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={state().progress === undefined ? undefined : Math.round(state().progress! * 100)}
            aria-valuetext={state().progress === undefined ? undefined : percentText(state().progress!)}
            data-tip={t('activity.update-downloading', { version: state().version })}
            data-indeterminate={state().progress === undefined ? '' : undefined}
            style={{ '--update-progress': String(state().progress ?? 0) }}
          >
            <svg data-vesta="titlebar-update-ring" viewBox="0 0 22 22" aria-hidden="true">
              <circle data-vesta="titlebar-update-ring-track" cx="11" cy="11" r="9" />
              <circle data-vesta="titlebar-update-ring-value" cx="11" cy="11" r="9" pathLength="100" />
            </svg>
            <Icon name="icons/actions/download" size={12} />
          </span>
        )}
      </Match>
      <Match when={ready()}>
        {(state) => (
          <span data-vesta="titlebar-status-item">
            <button
              type="button"
              data-vesta="titlebar-restart"
              data-error={state().error ? '' : undefined}
              aria-label={withError(t('activity.update-restart-label', { version: state().version }), state().error)}
              data-tip={withError(t('activity.update-restart-label', { version: state().version }), state().error)}
              onClick={() => void restartToUpdate().catch(() => undefined)}
            >
              <Icon name="icons/actions/refresh" size={12} />
              <span data-vesta="titlebar-restart-label">{t('activity.update-restart')}</span>
            </button>
          </span>
        )}
      </Match>
    </Switch>
  );
}

const severityIcon: Record<HostNotification['severity'], string> = {
  info: 'icons/status/bell',
  success: 'icons/controls/check',
  warning: 'icons/controls/warning',
  error: 'icons/status/error',
};

function InboxRow(props: { row: HostNotification }) {
  const key = () => notificationKey(props.row);
  const when = () => (props.row.created_at ? formatRelative(props.row.created_at, Date.now(), locale()) : '');
  return (
    <li data-vesta="inbox-row" data-severity={props.row.severity} data-unread={props.row.read ? undefined : ''}>
      <span data-vesta="inbox-row-icon" aria-hidden="true">
        <Icon name={severityIcon[props.row.severity] ?? severityIcon.info} size={14} />
      </span>
      <div data-vesta="inbox-row-copy">
        <strong data-vesta="inbox-row-title">{props.row.title}</strong>
        <Show when={props.row.description}>
          <p data-vesta="inbox-row-description">{props.row.description}</p>
        </Show>
        <Show when={when()}>
          <small data-vesta="inbox-row-time">{when()}</small>
        </Show>
      </div>
      <div data-vesta="inbox-row-actions">
        <IconButton
          variant="ghost"
          size="sm"
          label={t('activity.inbox-dismiss', { title: props.row.title })}
          icon={<Icon name="icons/actions/close" size={12} />}
          onClick={() => void notifications.dismiss(key()).catch(() => undefined)}
        />
      </div>
    </li>
  );
}

/**
 * The notification inbox: a bell that appears while anything is kept, with a dot while
 * something is unread. Opening it reads everything; × removes one row, Clear all the rest.
 */
export function InboxControl() {
  const [open, setOpen] = createSignal(false, { name: 'inboxOpen' });
  const unread = () => notifications.unreadCount();
  const readAll = () => {
    for (const row of notifications.list()) if (!row.read) void notifications.markRead(notificationKey(row)).catch(() => undefined);
  };
  const clearAll = () => {
    for (const row of notifications.list()) void notifications.dismiss(notificationKey(row)).catch(() => undefined);
    setOpen(false);
  };
  const toggle = (next: boolean) => {
    setOpen(next);
    if (next) readAll();
  };

  return (
    <Show when={notifications.list().length > 0 || open()}>
      <span data-vesta="titlebar-status-item">
        <Popover
          open={open()}
          onOpenChange={toggle}
          placement="bottom-end"
          title={t('activity.inbox-title')}
          class="inbox-panel"
          trigger={(triggerProps) => (
            <IconButton
              {...triggerProps}
              variant="ghost"
              size="sm"
              label={unread() ? t('activity.inbox-label', { count: unread() }) : t('activity.inbox-title')}
              icon={<Badged icon="icons/status/bell" dot={unread() > 0} />}
            />
          )}
        >
          <div data-vesta="inbox-panel">
            <Show when={notifications.list().length > 0}>
              <Button class="inbox-clear-all" size="sm" variant="ghost" onClick={clearAll}>
                {t('activity.inbox-clear-all')}
              </Button>
            </Show>
            <Show when={notifications.list().length} fallback={<p data-vesta="inbox-empty">{t('activity.inbox-empty')}</p>}>
              <ul data-vesta="inbox-rows">
                <For each={notifications.list()} keyed={(row) => notificationKey(row)}>
                  {(row) => <InboxRow row={row()} />}
                </For>
              </ul>
            </Show>
          </div>
        </Popover>
      </span>
    </Show>
  );
}
