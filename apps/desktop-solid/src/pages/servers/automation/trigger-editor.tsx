// What starts a workflow, edited from its sentence: a popover with schedule presets and a
// custom cron, a repeat interval, an event picker, or manual only.
import { Button, NumberField, Popover, SegmentedControl, Select, TextField } from '@vesta/ui';
import { For, Show, createSignal } from 'solid-js';
import { Icon } from '../../../components/icon';
import { t } from '../../../localization';
import {
  BOUNDS, clockTime, cronFromSchedule, formatOffset, isScheduled, localOffsetMinutes, offsetChoices, scheduleFromCron, triggerGroup,
  type EditorDraft, type TriggerGroup,
} from '../../../features/servers/automation-model';
import type { MissedPolicy, TriggerKind, WorkflowTrigger } from '../../../features/servers/native-automation';
import { triggerIcon, triggerLabels, triggerText, weekdayName } from '../tabs/automation-shared';

/** Monday first, as most schedules are read. */
const WEEK = [1, 2, 3, 4, 5, 6, 0];
const EVENTS: TriggerKind[] = ['server_started', 'server_stopped', 'server_crashed', 'player_first_joined', 'first_player_joined', 'player_count_zero', 'update_available', 'backup_completed', 'backup_failed', 'agent_startup'];

/** The starting trigger for a group, keeping what still applies. */
function triggerFor(group: TriggerGroup, previous: WorkflowTrigger): WorkflowTrigger {
  if (group === triggerGroup(previous)) return previous;
  switch (group) {
    case 'schedule': return { kind: 'cron', expr: '0 4 * * *', utcOffsetMinutes: localOffsetMinutes() };
    case 'interval': return { kind: 'interval', seconds: 6 * 3600 };
    case 'event': return { kind: 'server_started' };
    case 'manual': return { kind: 'manual' };
  }
}

export type Problem = (path: string) => string | undefined;

/**
 * The trigger sentence as a button; it opens the editor. `open` is controlled so the
 * validation summary can open it on a trigger problem.
 */
export function TriggerEditor(props: {
  draft: EditorDraft; disabled: boolean; profiles: string[]; problem: Problem; invalid: boolean;
  open: boolean; onOpenChange: (open: boolean) => void; onPatch: (next: Partial<EditorDraft>) => void;
}) {
  const setTrigger = (trigger: WorkflowTrigger) => props.onPatch({ trigger, ...(isScheduled(trigger) ? {} : { missedPolicy: { kind: 'skip_and_notify' } as MissedPolicy }) });
  const group = () => triggerGroup(props.draft.trigger);
  const as = <K extends WorkflowTrigger['kind']>(...kinds: K[]) => (kinds.includes(props.draft.trigger.kind as K) ? (props.draft.trigger as Extract<WorkflowTrigger, { kind: K }>) : null);
  return (
    <Popover open={props.open} onOpenChange={props.onOpenChange} placement="bottom-start" class="server-automation-trigger-popover"
      title={t('server-automation.trigger')}
      trigger={(trigger) => (
        <button {...trigger} type="button" data-vesta="server-automation-sentence" data-invalid={props.invalid ? '' : undefined} data-problem-path="trigger"
          aria-label={t('server-automation.edit-trigger', { name: triggerText(props.draft.trigger) })}>
          <Icon name={triggerIcon(props.draft.trigger)} size={14} />
          <span>{triggerText(props.draft.trigger)}</span>
          <Show when={props.invalid}><Icon name="icons/controls/warning" size={14} /></Show>
          <Icon name="icons/controls/chevron-down" size={12} />
        </button>
      )}
    >
      <div data-vesta="server-automation-trigger-form">
        <SegmentedControl size="sm" fill aria-label={t('server-automation.starts')} value={group()} disabled={props.disabled}
          onChange={(value) => setTrigger(triggerFor(value as TriggerGroup, props.draft.trigger))}
          options={[
            { value: 'schedule', label: t('server-automation.group-schedule') },
            { value: 'interval', label: t('server-automation.group-interval') },
            { value: 'event', label: t('server-automation.group-event') },
            { value: 'manual', label: t('server-automation.group-manual') },
          ]} />
        <Show when={as('cron')}>{(cron) => <ScheduleFields trigger={cron()} disabled={props.disabled} problem={props.problem} onChange={setTrigger} />}</Show>
        <Show when={as('interval')}>
          {(interval) => <IntervalFields seconds={interval().seconds} disabled={props.disabled} problem={props.problem} onChange={(seconds) => setTrigger({ kind: 'interval', seconds })} />}
        </Show>
        <Show when={group() === 'event'}>
          <Select size="sm" label={t('server-automation.when')} value={props.draft.trigger.kind} disabled={props.disabled}
            options={EVENTS.map((kind) => ({ value: kind, label: t(triggerLabels[kind]) }))}
            onChange={(value: string) => setTrigger(value === 'backup_completed' || value === 'backup_failed'
              ? { kind: value, profile: 'profile' in props.draft.trigger ? props.draft.trigger.profile : null }
              : { kind: value } as WorkflowTrigger)} />
          <Show when={as('backup_completed', 'backup_failed')}>
            {(backup) => (
              <div data-problem-path="trigger.profile">
                <Select size="sm" label={t('server-automation.backup-profile')} value={backup().profile ?? ''} disabled={props.disabled} error={props.problem('trigger.profile')}
                  options={[{ value: '', label: t('server-automation.any-profile') }, ...profileOptions(props.profiles, backup().profile)]}
                  onChange={(value: string) => setTrigger({ kind: backup().kind, profile: value || null })} />
              </div>
            )}
          </Show>
        </Show>
        <Show when={group() === 'manual'}>
          <p data-vesta="server-muted">{t('server-automation.manual-help')}</p>
        </Show>
        <Show when={isScheduled(props.draft.trigger)}>
          <MissedFields policy={props.draft.missedPolicy} disabled={props.disabled} problem={props.problem} onChange={(missedPolicy) => props.onPatch({ missedPolicy })} />
        </Show>
        <div data-vesta="server-automation-popover-actions">
          <Button size="sm" onClick={() => props.onOpenChange(false)}>{t('server-automation.done')}</Button>
        </div>
      </div>
    </Popover>
  );
}

