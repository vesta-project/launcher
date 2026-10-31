import { Badge, Button, IconButton, Menu, MenuItem, MenuSeparator, SegmentedControl, Switch, Tooltip, toast } from '@vesta/ui';
import { For, Show, createMemo, createSignal, untrack } from 'solid-js';
import { Icon } from '../../../components/icon';
import { route } from '../../../app/router';
import { transitionTo } from '../../../app/transition';
import { t } from '../../../localization';
import { lastRunByWorkflow, toEditorDraft, type TemplateId } from '../../../features/servers/automation-model';
import { gate } from '../../../features/servers/capabilities';
import { stableConnectionId } from '../../../features/servers/connection-id';
import { errorMessage } from '../../../features/servers/errors';
import { age, newIntentId } from '../../../features/servers/model';
import { invalidateServerResources, readServerResource, seedServerResource, useServerResource } from '../../../features/servers/resources';
import { serverCommand, useServersClock } from '../../../features/servers/store';
import type { ServerCommandError, ServerSnapshot } from '../../../features/servers/native';
import type { RunSummary, WorkflowSummary } from '../../../features/servers/native-automation';
import { ServerErrorNote } from '../parts';
import { invalidateAutomation, runPageResource, workflowResource, workflowsResource } from '../automation/resources';
import { AutomationEmpty, TemplateMenuItems, templateLabels } from '../automation/templates';
import { DeleteWorkflowDialog, WorkflowEditor } from './automation-editor';
import { RunList, useRunPolling } from './automation-runs';
import {
  decodeItem, draftFromTemplate, dropKeptDraft, encodeItem, handOffDraft, keptDraft, principalName, runState, triggerIcon, triggerText,
  useAutomationPeople, type AutomationPeople,
} from './automation-shared';
import '../../library/instance/settings-tab.css';
import './automation-tab.css';

/** Scheduled and event-driven workflows (`#/servers/<id>/automation[/<workflowId|new>]`). */
export function AutomationTab(props: { snapshot: ServerSnapshot }) {
  const item = () => {
    const current = route();
    return current.detail === 'automation' && current.item ? decodeItem(current.item) : null;
  };
  return (
    <Show when={item()} keyed fallback={<AutomationHome snapshot={props.snapshot} />}>
      {(workflowId) => <WorkflowEditor snapshot={props.snapshot} workflowId={workflowId} />}
    </Show>
  );
}

/** The last view per connection, so returning from the editor lands where you were. */
const lastView = new Map<string, 'workflows' | 'runs'>();
const ALL_RUNS = { workflowId: null, after: null };

