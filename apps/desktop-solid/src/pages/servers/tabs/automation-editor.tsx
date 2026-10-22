import { Button, Dialog, IconButton, Menu, MenuItem, MenuSeparator, NumberField, SegmentedControl, Select, Switch, TextArea, TextField, Tooltip, toast } from '@vesta/ui';
import { For, Show, createMemo, createSignal, onSettled } from 'solid-js';
import { Icon } from '../../../components/icon';
import { SettingRow } from '../../../components/setting-row';
import { transitionTo } from '../../../app/transition';
import { t } from '../../../localization';
import type { MessageId } from '../../../localization/messages';
import { gate } from '../../../features/servers/capabilities';
import { errorMessage } from '../../../features/servers/errors';
import { IntentMemo, newIntentId } from '../../../features/servers/model';
import {
  BOUNDS, clockTime, cronFromSchedule, defaultAction, defaultTimeout, duration, formatOffset, forwardTargets, fromEditorDraft, isScheduled,
  localOffsetMinutes, moveStep, newStep, offsetChoices, removeStep, renameStep, scheduleFromCron, stepSummary, templateDraft, toEditorDraft,
  triggerSentence, workflowProblems, type DraftAction, type DraftStep, type EditorDraft, type Problem,
} from '../../../features/servers/automation-model';
import { serverCommand } from '../../../features/servers/store';
import type { ServerCommandError, ServerSnapshot } from '../../../features/servers/native';
import type { ActionKind, FailureBranch, MissedPolicy, SuccessBranch, TriggerKind, WorkflowDetail, WorkflowTrigger } from '../../../features/servers/native-automation';
import { ServerErrorNote } from '../parts';
import { RunList } from './automation-runs';
import {
  actionLabels, encodeItem, handOffDraft, principalName, takeHandOff, triggerLabels, weekdayName, type AutomationRefs,
} from './automation-shared';

const TRIGGER_ORDER: TriggerKind[] = [
  'cron', 'interval', 'manual', 'agent_startup', 'server_started', 'server_stopped', 'server_crashed',
  'player_count_zero', 'first_player_joined', 'update_available', 'backup_completed', 'backup_failed',
];
const ACTION_ORDER: ActionKind[] = ['console_command', 'notify', 'delay', 'backup', 'verify_backup', 'restart', 'start', 'stop', 'clean_trash', 'script_preset'];
/** Monday first, as most schedules are read. */
const WEEK = [1, 2, 3, 4, 5, 6, 0];

const sameJson = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const asWire = (detail: WorkflowDetail) => fromEditorDraft(toEditorDraft({ name: detail.name, executionPrincipalId: detail.executionPrincipalId, definition: detail.definition }, detail.enabled));

/** Builds the starting trigger when the kind changes, keeping what still applies. */
function triggerFor(kind: TriggerKind, previous: WorkflowTrigger): WorkflowTrigger {
  if (kind === previous.kind) return previous;
  switch (kind) {
    case 'cron': return { kind, expr: '0 4 * * *', utcOffsetMinutes: localOffsetMinutes() };
    case 'interval': return { kind, seconds: 6 * 3600 };
    case 'backup_completed': case 'backup_failed': return { kind, profile: 'profile' in previous ? previous.profile : null };
    default: return { kind } as WorkflowTrigger;
  }
}

