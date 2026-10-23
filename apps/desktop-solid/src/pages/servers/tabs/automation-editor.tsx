import { Button, Dialog, IconButton, Menu, MenuItem, MenuSeparator, SegmentedControl, Select, Switch, TextField, toast } from '@vesta/ui';
import { For, Show, createEffect, createMemo, createSignal, onCleanup, onSettled, untrack } from 'solid-js';
import { navigate, setLeaveGuard } from '../../../app/router';
import { transitionTo } from '../../../app/transition';
import { Icon } from '../../../components/icon';
import { t } from '../../../localization';
import type { MessageId } from '../../../localization/messages';
import {
  changeStepKind, followIndex, fromEditorDraft, insertStep, problemArea, removeStep, renameStep, reorderSteps, stepReferences, toEditorDraft,
  workflowProblems, type DraftStep, type EditorDraft, type Problem, type ProblemArea,
} from '../../../features/servers/automation-model';
import { gate } from '../../../features/servers/capabilities';
import { stableConnectionId } from '../../../features/servers/connection-id';
import { errorMessage } from '../../../features/servers/errors';
import { IntentMemo, newIntentId } from '../../../features/servers/model';
import { invalidateServerResources, seedServerResource, useServerResource } from '../../../features/servers/resources';
import { serverCommand } from '../../../features/servers/store';
import type { ServerCommandError, ServerSnapshot } from '../../../features/servers/native';
import type { ActionKind, WorkflowDetail } from '../../../features/servers/native-automation';
import { ServerErrorNote } from '../parts';
import { workflowResource, workflowsResource } from '../automation/resources';
import { StepDetails } from '../automation/step-details';
import { StepFlow } from '../automation/step-flow';
import { TriggerEditor } from '../automation/trigger-editor';
import { RunList } from './automation-runs';
import {
  draftFromTemplate, dropKeptDraft, encodeItem, handOffDraft, keepDraft, keptDraft, principalName, stepText, takeHandOff, useAutomationPeople,
} from './automation-shared';

const sameJson = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const asWire = (detail: WorkflowDetail) => fromEditorDraft(toEditorDraft(detail, detail.enabled));
const saveKeys = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘S' : 'Ctrl+S';
/** Below this the details open under their card instead of beside the steps. */
const NARROW_PX = 760;

/** Problem paths as the field they point at, for the summary at the top. */
const fieldLabels: Record<string, MessageId> = {
  id: 'server-automation.step-id', timeout: 'server-automation.timeout', retries: 'server-automation.retries', backoff: 'server-automation.backoff',
  onSuccess: 'server-automation.on-success', onFailure: 'server-automation.on-failure', 'action.secs': 'server-automation.delay',
  'action.profile': 'server-automation.backup-profile', 'action.line': 'server-automation.console-line', 'action.title': 'server-automation.notify-title',
  'action.body': 'server-automation.notify-body', 'action.preset': 'server-automation.preset', 'action.params': 'server-automation.params',
};
const areaLabels: Partial<Record<ProblemArea, MessageId>> = {
  name: 'server-automation.name', principal: 'server-automation.run-as', trigger: 'server-automation.trigger', steps: 'server-automation.steps', definition: 'server-automation.workflow',
};

interface Panel { index: number; reveal: ProblemArea | null }