export const profileOptions = (profiles: string[], current: string | null) => {
  const names = [...profiles];
  if (current && !names.includes(current)) names.push(current);
  return names.map((name) => ({ value: name, label: name }));
};

/** Daily/weekly presets over a raw cron expression, at a fixed UTC offset. */
function ScheduleFields(props: { trigger: Extract<WorkflowTrigger, { kind: 'cron' }>; disabled: boolean; problem: Problem; onChange: (trigger: WorkflowTrigger) => void }) {
  const [custom, setCustom] = createSignal(false, { name: 'server-automation-schedule:custom' });
  const schedule = () => scheduleFromCron(props.trigger.expr);
  const mode = () => (custom() || !schedule() ? 'custom' : schedule()!.kind);
  const time = () => { const current = schedule(); return current ? clockTime(current.hour, current.minute) : '04:00'; };
  const setExpr = (expr: string) => props.onChange({ ...props.trigger, expr });
  const setMode = (value: string) => {
    if (value === 'custom') { setCustom(true); return; }
    setCustom(false);
    const current = schedule();
    const hour = current?.hour ?? 4;
    const minute = current?.minute ?? 0;
    setExpr(cronFromSchedule(value === 'weekly'
      ? { kind: 'weekly', hour, minute, weekdays: current?.kind === 'weekly' ? current.weekdays : [1, 2, 3, 4, 5] }
      : { kind: 'daily', hour, minute }));
  };
  const setTime = (value: string) => {
    const match = /^(\d{1,2}):(\d{2})$/.exec(value);
    const current = schedule();
    if (!match || !current) return;
    setExpr(cronFromSchedule({ ...current, hour: Math.min(23, Number(match[1])), minute: Math.min(59, Number(match[2])) }));
  };
  const days = () => { const current = schedule(); return current?.kind === 'weekly' ? current.weekdays : [0, 1, 2, 3, 4, 5, 6]; };
  const toggleDay = (day: number) => {
    const current = schedule();
    if (!current) return;
    const next = days().includes(day) ? days().filter((entry) => entry !== day) : [...days(), day];
    if (next.length) setExpr(cronFromSchedule({ kind: 'weekly', hour: current.hour, minute: current.minute, weekdays: next }));
  };
  return (
    <>
      <SegmentedControl size="sm" aria-label={t('server-automation.repeat')} value={mode()} disabled={props.disabled} onChange={setMode}
        options={[{ value: 'daily', label: t('server-automation.daily') }, { value: 'weekly', label: t('server-automation.weekly') }, { value: 'custom', label: t('server-automation.custom') }]} />
      <Show when={mode() !== 'custom'}>
        <TextField size="sm" type="time" label={t('server-automation.time')} value={time()} readOnly={props.disabled} onChange={setTime} />
      </Show>
      <Show when={mode() === 'weekly'}>
        <div data-vesta="server-automation-days" role="group" aria-label={t('server-automation.days')}>
          <For each={WEEK}>
            {(day) => (
              <Button size="sm" variant={days().includes(day) ? 'solid' : 'outline'} tone={days().includes(day) ? 'accent' : 'neutral'} aria-pressed={days().includes(day) ? 'true' : 'false'}
                disabled={props.disabled} onClick={() => toggleDay(day)}>{weekdayName(day)}</Button>
            )}
          </For>
        </div>
      </Show>
      <Show when={mode() === 'custom'}>
        <div data-problem-path="trigger.expr">
          <TextField size="sm" label={t('server-automation.cron')} description={t('server-automation.cron-help')} value={props.trigger.expr} readOnly={props.disabled}
            spellcheck="false" autocomplete="off" error={props.problem('trigger.expr')}
            onChange={(value: string) => { setExpr(value); if (!scheduleFromCron(value)) setCustom(true); }} />
        </div>
      </Show>
      <div data-problem-path="trigger.offset">
        <Select size="sm" label={t('server-automation.offset')} description={t('server-automation.offset-help', { value: formatOffset(localOffsetMinutes()) })}
          value={String(props.trigger.utcOffsetMinutes)} disabled={props.disabled} error={props.problem('trigger.offset')}
          options={offsetChoices(props.trigger.utcOffsetMinutes).map((value) => ({ value: String(value), label: formatOffset(value) }))}
          onChange={(value: string) => props.onChange({ ...props.trigger, utcOffsetMinutes: Number(value) })} />
      </div>
    </>
  );
}