/** Creates or edits one workflow; existing workflows also show their run history. */
export function WorkflowEditor(props: { snapshot: ServerSnapshot; workflowId: string; refs: AutomationRefs }) {
  const id = () => props.snapshot.connection.id;
  const isNew = () => props.workflowId === 'new';
  const canManage = () => gate(props.snapshot.capabilities, 'automation.manage') !== 'denied';
  const [base, setBase] = createSignal<WorkflowDetail | null>(null, { name: 'server-automation-editor:base' });
  const [draft, setDraft] = createSignal<EditorDraft | null>(null, { name: 'server-automation-editor:draft' });
  const [error, setError] = createSignal<ServerCommandError | null>(null, { name: 'server-automation-editor:error' });
  const [stale, setStale] = createSignal(false, { name: 'server-automation-editor:stale' });
  const [saving, setSaving] = createSignal(false, { name: 'server-automation-editor:saving' });
  const [view, setView] = createSignal<'edit' | 'runs'>('edit', { name: 'server-automation-editor:view' });
  const [deleting, setDeleting] = createSignal(false, { name: 'server-automation-editor:deleting' });
  const [reloadRuns, setReloadRuns] = createSignal(0, { name: 'server-automation-editor:reload-runs' });
  const intents = new IntentMemo();

  const fetchBase = () => serverCommand((client) => client.automationWorkflow(id(), props.workflowId));
  const load = async () => {
    setError(null);
    try {
      if (isNew()) {
        const handed = takeHandOff();
        if (handed) { setDraft(handed); return; }
        await props.refs.ready;
        setDraft(templateDraft('blank', { name: '', principalId: props.refs.self()?.principalId ?? '', offsetMinutes: localOffsetMinutes(), profile: props.refs.profiles()[0] }));
        return;
      }
      const detail = await fetchBase();
      setBase(detail);
      setDraft(toEditorDraft(detail, detail.enabled));
    } catch (reason) { setError(reason as ServerCommandError); }
  };
  onSettled(() => { void load(); });

  const problems = createMemo(() => (draft() ? workflowProblems(draft()!) : []), { name: 'server-automation-editor:problems' });
  const problem = (path: string): string | undefined => {
    const found = problems().find((entry: Problem) => entry.path === path);
    return found ? t(found.message, found.args) : undefined;
  };
  /** Any problem at or under a path, e.g. a whole step card. */
  const invalidAt = (prefix: string) => problems().some((entry: Problem) => entry.path === prefix || entry.path.startsWith(`${prefix}.`));
  const dirty = () => {
    const current = draft();
    if (!current) return false;
    if (isNew()) return true;
    const saved = base();
    return !!saved && !sameJson(fromEditorDraft(current), asWire(saved));
  };
  const patch = (next: Partial<EditorDraft>) => setDraft((current) => (current ? { ...current, ...next } : current));
  const setSteps = (update: (steps: DraftStep[]) => DraftStep[]) => setDraft((current) => (current ? { ...current, steps: update(current.steps) } : current));

  const save = async () => {
    const current = draft();
    if (!current || problems().length) return;
    const wire = fromEditorDraft(current);
    const saved = base();
    setSaving(true); setError(null);
    try {
      if (isNew()) {
        const result = await serverCommand((client) => client.automationWorkflowCreate(id(), wire, current.enabled, intents.idFor({ wire, enabled: current.enabled })));
        intents.settle();
        toast.show({ title: t('server-automation.created', { name: wire.name }), tone: 'success' });
        transitionTo(`/servers/${id()}/automation/${encodeItem(result.workflowId)}`, undefined, { replace: true });
        return;
      }
      if (!saved) return;
      await serverCommand((client) => client.automationWorkflowUpdate(id(), saved.id, saved.revision, wire, intents.idFor({ wire, revision: saved.revision })));
      intents.settle();
      const fresh = await fetchBase();
      setBase(fresh);
      setDraft(toEditorDraft(fresh, fresh.enabled));
      setStale(false);
      toast.show({ title: t('server-automation.saved'), tone: 'success' });
    } catch (reason) {
      const failure = reason as ServerCommandError;
      intents.settle(failure);
      if (failure.code === 'stale_target' && !isNew()) {
        // Someone else saved first: take their revision and keep these edits on top for review.
        try { setBase(await fetchBase()); setStale(true); } catch (again) { setError(again as ServerCommandError); }
      } else setError(failure);
    } finally { setSaving(false); }
  };

  const discard = () => {
    if (isNew()) { transitionTo(`/servers/${id()}/automation`); return; }
    const saved = base();
    if (saved) setDraft(toEditorDraft(saved, saved.enabled));
    setStale(false);
  };

  const runNow = async () => {
    const saved = base();
    if (!saved) return;
    try {
      const result = await serverCommand((client) => client.automationWorkflowRun(id(), saved.id, newIntentId()));
      toast.show({ title: t(result.skipped ? 'server-automation.run-skipped' : 'server-automation.run-started', { name: saved.name }), tone: result.skipped ? 'warning' : 'neutral' });
      setView('runs');
      setReloadRuns((value) => value + 1);
    } catch (reason) { toast.show({ title: t(errorMessage(reason)), tone: 'danger' }); }
  };

  const duplicate = () => {
    const current = draft();
    if (!current) return;
    handOffDraft({ ...structuredClone(current), name: t('server-automation.copy-name', { name: current.name }), enabled: false });
    transitionTo(`/servers/${id()}/automation/new`);
  };

  const manualReady = () => base()?.enabled && base()?.definition.trigger.kind === 'manual';

  return (
    <div data-vesta="server-activity">
      <div data-vesta="pane-toolbar">
        <IconButton size="sm" variant="ghost" label={t('server-automation.back')} icon={<Icon name="icons/navigation/arrow-back" />} onClick={() => transitionTo(`/servers/${id()}/automation`)} />
        <span data-vesta="server-toolbar-title">{isNew() ? t('server-automation.new-title') : base()?.name ?? t('servers.loading')}</span>
        <span data-vesta="server-toolbar-spacer" />
        <Show when={!isNew()}>
          <SegmentedControl size="sm" aria-label={t('server-automation.view')} value={view()} onChange={(value) => setView(value as 'edit' | 'runs')}
            options={[{ value: 'edit', label: t('server-automation.edit') }, { value: 'runs', label: t('server-automation.runs') }]} />
          <Show when={base()?.definition.trigger.kind === 'manual' && canManage()}>
            <Tooltip content={t('server-automation.run-needs-enabled')} disabled={!!manualReady()} trigger={(tooltip) => (
              <span {...tooltip}><Button size="sm" variant="outline" icon={<Icon name="icons/actions/play" />} disabled={!manualReady() || dirty()} onClick={() => void runNow()}>{t('server-automation.run-now')}</Button></span>
            )} />
          </Show>
          <Show when={canManage()}>
            <Menu placement="bottom-end" trigger={(menu) => <IconButton {...menu} size="sm" variant="ghost" label={t('servers.actions')} tooltip={false} icon={<Icon name="icons/content/ellipsis-v" />} />}>
              <MenuItem icon={<Icon name="icons/actions/duplicate" />} onSelect={duplicate}>{t('server-automation.duplicate')}</MenuItem>
              <MenuSeparator />
              <MenuItem tone="danger" icon={<Icon name="icons/actions/delete" />} onSelect={() => setDeleting(true)}>{t('server-automation.delete')}</MenuItem>
            </Menu>
          </Show>
        </Show>
      </div>
      <Show when={view() === 'edit'} fallback={
        <div data-vesta="instance-settings-scroll">
          <RunList snapshot={props.snapshot} workflowId={props.workflowId} names={() => base()?.name ?? null} reload={reloadRuns()} />
        </div>
      }>
        <div data-vesta="settings-content" data-dirty={dirty() ? '' : undefined} class="server-automation-content">
          <div data-vesta="instance-settings-scroll">
            <Show when={!canManage()}><p data-vesta="server-callout" data-tone="neutral">{t('server-automation.view-only')}</p></Show>
            <Show when={stale()}><p data-vesta="server-callout" data-tone="warning" role="status">{t('server-automation.stale')}</p></Show>
            <ServerErrorNote error={error()} onRetry={() => void load()} />
            <Show when={draft()}>
              {(current) => (
                <>
                  <GeneralPanel draft={current()} isNew={isNew()} disabled={!canManage()} refs={props.refs} problem={problem} onPatch={patch} />
                  <TriggerPanel draft={current()} disabled={!canManage()} refs={props.refs} problem={problem} onPatch={patch} />
                  <StepsPanel steps={current().steps} disabled={!canManage()} refs={props.refs} problem={problem} invalidAt={invalidAt} onSteps={setSteps} />
                </>
              )}
            </Show>
          </div>
          <Show when={dirty() && canManage()}>
            <div data-vesta="settings-savebar" role="region" aria-label={t('server-automation.unsaved')}>
              <span data-vesta="settings-savebar-dot" />
              <span>{problems().length ? t('server-automation.problems', { count: problems().length }) : isNew() ? t('server-automation.unsaved-new') : t('server-automation.unsaved')}</span>
              <Button size="sm" variant="ghost" disabled={saving()} onClick={discard}>{t(isNew() ? 'common.cancel' : 'server-files.discard')}</Button>
              <Button size="sm" tone="accent" disabled={problems().length > 0 || saving()} onClick={() => void save()}>{t(isNew() ? 'server-automation.create' : 'server-files.save')}</Button>
            </div>
          </Show>
        </div>
      </Show>
      <Show when={deleting() && base()}>
        {(target) => <DeleteWorkflowDialog snapshot={props.snapshot} workflow={target()} onClose={() => setDeleting(false)} onDeleted={() => transitionTo(`/servers/${id()}/automation`)} />}
      </Show>
    </div>
  );
}

