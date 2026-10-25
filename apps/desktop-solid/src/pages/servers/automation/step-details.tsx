// One step's details: what it does first, then folded groups for timing and branching and
// for the step id (only jumps use it, so it stays out of the way).
import { Button, IconButton, NumberField, Select, TextArea, TextField } from '@vesta/ui';
import type { JSX } from '@solidjs/web';
import { For, Show, createSignal } from 'solid-js';
import { Icon } from '../../../components/icon';
import { t } from '../../../localization';
import type { MessageId } from '../../../localization/messages';
import {
  BOUNDS, duration, forwardTargets, stepNotes, type DraftAction, type DraftStep, type ProblemArea,
} from '../../../features/servers/automation-model';
import type { ActionKind, FailureBranch, SuccessBranch } from '../../../features/servers/native-automation';
import { ACTION_ORDER, actionIcons, actionLabels, stepText } from '../tabs/automation-shared';
import { profileOptions, type Problem } from './trigger-editor';

const SUCCESS_LABELS: Record<string, MessageId> = { next: 'server-automation.branch-next', end: 'server-automation.branch-end' };
const FAILURE_LABELS: Record<string, MessageId> = { fail: 'server-automation.branch-fail', next: 'server-automation.branch-continue' };

const durationText = (seconds: number) => { const unit = duration(seconds); return t(unit.message, { count: unit.count }); };

