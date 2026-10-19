import { Button, IconButton, Progress } from '@vesta/ui';
import { For, Show, createMemo, createSignal, onSettled } from 'solid-js';
import {
  activities,
  activityError,
  backgroundActivities,
  cancelActivity,
  clearFinished,
  dismissActivity,
  type Activity,
} from '../../features/activity';
import { active, activityProgress, isForeground, terminal } from '../../features/activity/activity-model';
import { formatRelative } from '../../features/browse/browse-model';
import { findInstance, playInstance } from '../../features/instances/catalog';
import { Icon } from '../../components/icon';
import { locale, t } from '../../localization';
import { transitionTo } from '../transition';
import { ActivityIcon } from './activity-icon';
import { percentText } from './format';
import './activity-panel.css';

/** How long a finished row stays in the panel. Failures stay until dismissed. */
const RECENT_WINDOW = 3 * 60_000;

const ORDER: Record<Activity['state'], number> = { running: 0, queued: 1, failed: 2, done: 2, cancelled: 2 };
/** Running, then queued (both oldest first), then finished (newest first). The ledger itself
 * reorders on every progress patch, which would make rows jump. */
function byPlace(a: Activity, b: Activity) {
  const order = ORDER[a.state] - ORDER[b.state];
  if (order) return order;
  return ORDER[a.state] < 2 ? a.startedAt - b.startedAt : (b.finishedAt ?? 0) - (a.finishedAt ?? 0);
}

/** Legacy rows without a structured stage: "Mods 47/112", else the step count. */
function stepText(activity: Activity): string {
  if (activity.step) return activity.step;
  if (activity.totalSteps) return t('activity.step-count', { count: activity.currentStep ?? 0, max: activity.totalSteps });
  return t('activity.working');
}

/** Keep diagnostics on one line until the user asks to read the full message. */
function ActivityError(props: { message: string }) {
  let text: HTMLSpanElement | undefined;
  const [expanded, setExpanded] = createSignal(false);
  const [overflowing, setOverflowing] = createSignal(false);
  onSettled(() => {
    if (!text) return;
    const observer = new ResizeObserver(() => {
      if (text) setOverflowing(text.scrollWidth > text.clientWidth);
    });
    observer.observe(text);
    return () => observer.disconnect();
  });
  return (
    <span data-vesta="activity-row-error" data-expanded={expanded() ? '' : undefined}>
      <span ref={(element: HTMLSpanElement) => (text = element)} data-vesta="activity-error-text">{props.message}</span>
      <Show when={overflowing() || expanded()}>
        <button type="button" data-vesta="activity-error-toggle" aria-expanded={expanded() ? "true" : "false"} onClick={() => setExpanded(!expanded())}>
          {t(expanded() ? 'activity.error-less' : 'activity.error-more')}
        </button>
      </Show>
    </span>
  );
}

/** The instance a row would open or play, only while it still exists (a deleted one never does). */
function liveInstance(activity: Activity) {
  if (activity.kind === 'instance_delete') return undefined;
  const id = activity.target?.instanceId;
  return id && findInstance(id) ? id : undefined;
}

const routeOf = (activity: Activity) => {
  if (activity.kind === 'instance_delete') return undefined;
  if (activity.target?.route) return activity.target.route;
  const id = liveInstance(activity);
  return id ? `/library/${id}` : undefined;
};

function RowTitle(props: { activity: Activity; text: string; onNavigate: () => void }) {
  return (
    <Show
      when={routeOf(props.activity)}
      fallback={<span data-vesta="activity-row-title" data-tip-overflow>{props.text}</span>}
    >
      {(to) => (
        <button
          type="button"
          data-vesta="activity-row-title"
          data-tip-overflow
          onClick={() => {
            props.onNavigate();
            transitionTo(to());
          }}
        >
          {props.text}
        </button>
      )}
    </Show>
  );
}