/** Confirms a delete; run history is kept by the agent. */
export function DeleteWorkflowDialog(props: { snapshot: ServerSnapshot; workflow: { id: string; name: string; revision: number }; onClose: () => void; onDeleted: () => void }) {
  const [busy, setBusy] = createSignal(false, { name: 'server-automation-delete:busy' });
  const [error, setError] = createSignal<ServerCommandError | null>(null, { name: 'server-automation-delete:error' });
  const confirm = async () => {
    setBusy(true); setError(null);
    try {
      await serverCommand((client) => client.automationWorkflowDelete(props.snapshot.connection.id, props.workflow.id, props.workflow.revision, newIntentId()));
      toast.show({ title: t('server-automation.deleted', { name: props.workflow.name }), tone: 'neutral' });
      props.onDeleted();
      props.onClose();
    } catch (reason) { setError(reason as ServerCommandError); }
    finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(open) => { if (!open) props.onClose(); }} size="sm" closeLabel={t('nav.close')}
      title={t('server-automation.delete-title', { name: props.workflow.name })}
      description={t('server-automation.delete-description')}
      footer={<>
        <Button variant="ghost" onClick={props.onClose}>{t('common.cancel')}</Button>
        <Button tone="danger" disabled={busy()} onClick={() => void confirm()}>{t('server-automation.delete')}</Button>
      </>}
    >
      <ServerErrorNote error={error()} />
    </Dialog>
  );
}

interface PanelProps {
  draft: EditorDraft;
  disabled: boolean;
  refs: AutomationRefs;
  problem: (path: string) => string | undefined;
  onPatch: (next: Partial<EditorDraft>) => void;
}