function AutomationHome(props: { snapshot: ServerSnapshot }) {
  const now = useServersClock();
  const id = stableConnectionId(() => props.snapshot);
  const canManage = () => gate(props.snapshot.capabilities, 'automation.manage') === 'allowed';
  const [view, setView] = createSignal<'workflows' | 'runs'>(lastView.get(untrack(id)) ?? 'workflows', { name: 'server-automation:view' });
  const choose = (next: 'workflows' | 'runs') => { lastView.set(id(), next); setView(next); };
  // Summaries carry the trigger, and one newest-first page of runs gives each its last run.
  const workflows = useServerResource(id, workflowsResource);
  const runs = useServerResource(id, runPageResource, { args: () => ALL_RUNS });
  useRunPolling(id, runs, () => view() === 'workflows');
  const people = useAutomationPeople(id, () => props.snapshot, {
    users: (self) => !!self && (workflows.value() ?? []).some((workflow) => workflow.executionPrincipalId !== self),
    profiles: () => false,
  });
  const [busy, setBusy] = createSignal<string | null>(null, { name: 'server-automation:busy' });
  const [deleting, setDeleting] = createSignal<WorkflowSummary | null>(null, { name: 'server-automation:deleting' });
  const [keptNew, setKeptNew] = createSignal(!!keptDraft(untrack(id), 'new'), { name: 'server-automation:kept-new' });
  const lastRuns = createMemo(() => lastRunByWorkflow(runs.value()?.items ?? []), { name: 'server-automation:last-runs' });
  const nameOf = (workflowId: string) => workflows.value()?.find((entry) => entry.id === workflowId)?.name ?? null;

  const start = async (template: TemplateId) => {
    setBusy('new');
    try {
      dropKeptDraft(id(), 'new');
      handOffDraft(await draftFromTemplate(id(), template, template === 'blank' ? '' : t(templateLabels[template].name)));
      transitionTo(`/servers/${id()}/automation/new`);
    } finally { setBusy(null); }
  };
  const edit = (workflow: WorkflowSummary) => transitionTo(`/servers/${id()}/automation/${encodeItem(workflow.id)}`);
  const duplicate = async (workflow: WorkflowSummary) => {
    setBusy(workflow.id);
    try {
      // The only time the list reads a definition: a copy needs the steps.
      const detail = await readServerResource(id(), workflowResource, workflow.id);
      dropKeptDraft(id(), 'new');
      handOffDraft({ ...toEditorDraft(detail, false), name: t('server-automation.copy-name', { name: workflow.name }) });
      transitionTo(`/servers/${id()}/automation/new`);
    } catch (reason) { toast.show({ title: t(errorMessage(reason)), tone: 'danger' }); }
    finally { setBusy(null); }
  };
  const setEnabled = async (workflow: WorkflowSummary, enabled: boolean) => {
    setBusy(workflow.id);
    try {
      const result = await serverCommand((client) => client.automationWorkflowSetEnabled(id(), workflow.id, workflow.revision, enabled, newIntentId()));
      // The answer is known: update the list in place and let an open definition revalidate.
      const list = workflows.value() ?? [];
      seedServerResource(id(), workflowsResource, list.map((entry) => (entry.id === workflow.id ? { ...entry, enabled, revision: result.revision } : entry)));
      invalidateServerResources(id(), [workflowResource.name]);
      toast.show({ title: t(enabled ? 'server-automation.turned-on' : 'server-automation.turned-off', { name: workflow.name }), tone: 'neutral' });
    } catch (reason) {
      toast.show({ title: t(errorMessage(reason)), tone: (reason as ServerCommandError).code === 'stale_target' ? 'warning' : 'danger' });
      invalidateAutomation(id());
    } finally { setBusy(null); }
  };
  const runNow = async (workflow: WorkflowSummary) => {
    setBusy(workflow.id);
    try {
      const result = await serverCommand((client) => client.automationWorkflowRun(id(), workflow.id, newIntentId()));
      toast.show({ title: t(result.skipped ? 'server-automation.run-skipped' : 'server-automation.run-started', { name: workflow.name }), tone: result.skipped ? 'warning' : 'neutral' });
      invalidateServerResources(id(), [runPageResource.name]);
    } catch (reason) { toast.show({ title: t(errorMessage(reason)), tone: 'danger' }); }
    finally { setBusy(null); }
  };
  const deleted = (workflow: WorkflowSummary) => {
    dropKeptDraft(id(), workflow.id);
    seedServerResource(id(), workflowsResource, (workflows.value() ?? []).filter((entry) => entry.id !== workflow.id));
    invalidateServerResources(id(), [workflowResource.name], true);
  };
  const empty = () => workflows.value()?.length === 0;
  const refresh = () => { void workflows.refresh(); void runs.refresh(); };

  return (
    <div data-vesta="server-activity">
      <div data-vesta="pane-toolbar">
        <SegmentedControl aria-label={t('server-automation.view')} value={view()} onChange={(value) => choose(value as 'workflows' | 'runs')}
          options={[{ value: 'workflows', label: t('server-automation.workflows') }, { value: 'runs', label: t('server-automation.recent-runs') }]} />
        <span data-vesta="server-toolbar-spacer" />
        <Button variant="ghost" icon={<Icon name="icons/actions/refresh" />} disabled={workflows.refreshing() || runs.refreshing()} onClick={refresh}>{t('servers.refresh')}</Button>
        <Show when={canManage() && !empty()}>
          <Menu placement="bottom-end" trigger={(menu) => <Button {...menu} tone="accent" icon={<Icon name="icons/actions/add" />} disabled={busy() === 'new'}>{t('server-automation.new')}</Button>}>
            <TemplateMenuItems onPick={(template) => void start(template)} />
          </Menu>
        </Show>
      </div>
      <div data-vesta="instance-settings-scroll">
        <Show when={keptNew() && canManage()}>
          <div data-vesta="server-callout" data-tone="neutral" role="status">
            <span data-vesta="server-automation-callout-text">{t('server-automation.kept-new')}</span>
            <Button size="sm" variant="ghost" onClick={() => { dropKeptDraft(id(), 'new'); setKeptNew(false); }}>{t('server-files.discard')}</Button>
            <Button size="sm" variant="outline" onClick={() => transitionTo(`/servers/${id()}/automation/new`)}>{t('server-automation.keep-editing')}</Button>
          </div>
        </Show>
        <Show when={view() === 'workflows'} fallback={<RunList snapshot={props.snapshot} names={nameOf} />}>
          <ServerErrorNote error={workflows.error()} onRetry={() => void workflows.refresh()} />
          <Show when={workflows.value()} fallback={<Show when={!workflows.error()}><p data-vesta="server-muted">{t('servers.loading')}</p></Show>}>
            {(list) => (
              <Show when={list().length} fallback={<AutomationEmpty canManage={canManage()} busy={busy() === 'new'} onPick={(template) => void start(template)} />}>
                <ul data-vesta="server-automation-list" aria-label={t('server-automation.workflows')}>
                  <For each={list()} keyed={(workflow) => workflow.id}>
                    {(workflow) => (
                      <WorkflowRow workflow={workflow()} last={lastRuns().get(workflow().id) ?? null} now={now()} people={people}
                        canManage={canManage()} busy={busy() === workflow().id} unsaved={!!keptDraft(id(), workflow().id)}
                        onEdit={() => edit(workflow())} onDuplicate={() => void duplicate(workflow())} onDelete={() => setDeleting(workflow())}
                        onEnabled={(value) => void setEnabled(workflow(), value)} onRun={() => void runNow(workflow())} />
                    )}
                  </For>
                </ul>
                <p data-vesta="server-muted">{t('server-automation.footnote')}</p>
              </Show>
            )}
          </Show>
        </Show>
      </div>
      <Show when={deleting()}>
        {(target) => <DeleteWorkflowDialog snapshot={props.snapshot} workflow={target()} onClose={() => setDeleting(null)} onDeleted={() => deleted(target())} />}
      </Show>
    </div>
  );
}