/** Running or queued: title and percentage, a full-width bar, then the stage and its counter. */
function LiveRow(props: { activity: Activity; onNavigate: () => void }) {
  const value = () => activityProgress(props.activity);
  const queued = () => props.activity.state === 'queued';
  return (
    <li data-vesta="activity-row" data-state={props.activity.state}>
      <ActivityIcon activity={props.activity} size="row" />
      <div data-vesta="activity-row-line">
        <RowTitle activity={props.activity} text={props.activity.title} onNavigate={props.onNavigate} />
        <Show when={!queued() && value() !== undefined}>
          <span data-vesta="activity-row-percent">{percentText(value()!)}</span>
        </Show>
        <Show when={props.activity.cancellable}>
          <IconButton
            class="activity-row-cancel"
            variant="ghost"
            size="sm"
            label={t('activity.cancel', { title: props.activity.title })}
            icon={<Icon name="icons/actions/close" size={12} />}
            onClick={() => void cancelActivity(props.activity.id).catch(() => undefined)}
          />
        </Show>
      </div>
      <Progress
        class="activity-row-progress"
        value={queued() ? 0 : value() === undefined ? undefined : value()! * 100}
        aria-label={props.activity.title}
      />
      <div data-vesta="activity-row-status">
        <span data-vesta="activity-row-stage" data-tip-overflow>
          {queued() ? t('activity.queued') : (props.activity.stageLabel ?? stepText(props.activity))}
        </span>
        <Show when={!queued() && props.activity.counter}>
          <span data-vesta="activity-row-counter">{props.activity.counter}</span>
        </Show>
      </div>
    </li>
  );
}

/** Finished or cancelled: one quiet line in past tense, with Play only when it still applies. */
function RecentRow(props: { activity: Activity; now: number; onNavigate: () => void }) {
  const ago = () =>
    formatRelative(new Date(props.activity.finishedAt ?? props.now).toISOString(), props.now, locale());
  const cancelled = () => props.activity.state === 'cancelled';
  const playable = () =>
    !cancelled() && props.activity.action === 'play' ? liveInstance(props.activity) : undefined;
  return (
    <li data-vesta="activity-recent-row" data-state={props.activity.state}>
      <ActivityIcon activity={props.activity} />
      <Icon name={cancelled() ? 'icons/actions/close' : 'icons/controls/check'} size={11} />
      <RowTitle
        activity={props.activity}
        text={cancelled() ? props.activity.title : (props.activity.doneTitle ?? props.activity.title)}
        onNavigate={props.onNavigate}
      />
      <span data-vesta="activity-recent-time">
        {cancelled() ? t('activity.cancelled-ago', { time: ago() }) : ago()}
      </span>
      <Show when={playable()}>
        {(id) => (
          <Button
            size="sm"
            tone="accent"
            icon={<Icon name="icons/actions/play" size={10} />}
            onClick={() => {
              playInstance(id());
              dismissActivity(props.activity.id);
            }}
          >
            {t('common.play')}
          </Button>
        )}
      </Show>
    </li>
  );
}

/** Failed: stays until dismissed, with the error and a way to the instance when it still exists. */
function FailedRow(props: { activity: Activity; onNavigate: () => void }) {
  const route = () => routeOf(props.activity);
  return (
    <li data-vesta="activity-row" data-state="failed">
      <ActivityIcon activity={props.activity} size="row" />
      <div data-vesta="activity-row-line">
        <RowTitle activity={props.activity} text={props.activity.title} onNavigate={props.onNavigate} />
        <Show when={route()}>
          {(to) => (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                props.onNavigate();
                transitionTo(to());
              }}
            >
              {t('activity.open')}
            </Button>
          )}
        </Show>
        <IconButton
          class="activity-row-cancel"
          variant="ghost"
          size="sm"
          label={t('activity.inbox-dismiss')}
          icon={<Icon name="icons/actions/close" size={12} />}
          onClick={() => dismissActivity(props.activity.id)}
        />
      </div>
      <div data-vesta="activity-row-status">
        <Icon name="icons/status/error" size={11} />
        <ActivityError message={props.activity.error || t('activity.failed')} />
      </div>
    </li>
  );
}

