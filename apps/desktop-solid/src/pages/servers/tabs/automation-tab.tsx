import { Badge, Button, IconButton, Menu, MenuItem, MenuSeparator, SegmentedControl, Switch, Tooltip, toast } from '@vesta/ui';
import { For, Show, createMemo, createSignal, onSettled, untrack } from 'solid-js';
import { EmptyState } from '../../../components/empty-state';
import { Icon } from '../../../components/icon';
import { route } from '../../../app/router';
import { transitionTo } from '../../../app/transition';
import { t } from '../../../localization';
import type { MessageId } from '../../../localization/messages';
import { gate } from '../../../features/servers/capabilities';
import { errorMessage } from '../../../features/servers/errors';
import { age, newIntentId } from '../../../features/servers/model';
import { TEMPLATES, lastRunByWorkflow, localOffsetMinutes, templateDraft, toEditorDraft, triggerSentence, type TemplateId } from '../../../features/servers/automation-model';
import { serverCommand, useServersClock } from '../../../features/servers/store';
import type { ServerCommandError, ServerSnapshot } from '../../../features/servers/native';
import type { RunSummary, WorkflowDetail } from '../../../features/servers/native-automation';
import { ServerErrorNote } from '../parts';
import { DeleteWorkflowDialog, WorkflowEditor } from './automation-editor';
import { RunList } from './automation-runs';
import {
  collectPages, createAutomationRefs, decodeItem, encodeItem, handOffDraft, principalName, runState, weekdayName, type AutomationRefs,
} from './automation-shared';
import '../../library/instance/settings-tab.css';
import './automation-tab.css';

const templateLabels: Record<TemplateId, { name: MessageId; description: MessageId; icon: string }> = {
  'nightly-backup': { name: 'server-automation.template-nightly', description: 'server-automation.template-nightly-help', icon: 'icons/content/storage' },
  'restart-every': { name: 'server-automation.template-restart', description: 'server-automation.template-restart-help', icon: 'icons/actions/reload' },
  'announce-join': { name: 'server-automation.template-announce', description: 'server-automation.template-announce-help', icon: 'icons/content/chat' },
  blank: { name: 'server-automation.template-blank', description: 'server-automation.template-blank-help', icon: 'icons/actions/add' },
};

/** Scheduled and event-driven workflows (`#/servers/<id>/automation[/<workflowId|new>]`). */
export function AutomationTab(props: { snapshot: ServerSnapshot }) {
  const refs = createAutomationRefs(untrack(() => props.snapshot.connection.id));
  const item = () => {
    const current = route();
    return current.detail === 'automation' && current.item ? decodeItem(current.item) : null;
  };
  return (
    <Show when={item()} keyed fallback={<AutomationHome snapshot={props.snapshot} refs={refs} />}>
      {(workflowId) => <WorkflowEditor snapshot={props.snapshot} workflowId={workflowId} refs={refs} />}
    </Show>
  );
}

