import { Button, Menu, MenuItem, NumberField, Select, Switch as Toggle, TextArea, TextField, Tooltip, toast } from '@vesta/ui';
import { For, Show, createEffect, createMemo, createSignal } from 'solid-js';
import { Icon } from '../../../components/icon';
import { SettingRow } from '../../../components/setting-row';
import { t } from '../../../localization';
import type { MessageId } from '../../../localization/messages';
import { gate } from '../../../features/servers/capabilities';
import { stableConnectionId } from '../../../features/servers/connection-id';
import { errorMessage } from '../../../features/servers/errors';
import { newIntentId } from '../../../features/servers/model';
import { MOTD_COLORS, MOTD_PLACEHOLDERS, motdProblems, type MotdProblem } from '../../../features/servers/motd-model';
import { serverCommand } from '../../../features/servers/store';
import type { ServerCommandError, ServerSnapshot } from '../../../features/servers/native';
import { PRESENCE_STATES, SLEEP_BOUNDS, type MotdDocument, type MotdPreview as AgentPreview, type PresenceState, type SleepPolicy } from '../../../features/servers/native-presence';
import { MotdPreview } from '../motd-preview';
import { ServerErrorNote } from '../parts';
import '../../library/instance/settings-tab.css';

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

const sameJson = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

export function PresenceTab(props: { snapshot: ServerSnapshot }) {
  return (
    <div data-vesta="server-activity">
      <div data-vesta="instance-settings-scroll">
        <SleepPanel snapshot={props.snapshot} />
        <PresencePanel snapshot={props.snapshot} />
      </div>
    </div>
  );
}

function SleepPanel(props: { snapshot: ServerSnapshot }) {
  const id = stableConnectionId(() => props.snapshot);
  const canEdit = () => gate(props.snapshot.capabilities, 'config.edit') !== 'denied';
  const [saved, setSaved] = createSignal<{ policy: SleepPolicy; revision: number } | null>(null, { name: 'server-sleep:saved' });
  const [draft, setDraft] = createSignal<SleepPolicy | null>(null, { name: 'server-sleep:draft' });
  const [error, setError] = createSignal<ServerCommandError | null>(null, { name: 'server-sleep:error' });
  const [busy, setBusy] = createSignal(false, { name: 'server-sleep:busy' });
  const load = async () => {
    setError(null);
    try { const value = await serverCommand((client) => client.sleepPolicy(id())); setSaved(value); setDraft(value.policy); }
    catch (reason) { setError(reason as ServerCommandError); }
  };
  createEffect(id, () => { void load(); }, { name: 'server-sleep:load' });
  const dirty = () => !!draft() && !!saved() && !sameJson(draft(), saved()!.policy);
  const patch = (next: Partial<SleepPolicy>) => setDraft((current) => (current ? { ...current, ...next } : current));
  const minutes = (key: 'idleSeconds') => Math.round((draft()?.[key] ?? 0) / 60);
  const save = async () => {
    const policy = draft();
    const current = saved();
    if (!policy || !current) return;
    setBusy(true); setError(null);
    try {
      const next = await serverCommand((client) => client.updateSleepPolicy(id(), policy, current.revision, newIntentId()));
      setSaved(next); setDraft(next.policy);
      toast.show({ title: t('servers.presence.saved'), tone: 'neutral' });
    } catch (reason) {
      setError(reason as ServerCommandError);
      if ((reason as ServerCommandError).code === 'stale_target') void load();
    } finally { setBusy(false); }
  };
  return (
    <section data-vesta="settings-panel">
      <h3>{t('servers.presence.sleep')}</h3>
      <p data-vesta="server-muted" class="server-panel-note">{t('servers.presence.sleep-help')}</p>
      <ServerErrorNote error={error()} onRetry={() => void load()} />
      <Show when={draft()}>
        {(policy) => (
          <div data-vesta="settings-panel-body">
            <SettingRow label={t('servers.presence.sleep-enabled')} description={t('servers.presence.sleep-enabled-help')}>
              <Toggle size="sm" aria-label={t('servers.presence.sleep-enabled')} disabled={!canEdit()} checked={policy().enabled} onChange={(value: boolean) => patch({ enabled: value })} />
            </SettingRow>
            <Show when={policy().enabled}>
              <div data-vesta="settings-reveal">
                <SettingRow label={t('servers.presence.idle')} description={t('servers.presence.idle-help')}>
                  <NumberField aria-label={t('servers.presence.idle')} disabled={!canEdit()} value={minutes('idleSeconds')} min={1} max={SLEEP_BOUNDS.idleSeconds[1] / 60}
                    onChange={(value: number) => patch({ idleSeconds: Math.round(value) * 60 })} />
                </SettingRow>
                <SettingRow label={t('servers.presence.warning')} description={t('servers.presence.warning-help')}>
                  <NumberField aria-label={t('servers.presence.warning')} disabled={!canEdit()} value={policy().warningSeconds} min={SLEEP_BOUNDS.warningSeconds[0]} max={SLEEP_BOUNDS.warningSeconds[1]}
                    onChange={(value: number) => patch({ warningSeconds: Math.round(value) })} />
                </SettingRow>
              </div>
            </Show>
            <SettingRow label={t('servers.presence.offline-status')} description={t('servers.presence.offline-status-help')}>
              <Toggle size="sm" aria-label={t('servers.presence.offline-status')} disabled={!canEdit()} checked={policy().offlineStatus} onChange={(value: boolean) => patch({ offlineStatus: value, wakeOnJoin: value && policy().wakeOnJoin })} />
            </SettingRow>
            <SettingRow label={t('servers.presence.wake')} description={t('servers.presence.wake-help')}>
              <Toggle size="sm" aria-label={t('servers.presence.wake')} disabled={!canEdit() || !policy().offlineStatus} checked={policy().wakeOnJoin} onChange={(value: boolean) => patch({ wakeOnJoin: value })} />
            </SettingRow>
            <Show when={policy().wakeOnJoin}>
              <div data-vesta="settings-reveal">
                <SettingRow label={t('servers.presence.cooldown')} description={t('servers.presence.cooldown-help')}>
                  <NumberField aria-label={t('servers.presence.cooldown')} disabled={!canEdit()} value={policy().startCooldownSeconds} min={SLEEP_BOUNDS.startCooldownSeconds[0]} max={SLEEP_BOUNDS.startCooldownSeconds[1]}
                    onChange={(value: number) => patch({ startCooldownSeconds: Math.round(value) })} />
                </SettingRow>
              </div>
            </Show>
            <Show when={dirty()}>
              <div data-vesta="server-panel-actions">
                <p data-vesta="server-muted">{t('servers.presence.unsaved')}</p>
                <div>
                  <Button size="sm" variant="ghost" onClick={() => setDraft(saved()!.policy)}>{t('servers.presence.discard')}</Button>
                  <Button size="sm" tone="accent" disabled={busy()} onClick={() => void save()}>{t('servers.save')}</Button>
                </div>
              </div>
            </Show>
          </div>
        )}
      </Show>
    </section>
  );
}