function GeneralPanel(props: PanelProps & { isNew: boolean }) {
  /** Yourself, and anyone whose role ranks below yours; the agent refuses the rest. */
  const principals = () => {
    const self = props.refs.self();
    const options = new Map<string, string>();
    if (self) options.set(self.principalId, t('server-automation.you'));
    for (const user of props.refs.users()) {
      if (user.id === self?.principalId) continue;
      if (!self || user.rank < self.rank) options.set(user.id, t('server-automation.principal-option', { name: user.displayName, value: user.roles[0]?.role.name ?? '' }));
    }
    const current = props.draft.executionPrincipalId;
    if (current && !options.has(current)) options.set(current, principalName(props.refs, current));
    return [...options].map(([value, label]) => ({ value, label }));
  };
  return (
    <section data-vesta="settings-panel">
      <h3>{t('server-automation.workflow')}</h3>
      <div data-vesta="settings-panel-body">
        <SettingRow label={t('server-automation.name')}>
          <TextField size="sm" aria-label={t('server-automation.name')} value={props.draft.name} readOnly={props.disabled} placeholder={t('server-automation.name-placeholder')}
            error={props.problem('name')} onChange={(value: string) => props.onPatch({ name: value })} />
        </SettingRow>
        <SettingRow label={t('server-automation.run-as')} description={t('server-automation.run-as-help')}>
          <Select size="sm" aria-label={t('server-automation.run-as')} value={props.draft.executionPrincipalId} disabled={props.disabled}
            placeholder={t('server-automation.run-as-placeholder')} error={props.problem('principal')}
            options={principals()} onChange={(value: string) => props.onPatch({ executionPrincipalId: value })} />
        </SettingRow>
        <Show when={props.isNew}>
          <SettingRow label={t('server-automation.enable-on-create')} description={t('server-automation.enable-on-create-help')}>
            <Switch size="sm" aria-label={t('server-automation.enable-on-create')} checked={props.draft.enabled} disabled={props.disabled} onChange={(value: boolean) => props.onPatch({ enabled: value })} />
          </SettingRow>
        </Show>
      </div>
    </section>
  );
}

function TriggerPanel(props: PanelProps) {
  const sentence = () => triggerSentence(props.draft.trigger, weekdayName);
  const setTrigger = (trigger: WorkflowTrigger) => props.onPatch({ trigger, ...(isScheduled(trigger) ? {} : { missedPolicy: { kind: 'skip_and_notify' } as MissedPolicy }) });
  const missed = () => props.draft.missedPolicy;
  return (
    <section data-vesta="settings-panel">
      <h3>{t('server-automation.trigger')}</h3>
      <p data-vesta="server-muted" class="server-panel-note" data-vesta-sentence>
        <Icon name="icons/content/timer" size={14} /> {t(sentence().message, sentence().args)}
      </p>
      <div data-vesta="settings-panel-body">
        <SettingRow label={t('server-automation.starts')}>
          <Select size="sm" aria-label={t('server-automation.starts')} value={props.draft.trigger.kind} disabled={props.disabled}
            options={TRIGGER_ORDER.map((kind) => ({ value: kind, label: t(triggerLabels[kind]) }))}
            onChange={(value: string) => setTrigger(triggerFor(value as TriggerKind, props.draft.trigger))} />
        </SettingRow>
        <Show when={props.draft.trigger.kind === 'cron' ? (props.draft.trigger as Extract<WorkflowTrigger, { kind: 'cron' }>) : null}>
          {(cron) => <ScheduleFields trigger={cron()} disabled={props.disabled} problem={props.problem} onChange={setTrigger} />}
        </Show>
        <Show when={props.draft.trigger.kind === 'interval' ? (props.draft.trigger as Extract<WorkflowTrigger, { kind: 'interval' }>) : null}>
          {(interval) => <IntervalFields seconds={interval().seconds} disabled={props.disabled} problem={props.problem} onChange={(seconds) => setTrigger({ kind: 'interval', seconds })} />}
        </Show>
        <Show when={props.draft.trigger.kind === 'backup_completed' || props.draft.trigger.kind === 'backup_failed' ? (props.draft.trigger as Extract<WorkflowTrigger, { profile: string | null }>) : null}>
          {(backup) => (
            <div data-vesta="settings-reveal">
              <SettingRow label={t('server-automation.backup-profile')}>
                <Select size="sm" aria-label={t('server-automation.backup-profile')} value={backup().profile ?? ''} disabled={props.disabled} error={props.problem('trigger.profile')}
                  options={[{ value: '', label: t('server-automation.any-profile') }, ...profileOptions(props.refs, backup().profile)]}
                  onChange={(value: string) => setTrigger({ kind: backup().kind, profile: value || null })} />
              </SettingRow>
            </div>
          )}
        </Show>
        <Show when={isScheduled(props.draft.trigger)}>
          <SettingRow label={t('server-automation.missed')} description={t('server-automation.missed-help')}>
            <Select size="sm" aria-label={t('server-automation.missed')} value={missed().kind} disabled={props.disabled}
              options={[
                { value: 'skip_and_notify', label: t('server-automation.missed-skip') },
                { value: 'run_latest', label: t('server-automation.missed-latest') },
                { value: 'catch_up', label: t('server-automation.missed-catch-up') },
              ]}
              onChange={(value: string) => props.onPatch({ missedPolicy: value === 'catch_up' ? { kind: 'catch_up', max: 3 } : { kind: value as 'skip_and_notify' | 'run_latest' } })} />
          </SettingRow>
          <Show when={missed().kind === 'catch_up' ? (missed() as { max: number }) : null}>
            {(policy) => (
              <div data-vesta="settings-reveal">
                <SettingRow label={t('server-automation.catch-up-max')}>
                  <NumberField size="sm" aria-label={t('server-automation.catch-up-max')} value={policy().max} min={BOUNDS.catchUp[0]} max={BOUNDS.catchUp[1]} disabled={props.disabled}
                    error={props.problem('missed.max')} onChange={(value: number) => props.onPatch({ missedPolicy: { kind: 'catch_up', max: Math.round(value) } })} />
                </SettingRow>
              </div>
            )}
          </Show>
        </Show>
      </div>
    </section>
  );
}

