import { refreshUnedited } from '../../../features/servers/edit-revision';
import { EditConflictNotice, useEditRevision } from '../edit-conflict';
import { Button, NumberField, Select, Skeleton, Switch as Toggle, TextField, toast } from '@vesta/ui';
import { Show, createMemo, createSignal } from 'solid-js';
import { SettingRow } from '../../../components/setting-row';
import { t } from '../../../localization';
import type { MessageId } from '../../../localization/messages';
import { gate } from '../../../features/servers/capabilities';
import { stableConnectionId } from '../../../features/servers/connection-id';
import { newIntentId } from '../../../features/servers/model';
import { motdProblems, type MotdProblem } from '../../../features/servers/motd-model';
import { seedServerResource, useServerResource } from '../../../features/servers/resources';
import { motdPolicyResource, sleepPolicyResource } from '../../../features/servers/server-resources';
import { putSnapshot, serverCommand, useServersClock } from '../../../features/servers/store';
import type { ServerCommandError, ServerSnapshot } from '../../../features/servers/native';
import {
  PRESENCE_STATES, SLEEP_BOUNDS, type MotdDocument, type MotdPreview as AgentPreview, type PresenceState, type SleepPolicy, type StatePresentation,
} from '../../../features/servers/native-presence';
import { AGENT_START_CHOICES, agentStartAllowed, agentStartChoice, liveBlocker, sleepBlockerCopy, type AgentStartChoice } from '../../../features/servers/sleep-model';
import { Icon } from '../../../components/icon';
import { MotdEditor } from '../motd-editor';
import { ServerErrorNote } from '../parts';
import { SaveBar, SectionLink, SettingsPage, SettingsPanel } from '../settings-parts';

const stateLabels: Record<PresenceState, MessageId> = {
  online: 'servers.presence.state-online', offline: 'servers.presence.state-offline', sleeping: 'servers.presence.state-sleeping',
  waking: 'servers.presence.state-waking', starting: 'servers.presence.state-starting', stopping: 'servers.presence.state-stopping',
  maintenance: 'servers.presence.state-maintenance', crash_loop: 'servers.presence.state-crash-loop', recovery_required: 'servers.presence.state-recovery',
};

const problemMessages: Record<MotdProblem, MessageId> = {
  'too-many-lines': 'servers.presence.problem-lines',
  'too-long': 'servers.presence.problem-length',
  'unknown-placeholder': 'servers.presence.problem-placeholder',
  'unclosed-placeholder': 'servers.presence.problem-unclosed',
};

const agentStartLabels: Record<AgentStartChoice, MessageId> = {
  stay_stopped: 'servers.presence.agent-start-stay-stopped', sleep: 'servers.presence.agent-start-sleep', start: 'servers.presence.agent-start-start',
};

const sameJson = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

/**
 * Sleep & status: when Minecraft sleeps and wakes, and what the multiplayer list shows
 * meanwhile. Both policies share one save bar; each saves against its own revision.
 */