function AutomationHome(props: { snapshot: ServerSnapshot; refs: AutomationRefs }) {
  const now = useServersClock();
  const id = () => props.snapshot.connection.id;
  const canManage = () => gate(props.snapshot.capabilities, 'automation.manage') !== 'denied';
  const [view, setView] = createSignal<'workflows' | 'runs'>('workflows', { name: 'server-automation:view' });
  const [workflows, setWorkflows] = createSignal<WorkflowDetail[] | null>(null, { name: 'server-automation:workflows' });
  const [runs, setRuns] = createSignal<RunSummary[]>([], { name: 'server-automation:runs' });
  const [error, setError] = createSignal<ServerCommandError | null>(null, { name: 'server-automation:error' });
  const [loading, setLoading] = createSignal(false, { name: 'server-automation:loading' });
  const [busy, setBusy] = createSignal<string | null>(null, { name: 'server-automation:busy' });
  const [deleting, setDeleting] = createSignal<WorkflowDetail | null>(null, { name: 'server-automation:deleting' });
  const [reloadRuns, setReloadRuns] = createSignal(0, { name: 'server-automation:reload-runs' });

  const refresh = async () => {
    setLoading(true); setError(null);
    try {
      // Summaries carry no trigger, so each workflow's detail is read for its sentence.
      const summaries = await collectPages((after) => serverCommand((client) => client.automationWorkflows(id(), after)));
      const [details, history] = await Promise.all([
        Promise.all(summaries.map((summary) => serverCommand((client) => client.automationWorkflow(id(), summary.id)))),
        collectPages((after) => serverCommand((client) => client.automationRuns(id(), after))).catch(() => [] as RunSummary[]),
      ]);
      setWorkflows(details);
      setRuns(history);
    } catch (reason) { setError(reason as ServerCommandError); }
    finally { setLoading(false); }
  };
  onSettled(() => { void refresh(); });
  const lastRuns = createMemo(() => lastRunByWorkflow(runs()), { name: 'server-automation:last-runs' });
  const nameOf = (workflowId: string) => workflows()?.find((entry) => entry.id === workflowId)?.name ?? null;

  const start = async (template: TemplateId) => {
    await props.refs.ready;
    handOffDraft(templateDraft(template, {
      name: template === 'blank' ? '' : t(templateLabels[template].name),
      principalId: props.refs.self()?.principalId ?? '',
      offsetMinutes: localOffsetMinutes(),
      profile: props.refs.profiles()[0],
    }));
    transitionTo(`/servers/${id()}/automation/new`);
  };
  const edit = (workflow: WorkflowDetail) => transitionTo(`/servers/${id()}/automation/${encodeItem(workflow.id)}`);
  const duplicate = (workflow: WorkflowDetail) => {
    handOffDraft({ ...toEditorDraft(workflow, false), name: t('server-automation.copy-name', { name: workflow.name }) });
    transitionTo(`/servers/${id()}/automation/new`);
  };
  const setEnabled = async (workflow: WorkflowDetail, enabled: boolean) => {
    setBusy(workflow.id);
    try {
      await serverCommand((client) => client.automationWorkflowSetEnabled(id(), workflow.id, workflow.revision, enabled, newIntentId()));
      toast.show({ title: t(enabled ? 'server-automation.turned-on' : 'server-automation.turned-off', { name: workflow.name }), tone: 'neutral' });
    } catch (reason) {
      toast.show({ title: t(errorMessage(reason)), tone: (reason as ServerCommandError).code === 'stale_target' ? 'warning' : 'danger' });
    } finally {
      setBusy(null);
      void refresh();
    }
  };
  const runNow = async (workflow: WorkflowDetail) => {
    setBusy(workflow.id);
    try {
      const result = await serverCommand((client) => client.automationWorkflowRun(id(), workflow.id, newIntentId()));
      toast.show({ title: t(result.skipped ? 'server-automation.run-skipped' : 'server-automation.run-started', { name: workflow.name }), tone: result.skipped ? 'warning' : 'neutral' });
      setTimeout(() => void refresh(), 1500);
    } catch (reason) { toast.show({ title: t(errorMessage(reason)), tone: 'danger' }); }
    finally { setBusy(null); }
  };

  return (
    <div data-vesta="server-activity">
      <div data-vesta="pane-toolbar">
        <SegmentedControl size="sm" aria-label={t('server-automation.view')} value={view()} onChange={(value) => setView(value as 'workflows' | 'runs')}
          options={[{ value: 'workflows', label: t('server-automation.workflows') }, { value: 'runs', label: t('server-automation.recent-runs') }]} />
        <span data-vesta="server-toolbar-spacer" />
        <Button size="sm" variant="ghost" icon={<Icon name="icons/actions/refresh" />} disabled={loading()}
          onClick={() => { void refresh(); setReloadRuns((value) => value + 1); }}>{t('servers.refresh')}</Button>
        <Show when={canManage()}>
          <Menu placement="bottom-end" trigger={(menu) => <Button {...menu} size="sm" tone="accent" icon={<Icon name="icons/actions/add" />}>{t('server-automation.new')}</Button>}>
            <For each={TEMPLATES}>
              {(template) => (
                <>
                  <Show when={template === 'blank'}><MenuSeparator /></Show>
                  <MenuItem icon={<Icon name={templateLabels[template].icon} />} onSelect={() => void start(template)}>
                    <span data-vesta="server-automation-template">
                      <span>{t(templateLabels[template].name)}</span>
                      <small>{t(templateLabels[template].description)}</small>
                    </span>
                  </MenuItem>
                </>
              )}
            </For>
          </Menu>
        </Show>
      </div>
      <div data-vesta="instance-settings-scroll">
        <Show when={view() === 'workflows'} fallback={<RunList snapshot={props.snapshot} names={nameOf} reload={reloadRuns()} />}>
          <ServerErrorNote error={error()} onRetry={() => void refresh()} />
          <Show when={workflows()} fallback={<Show when={!error()}><p data-vesta="server-muted">{t('servers.loading')}</p></Show>}>
            {(list) => (
              <Show when={list().length} fallback={
                <EmptyState icon="icons/content/timer" title={t('server-automation.empty-title')} description={t('server-automation.empty-description')}>
                  <Show when={canManage()}><Button tone="accent" onClick={() => void start('nightly-backup')}>{t('server-automation.template-nightly')}</Button></Show>
                </EmptyState>
              }>
                <section data-vesta="settings-panel">
                  <h3>{t('server-automation.workflows')}</h3>
                  <div data-vesta="settings-panel-body">
                    <For each={list()} keyed={(workflow) => workflow.id}>
                      {(workflow) => (
                        <WorkflowRow workflow={workflow()} last={lastRuns().get(workflow().id) ?? null} now={now()} refs={props.refs}
                          canManage={canManage()} busy={busy() === workflow().id}
                          onEdit={() => edit(workflow())} onDuplicate={() => duplicate(workflow())} onDelete={() => setDeleting(workflow())}
                          onEnabled={(value) => void setEnabled(workflow(), value)} onRun={() => void runNow(workflow())} />
                      )}
                    </For>
                  </div>
                </section>
                <p data-vesta="server-muted">{t('server-automation.footnote')}</p>
              </Show>
            )}
          </Show>
        </Show>
      </div>
      <Show when={deleting()}>
        {(target) => <DeleteWorkflowDialog snapshot={props.snapshot} workflow={target()} onClose={() => setDeleting(null)} onDeleted={() => void refresh()} />}
      </Show>
    </div>
  );
}

