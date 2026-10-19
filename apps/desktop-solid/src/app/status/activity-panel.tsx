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
import { activityProgress, terminal } from '../../features/activity/activity-model';
import { formatRelative } from '../../features/browse/browse-model';
import { playInstance } from '../../features/instances/catalog';
import { Icon } from '../../components/icon';
import { locale, t } from '../../localization';
import { transitionTo } from '../transition';
import { ActivityIcon } from './activity-icon';
import { percentText } from './format';
import './activity-panel.css';

const routeOf = (activity: Activity) =>
  activity.target?.route ?? (activity.target?.instanceId ? `/library/${activity.target.instanceId}` : undefined);

const ORDER: Record<Activity['state'], number> = { running: 0, queued: 1, failed: 2, done: 2, cancelled: 2 };
/** Running, then queued (both oldest first), then finished (newest first). The ledger itself
 * reorders on every progress patch, which would make rows jump. */
function byPlace(a: Activity, b: Activity) {
  const order = ORDER[a.state] - ORDER[b.state];
  if (order) return order;
  return ORDER[a.state] < 2 ? a.startedAt - b.startedAt : (b.finishedAt ?? 0) - (a.finishedAt ?? 0);
}

/** "Mods 47/112", else the step count, else the percentage. */
function stepText(activity: Activity): string {
  if (activity.step) return activity.step;
  if (activity.totalSteps) return t('activity.step-count', { count: activity.currentStep ?? 0, max: activity.totalSteps });
  return activity.progress === undefined ? t('activity.working') : percentText(activity.progress);
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

function TaskRow(props: { activity: Activity; now: number; onNavigate: () => void }) {
  const route = () => routeOf(props.activity);
  const ago = () =>
    formatRelative(new Date(props.activity.finishedAt ?? props.now).toISOString(), props.now, locale());
  const go = (to: string) => {
    props.onNavigate();
    transitionTo(to);
  };
  const playable = () =>
    props.activity.state === 'done' && props.activity.action === 'play' ? props.activity.target?.instanceId : undefined;

  return (
    <li data-vesta="activity-row" data-state={props.activity.state}>
      <ActivityIcon activity={props.activity} size="row" />
      <div data-vesta="activity-row-head">
        <Show
          when={route()}
          fallback={<span data-vesta="activity-row-title" data-tip-overflow>{props.activity.title}</span>}
        >
          {(to) => (
            <button type="button" data-vesta="activity-row-title" data-tip-overflow onClick={() => go(to())}>
              {props.activity.title}
            </button>
          )}
        </Show>
        <Show when={props.activity.subtitle}>
          <small data-vesta="activity-row-subtitle">{props.activity.subtitle}</small>
        </Show>
      </div>

      <div data-vesta="activity-row-actions">
        <Show when={props.activity.cancellable && (props.activity.state === 'running' || props.activity.state === 'queued')}>
          <IconButton
            variant="ghost"
            size="sm"
            label={t('activity.cancel', { title: props.activity.title })}
            icon={<Icon name="icons/actions/close" size={12} />}
            onClick={() => void cancelActivity(props.activity.id).catch(() => undefined)}
          />
        </Show>
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
        <Show when={!playable() && (props.activity.state === 'done' || props.activity.state === 'failed') && route()}>
          {(to) => (
            <Button size="sm" variant="outline" onClick={() => go(to())}>
              {t('activity.open')}
            </Button>
          )}
        </Show>
      </div>

      <div data-vesta="activity-row-detail">
        <Show when={props.activity.state === 'running'}>
          <Progress
            class="activity-row-progress"
            value={activityProgress(props.activity) === undefined ? undefined : activityProgress(props.activity)! * 100}
            aria-label={props.activity.title}
          />
          <span data-vesta="activity-row-step" data-tip-overflow>{stepText(props.activity)}</span>
          <Show when={props.activity.overallProgress !== undefined && props.activity.progress !== undefined}>
            <span data-vesta="activity-row-stage-percent" title={stepText(props.activity)}>{percentText(props.activity.progress!)}</span>
          </Show>
        </Show>
        <Show when={props.activity.state === 'queued'}>
          <span data-vesta="activity-row-step">{t('activity.queued')}</span>
        </Show>
        <Show when={props.activity.state === 'done'}>
          <Icon name="icons/controls/check" size={11} />
          <span data-vesta="activity-row-step">
            {t(props.activity.action === 'play' ? 'activity.installed-ago' : 'activity.finished-ago', { time: ago() })}
          </span>
        </Show>
        <Show when={props.activity.state === 'cancelled'}>
          <span data-vesta="activity-row-step">{t('activity.cancelled-ago', { time: ago() })}</span>
        </Show>
        <Show when={props.activity.state === 'failed'}>
          <Icon name="icons/status/error" size={11} />
          <ActivityError message={props.activity.error || t('activity.failed')} />
        </Show>
      </div>
    </li>
  );
}

/** The activity panel under the status pill: tasks, then quiet background work. */
export function ActivityPanel(props: { onNavigate: () => void }) {
  // Relative times ("2 minutes ago") only need to move while the panel is open.
  const [now, setNow] = createSignal(Date.now(), { name: 'activityPanelClock' });
  onSettled(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  });

  const tasks = createMemo(() => activities().filter((row) => row.kind === 'task').sort(byPlace), {
    name: 'activityPanelTasks',
  });
  const background = createMemo(
    () => [
      ...backgroundActivities(),
      ...activities().filter((row) => row.kind === 'background' && row.state === 'failed'),
    ],
    { name: 'activityPanelBackground' },
  );
  // Hidden successful background work must not expose an ineffective clear action.
  const hasFinished = () => tasks().some(terminal) || background().some(terminal);

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

      <Show
        when={tasks().length || background().length}
        fallback={<p data-vesta="activity-panel-empty">{t('activity.empty')}</p>}
      >
        <Show when={tasks().length}>
          <ul data-vesta="activity-rows">
            <For each={tasks()} keyed={(row) => row.id}>
              {(row) => <TaskRow activity={row()} now={now()} onNavigate={props.onNavigate} />}
            </For>
          </ul>
        </Show>
        <Show when={background().length}>
          <section data-vesta="activity-background">
            <h3 data-vesta="activity-background-title">{t('activity.background')}</h3>
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