/** Creates or edits one workflow: a header, the step canvas and a details panel; existing workflows also show their runs. */
export function WorkflowEditor(props: { snapshot: ServerSnapshot; workflowId: string }) {
  const id = stableConnectionId(() => props.snapshot);
  const isNew = props.workflowId === 'new';
  const listPath = () => `/servers/${id()}/automation`;
  const canManage = () => gate(props.snapshot.capabilities, 'automation.manage') !== 'denied';
  // The definition is read here, when the workflow is opened, and nowhere else.
  const detail = useServerResource(id, workflowResource, { args: () => props.workflowId, enabled: () => !isNew });
  const people = useAutomationPeople(id, () => props.snapshot, { users: () => true, profiles: () => canManage() });
  const [base, setBase] = createSignal<WorkflowDetail | null>(null, { name: 'server-automation-editor:base' });
  const [draft, setDraft] = createSignal<EditorDraft | null>(null, { name: 'server-automation-editor:draft' });
  const [error, setError] = createSignal<ServerCommandError | null>(null, { name: 'server-automation-editor:error' });
  const [stale, setStale] = createSignal(false, { name: 'server-automation-editor:stale' });
  const [saving, setSaving] = createSignal(false, { name: 'server-automation-editor:saving' });
  const [toggling, setToggling] = createSignal(false, { name: 'server-automation-editor:toggling' });
  const [view, setView] = createSignal<'edit' | 'runs'>('edit', { name: 'server-automation-editor:view' });
  const [deleting, setDeleting] = createSignal(false, { name: 'server-automation-editor:deleting' });
  const [panel, setPanel] = createSignal<Panel | null>(null, { name: 'server-automation-editor:panel' });
  const [triggerOpen, setTriggerOpen] = createSignal(false, { name: 'server-automation-editor:trigger-open' });
  const [removing, setRemoving] = createSignal<number | null>(null, { name: 'server-automation-editor:removing' });
  const [leaving, setLeaving] = createSignal<string | null>(null, { name: 'server-automation-editor:leaving' });
  const [narrow, setNarrow] = createSignal(false, { name: 'server-automation-editor:narrow' });
  const intents = new IntentMemo();

  const problems = createMemo(() => (draft() ? workflowProblems(draft()!) : []), { name: 'server-automation-editor:problems' });
  const problem = (path: string): string | undefined => {
    const found = problems().find((entry: Problem) => entry.path === path);
    return found ? t(found.message, found.args) : undefined;
  };
  const invalidAt = (prefix: string) => problems().some((entry: Problem) => entry.path === prefix || entry.path.startsWith(`${prefix}.`));
  const dirty = createMemo(() => {
    const current = draft();
    if (!current) return false;
    if (isNew) return true;
    const saved = base();
    return !!saved && !sameJson(fromEditorDraft(current), asWire(saved));
  }, { name: 'server-automation-editor:dirty' });
  const patch = (next: Partial<EditorDraft>) => setDraft((current) => (current ? { ...current, ...next } : current));
  const setSteps = (update: (steps: DraftStep[]) => DraftStep[]) => setDraft((current) => (current ? { ...current, steps: update(current.steps) } : current));
  const steps = () => draft()?.steps ?? [];

  // A new workflow starts from what was handed over (template, duplicate) or what was left unsaved.
  if (isNew) {
    const start = takeHandOff() ?? keptDraft(untrack(id), 'new')?.draft ?? null;
    if (start) setDraft(start);
    else void draftFromTemplate(untrack(id), 'blank', '').then((blank) => { if (!untrack(draft)) setDraft(blank); });
  }
  // An existing workflow follows its cached definition; someone else's save marks the edits stale.
  createEffect(() => detail.value(), (value) => {
    if (!value) return;
    const current = untrack(base);
    if (!current) {
      setBase(value);
      const kept = keptDraft(untrack(id), props.workflowId);
      if (kept) { setDraft(kept.draft); if (kept.revision !== value.revision) setStale(true); }
      else setDraft(toEditorDraft(value, value.enabled));
      return;
    }
    if (value.revision === current.revision) return;
    const edited = untrack(dirty);
    setBase(value);
    if (edited) setStale(true);
    else setDraft(toEditorDraft(value, value.enabled));
  }, { name: 'server-automation-editor:base-follow' });
  // A blank workflow learns who you are once the agent says.
  createEffect(() => people.self()?.principalId, (self) => {
    const current = untrack(draft);
    if (self && current && !current.executionPrincipalId) setDraft({ ...current, executionPrincipalId: self });
  }, { name: 'server-automation-editor:fill-principal' });

  const select = (index: number | null) => setPanel(index === null ? null : { index, reveal: null });

  // ------------------------------------------------------------- leaving
  // Unsaved edits hold every way out (tabs, rail, back) behind a save/discard question.
  let releaseGuard: (() => void) | undefined;
  createEffect(() => dirty() && canManage(), (held) => {
    if (!held) return;
    const release = setLeaveGuard((to) => { setLeaving(to); return false; });
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', unload);
    releaseGuard = () => { release(); window.removeEventListener('beforeunload', unload); };
    return () => { releaseGuard?.(); releaseGuard = undefined; };
  }, { name: 'server-automation-editor:leave-guard' });
  const proceed = (to: string) => { releaseGuard?.(); setLeaving(null); navigate(to); };
  // If the editor goes away without asking (the server went offline), keep the edits for later.
  let kept = true;
  onCleanup(() => {
    setLeaving(null);
    if (kept && untrack(dirty) && untrack(canManage)) keepDraft(untrack(id), props.workflowId, { draft: untrack(draft)!, revision: untrack(base)?.revision ?? null });
  });
  const forget = () => { kept = false; dropKeptDraft(id(), props.workflowId); };

  // ---------------------------------------------------------------- save
  const save = async (then?: string): Promise<boolean> => {
    const current = draft();
    if (!current || problems().length || saving() || !canManage()) return false;
    const wire = fromEditorDraft(current);
    const saved = base();
    setSaving(true); setError(null);
    try {
      const now = Date.now();
      if (isNew) {
        const result = await serverCommand((client) => client.automationWorkflowCreate(id(), wire, current.enabled, intents.idFor({ wire, enabled: current.enabled })));
        intents.settle();
        const created: WorkflowDetail = {
          id: result.workflowId, name: wire.name, enabled: current.enabled, executionPrincipalId: wire.executionPrincipalId,
          createdAtMs: now, updatedAtMs: now, revision: result.revision, definition: wire.definition, trigger: wire.definition.trigger,
        };
        // The new editor opens on known data instead of reading it back.
        seedServerResource(id(), workflowResource, created, result.workflowId);
        invalidateServerResources(id(), [workflowsResource.name]);
        forget();
        toast.show({ title: t('server-automation.created', { name: wire.name }), tone: 'success' });
        releaseGuard?.();
        if (then) navigate(then);
        else transitionTo(`${listPath()}/${encodeItem(result.workflowId)}`, undefined, { replace: true });
        return true;
      }
      if (!saved) return false;
      const result = await serverCommand((client) => client.automationWorkflowUpdate(id(), saved.id, saved.revision, wire, intents.idFor({ wire, revision: saved.revision })));
      intents.settle();
      const fresh: WorkflowDetail = { ...saved, name: wire.name, executionPrincipalId: wire.executionPrincipalId, definition: wire.definition, trigger: wire.definition.trigger, revision: result.revision, updatedAtMs: now };
      setBase(fresh);
      setDraft(toEditorDraft(fresh, fresh.enabled));
      setStale(false);
      seedServerResource(id(), workflowResource, fresh, saved.id);
      invalidateServerResources(id(), [workflowsResource.name]);
      forget();
      toast.show({ title: t('server-automation.saved'), tone: 'success' });
      return true;
    } catch (reason) {
      const failure = reason as ServerCommandError;
      intents.settle(failure);
      if (failure.code === 'stale_target' && !isNew) {
        // Someone else saved first: their revision loads underneath and these edits stay on top.
        setStale(true);
        void detail.refresh();
      } else setError(failure);
      return false;
    } finally { setSaving(false); }
  };
  const discard = () => {
    if (isNew) { forget(); releaseGuard?.(); transitionTo(listPath()); return; }
    const saved = base();
    if (saved) setDraft(toEditorDraft(saved, saved.enabled));
    setStale(false);
    forget();
  };
  const leaveDiscarding = () => { const to = leaving(); forget(); releaseGuard?.(); setLeaving(null); if (to) navigate(to); };
  const leaveSaving = async () => {
    const to = leaving();
    if (to && await save(isNew ? to : undefined)) { if (!isNew) proceed(to); else setLeaving(null); }
    else setLeaving(null);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== 's') return;
    event.preventDefault();
    void save();
  };

  // ------------------------------------------------------------- actions
  const setEnabled = async (enabled: boolean) => {
    if (isNew) { patch({ enabled }); return; }
    const saved = base();
    if (!saved) return;
    setToggling(true);
    try {
      const result = await serverCommand((client) => client.automationWorkflowSetEnabled(id(), saved.id, saved.revision, enabled, newIntentId()));
      const fresh = { ...saved, enabled, revision: result.revision };
      setBase(fresh);
      setDraft((current) => (current ? { ...current, enabled } : current));
      seedServerResource(id(), workflowResource, fresh, saved.id);
      invalidateServerResources(id(), [workflowsResource.name]);
      toast.show({ title: t(enabled ? 'server-automation.turned-on' : 'server-automation.turned-off', { name: saved.name }), tone: 'neutral' });
    } catch (reason) {
      toast.show({ title: t(errorMessage(reason)), tone: 'danger' });
      void detail.refresh();
    } finally { setToggling(false); }
  };
  const runNow = async () => {
    const saved = base();
    if (!saved) return;
    try {
      const result = await serverCommand((client) => client.automationWorkflowRun(id(), saved.id, newIntentId()));
      toast.show({ title: t(result.skipped ? 'server-automation.run-skipped' : 'server-automation.run-started', { name: saved.name }), tone: result.skipped ? 'warning' : 'neutral' });
      invalidateServerResources(id(), ['automation-runs']);
      setView('runs');
    } catch (reason) { toast.show({ title: t(errorMessage(reason)), tone: 'danger' }); }
  };
  const duplicate = () => {
    const current = draft();
    if (!current) return;
    dropKeptDraft(id(), 'new');
    handOffDraft({ ...structuredClone(current), name: t('server-automation.copy-name', { name: current.name }), enabled: false });
    transitionTo(`${listPath()}/new`);
  };
  const manualReady = () => base()?.enabled && base()?.definition.trigger.kind === 'manual' && !dirty();

  // --------------------------------------------------------------- steps
  const reorder = (from: number, to: number) => {
    setSteps((current) => reorderSteps(current, from, to));
    const open = panel();
    if (open) setPanel({ index: followIndex(open.index, from, to), reveal: null });
  };
  const insert = (at: number, kind: ActionKind) => {
    setSteps((current) => insertStep(current, at, kind, people.profiles()[0]));
    select(at);
  };
  const remove = (index: number) => {
    setSteps((current) => removeStep(current, index));
    setRemoving(null);
    const open = panel();
    if (open) setPanel(open.index === index ? null : { index: open.index > index ? open.index - 1 : open.index, reveal: null });
  };
  /** Removing a step other steps jump to asks first: those jumps fall back to their defaults. */
  const askRemove = (index: number) => {
    const step = steps()[index];
    if (step && stepReferences(steps(), step.id).some((from) => from !== index)) setRemoving(index);
    else remove(index);
  };
  const referencing = () => {
    const index = removing();
    const step = index === null ? null : steps()[index];
    return step ? stepReferences(steps(), step.id).filter((from) => from !== index).map((from) => from + 1) : [];
  };

  // ------------------------------------------------------------ problems
  const describe = (entry: Problem) => {
    const target = problemArea(entry.path);
    const where = target.step !== null
      ? `${t('server-automation.step-number', { count: target.step + 1 })} · ${t(fieldLabels[target.field.startsWith('action.params') ? 'action.params' : target.field] ?? 'server-automation.step')}`
      : t(areaLabels[target.area] ?? 'server-automation.workflow');
    return { where, message: t(entry.message, entry.args) };
  };
  const focusProblem = (path: string) => {
    const target = problemArea(path);
    setView('edit');
    if (target.area === 'trigger') setTriggerOpen(true);
    else if (target.step !== null) setPanel({ index: target.step, reveal: target.area });
    setTimeout(() => {
      const holder = document.querySelector<HTMLElement>(`[data-problem-path="${CSS.escape(path)}"]`)
        ?? document.querySelector<HTMLElement>(`[data-problem-path="${CSS.escape(path.split('.').slice(0, 3).join('.'))}"]`);
      const focusable = holder?.matches('button, input, textarea') ? holder : holder?.querySelector<HTMLElement>('input, textarea, button, [tabindex]:not([tabindex="-1"])');
      holder?.scrollIntoView({ block: 'nearest' });
      focusable?.focus();
    }, 60);
  };

  // --------------------------------------------------------------- layout
  let canvas: HTMLDivElement | undefined;
  onSettled(() => {
    if (!canvas || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => { if (entry) setNarrow(entry.contentRect.width < NARROW_PX); });
    observer.observe(canvas);
    return () => observer.disconnect();
  });

  /** You, and anyone whose role ranks below yours; the agent refuses the rest. */
  const principals = () => {
    const self = people.self();
    const options = new Map<string, string>();
    if (self) options.set(self.principalId, t('server-automation.you'));
    for (const user of people.users()) {
      if (user.id === self?.principalId) continue;
      if (!self || user.rank < self.rank) options.set(user.id, t('server-automation.principal-option', { name: user.displayName, value: user.roles[0]?.role.name ?? '' }));
    }
    const current = draft()?.executionPrincipalId;
    if (current && !options.has(current)) options.set(current, principalName(people, current));
    return [...options].map(([value, label]) => ({ value, label }));
  };

  const details = (index: number, reveal: ProblemArea | null, onClose?: () => void) => (
    <Show when={steps()[index]}>
      {(step) => (
        <StepDetails step={step()} index={index} steps={steps()} disabled={!canManage()} profiles={people.profiles()} problem={problem} invalidAt={invalidAt}
          reveal={reveal} onClose={onClose}
          onChange={(next) => setSteps((current) => current.map((entry, at) => (at === index ? next : entry)))}
          onKind={(kind) => setSteps((current) => changeStepKind(current, index, kind, people.profiles()[0]))}
          onRename={(value) => setSteps((current) => renameStep(current, index, value))}
          onRemove={() => askRemove(index)} />
      )}
    </Show>
  );

  return (
    <div data-vesta="server-activity" onKeyDown={onKeyDown}>
      <div data-vesta="pane-toolbar">
        <IconButton variant="ghost" label={t('server-automation.back')} icon={<Icon name="icons/navigation/arrow-back" />} onClick={() => transitionTo(listPath())} />
        <span data-vesta="server-toolbar-title" class="server-automation-title">{isNew ? t('server-automation.new-title') : base()?.name ?? t('servers.loading')}</span>
        <Show when={!isNew}>
          <SegmentedControl aria-label={t('server-automation.view')} value={view()} onChange={(value) => setView(value as 'edit' | 'runs')}
            options={[{ value: 'edit', label: t('server-automation.edit') }, { value: 'runs', label: t('server-automation.runs') }]} />
        </Show>
        <span data-vesta="server-toolbar-spacer" />
        {/* Save lives in the bar, always in the same place, so editing never moves the page. */}
        <Show when={canManage()}>
          <Show when={dirty()}>
            <span data-vesta="server-automation-dirty" role="status">
              <span data-vesta="server-automation-dirty-dot" aria-hidden="true" />
              {problems().length ? t('server-automation.problems', { count: problems().length }) : isNew ? t('server-automation.unsaved-new') : t('server-automation.unsaved')}
            </span>
            <Button variant="ghost" disabled={saving()} onClick={discard}>{t(isNew ? 'common.cancel' : 'server-files.discard')}</Button>
          </Show>
          <Button tone="accent" disabled={!dirty() || problems().length > 0 || saving()} title={t('server-files.save-shortcut', { value: saveKeys })}
            onClick={() => void save()}>{t(isNew ? 'server-automation.create' : 'server-files.save')}</Button>
        </Show>
        <Show when={!isNew && canManage()}>
          <Menu placement="bottom-end" trigger={(menu) => <IconButton {...menu} variant="ghost" label={t('servers.actions')} tooltip={false} icon={<Icon name="icons/content/ellipsis-v" />} />}>
            <Show when={base()?.definition.trigger.kind === 'manual'}>
              <MenuItem icon={<Icon name="icons/actions/play" />} disabled={!manualReady()} onSelect={() => void runNow()}>{t('server-automation.run-now')}</MenuItem>
            </Show>
            <MenuItem icon={<Icon name="icons/actions/duplicate" />} onSelect={duplicate}>{t('server-automation.duplicate')}</MenuItem>
            <MenuSeparator />
            <MenuItem tone="danger" icon={<Icon name="icons/actions/delete" />} onSelect={() => setDeleting(true)}>{t('server-automation.delete')}</MenuItem>
          </Menu>
        </Show>
      </div>
      <Show when={view() === 'edit'} fallback={
        <div data-vesta="instance-settings-scroll">
          <RunList snapshot={props.snapshot} workflowId={props.workflowId} names={() => base()?.name ?? null} />
        </div>
      }>
        <div data-vesta="instance-settings-scroll">
          <Show when={!canManage()}><p data-vesta="server-callout" data-tone="neutral">{t('server-automation.view-only')}</p></Show>
          <Show when={stale()}><p data-vesta="server-callout" data-tone="warning" role="status">{t('server-automation.stale')}</p></Show>
          <ServerErrorNote error={error() ?? detail.error()} onRetry={() => { setError(null); void detail.refresh(); }} />
          <Show when={draft()} fallback={<Show when={!detail.error()}><p data-vesta="server-muted">{t('servers.loading')}</p></Show>}>
            {(current) => (
              <>
                <Show when={canManage() && problems().length}>
                  <div data-vesta="server-callout" data-tone="danger" class="server-automation-problems">
                    <strong>{t('server-automation.problems', { count: problems().length })}</strong>
                    <ul>
                      <For each={problems()}>
                        {(entry) => (
                          <li>
                            <button type="button" data-vesta="server-automation-problem-link" onClick={() => focusProblem(entry.path)}>
                              <span>{describe(entry).where}</span>
                              <span>{describe(entry).message}</span>
                            </button>
                          </li>
                        )}
                      </For>
                    </ul>
                  </div>
                </Show>
                <section data-vesta="server-automation-head">
                  <div data-vesta="server-automation-head-row">
                    <div data-problem-path="name" class="server-automation-name-field">
                      <TextField aria-label={t('server-automation.name')} value={current().name} readOnly={!canManage()} placeholder={t('server-automation.name-placeholder')}
                        error={problem('name')} onChange={(value: string) => patch({ name: value })} />
                    </div>
                    <label data-vesta="server-automation-enabled">
                      <Switch size="sm" aria-label={t(isNew ? 'server-automation.enable-on-create' : 'server-automation.enabled', { name: current().name })}
                        checked={current().enabled} disabled={!canManage() || toggling()} onChange={(value: boolean) => void setEnabled(value)} />
                      <span>{t(isNew ? 'server-automation.enable-on-create' : current().enabled ? 'server-automation.on' : 'server-automation.off')}</span>
                    </label>
                  </div>
                  <div data-vesta="server-automation-head-row">
                    <span data-vesta="server-automation-head-label">{t('server-automation.starts')}</span>
                    <TriggerEditor draft={current()} disabled={!canManage()} profiles={people.profiles()} problem={problem} invalid={invalidAt('trigger') || invalidAt('missed')}
                      open={triggerOpen()} onOpenChange={setTriggerOpen} onPatch={patch} />
                    <span data-vesta="server-automation-head-label">{t('server-automation.run-as')}</span>
                    <div data-problem-path="principal" class="server-automation-principal">
                      <Select size="sm" aria-label={t('server-automation.run-as')} value={current().executionPrincipalId} disabled={!canManage()}
                        placeholder={t('server-automation.run-as-placeholder')} error={problem('principal')}
                        options={principals()} onChange={(value: string) => patch({ executionPrincipalId: value })} />
                    </div>
                  </div>
                </section>
                <div ref={(element) => { canvas = element; }} data-vesta="server-automation-canvas" data-narrow={narrow() ? '' : undefined}>
                  <div data-vesta="server-automation-canvas-steps" data-problem-path="steps">
                    <h3 data-vesta="server-automation-section-title">{t('server-automation.steps')}</h3>
                    <Show when={problem('steps')}>{(message) => <p data-vesta="server-callout" data-tone="danger">{message()}</p>}</Show>
                    <StepFlow steps={current().steps} selected={panel()?.index ?? null} problems={problems()} disabled={!canManage()}
                      onSelect={(index) => select(panel()?.index === index && narrow() ? null : index)} onReorder={reorder} onInsert={insert}
                      inlineDetails={narrow() ? (index) => details(index, panel()?.reveal ?? null) : undefined} />
                  </div>
                  <Show when={!narrow()}>
                    <aside data-vesta="server-automation-canvas-panel">
                      <Show when={panel()} keyed fallback={
                        <div data-vesta="server-automation-panel-empty">
                          <Icon name="icons/content/list" size={20} />
                          <p>{t(canManage() ? 'server-automation.select-step' : 'server-automation.select-step-view')}</p>
                        </div>
                      }>
                        {(open) => details(open.index, open.reveal, () => select(null))}
                      </Show>
                    </aside>
                  </Show>
                </div>
              </>
            )}
          </Show>
        </div>
      </Show>
      <Show when={deleting() && base()}>
        {(target) => <DeleteWorkflowDialog snapshot={props.snapshot} workflow={target()} onClose={() => setDeleting(false)}
          onDeleted={() => {
            forget(); releaseGuard?.();
            invalidateServerResources(id(), [workflowsResource.name]);
            invalidateServerResources(id(), [workflowResource.name], true);
            transitionTo(listPath());
          }} />}
      </Show>
      <Dialog open={removing() !== null} onOpenChange={(open) => { if (!open) setRemoving(null); }} size="sm" closeLabel={t('nav.close')}
        title={t('server-automation.remove-title', { name: removing() !== null && steps()[removing()!] ? stepText(steps()[removing()!]!.action) : '' })}
        description={t('server-automation.remove-referenced', { count: referencing().length, name: referencing().join(', ') })}
        footer={<>
          <Button variant="ghost" onClick={() => setRemoving(null)}>{t('common.cancel')}</Button>
          <Button tone="danger" onClick={() => { const index = removing(); if (index !== null) remove(index); }}>{t('server-automation.remove-step')}</Button>
        </>}
      />
      <Dialog open={!!leaving()} onOpenChange={(open) => { if (!open) setLeaving(null); }} size="sm" closeLabel={t('nav.close')}
        title={t('server-automation.leave-title', { name: draft()?.name || t('server-automation.new-title') })}
        description={t(problems().length ? 'server-automation.leave-description-invalid' : 'server-automation.leave-description')}
        footer={<>
          <Button variant="ghost" onClick={leaveDiscarding}>{t('server-files.leave-discard')}</Button>
          <Button variant="ghost" onClick={() => setLeaving(null)}>{t('server-automation.keep-editing')}</Button>
          <Button tone="accent" disabled={problems().length > 0 || saving()} onClick={() => void leaveSaving()}>{t(isNew ? 'server-automation.create' : 'server-files.save')}</Button>
        </>}
      />
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