function WorkflowRow(props: {
  workflow: WorkflowDetail; last: RunSummary | null; now: number; refs: AutomationRefs; canManage: boolean; busy: boolean;
  onEdit: () => void; onDuplicate: () => void; onDelete: () => void; onEnabled: (enabled: boolean) => void; onRun: () => void;
}) {
  const sentence = () => triggerSentence(props.workflow.definition.trigger, weekdayName);
  const manual = () => props.workflow.definition.trigger.kind === 'manual';
  const lastState = () => (props.last ? runState(props.last.state) : null);
  const lastAge = () => (props.last ? age(props.last.startedAtMs, props.now) : null);
  return (
    <div data-vesta="setting-row" data-automation-workflow data-off={props.workflow.enabled ? undefined : ''}>
      <div data-vesta="setting-row-copy">
        <span data-vesta="setting-row-label">
          <button type="button" data-vesta="server-automation-name" onClick={() => props.onEdit()}>{props.workflow.name}</button>
          <Show when={lastState()}>{(state) => <Badge size="sm" variant="soft" tone={state().tone}>{t(state().message)}</Badge>}</Show>
        </span>
        <span data-vesta="setting-row-description">
          {t(sentence().message, sentence().args)}
          {' · '}{t('server-automation.step-count-short', { count: props.workflow.definition.steps.length })}
          <Show when={lastAge()} fallback={<>{' · '}{t('server-automation.never-ran')}</>}>
            {(when) => <>{' · '}{t('server-automation.last-run', { time: t(when().message, { count: when().count }) })}</>}
          </Show>
          <Show when={props.refs.self()?.principalId !== props.workflow.executionPrincipalId}>
            {' · '}{t('server-automation.runs-as', { name: principalName(props.refs, props.workflow.executionPrincipalId) })}
          </Show>
        </span>
      </div>
      <div data-vesta="setting-row-control">
        <Show when={manual() && props.canManage}>
          <Tooltip content={t('server-automation.run-needs-enabled')} disabled={props.workflow.enabled} trigger={(tooltip) => (
            <span {...tooltip}>
              <Button size="sm" variant="outline" icon={<Icon name="icons/actions/play" />} disabled={!props.workflow.enabled || props.busy} onClick={() => props.onRun()}>{t('server-automation.run-now')}</Button>
            </span>
          )} />
        </Show>
        <Switch size="sm" aria-label={t('server-automation.enabled', { name: props.workflow.name })} checked={props.workflow.enabled} disabled={!props.canManage || props.busy}
          onChange={(value: boolean) => props.onEnabled(value)} />
        <Menu placement="bottom-end" trigger={(menu) => <IconButton {...menu} size="sm" variant="ghost" label={t('servers.actions')} tooltip={false} icon={<Icon name="icons/content/ellipsis-v" />} />}>
          <MenuItem icon={<Icon name="icons/actions/edit" />} onSelect={() => props.onEdit()}>{t(props.canManage ? 'server-automation.edit' : 'server-automation.view-details')}</MenuItem>
          <Show when={props.canManage}>
            <MenuItem icon={<Icon name="icons/actions/duplicate" />} onSelect={() => props.onDuplicate()}>{t('server-automation.duplicate')}</MenuItem>
            <MenuSeparator />
            <MenuItem tone="danger" icon={<Icon name="icons/actions/delete" />} onSelect={() => props.onDelete()}>{t('server-automation.delete')}</MenuItem>
          </Show>
        </Menu>
      </div>
    </div>
  );
}