const profileOptions = (refs: AutomationRefs, current: string | null) => {
  const names = [...refs.profiles()];
  if (current && !names.includes(current)) names.push(current);
  return names.map((name) => ({ value: name, label: name }));
};

/** Daily/weekly builder over a raw cron expression, at a fixed UTC offset. */
function ScheduleFields(props: { trigger: Extract<WorkflowTrigger, { kind: 'cron' }>; disabled: boolean; problem: (path: string) => string | undefined; onChange: (trigger: WorkflowTrigger) => void }) {
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
  const toggleDay = (day: number) => {
    const current = schedule();
    if (!current) return;
    const days = current.kind === 'weekly' ? current.weekdays : [0, 1, 2, 3, 4, 5, 6];
    const next = days.includes(day) ? days.filter((entry) => entry !== day) : [...days, day];
    if (next.length) setExpr(cronFromSchedule({ kind: 'weekly', hour: current.hour, minute: current.minute, weekdays: next }));
  };
  const days = () => { const current = schedule(); return current?.kind === 'weekly' ? current.weekdays : [0, 1, 2, 3, 4, 5, 6]; };
  return (
    <div data-vesta="settings-reveal">
      <SettingRow label={t('server-automation.repeat')}>
        <SegmentedControl size="sm" aria-label={t('server-automation.repeat')} value={mode()} disabled={props.disabled} onChange={setMode}
          options={[{ value: 'daily', label: t('server-automation.daily') }, { value: 'weekly', label: t('server-automation.weekly') }, { value: 'custom', label: t('server-automation.custom') }]} />
      </SettingRow>
      <Show when={mode() !== 'custom'}>
        <SettingRow label={t('server-automation.time')}>
          <TextField size="sm" type="time" aria-label={t('server-automation.time')} value={time()} readOnly={props.disabled} onChange={setTime} />
        </SettingRow>
      </Show>
      <Show when={mode() === 'weekly'}>
        <SettingRow label={t('server-automation.days')}>
          <div data-vesta="server-automation-days" role="group" aria-label={t('server-automation.days')}>
            <For each={WEEK}>
              {(day) => (
                <Button size="sm" variant={days().includes(day) ? 'solid' : 'outline'} tone={days().includes(day) ? 'accent' : 'neutral'} aria-pressed={days().includes(day) ? 'true' : 'false'}
                  disabled={props.disabled} onClick={() => toggleDay(day)}>{weekdayName(day)}</Button>
              )}
            </For>
          </div>
        </SettingRow>
      </Show>
      <SettingRow label={t('server-automation.cron')} description={t('server-automation.cron-help')}>
        <TextField size="sm" aria-label={t('server-automation.cron')} value={props.trigger.expr} readOnly={props.disabled} spellcheck="false" autocomplete="off"
          error={props.problem('trigger.expr')} onChange={(value: string) => { setExpr(value); if (!scheduleFromCron(value)) setCustom(true); }} />
      </SettingRow>
      <SettingRow label={t('server-automation.offset')} description={t('server-automation.offset-help', { value: formatOffset(localOffsetMinutes()) })}>
        <Select size="sm" aria-label={t('server-automation.offset')} value={String(props.trigger.utcOffsetMinutes)} disabled={props.disabled} error={props.problem('trigger.offset')}
          options={offsetChoices(props.trigger.utcOffsetMinutes).map((value) => ({ value: String(value), label: formatOffset(value) }))}
          onChange={(value: string) => props.onChange({ ...props.trigger, utcOffsetMinutes: Number(value) })} />
      </SettingRow>
    </div>
  );
}

function IntervalFields(props: { seconds: number; disabled: boolean; problem: (path: string) => string | undefined; onChange: (seconds: number) => void }) {
  const [unit, setUnit] = createSignal<'minutes' | 'hours' | null>(null, { name: 'server-automation-interval:unit' });
  const current = () => unit() ?? (props.seconds % 3600 === 0 ? 'hours' : 'minutes');
  const size = () => (current() === 'hours' ? 3600 : 60);
  return (
    <div data-vesta="settings-reveal">
      <SettingRow label={t('server-automation.every')} description={t('server-automation.every-help')}>
        <div data-vesta="server-automation-inline">
          <NumberField size="sm" aria-label={t('server-automation.every')} value={Math.round((props.seconds / size()) * 100) / 100} min={1} max={BOUNDS.interval[1] / size()} disabled={props.disabled}
            error={props.problem('trigger.seconds')} onChange={(value: number) => props.onChange(Math.round(value * size()))} />
          <Select size="sm" aria-label={t('server-automation.unit')} value={current()} disabled={props.disabled}
            options={[{ value: 'minutes', label: t('server-automation.unit-minutes') }, { value: 'hours', label: t('server-automation.unit-hours') }]}
            onChange={(value: string) => setUnit(value as 'minutes' | 'hours')} />
        </div>
      </SettingRow>
    </div>
  );
}

