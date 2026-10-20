import { isForeground } from '../../features/activity/activity-model';
import { Popover } from '@vesta/ui';
import { For, Show, createEffect, createMemo, createSignal, onSettled, untrack } from 'solid-js';
import {
  activities,
  backgroundActivities,
  configureActivityTargets,
  markInstancesPlayed,
  markSeen,
  pillState,
  type Activity,
  type PillState,
} from '../../features/activity';
import { findInstance, playInstance, playingInstanceIds } from '../../features/instances/catalog';
import { Icon } from '../../components/icon';
import { t } from '../../localization';
import { percentText } from './format';
import { ActivityIcon } from './activity-icon';
import { ActivityPanel } from './activity-panel';
import './status-pill.css';

type Shown = Exclude<PillState, { state: 'idle' }>;
type Face = 'quiet' | 'single' | 'multi' | 'success' | 'failed' | 'ready';

const faceOf = (state: Shown): Face =>
  state.state === 'running' ? (state.count > 1 ? 'multi' : 'single') : state.state;
const leadOf = (state: Shown): Activity => ('activity' in state ? state.activity : state.activities[0]!);

// Ready installs wait only while their instance is still in the library.
configureActivityTargets((id) => !!findInstance(id));

/** The instance's current name, so a rename after install still reads correctly. */
const readyName = (activity: Activity) =>
  findInstance(activity.target?.instanceId)?.instance.name
  ?? activity.subject?.name
  ?? activity.doneTitle
  ?? activity.title;

/** "3 installs" when every running task ends in Play (instance installs), else "3 tasks". */
const countLabel = (rows: readonly Activity[]) =>
  t(rows.every((row) => row.action === 'play') ? 'activity.installs' : 'activity.tasks', { count: rows.length });

const quietTitle = (rows: readonly Activity[]) =>
  rows.length > 1
    ? t('activity.quiet-more', { title: rows[0]!.title, count: rows.length - 1 })
    : (rows[0]?.title ?? '');

/** What the pill is doing, without the percentage (also the polite announcement). */
function statusText(state: Shown): string {
  switch (state.state) {
    case 'quiet':
      return t('activity.status-quiet', { title: quietTitle(state.activities) });
    case 'running':
      return t('activity.status-running', { count: state.count, title: state.activities[0]!.title });
    case 'success':
      return state.activity.action === 'play' || !state.activity.doneTitle
        ? t('activity.status-success', { title: state.activity.title })
        : state.activity.doneTitle;
    case 'failed':
      return t('activity.status-failed', { title: state.activity.title });
    case 'ready':
      return state.activities.length > 1
        ? t('activity.status-ready-more', { title: readyName(state.activities[0]!), count: state.activities.length - 1 })
        : t('activity.status-success', { title: readyName(state.activities[0]!) });
  }
}

/** Progress ring for narrow windows; it replaces the icon when the label has already gone. */
function Ring() {
  return (
    <svg data-vesta="status-pill-ring" viewBox="0 0 18 18" aria-hidden="true">
      <circle data-vesta="status-pill-ring-track" cx="9" cy="9" r="7" />
      <circle data-vesta="status-pill-ring-value" cx="9" cy="9" r="7" pathLength="100" />
    </svg>
  );
}