/** The activity panel under the status pill: tasks, then quiet background work. */
export function ActivityPanel(props: { onNavigate: () => void }) {
  // Relative times ("2 minutes ago") only need to move while the panel is open.
  const [now, setNow] = createSignal(Date.now(), { name: 'activityPanelClock' });
  onSettled(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  });

  const foreground = createMemo(() => activities().filter((row) => isForeground(row)), {
    name: 'activityPanelForeground',
  });
  const live = createMemo(() => foreground().filter(active).sort(byPlace), { name: 'activityPanelLive' });
  const failed = createMemo(() => foreground().filter((row) => row.state === 'failed').sort(byPlace), {
    name: 'activityPanelFailed',
  });
  // Finished work is a short receipt, not a history: it leaves the panel a few minutes later.
  const recent = createMemo(
    () =>
      foreground()
        .filter((row) => (row.state === 'done' || row.state === 'cancelled') && now() - (row.finishedAt ?? 0) < RECENT_WINDOW)
        .sort(byPlace),
    { name: 'activityPanelRecent' },
  );
  const background = createMemo(
    () => [
      ...backgroundActivities(),
      ...activities().filter((row) => !isForeground(row) && row.state === 'failed'),
    ],
    { name: 'activityPanelBackground' },
  );
  const hasFinished = () => recent().length > 0 || failed().length > 0 || background().some(terminal);
  const empty = () => !live().length && !failed().length && !recent().length && !background().length;

  return (
    <div data-vesta="activity-panel">
      <Show when={hasFinished()}>
        <Button
          class="activity-panel-clear"
          size="sm"
          variant="ghost"
          onClick={clearFinished}
        >
          {t('activity.clear-finished')}
        </Button>
      </Show>

      <Show when={activityError()}>
        <p data-vesta="activity-panel-error" role="alert">{activityError()}</p>
      </Show>

      <Show when={!empty()} fallback={<p data-vesta="activity-panel-empty">{t('activity.empty')}</p>}>
        <Show when={live().length || failed().length}>
          <ul data-vesta="activity-rows">
            <For each={failed()} keyed={(row) => row.id}>
              {(row) => <FailedRow activity={row()} onNavigate={props.onNavigate} />}
            </For>
            <For each={live()} keyed={(row) => row.id}>
              {(row) => <LiveRow activity={row()} onNavigate={props.onNavigate} />}
            </For>
          </ul>
        </Show>
        <Show when={recent().length}>
          <section data-vesta="activity-recent">
            <h3 data-vesta="activity-section-title">{t('activity.recent')}</h3>
            <ul data-vesta="activity-recent-rows">
              <For each={recent()} keyed={(row) => row.id}>
                {(row) => <RecentRow activity={row()} now={now()} onNavigate={props.onNavigate} />}
              </For>
            </ul>
          </section>
        </Show>
        <Show when={background().length}>
          <section data-vesta="activity-background">
            <h3 data-vesta="activity-section-title">{t('activity.background')}</h3>
            <ul data-vesta="activity-background-rows">
              <For each={background()} keyed={(row) => row.id}>
                {(row) => (
                  <li data-vesta="activity-background-row" data-state={row().state}>
                    <Show when={row().state === 'failed'} fallback={<span data-vesta="status-spinner" aria-hidden="true" />}>
                      <Icon name="icons/status/error" size={11} />
                    </Show>
                    <span data-vesta="activity-background-name" data-tip-overflow>{row().title}</span>
                    <Show when={row().state === 'failed' && row().error}>
                      <ActivityError message={row().error!} />
                    </Show>
                  </li>
                )}
              </For>
            </ul>
          </section>
        </Show>
      </Show>
    </div>
  );
}