function PresencePanel(props: { snapshot: ServerSnapshot }) {
  const id = stableConnectionId(() => props.snapshot);
  const canEdit = () => gate(props.snapshot.capabilities, 'config.edit') !== 'denied';
  const [saved, setSaved] = createSignal<{ document: MotdDocument; revision: string | null } | null>(null, { name: 'server-motd:saved' });
  const [draft, setDraft] = createSignal<MotdDocument | null>(null, { name: 'server-motd:draft' });
  const [state, setState] = createSignal<PresenceState>('sleeping', { name: 'server-motd:state' });
  const [checked, setChecked] = createSignal<AgentPreview | null>(null, { name: 'server-motd:checked' });
  const [error, setError] = createSignal<ServerCommandError | null>(null, { name: 'server-motd:error' });
  const [busy, setBusy] = createSignal(false, { name: 'server-motd:busy' });
  let editor: HTMLTextAreaElement | undefined;
  const load = async () => {
    setError(null);
    try { const value = await serverCommand((client) => client.motdPolicy(id())); setSaved(value); setDraft(value.document); }
    catch (reason) { setError(reason as ServerCommandError); }
  };
  createEffect(id, () => { void load(); }, { name: 'server-motd:load' });
  const presentation = () => draft()?.states[state()];
  const problems = createMemo(() => motdProblems(presentation()?.template ?? ''), { name: 'server-motd:problems' });
  const dirty = () => !!draft() && !!saved() && !sameJson(draft(), saved()!.document);
  const patchState = (next: Partial<MotdDocument['states'][PresenceState]>) => {
    setChecked(null);
    setDraft((current) => (current ? { ...current, states: { ...current.states, [state()]: { ...current.states[state()], ...next } } } : current));
  };
  /** Inserts at the cursor, keeping focus in the editor. */
  const insert = (text: string) => {
    const current = presentation()?.template ?? '';
    const start = editor?.selectionStart ?? current.length;
    const end = editor?.selectionEnd ?? current.length;
    patchState({ template: current.slice(0, start) + text + current.slice(end) });
    queueMicrotask(() => { editor?.focus(); editor?.setSelectionRange(start + text.length, start + text.length); });
  };
  const check = async () => {
    const document = draft();
    if (!document) return;
    setError(null);
    try { setChecked(await serverCommand((client) => client.motdPreview(id(), state(), document))); }
    catch (reason) { setError(reason as ServerCommandError); }
  };
  const save = async () => {
    const document = draft();
    const current = saved();
    if (!document || !current) return;
    setBusy(true); setError(null);
    try {
      const next = await serverCommand((client) => client.updateMotdPolicy(id(), document, current.revision, newIntentId()));
      setSaved(next); setDraft(next.document);
      toast.show({ title: t('servers.presence.saved'), tone: 'neutral' });
    } catch (reason) {
      setError(reason as ServerCommandError);
      toast.show({ title: t(errorMessage(reason)), tone: 'danger' });
    } finally { setBusy(false); }
  };
  const samples = () => ({
    server_name: props.snapshot.connection.name, state: t(stateLabels[state()]), online_players: '0',
    max_players: String(presentation()?.maximumPlayers ?? 20), minecraft_version: props.snapshot.info?.minecraftVersion ?? '1.21',
    pack_version: props.snapshot.info?.packVersion ?? '', maintenance_reason: t('servers.presence.sample-reason'),
  });
  return (
    <section data-vesta="settings-panel">
      <h3>{t('servers.presence.status')}</h3>
      <p data-vesta="server-muted" class="server-panel-note">{t('servers.presence.status-help')}</p>
      <ServerErrorNote error={error()} onRetry={() => void load()} />
      <Show when={presentation()}>
        {(current) => (
          <div data-vesta="server-motd-editor">
            <div data-vesta="server-motd-toolbar">
              <Select aria-label={t('servers.presence.when')} value={state()} onChange={(value) => { setState(value as PresenceState); setChecked(null); }}
                options={PRESENCE_STATES.map((entry) => ({ value: entry, label: t(stateLabels[entry]) }))} />
              <div data-vesta="server-motd-colors" role="toolbar" aria-label={t('servers.presence.colors')}>
                <For each={Object.entries(MOTD_COLORS)}>
                  {([code, color]) => (
                    <Tooltip content={`§${code}`} trigger={(tooltip) => (
                      <button {...tooltip} type="button" disabled={!canEdit()} data-vesta="server-motd-swatch" style={{ background: color }} aria-label={`§${code}`} onClick={() => insert(`§${code}`)} />
                    )} />
                  )}
                </For>
                <button type="button" disabled={!canEdit()} data-vesta="server-motd-style" onClick={() => insert('§l')}><b>B</b></button>
                <button type="button" disabled={!canEdit()} data-vesta="server-motd-style" onClick={() => insert('§o')}><i>I</i></button>
                <button type="button" disabled={!canEdit()} data-vesta="server-motd-style" onClick={() => insert('§n')}><u>U</u></button>
                <button type="button" disabled={!canEdit()} data-vesta="server-motd-style" onClick={() => insert('§r')}>{t('servers.presence.reset')}</button>
              </div>
              <Menu trigger={(menu) => <Button {...menu} size="sm" variant="ghost" disabled={!canEdit()} icon={<Icon name="icons/actions/add" />}>{t('servers.presence.placeholder')}</Button>}>
                <For each={MOTD_PLACEHOLDERS}>{(name) => <MenuItem onSelect={() => insert(`{${name}}`)}>{`{${name}}`}</MenuItem>}</For>
              </Menu>
            </div>
            <TextArea
              ref={(element: HTMLTextAreaElement) => { editor = element; }}
              aria-label={t('servers.presence.template')}
              value={current().template}
              readOnly={!canEdit()}
              rows={2}
              spellcheck="false"
              onChange={(value: string) => patchState({ template: value })}
              error={problems().length ? problems().map((problem) => t(problemMessages[problem])).join(' ') : undefined}
            />
            <MotdPreview
              name={props.snapshot.connection.name}
              template={current().template}
              players={`0/${current().maximumPlayers ?? 20}`}
              version={current().versionName}
              iconPng={current().iconPng ?? draft()?.normalIconPng}
              segments={checked()?.segments}
              samples={samples()}
            />
            <div data-vesta="server-motd-fields">
              <TextField size="sm" label={t('servers.presence.version-label')} placeholder={t('servers.presence.version-placeholder')} readOnly={!canEdit()} value={current().versionName ?? ''}
                onChange={(value: string) => patchState({ versionName: value || null })} />
              <NumberField label={t('servers.presence.max-players')} readOnly={!canEdit()} value={current().maximumPlayers ?? 20} min={0} max={100_000}
                onChange={(value: number) => patchState({ maximumPlayers: Math.round(value) })} />
            </div>
            <Show when={state() === 'sleeping' || state() === 'waking'}>
              <TextField size="sm" label={t('servers.presence.login-message')} description={t('servers.presence.login-message-help')} readOnly={!canEdit()} value={draft()!.loginMessage}
                onChange={(value: string) => setDraft((doc) => (doc ? { ...doc, loginMessage: value } : doc))} />
            </Show>
            <div data-vesta="server-panel-actions">
              <p data-vesta="server-muted">{checked() ? t('servers.presence.checked') : dirty() ? t('servers.presence.unsaved') : t('servers.presence.live-motd-note')}</p>
              <div>
                <Button size="sm" variant="ghost" disabled={problems().length > 0} onClick={() => void check()}>{t('servers.presence.check')}</Button>
                <Show when={dirty() && canEdit()}>
                  <Button size="sm" variant="ghost" onClick={() => { setDraft(saved()!.document); setChecked(null); }}>{t('servers.presence.discard')}</Button>
                  <Button size="sm" tone="accent" disabled={busy() || problems().length > 0} onClick={() => void save()}>{t('servers.save')}</Button>
                </Show>
              </div>
            </div>
          </div>
        )}
      </Show>
    </section>
  );
}