function IntervalFields(props: { seconds: number; disabled: boolean; problem: Problem; onChange: (seconds: number) => void }) {
  const [unit, setUnit] = createSignal<'minutes' | 'hours' | null>(null, { name: 'server-automation-interval:unit' });
  const current = () => unit() ?? (props.seconds % 3600 === 0 ? 'hours' : 'minutes');
  const size = () => (current() === 'hours' ? 3600 : 60);
  return (
    <div data-vesta="server-automation-inline" data-problem-path="trigger.seconds">
      <NumberField size="sm" label={t('server-automation.every')} description={t('server-automation.every-help')} value={Math.round((props.seconds / size()) * 100) / 100}
        min={1} max={BOUNDS.interval[1] / size()} disabled={props.disabled}
        error={props.problem('trigger.seconds')} onChange={(value: number) => props.onChange(Math.round(value * size()))} />
      <Select size="sm" label={t('server-automation.unit')} value={current()} disabled={props.disabled}
        options={[{ value: 'minutes', label: t('server-automation.unit-minutes') }, { value: 'hours', label: t('server-automation.unit-hours') }]}
        onChange={(value: string) => setUnit(value as 'minutes' | 'hours')} />
    </div>
  );
}

function MissedFields(props: { policy: MissedPolicy; disabled: boolean; problem: Problem; onChange: (policy: MissedPolicy) => void }) {
  return (
    <>
      <Select size="sm" label={t('server-automation.missed')} description={t('server-automation.missed-help')} value={props.policy.kind} disabled={props.disabled}
        options={[
          { value: 'skip_and_notify', label: t('server-automation.missed-skip') },
          { value: 'run_latest', label: t('server-automation.missed-latest') },
          { value: 'catch_up', label: t('server-automation.missed-catch-up') },
        ]}
        onChange={(value: string) => props.onChange(value === 'catch_up' ? { kind: 'catch_up', max: 3 } : { kind: value as 'skip_and_notify' | 'run_latest' })} />
      <Show when={props.policy.kind === 'catch_up' ? (props.policy as { max: number }) : null}>
        {(policy) => (
          <div data-problem-path="missed.max">
            <NumberField size="sm" label={t('server-automation.catch-up-max')} value={policy().max} min={BOUNDS.catchUp[0]} max={BOUNDS.catchUp[1]} disabled={props.disabled}
              error={props.problem('missed.max')} onChange={(value: number) => props.onChange({ kind: 'catch_up', max: Math.round(value) })} />
          </div>
        )}
      </Show>
    </>
  );
}