/** The visible contents for one face. Re-created (and faded in) when the face changes. */
function PillFace(props: { state: Shown; face: Face }) {
  const running = () => (props.state.state === 'running' ? props.state : undefined);
  const ready = () => (props.state.state === 'ready' ? props.state : undefined);
  return (
    <span data-vesta="status-pill-face" data-face={props.face}>
      <Show when={props.face === 'quiet'}>
        <span data-vesta="status-spinner" aria-hidden="true" />
      </Show>

      <Show when={props.face === 'single' || props.face === 'success'}>
        <span data-vesta="status-pill-lead">
          <ActivityIcon activity={leadOf(props.state)} />
          <Show when={props.face === 'single'}>
            <Ring />
          </Show>
        </span>
      </Show>

      <Show when={props.face === 'multi' && running()}>
        {(state) => (
          <span data-vesta="status-pill-lead">
            <span data-vesta="status-pill-stack">
              <For each={state().icons} keyed={(row) => row.id}>
                {(row) => <ActivityIcon activity={row()} />}
              </For>
              <Show when={state().extraCount > 0}>
                <b data-vesta="status-pill-more">+{state().extraCount}</b>
              </Show>
            </span>
            <Ring />
          </span>
        )}
      </Show>

      <Show when={props.face === 'ready' && ready()}>
        {(state) => (
          <span data-vesta="status-pill-lead">
            <span data-vesta="status-pill-stack">
              <ActivityIcon activity={state().activities[0]!} />
              <For each={state().icons} keyed={(row) => row.id}>
                {(row) => <ActivityIcon activity={row()} />}
              </For>
              <Show when={state().extraCount > 0}>
                <b data-vesta="status-pill-more">+{state().extraCount}</b>
              </Show>
            </span>
          </span>
        )}
      </Show>

      <Show when={props.face === 'failed'}>
        <b data-vesta="status-pill-alert" aria-hidden="true">!</b>
      </Show>

      <Show when={props.face !== 'quiet'}>
        <span data-vesta="status-pill-label" data-tip-overflow>
          {props.face === 'single'
            ? leadOf(props.state).title
            : props.face === 'ready'
              ? readyName(leadOf(props.state))
              : props.face === 'multi'
              ? countLabel(running()?.activities ?? [])
              : props.face === 'success'
                ? leadOf(props.state).action === 'play'
                  ? t('activity.ready')
                  : (leadOf(props.state).doneTitle ?? t('activity.ready'))
                : statusText(props.state)}
        </span>
      </Show>

      <Show when={running()?.progress !== undefined}>
        <span data-vesta="status-pill-percent">{percentText(running()?.progress ?? 0)}</span>
      </Show>
    </span>
  );
}

/**
 * The titlebar status pill: a small "island" that shows running work, a short success
 * moment and failures, and opens the activity panel. Its width is measured from its
 * content and animated, so it grows leftward from its right edge; the tint behind the
 * content is the progress bar.
 */