function StepsPanel(props: { steps: DraftStep[]; disabled: boolean; refs: AutomationRefs; problem: (path: string) => string | undefined; invalidAt: (prefix: string) => boolean; onSteps: (update: (steps: DraftStep[]) => DraftStep[]) => void }) {
  const add = (kind: ActionKind) => props.onSteps((steps) => [...steps, newStep(kind, steps, props.refs.profiles()[0])]);
  return (
    <section data-vesta="settings-panel">
      <h3>{t('server-automation.steps')}</h3>
      <p data-vesta="server-muted" class="server-panel-note">{t('server-automation.steps-help')}</p>
      <Show when={props.problem('steps')}>{(message) => <p data-vesta="server-callout" data-tone="danger" class="server-automation-panel-callout">{message()}</p>}</Show>
      <ol data-vesta="server-automation-steps">
        <For each={props.steps} keyed={false}>
          {(step, index) => (
            <StepCard step={step()} index={index} steps={props.steps} disabled={props.disabled} refs={props.refs} problem={props.problem} invalid={props.invalidAt(`steps.${index}`)}
              onChange={(next) => props.onSteps((steps) => steps.map((entry, at) => (at === index ? next : entry)))}
              onRename={(value) => props.onSteps((steps) => renameStep(steps, index, value))}
              onMove={(by) => props.onSteps((steps) => moveStep(steps, index, by))}
              onRemove={() => props.onSteps((steps) => removeStep(steps, index))} />
          )}
        </For>
      </ol>
      <div data-vesta="server-panel-actions">
        <p data-vesta="server-muted">{t('server-automation.step-count', { count: props.steps.length, max: BOUNDS.steps[1] })}</p>
        <Menu trigger={(menu) => (
          <Button {...menu} size="sm" variant="outline" icon={<Icon name="icons/actions/add" />} disabled={props.disabled || props.steps.length >= BOUNDS.steps[1]}>{t('server-automation.add-step')}</Button>
        )}>
          <For each={ACTION_ORDER}>{(kind) => <MenuItem onSelect={() => add(kind)}>{t(actionLabels[kind])}</MenuItem>}</For>
        </Menu>
      </div>
    </section>
  );
}

const SUCCESS_LABELS: Record<string, MessageId> = { next: 'server-automation.branch-next', end: 'server-automation.branch-end' };
const FAILURE_LABELS: Record<string, MessageId> = { fail: 'server-automation.branch-fail', next: 'server-automation.branch-continue' };