export function StepDetails(props: {
  step: DraftStep; index: number; steps: DraftStep[]; disabled: boolean; profiles: string[];
  problem: Problem; invalidAt: (prefix: string) => boolean;
  /** A group to open on arrival, e.g. when a problem in it was chosen from the summary. */
  reveal?: ProblemArea | null;
  onChange: (step: DraftStep) => void; onKind: (kind: ActionKind) => void; onRename: (id: string) => void;
  onRemove: () => void; onMove: (by: -1 | 1) => void; onClose?: () => void;
}) {
  const at = () => `steps.${props.index}`;
  const [flowOpen, setFlowOpen] = createSignal(props.reveal === 'flow' || props.invalidAt(`steps.${props.index}.timeout`) || props.invalidAt(`steps.${props.index}.retries`)
    || props.invalidAt(`steps.${props.index}.backoff`) || props.invalidAt(`steps.${props.index}.onSuccess`) || props.invalidAt(`steps.${props.index}.onFailure`), { name: 'server-automation-step:flow-open' });
  const [idOpen, setIdOpen] = createSignal(props.reveal === 'id' || props.invalidAt(`steps.${props.index}.id`), { name: 'server-automation-step:id-open' });

  /** Forward targets only, plus a now-invalid current target so the select can show it. */
  const gotoOptions = (current: string | null) => {
    const targets = forwardTargets(props.steps, props.index);
    const options = targets.map((target) => {
      const position = props.steps.findIndex((entry) => entry.id === target);
      return { value: `goto:${target}`, label: t('server-automation.branch-goto', { count: position + 1, name: stepText(props.steps[position]!.action) }) };
    });
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
  const flowSummary = () => [
    t('server-automation.timeout-after', { time: durationText(props.step.timeoutSecs) }),
    ...stepNotes(props.steps, props.index).map((note) => t(note.message, note.args)),
  ].join(' · ');
  const flowInvalid = () => ['timeout', 'retries', 'backoff', 'onSuccess', 'onFailure'].some((field) => props.invalidAt(`${at()}.${field}`));

  return (
    <section data-vesta="server-automation-details" aria-label={t('server-automation.step-label', { count: props.index + 1, name: stepText(props.step.action) })}>
      <header data-vesta="server-automation-details-head">
        <span data-vesta="server-automation-tile" aria-hidden="true"><Icon name={actionIcons[props.step.action.kind]} /></span>
        <div data-vesta="server-automation-details-title">
          <span>{t('server-automation.step-of', { count: props.index + 1, max: props.steps.length })}</span>
          <Select size="sm" aria-label={t('server-automation.action')} value={props.step.action.kind} disabled={props.disabled}
            options={ACTION_ORDER.map((kind) => ({ value: kind, label: t(actionLabels[kind]) }))} onChange={(value: string) => props.onKind(value as ActionKind)} />
        </div>
        <Show when={!props.disabled}>
          {/* The visible alternative to dragging; the step stays open as it moves. */}
          <IconButton size="sm" variant="ghost" label={t('server-automation.move-up')} icon={<Icon name="icons/controls/chevron-up" />}
            disabled={props.index === 0} onClick={() => props.onMove(-1)} />
          <IconButton size="sm" variant="ghost" label={t('server-automation.move-down')} icon={<Icon name="icons/controls/chevron-down" />}
            disabled={props.index >= props.steps.length - 1} onClick={() => props.onMove(1)} />
          <IconButton size="sm" variant="ghost" tone="danger" label={t('server-automation.remove-step')} icon={<Icon name="icons/actions/delete" />}
            disabled={props.steps.length <= 1} onClick={() => props.onRemove()} />
        </Show>
        <Show when={props.onClose}>
          <IconButton size="sm" variant="ghost" label={t('nav.close')} icon={<Icon name="icons/actions/close" />} onClick={() => props.onClose!()} />
        </Show>
      </header>

      <div data-vesta="server-automation-details-fields">
        <ActionFields action={props.step.action} at={`${at()}.action`} disabled={props.disabled} profiles={props.profiles} problem={props.problem}
          onChange={(action) => props.onChange({ ...props.step, action })} />
      </div>

      <Group title={t('server-automation.timing-failure')} summary={flowSummary()} open={flowOpen()} invalid={flowInvalid()} onToggle={() => setFlowOpen(!flowOpen())}>
        <div data-vesta="server-automation-details-grid">
          <div data-problem-path={`${at()}.timeout`}>
            <NumberField size="sm" label={t('server-automation.timeout')} value={props.step.timeoutSecs} min={BOUNDS.timeout[0]} max={BOUNDS.timeout[1]} disabled={props.disabled}
              description={durationText(props.step.timeoutSecs)} error={props.problem(`${at()}.timeout`)}
              onChange={(value: number) => props.onChange({ ...props.step, timeoutSecs: Math.round(value) })} />
          </div>
          <div data-problem-path={`${at()}.retries`}>
            <NumberField size="sm" label={t('server-automation.retries')} value={props.step.retries.maxRetries} min={BOUNDS.retries[0]} max={BOUNDS.retries[1]} disabled={props.disabled}
              error={props.problem(`${at()}.retries`)} onChange={(value: number) => props.onChange({ ...props.step, retries: { ...props.step.retries, maxRetries: Math.round(value) } })} />
          </div>
          <div data-problem-path={`${at()}.backoff`}>
            <NumberField size="sm" label={t('server-automation.backoff')} value={props.step.retries.backoffSecs} min={BOUNDS.backoff[0]} max={BOUNDS.backoff[1]}
              disabled={props.disabled || props.step.retries.maxRetries === 0}
              error={props.problem(`${at()}.backoff`)} onChange={(value: number) => props.onChange({ ...props.step, retries: { ...props.step.retries, backoffSecs: Math.round(value) } })} />
          </div>
          <div data-problem-path={`${at()}.onSuccess`} class="server-automation-wide">
            <Select size="sm" label={t('server-automation.on-success')} value={successValue()} disabled={props.disabled} options={successOptions()}
              error={props.problem(`${at()}.onSuccess`)} onChange={setSuccess} />
          </div>
          <div data-problem-path={`${at()}.onFailure`} class="server-automation-wide">
            <Select size="sm" label={t('server-automation.on-failure')} value={failureValue()} disabled={props.disabled} options={failureOptions()}
              error={props.problem(`${at()}.onFailure`)} onChange={setFailure} />
          </div>
        </div>
      </Group>

      <Group title={t('server-automation.advanced')} summary={props.step.id} mono open={idOpen()} invalid={props.invalidAt(`${at()}.id`)} onToggle={() => setIdOpen(!idOpen())}>
        <div data-problem-path={`${at()}.id`}>
          <TextField size="sm" label={t('server-automation.step-id')} description={t('server-automation.step-id-help')} value={props.step.id} readOnly={props.disabled}
            spellcheck="false" autocomplete="off" error={props.problem(`${at()}.id`)} onChange={(value: string) => props.onRename(value)} />
        </div>
      </Group>
    </section>
  );
}

/** A folded group with a one-line summary of what is inside. */
function Group(props: { title: string; summary: string; mono?: boolean; open: boolean; invalid: boolean; onToggle: () => void; children: JSX.Element }) {
  return (
    <div data-vesta="server-automation-group" data-open={props.open ? '' : undefined} data-invalid={props.invalid ? '' : undefined}>
      <button type="button" data-vesta="server-automation-group-head" aria-expanded={props.open ? 'true' : 'false'} onClick={() => props.onToggle()}>
        <Icon name={props.open ? 'icons/controls/chevron-down' : 'icons/controls/chevron-right'} size={12} />
        <span data-vesta="server-automation-group-title">{props.title}</span>
        <Show when={!props.open}>
          <span data-vesta="server-automation-group-summary" data-mono={props.mono ? '' : undefined}>{props.summary}</span>
        </Show>
        <Show when={props.invalid}><Icon name="icons/controls/warning" size={12} class="server-automation-group-warning" /></Show>
      </button>
      <Show when={props.open}><div data-vesta="server-automation-group-body">{props.children}</div></Show>
    </div>
  );
}

function ActionFields(props: { action: DraftAction; at: string; disabled: boolean; profiles: string[]; problem: Problem; onChange: (action: DraftAction) => void }) {
  const kind = () => props.action.kind;
  const as = <K extends DraftAction['kind']>(name: K) => (kind() === name ? (props.action as Extract<DraftAction, { kind: K }>) : null);
  const backup = () => (kind() === 'backup' || kind() === 'verify_backup' ? (props.action as Extract<DraftAction, { kind: 'backup' | 'verify_backup' }>) : null);
  return (
    <>
      <Show when={as('delay')}>
        {(delay) => (
          <div data-problem-path={`${props.at}.secs`}>
            <NumberField size="sm" label={t('server-automation.delay')} value={delay().secs} min={BOUNDS.delay[0]} max={BOUNDS.delay[1]} disabled={props.disabled}
              description={durationText(delay().secs)} error={props.problem(`${props.at}.secs`)} onChange={(value: number) => props.onChange({ kind: 'delay', secs: Math.round(value) })} />
          </div>
        )}
      </Show>
      <Show when={backup()}>
        {(current) => (
          <div data-problem-path={`${props.at}.profile`}>
              <Select size="sm" label={t('server-automation.backup-profile')} value={current().profile} disabled={props.disabled || !props.profiles.length} description={!props.profiles.length ? t('server-automation.no-backup-profiles') : undefined} error={props.problem(`${props.at}.profile`)}
                options={profileOptions(props.profiles, current().profile)} onChange={(value: string) => props.onChange({ kind: current().kind, profile: value })} />
          </div>
        )}
      </Show>
      <Show when={as('console_command')}>
        {(command) => (
          <div data-problem-path={`${props.at}.line`}>
            <TextField size="sm" label={t('server-automation.console-line')} description={t('server-automation.console-line-help')} placeholder="say Hello!"
              value={command().line} readOnly={props.disabled} spellcheck="false" autocomplete="off" error={props.problem(`${props.at}.line`)}
              onChange={(value: string) => props.onChange({ kind: 'console_command', line: value })} />
          </div>
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
            <div data-problem-path={`${props.at}.title`}>
              <TextField size="sm" label={t('server-automation.notify-title')} value={notify().title} readOnly={props.disabled} error={props.problem(`${props.at}.title`)}
                onChange={(value: string) => props.onChange({ ...notify(), title: value })} />
            </div>
            <div data-problem-path={`${props.at}.body`}>
              <TextArea size="sm" label={t('server-automation.notify-body')} value={notify().body} readOnly={props.disabled} rows={3} error={props.problem(`${props.at}.body`)}
                onChange={(value: string) => props.onChange({ ...notify(), body: value })} />
            </div>
          </>
        )}
      </Show>
      <Show when={as('script_preset')}>
        {(script) => (
          <>
            <div data-problem-path={`${props.at}.preset`}>
              <TextField size="sm" label={t('server-automation.preset')} description={t('server-automation.preset-help')} value={script().preset} readOnly={props.disabled} spellcheck="false"
                error={props.problem(`${props.at}.preset`)} onChange={(value: string) => props.onChange({ ...script(), preset: value })} />
            </div>
            <div data-vesta="server-automation-params" data-problem-path={`${props.at}.params`}>
              <span data-vesta="server-automation-label">{t('server-automation.params')}</span>
              <For each={script().params} keyed={false}>
                {(param, index) => (
                  <div data-vesta="server-automation-param">
                    <div data-problem-path={`${props.at}.params.${index}.key`}>
                      <TextField size="sm" aria-label={t('server-automation.param-key')} placeholder={t('server-automation.param-key')} value={param()[0]} readOnly={props.disabled}
                        error={props.problem(`${props.at}.params.${index}.key`)}
                        onChange={(value: string) => props.onChange({ ...script(), params: script().params.map((entry, at) => (at === index ? [value, entry[1]] : entry)) })} />
                    </div>
                    <div data-problem-path={`${props.at}.params.${index}.value`}>
                      <TextField size="sm" aria-label={t('server-automation.param-value')} placeholder={t('server-automation.param-value')} value={param()[1]} readOnly={props.disabled}
                        error={props.problem(`${props.at}.params.${index}.value`)}
                        onChange={(value: string) => props.onChange({ ...script(), params: script().params.map((entry, at) => (at === index ? [entry[0], value] : entry)) })} />
                    </div>
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
        <p data-vesta="server-muted">{t('server-automation.no-fields')}</p>
      </Show>
    </>
  );
}