export function StatusPill() {
  let pill: HTMLDivElement | undefined;
  let content: HTMLDivElement | undefined;
  let measured = 0;
  const [open, setOpen] = createSignal(false, { name: 'activityPanelOpen' });

  // The last visible state stays on screen while the pill collapses away.
  const shown = createMemo<Shown | undefined>(
    (previous) => {
      const state = pillState();
      return state.state === 'idle' ? previous : state;
    },
    { name: 'activityPillShown' },
  );
  // Finished background refreshes leave no actionable history in this panel.
  // Close only an empty panel; retain task history and failures the user is inspecting.
  createEffect(
    () => pillState().state === 'idle'
      && !backgroundActivities().length
      && !activities().some((row) => isForeground(row) || row.state === 'failed'),
    (empty) => { if (empty) setOpen(false); },
  );
  const collapsed = createMemo(() => pillState().state === 'idle' && !open(), { name: 'activityPillCollapsed' });
  const face = createMemo(() => {
    const state = shown();
    return state ? faceOf(state) : undefined;
  }, { name: 'activityPillFace' });
  const faceKey = createMemo(() => {
    const state = shown();
    // A ready face keys on its lead, so playing the front install fades in the next one.
    return state ? `${faceOf(state)}:${faceOf(state) === 'multi' ? '' : leadOf(state).id}` : undefined;
  }, { name: 'activityPillFaceKey' });
  const progress = () => {
    const state = shown();
    if (!state || state.state === 'quiet') return 0;
    return state.state === 'running' ? state.progress : 1;
  };
  const label = () => {
    const state = shown();
    if (!state || pillState().state === 'idle') return t('activity.panel-title');
    const status = statusText(state);
    const value = progress();
    return state.state === 'running' && value !== undefined
      ? t('activity.status-percent', { label: status, value: percentText(value) })
      : status;
  };
  // Announce state changes, not progress ticks; quiet work is not worth interrupting for.
  // A ready install is announced once: returning after other work or moving to the front is silent.
  const announcement = createMemo<{ text: string; announced: ReadonlySet<string> }>((previous) => {
    const announced = previous?.announced ?? new Set<string>();
    const state = pillState();
    if (state.state === 'idle' || state.state === 'quiet') return { text: '', announced };
    if (state.state === 'ready') {
      if (state.activities.every((row) => announced.has(row.id))) return { text: '', announced };
      return { text: statusText(state), announced: new Set([...announced, ...state.activities.map((row) => row.id)]) };
    }
    const status = statusText(state);
    return {
      text: state.state === 'failed' && state.activity.error ? `${status}. ${state.activity.error}` : status,
      announced,
    };
  }, {
    name: 'activityAnnouncement',
    equals: (a, b) => a.text === b.text && a.announced === b.announced,
  });
  // Quiet work has nothing visible but a spinner, so the hint names it.
  const tip = () => {
    const state = shown();
    return state?.state === 'quiet' && pillState().state === 'quiet' ? quietTitle(state.activities) : undefined;
  };
  const play = () => {
    const state = shown();
    return state?.state === 'ready' ? state.activities[0] : undefined;
  };

  // A successful launch from anywhere (pill, panel, card, shortcut) ends the wait; a failed
  // launch never reaches "running", so the install stays ready.
  let playing: readonly string[] = untrack(playingInstanceIds);
  createEffect(playingInstanceIds, (ids) => {
    const started = ids.filter((id) => !playing.includes(id));
    playing = ids;
    markInstancesPlayed(started);
  });

  const fit = (isCollapsed: boolean) => {
    if (!pill) return;
    // Collapsed falls back to the stylesheet's resting circle.
    pill.style.inlineSize = isCollapsed || !measured ? '' : `${measured}px`;
  };
  onSettled(() => {
    if (!content) return;
    const observer = new ResizeObserver(([entry]) => {
      // Layout size, so the pill's own scale animations never feed back into its width.
      measured = Math.ceil(entry?.borderBoxSize?.[0]?.inlineSize ?? entry?.contentRect.width ?? 0);
      fit(untrack(collapsed));
    });
    observer.observe(content);
    return () => observer.disconnect();
  });
  createEffect(() => collapsed(), (isCollapsed) => fit(isCollapsed));

  const changeOpen = (value: boolean) => {
    setOpen(value);
    // Opening the panel acknowledges every failure it shows (it lists all of them).
    if (value) markSeen();
  };

  return (
    <div data-vesta="status-pill-slot">
      <div
        ref={(element: HTMLDivElement) => (pill = element)}
        data-vesta="status-pill"
        data-face={face()}
        data-collapsed={collapsed() ? '' : undefined}
        data-open={open() ? '' : undefined}
        data-indeterminate={progress() === undefined ? '' : undefined}
        style={{ '--status-pill-progress': String(progress() ?? 0) }}
      >
        <span data-vesta="status-pill-fill" aria-hidden="true" />
        <div ref={(element: HTMLDivElement) => (content = element)} data-vesta="status-pill-content">
          <Popover
            open={open()}
            onOpenChange={changeOpen}
            placement="bottom-end"
            anchorRef={() => pill}
            title={t('activity.panel-title')}
            class="activity-panel"
            trigger={(triggerProps) => (
              <button
                {...triggerProps}
                type="button"
                data-vesta="status-pill-button"
                aria-label={label()}
                data-tip={tip()}
                tabindex={collapsed() ? -1 : undefined}
              >
                <Show when={faceKey()} keyed>
                  {(key) => <PillFace state={shown()!} face={key.slice(0, key.indexOf(':')) as Face} />}
                </Show>
              </button>
            )}
          >
            <ActivityPanel onNavigate={() => setOpen(false)} />
          </Popover>
          <Show when={play()}>
            {(activity) => (
              <button
                type="button"
                data-vesta="status-pill-play"
                aria-label={t('activity.play-ready', { title: readyName(activity()) })}
                tabindex={collapsed() ? -1 : undefined}
                onClick={() => playInstance(activity().target!.instanceId!)}
              >
                <Icon name="icons/actions/play" size={10} />
                <span data-vesta="status-pill-play-label">{t('common.play')}</span>
              </button>
            )}
          </Show>
        </div>
      </div>
      <span data-vesta="status-live" aria-live="polite">
        {announcement().text}
      </span>
    </div>
  );
}