function StepCard(props: {
  step: DraftStep; index: number; steps: DraftStep[]; disabled: boolean; refs: AutomationRefs; invalid: boolean;
  problem: (path: string) => string | undefined;
  onChange: (step: DraftStep) => void; onRename: (id: string) => void; onMove: (by: -1 | 1) => void; onRemove: () => void;
}) {
  const at = () => `steps.${props.index}`;
  const action = () => props.step.action;
  const setAction = (next: DraftAction) => props.onChange({ ...props.step, action: next });
  const changeKind = (kind: ActionKind) => {
    const next = defaultAction(kind, props.refs.profiles()[0]);
    props.onChange({ ...props.step, action: next, timeoutSecs: defaultTimeout(next) });
  };
  const summary = () => {
    const text = stepSummary(action());
    return t(text.message, { ...text.args, ...(text.duration ? { time: t(text.duration.message, { count: text.duration.count }) } : {}) });
  };
  /** Forward targets only, plus a now-invalid current target so the select can show it. */
  const gotoOptions = (current: string | null) => {
    const targets = forwardTargets(props.steps, props.index);
    const options = targets.map((target) => ({ value: `goto:${target}`, label: t('server-automation.branch-goto', { name: target, count: props.steps.findIndex((entry) => entry.id === target) + 1 }) }));
    if (current && !targets.includes(current)) options.push({ value: `goto:${current}`, label: t('server-automation.branch-goto-missing', { name: current }) });
    return options;
  };
  const successValue = () => {
    const branch = props.step.onSuccess;
    return branch.kind === 'goto' ? `goto:${branch.stepId}` : branch.kind === 'if_output_equals' ? 'conditional' : branch.kind;
  };
  const successOptions = () => [
    ...Object.entries(SUCCESS_LABELS).map(([value, label]) => ({ value, label: t(label) })),
    ...(props.step.onSuccess.kind === 'if_output_equals' ? [{ value: 'conditional', label: t('server-automation.branch-conditional') }] : []),
    ...gotoOptions(props.step.onSuccess.kind === 'goto' ? props.step.onSuccess.stepId : null),
  ];
  const failureValue = () => (props.step.onFailure.kind === 'goto' ? `goto:${props.step.onFailure.stepId}` : props.step.onFailure.kind);
  const failureOptions = () => [
    ...Object.entries(FAILURE_LABELS).map(([value, label]) => ({ value, label: t(label) })),
    ...gotoOptions(props.step.onFailure.kind === 'goto' ? props.step.onFailure.stepId : null),
  ];
  const setSuccess = (value: string) => {
    if (value === 'conditional') return;
    const branch: SuccessBranch = value.startsWith('goto:') ? { kind: 'goto', stepId: value.slice(5) } : { kind: value as 'next' | 'end' };
    props.onChange({ ...props.step, onSuccess: branch });
  };
  const setFailure = (value: string) => {
    const branch: FailureBranch = value.startsWith('goto:') ? { kind: 'goto', stepId: value.slice(5) } : { kind: value as 'fail' | 'next' };
    props.onChange({ ...props.step, onFailure: branch });
  };

  return (
    <li data-vesta="server-automation-step" data-invalid={props.invalid ? '' : undefined}>
      <header data-vesta="server-automation-step-head">
        <span data-vesta="server-automation-step-index">{props.index + 1}</span>
        <Select size="sm" aria-label={t('server-automation.action')} value={action().kind} disabled={props.disabled}
          options={ACTION_ORDER.map((kind) => ({ value: kind, label: t(actionLabels[kind]) }))} onChange={(value: string) => changeKind(value as ActionKind)} />
        <span data-vesta="server-automation-step-summary">{summary()}</span>
        <span data-vesta="server-toolbar-spacer" />
        <IconButton size="sm" variant="ghost" label={t('server-automation.move-up')} icon={<Icon name="icons/navigation/arrow-up" />} disabled={props.disabled || props.index === 0} onClick={() => props.onMove(-1)} />
        <IconButton size="sm" variant="ghost" label={t('server-automation.move-down')} icon={<Icon name="icons/navigation/arrow-down" />} disabled={props.disabled || props.index === props.steps.length - 1} onClick={() => props.onMove(1)} />
        <IconButton size="sm" variant="ghost" tone="danger" label={t('server-automation.remove-step')} icon={<Icon name="icons/actions/delete" />} disabled={props.disabled || props.steps.length <= 1} onClick={() => props.onRemove()} />
      </header>
      <div data-vesta="server-automation-step-fields">
        <TextField size="sm" label={t('server-automation.step-id')} description={t('server-automation.step-id-help')} value={props.step.id} readOnly={props.disabled} spellcheck="false" autocomplete="off"
          error={props.problem(`${at()}.id`)} onChange={(value: string) => props.onRename(value)} />
        <ActionFields action={action()} at={`${at()}.action`} disabled={props.disabled} refs={props.refs} problem={props.problem} onChange={setAction} />
      </div>
      <div data-vesta="server-automation-step-flow">
        <NumberField size="sm" label={t('server-automation.timeout')} value={props.step.timeoutSecs} min={BOUNDS.timeout[0]} max={BOUNDS.timeout[1]} disabled={props.disabled}
          description={t(duration(props.step.timeoutSecs).message, { count: duration(props.step.timeoutSecs).count })}
          error={props.problem(`${at()}.timeout`)} onChange={(value: number) => props.onChange({ ...props.step, timeoutSecs: Math.round(value) })} />
        <NumberField size="sm" label={t('server-automation.retries')} value={props.step.retries.maxRetries} min={BOUNDS.retries[0]} max={BOUNDS.retries[1]} disabled={props.disabled}
          error={props.problem(`${at()}.retries`)} onChange={(value: number) => props.onChange({ ...props.step, retries: { ...props.step.retries, maxRetries: Math.round(value) } })} />
        <NumberField size="sm" label={t('server-automation.backoff')} value={props.step.retries.backoffSecs} min={BOUNDS.backoff[0]} max={BOUNDS.backoff[1]} disabled={props.disabled || props.step.retries.maxRetries === 0}
          error={props.problem(`${at()}.backoff`)} onChange={(value: number) => props.onChange({ ...props.step, retries: { ...props.step.retries, backoffSecs: Math.round(value) } })} />
        <Select size="sm" label={t('server-automation.on-success')} value={successValue()} disabled={props.disabled} options={successOptions()} error={props.problem(`${at()}.onSuccess`)} onChange={setSuccess} />
        <Select size="sm" label={t('server-automation.on-failure')} value={failureValue()} disabled={props.disabled} options={failureOptions()} error={props.problem(`${at()}.onFailure`)} onChange={setFailure} />
      </div>
    </li>
  );
}