export function PresenceTab(props: { snapshot: ServerSnapshot }) {
  const id = stableConnectionId(() => props.snapshot);
  const canEdit = () => gate(props.snapshot.capabilities, 'config.edit') === 'allowed';
  const sleep = useServerResource(id, sleepPolicyResource);
  const motd = useServerResource(id, motdPolicyResource);
  const sleepRevision = useEditRevision(() => sleep.value()?.revision);
  const motdRevision = useEditRevision(() => motd.value()?.revision);
  // A null draft means "as saved", so a fresh read shows through without syncing.
  const [sleepDraft, setSleepDraft] = createSignal<SleepPolicy | null>(null, { name: 'server-sleep:draft' });
  const [motdDraft, setMotdDraft] = createSignal<MotdDocument | null>(null, { name: 'server-motd:draft' });
  const [state, setState] = createSignal<PresenceState>('sleeping', { name: 'server-motd:state' });
  const [checked, setChecked] = createSignal<AgentPreview | null>(null, { name: 'server-motd:checked' });
  const [sleepError, setSleepError] = createSignal<ServerCommandError | null>(null, { name: 'server-sleep:error' });
  const [motdError, setMotdError] = createSignal<ServerCommandError | null>(null, { name: 'server-motd:error' });
  const [busy, setBusy] = createSignal(false, { name: 'server-presence:busy' });

  let sleepBase: SleepPolicy | undefined;
  let motdBase: MotdDocument | undefined;
  const policy = () => sleepDraft() && sleepBase && sleep.value() ? refreshUnedited(sleepBase, sleepDraft()!, sleep.value()!.policy) : sleep.value()?.policy;
  const document = () => motdDraft() && motdBase && motd.value() ? refreshUnedited(motdBase, motdDraft()!, motd.value()!.document) : motd.value()?.document;
  const sleepDirty = () => !!sleepDraft() && !!sleep.value() && !sameJson(policy(), sleep.value()!.policy);
  const motdDirty = () => !!motdDraft() && !!motd.value() && !sameJson(document(), motd.value()!.document);
  const presentation = () => document()?.states[state()];
  const problems = createMemo(() => motdProblems(presentation()?.template ?? ''), { name: 'server-motd:problems' });
  const dirtyCount = () => Number(sleepDirty()) + Number(motdDirty());

  const patchSleep = (next: Partial<SleepPolicy>) => { const current = policy(); if (current) { if (!sleepDraft()) sleepBase = sleep.value()?.policy; sleepRevision.begin(); setSleepDraft({ ...(sleepDraft() ?? current), ...next }); } };
  const patchDocument = (next: Partial<MotdDocument>) => { const current = document(); if (current) { if (!motdDraft()) motdBase = motd.value()?.document; motdRevision.begin(); setChecked(null); setMotdDraft({ ...(motdDraft() ?? current), ...next }); } };
  const patchState = (next: Partial<StatePresentation>) => {
    const current = document();
    const source = motdDraft() ?? current;
    if (source) patchDocument({ states: { ...source.states, [state()]: { ...source.states[state()], ...next } } });
  };

  const save = async () => {
    if (sleepRevision.conflict() || motdRevision.conflict()) return;
    setBusy(true);
    let saved = 0;
    const sleepPolicy = policy();
    const sleepSaved = sleep.value();
    if (sleepDirty() && sleepPolicy && sleepSaved) {
      setSleepError(null);
      try {
        const next = await serverCommand((client) => client.updateSleepPolicy(id(), sleepPolicy, sleepSaved.revision, newIntentId()));
        seedServerResource(id(), sleepPolicyResource, next);
        // Sleep availability and the startup choice show in the header; re-read status now.
        void serverCommand((client) => client.snapshot(id(), true)).then(putSnapshot).catch(() => {});
        sleepRevision.reset(); setSleepDraft(null);
        saved++;
      } catch (reason) {
        setSleepError(reason as ServerCommandError);
        if ((reason as ServerCommandError).code === 'stale_target' || (reason as ServerCommandError).code === 'conflict') void sleep.refresh();
      }
    }
    const motdDocument = document();
    const motdSaved = motd.value();
    if (motdDirty() && motdDocument && motdSaved) {
      setMotdError(null);
      try {
        const next = await serverCommand((client) => client.updateMotdPolicy(id(), motdDocument, motdSaved.revision, newIntentId()));
        seedServerResource(id(), motdPolicyResource, next);
        motdRevision.reset(); setMotdDraft(null);
        setChecked(null);
        saved++;
      } catch (reason) {
        setMotdError(reason as ServerCommandError);
        if ((reason as ServerCommandError).code === 'stale_target' || (reason as ServerCommandError).code === 'conflict') void motd.refresh();
      }
    }
    setBusy(false);
    if (saved) toast.show({ title: t('servers.presence.saved'), tone: 'success' });
  };
  const discard = () => { sleepRevision.reset(); motdRevision.reset(); setSleepDraft(null); setMotdDraft(null); setChecked(null); };
  const check = async () => {
    const current = document();
    if (!current) return;
    setMotdError(null);
    try { setChecked(await serverCommand((client) => client.motdPreview(id(), state(), current))); }
    catch (reason) { setMotdError(reason as ServerCommandError); }
  };

  const samples = () => ({
    server_name: props.snapshot.connection.name, state: t(stateLabels[state()]), online_players: '0',
    max_players: String(presentation()?.maximumPlayers ?? 20), minecraft_version: props.snapshot.info?.minecraftVersion ?? '1.21',
    pack_version: props.snapshot.info?.packVersion ?? '', maintenance_reason: t('servers.presence.sample-reason'),
  });
  const minutes = () => Math.round((policy()?.idleSeconds ?? 0) / 60);
  const now = useServersClock();
  /** The live reason an enabled timer isn't sleeping yet, for the saved policy only. */
  const sleepNow = () => {
    const saved = sleep.value();
    if (!saved?.policy.enabled || !policy()?.enabled) return null;
    const status = props.snapshot.status;
    if (props.snapshot.state.phase !== 'online' || (status?.state === 'stopped' && status.lifecycle !== 'sleeping')) return null;
    return sleepBlockerCopy(liveBlocker(status?.sleepBlocker, saved.sleepBlocker, true), status?.lifecycle ?? undefined, props.snapshot.statusObservedAtMs, now());
  };
  const agentStart = () => agentStartChoice(policy(), props.snapshot.status);

  return (
    <SettingsPage saveBar={
      <SaveBar show={dirtyCount() > 0} label={t('server-settings.unsaved', { count: dirtyCount() })} busy={busy()}
        disabled={sleepRevision.conflict() || motdRevision.conflict() || !canEdit() || (motdDirty() && problems().length > 0)} onDiscard={discard} onSave={() => void save()} />
    }>
      <SettingsPanel title={t('servers.presence.sleep')} name="sleep">
        <EditConflictNotice id={id()} resource="sleep-policy" show={sleepRevision.conflict()} current={sleep.value()} onReview={sleepRevision.review} />
        <ServerErrorNote error={sleepError() ?? sleep.error()} onRetry={() => void sleep.refresh()} />
        <Show when={policy()} fallback={<Show when={!sleep.error()}><Skeleton height={160} radius={0} /></Show>}>
          {(current) => (
            <div data-vesta="settings-panel-body">
              <SettingRow label={t('servers.presence.sleep-enabled')} description={t('servers.presence.sleep-enabled-help')}>
                <Toggle size="sm" aria-label={t('servers.presence.sleep-enabled')} disabled={!canEdit()} checked={current().enabled} onChange={(value: boolean) => patchSleep({ enabled: value })} />
              </SettingRow>
              <Show when={current().enabled}>
                <div data-vesta="settings-reveal">
                  <Show when={sleepNow()}>
                    {(copy) => (
                      <p data-vesta="server-sleep-now" data-kind={copy().kind} role="status">
                        <Icon name={copy().kind === 'asleep' ? 'icons/status/moon' : copy().kind === 'counting' ? 'icons/content/timer' : 'icons/status/info'} size={14} />
                        <span>{t(copy().message, copy().args)}</span>
                      </p>
                    )}
                  </Show>
                  <SettingRow label={t('servers.presence.idle')} description={t('servers.presence.idle-help')}>
                    <NumberField size="sm" aria-label={t('servers.presence.idle')} disabled={!canEdit()} value={minutes()} min={1} max={SLEEP_BOUNDS.idleSeconds[1] / 60}
                      onChange={(value: number) => patchSleep({ idleSeconds: Math.round(value) * 60 })} />
                  </SettingRow>
                  <SettingRow label={t('servers.presence.warning')} description={t('servers.presence.warning-help')}>
                    <NumberField size="sm" aria-label={t('servers.presence.warning')} disabled={!canEdit()} value={current().warningSeconds} min={SLEEP_BOUNDS.warningSeconds[0]} max={SLEEP_BOUNDS.warningSeconds[1]}
                      onChange={(value: number) => patchSleep({ warningSeconds: Math.round(value) })} />
                  </SettingRow>
                </div>
              </Show>
              <SettingRow label={t('servers.presence.offline-status')} description={t('servers.presence.offline-status-help')}>
                <Toggle size="sm" aria-label={t('servers.presence.offline-status')} disabled={!canEdit()} checked={current().offlineStatus}
                  onChange={(value: boolean) => patchSleep({
                    offlineStatus: value, wakeOnJoin: value && current().wakeOnJoin,
                    // The agent refuses to sleep at startup without the responder.
                    ...(value || agentStart() !== 'sleep' ? {} : { onAgentStart: 'stay_stopped' as const }),
                  })} />
              </SettingRow>
              <SettingRow label={t('servers.presence.wake')} description={current().offlineStatus ? t('servers.presence.wake-help') : t('servers.presence.wake-needs')}>
                <Toggle size="sm" aria-label={t('servers.presence.wake')} disabled={!canEdit() || !current().offlineStatus} checked={current().wakeOnJoin}
                  onChange={(value: boolean) => patchSleep({ wakeOnJoin: value })} />
              </SettingRow>
              <Show when={current().wakeOnJoin}>
                <div data-vesta="settings-reveal">
                  <SettingRow label={t('servers.presence.cooldown')} description={t('servers.presence.cooldown-help')}>
                    <NumberField size="sm" aria-label={t('servers.presence.cooldown')} disabled={!canEdit()} value={current().startCooldownSeconds}
                      min={SLEEP_BOUNDS.startCooldownSeconds[0]} max={SLEEP_BOUNDS.startCooldownSeconds[1]}
                      onChange={(value: number) => patchSleep({ startCooldownSeconds: Math.round(value) })} />
                  </SettingRow>
                </div>
              </Show>
              <SettingRow label={t('servers.presence.agent-start')}
                description={current().offlineStatus ? t('servers.presence.agent-start-help') : `${t('servers.presence.agent-start-help')} ${t('servers.presence.agent-start-sleep-needs')}`}>
                <Select size="sm" aria-label={t('servers.presence.agent-start')} disabled={!canEdit()} value={agentStart()}
                  onChange={(value) => { if (value !== agentStart()) patchSleep({ onAgentStart: value as AgentStartChoice }); }}
                  options={AGENT_START_CHOICES.map((choice) => ({ value: choice, label: t(agentStartLabels[choice]), disabled: !agentStartAllowed(choice, current()) }))} />
              </SettingRow>
            </div>
          )}
        </Show>
      </SettingsPanel>

      <SettingsPanel
        title={t('servers.presence.status')}

        name="status"
        action={
          <Select size="sm" aria-label={t('servers.presence.when')} value={state()} onChange={(value) => { setState(value as PresenceState); setChecked(null); }}
            options={PRESENCE_STATES.map((entry) => ({ value: entry, label: t('servers.presence.when-state', { name: t(stateLabels[entry]) }) }))} />
        }
      >
        <EditConflictNotice id={id()} resource="motd-policy" show={motdRevision.conflict()} current={motd.value()} onReview={motdRevision.review} />
        <ServerErrorNote error={motdError() ?? motd.error()} onRetry={() => void motd.refresh()} />
        <Show when={presentation()} fallback={<Show when={!motd.error()}><Skeleton height={220} radius={0} /></Show>}>
          {(current) => (
            <>
              <MotdEditor
                id={id()}
                name={props.snapshot.connection.name}
                label={t('servers.presence.template')}
                value={current().template}
                onChange={(template) => patchState({ template })}
                formatting
                placeholders
                readOnly={!canEdit()}
                error={problems().length ? problems().map((problem) => t(problemMessages[problem])).join(' ') : undefined}
                note={checked() ? t('servers.presence.checked') : t('servers.presence.live-motd-note')}
                players={`0/${current().maximumPlayers ?? 20}`}
                version={current().versionName}
                iconPng={current().iconPng ?? document()?.normalIconPng}
                segments={checked()?.segments}
                samples={samples()}
              />
              <div data-vesta="settings-panel-body">
                <SettingRow label={t('servers.presence.version-label')} description={t('servers.presence.version-help')}>
                  <TextField size="sm" aria-label={t('servers.presence.version-label')} placeholder={t('servers.presence.version-placeholder')} readOnly={!canEdit()}
                    value={current().versionName ?? ''} onChange={(value: string) => patchState({ versionName: value || null })} />
                </SettingRow>
                <SettingRow label={t('servers.presence.max-players')} description={t('servers.presence.max-players-help')}>
                  <NumberField size="sm" aria-label={t('servers.presence.max-players')} readOnly={!canEdit()} value={current().maximumPlayers ?? 20} min={0} max={100_000}
                    onChange={(value: number) => patchState({ maximumPlayers: Math.round(value) })} />
                </SettingRow>
                <Show when={state() === 'sleeping' || state() === 'waking'}>
                  <SettingRow label={t('servers.presence.login-message')} description={t('servers.presence.login-message-help')}>
                    <TextField size="sm" aria-label={t('servers.presence.login-message')} readOnly={!canEdit()} value={document()!.loginMessage}
                      onChange={(value: string) => patchDocument({ loginMessage: value })} />
                  </SettingRow>
                </Show>
              </div>
              <div data-vesta="server-panel-foot">
                <span>{t('servers.presence.running-note')}</span>
                <span data-vesta="server-panel-actions">
                  <SectionLink section="game">{t('servers.presence.edit-motd')}</SectionLink>
                  <Button size="sm" variant="outline" disabled={problems().length > 0} onClick={() => void check()}>{t('servers.presence.check')}</Button>
                </span>
              </div>
            </>
          )}
        </Show>
      </SettingsPanel>
    </SettingsPage>
  );
}