function WorkflowRow(props: {
  workflow: WorkflowSummary; last: RunSummary | null; now: number; people: AutomationPeople; canManage: boolean; busy: boolean; unsaved: boolean;
  onEdit: () => void; onDuplicate: () => void; onDelete: () => void; onEnabled: (enabled: boolean) => void; onRun: () => void;
}) {
  const manual = () => props.workflow.trigger?.kind === 'manual';
  const lastState = () => (props.last ? runState(props.last.state) : null);
  const lastAge = () => (props.last ? age(props.last.startedAtMs, props.now) : null);
  return (
    <li data-vesta="server-automation-row" data-off={props.workflow.enabled ? undefined : ''}>
      <span data-vesta="server-automation-tile" aria-hidden="true"><Icon name={triggerIcon(props.workflow.trigger)} /></span>
      <div data-vesta="server-automation-row-copy">
        <span data-vesta="server-automation-row-title">
          <button type="button" data-vesta="server-automation-name" onClick={() => props.onEdit()}>{props.workflow.name}</button>
          <Show when={props.unsaved}><Badge size="sm" variant="soft" tone="warning">{t('server-automation.unsaved')}</Badge></Show>
          <Show when={!props.workflow.enabled}><Badge size="sm" variant="soft">{t('server-automation.off')}</Badge></Show>
        </span>
        <span data-vesta="server-automation-row-meta">
          <Show when={props.workflow.trigger}>{(trigger) => <span>{triggerText(trigger())}</span>}</Show>
          <Show when={props.people.self() && props.people.self()!.principalId !== props.workflow.executionPrincipalId}>
            <span>{t('server-automation.runs-as', { name: principalName(props.people, props.workflow.executionPrincipalId) })}</span>
          </Show>
        </span>
      </div>
      <div data-vesta="server-automation-row-last">
        <Show when={lastState()} fallback={<span data-vesta="server-automation-row-never">{t('server-automation.never-ran')}</span>}>
          {(state) => (
            <>
              <Badge size="sm" variant="soft" tone={state().tone}>{t(state().message)}</Badge>
              <Show when={lastAge()}>{(when) => <span>{t('servers.ago', { time: t(when().message, { count: when().count }) })}</span>}</Show>
            </>
          )}
        </Show>
      </div>
      <div data-vesta="server-automation-row-actions">
        <Show when={manual() && props.canManage}>
          <Tooltip content={t('server-automation.run-needs-enabled')} disabled={props.workflow.enabled} trigger={(tooltip) => (
            <span {...tooltip}>
              <Button size="sm" variant="ghost" icon={<Icon name="icons/actions/play" />} disabled={!props.workflow.enabled || props.busy} onClick={() => props.onRun()}>{t('server-automation.run-now')}</Button>
            </span>
          )} />
        </Show>
        <Switch aria-label={t('server-automation.enabled', { name: props.workflow.name })} checked={props.workflow.enabled} disabled={!props.canManage || props.busy}
          onChange={(value: boolean) => props.onEnabled(value)} />
        <Menu placement="bottom-end" trigger={(menu) => <IconButton {...menu} size="sm" variant="ghost" label={t('servers.actions')} tooltip={false} icon={<Icon name="icons/content/ellipsis-v" />} />}>
          <MenuItem icon={<Icon name="icons/actions/edit" />} onSelect={() => props.onEdit()}>{t(props.canManage ? 'server-automation.edit' : 'server-automation.view-details')}</MenuItem>
          <Show when={props.canManage}>
            <MenuItem icon={<Icon name="icons/actions/duplicate" />} disabled={props.busy} onSelect={() => props.onDuplicate()}>{t('server-automation.duplicate')}</MenuItem>
            <MenuSeparator />
            <MenuItem tone="danger" icon={<Icon name="icons/actions/delete" />} onSelect={() => props.onDelete()}>{t('server-automation.delete')}</MenuItem>
          </Show>
        </Menu>
      </div>
    </li>
  );
}