function ActionFields(props: { action: DraftAction; at: string; disabled: boolean; refs: AutomationRefs; problem: (path: string) => string | undefined; onChange: (action: DraftAction) => void }) {
  const kind = () => props.action.kind;
  const as = <K extends DraftAction['kind']>(name: K) => (kind() === name ? (props.action as Extract<DraftAction, { kind: K }>) : null);
  const backup = () => (kind() === 'backup' || kind() === 'verify_backup' ? (props.action as Extract<DraftAction, { kind: 'backup' | 'verify_backup' }>) : null);
  return (
    <>
      <Show when={as('delay')}>
        {(delay) => (
          <NumberField size="sm" label={t('server-automation.delay')} value={delay().secs} min={BOUNDS.delay[0]} max={BOUNDS.delay[1]} disabled={props.disabled}
            description={t(duration(delay().secs).message, { count: duration(delay().secs).count })}
            error={props.problem(`${props.at}.secs`)} onChange={(value: number) => props.onChange({ kind: 'delay', secs: Math.round(value) })} />
        )}
      </Show>
      <Show when={backup()}>
        {(current) => (
          <Show when={props.refs.profiles().length} fallback={
            <TextField size="sm" label={t('server-automation.backup-profile')} value={current().profile} readOnly={props.disabled} error={props.problem(`${props.at}.profile`)}
              onChange={(value: string) => props.onChange({ kind: current().kind, profile: value })} />
          }>
            <Select size="sm" label={t('server-automation.backup-profile')} value={current().profile} disabled={props.disabled} error={props.problem(`${props.at}.profile`)}
              options={profileOptions(props.refs, current().profile)} onChange={(value: string) => props.onChange({ kind: current().kind, profile: value })} />
          </Show>
        )}
      </Show>
      <Show when={as('console_command')}>
        {(command) => (
          <TextField size="sm" class="server-automation-wide" label={t('server-automation.console-line')} description={t('server-automation.console-line-help')} placeholder="say Hello!"
            value={command().line} readOnly={props.disabled} spellcheck="false" autocomplete="off" error={props.problem(`${props.at}.line`)}
            onChange={(value: string) => props.onChange({ kind: 'console_command', line: value })} />
        )}
      </Show>
      <Show when={as('notify')}>
        {(notify) => (
          <>
            <Select size="sm" label={t('server-automation.severity')} value={notify().severity} disabled={props.disabled}
              options={[
                { value: 'info', label: t('server-automation.severity-info') },
                { value: 'warning', label: t('server-automation.severity-warning') },
                { value: 'critical', label: t('server-automation.severity-critical') },
              ]}
              onChange={(value: string) => props.onChange({ ...notify(), severity: value as 'info' | 'warning' | 'critical' })} />
            <TextField size="sm" class="server-automation-wide" label={t('server-automation.notify-title')} value={notify().title} readOnly={props.disabled} error={props.problem(`${props.at}.title`)}
              onChange={(value: string) => props.onChange({ ...notify(), title: value })} />
            <TextArea size="sm" class="server-automation-wide" label={t('server-automation.notify-body')} value={notify().body} readOnly={props.disabled} rows={2} error={props.problem(`${props.at}.body`)}
              onChange={(value: string) => props.onChange({ ...notify(), body: value })} />
          </>
        )}
      </Show>
      <Show when={as('script_preset')}>
        {(script) => (
          <>
            <TextField size="sm" label={t('server-automation.preset')} description={t('server-automation.preset-help')} value={script().preset} readOnly={props.disabled} spellcheck="false"
              error={props.problem(`${props.at}.preset`)} onChange={(value: string) => props.onChange({ ...script(), preset: value })} />
            <div data-vesta="server-automation-params" class="server-automation-wide">
              <span data-vesta="server-automation-label">{t('server-automation.params')}</span>
              <For each={script().params} keyed={false}>
                {(param, index) => (
                  <div data-vesta="server-automation-param">
                    <TextField size="sm" aria-label={t('server-automation.param-key')} placeholder={t('server-automation.param-key')} value={param()[0]} readOnly={props.disabled}
                      error={props.problem(`${props.at}.params.${index}.key`)}
                      onChange={(value: string) => props.onChange({ ...script(), params: script().params.map((entry, at) => (at === index ? [value, entry[1]] : entry)) })} />
                    <TextField size="sm" aria-label={t('server-automation.param-value')} placeholder={t('server-automation.param-value')} value={param()[1]} readOnly={props.disabled}
                      error={props.problem(`${props.at}.params.${index}.value`)}
                      onChange={(value: string) => props.onChange({ ...script(), params: script().params.map((entry, at) => (at === index ? [entry[0], value] : entry)) })} />
                    <IconButton size="sm" variant="ghost" label={t('server-automation.remove-param')} icon={<Icon name="icons/actions/close" />} disabled={props.disabled}
                      onClick={() => props.onChange({ ...script(), params: script().params.filter((_, at) => at !== index) })} />
                  </div>
                )}
              </For>
              <Show when={props.problem(`${props.at}.params`)}>{(message) => <p data-vesta="server-automation-error">{message()}</p>}</Show>
              <div>
                <Button size="sm" variant="ghost" icon={<Icon name="icons/actions/add" />} disabled={props.disabled || script().params.length >= BOUNDS.params}
                  onClick={() => props.onChange({ ...script(), params: [...script().params, ['', '']] })}>{t('server-automation.add-param')}</Button>
              </div>
            </div>
          </>
        )}
      </Show>
      <Show when={['start', 'stop', 'restart', 'clean_trash'].includes(kind())}>
        <p data-vesta="server-muted" class="server-automation-wide">{t('server-automation.no-fields')}</p>
      </Show>
    </>
  );
}
