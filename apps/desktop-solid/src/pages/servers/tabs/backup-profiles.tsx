import { Badge, Button, NumberField, SegmentedControl, Skeleton, TextArea, TextField, toast } from '@vesta/ui';
import { For, Show, createMemo, createSignal, untrack } from 'solid-js';
import type { JSX } from '@solidjs/web';
import { Icon } from '../../../components/icon';
import { transitionTo } from '../../../app/transition';
import { t } from '../../../localization';
import type { MessageId } from '../../../localization/messages';
import {
  MAX_KEEP, MAX_PROFILES, diffCount, draftDiff, editDraft, keepsEverything, nextProfileName, parseList, profileProblems, setupDraft,
  simpleRetention, suggestedProfile, withSimpleRetention, type ProfileProblem, type SimpleRetention, type Thinning,
} from '../../../features/servers/backup-setup-model';
import { gate } from '../../../features/servers/capabilities';
import { stableConnectionId } from '../../../features/servers/connection-id';
import { IntentMemo } from '../../../features/servers/model';
import { invalidateServerResources, useServerResource } from '../../../features/servers/resources';
import { backupConfigResource } from '../../../features/servers/server-resources';
import { serverCommand } from '../../../features/servers/store';
import type { ServerCommandError, ServerSnapshot } from '../../../features/servers/native';
import type { BackupConfigDraft, BackupConfiguration, BackupProfileConfig } from '../../../features/servers/native-backups-config';
import { ServerErrorNote } from '../parts';
import { SaveBar } from '../settings-parts';
import { draftFromTemplate, handOffDraft } from './automation-shared';
import { templateLabels } from '../automation/templates';
import './backups-tab.css';

/** One profile while it is edited: list fields stay as typed text until saved. */
interface Row { key: number; profile: BackupProfileConfig; scope: 'all' | 'some'; includeText: string; excludeText: string }

let nextKey = 0;
const toRow = (profile: BackupProfileConfig): Row => ({
  key: nextKey++, profile, scope: profile.include.length ? 'some' : 'all', includeText: profile.include.join('\n'), excludeText: profile.exclude.join('\n'),
});
const fromRow = (row: Row): BackupProfileConfig => ({
  ...row.profile, include: row.scope === 'all' ? [] : parseList(row.includeText), exclude: parseList(row.excludeText),
});

const problemText: Record<ProfileProblem, MessageId> = {
  name: 'servers.backup-setup.name-problem',
  'name-taken': 'servers.backup-setup.name-taken',
  'keep-range': 'servers.backup-setup.keep-range',
  include: 'servers.backup-setup.include-problem',
  exclude: 'servers.backup-setup.exclude-problem',
};

const ADVANCED_FIELDS = [
  ['keepTotal', 'servers.backup-setup.keep-total'],
  ['keepLast', 'servers.backup-setup.keep-last'],
  ['keepHourly', 'servers.backup-setup.keep-hourly'],
  ['keepDaily', 'servers.backup-setup.keep-daily'],
  ['keepWeekly', 'servers.backup-setup.keep-weekly'],
  ['keepMonthly', 'servers.backup-setup.keep-monthly'],
] as const satisfies readonly (readonly [keyof BackupProfileConfig, MessageId])[];

const DEFAULT_TOTAL = 14;

/** Name, mode, retention and scope of one profile, in two columns. */
function ProfileFields(props: { row: Row; others: readonly BackupProfileConfig[]; readOnly?: boolean; onChange: (patch: Partial<Row>) => void }) {
  const profile = () => fromRow(props.row);
  const problems = () => profileProblems(profile(), props.others);
  const has = (problem: ProfileProblem) => problems().includes(problem);
  const patch = (next: Partial<BackupProfileConfig>) => props.onChange({ profile: { ...props.row.profile, ...next } });
  const simple = () => simpleRetention(props.row.profile);
  // Advanced opens by itself only for retention the simple form can't show.
  const [advanced, setAdvanced] = createSignal(untrack(simple) === null, { name: 'server-backup-fields:advanced' });
  const setSimple = (next: Partial<SimpleRetention>) => {
    const base = simple() ?? { total: props.row.profile.keepTotal || DEFAULT_TOTAL, thinning: 'none' as Thinning };
    patch(withSimpleRetention(props.row.profile, { ...base, ...next }));
  };
  return (
    <div data-vesta="backup-form">
      <div data-vesta="backup-form-column">
        <TextField size="sm" label={t('servers.backup-setup.name')} value={props.row.profile.name}
          disabled={props.readOnly} autocomplete="off" spellcheck="false"
          error={has('name') ? t(problemText.name) : has('name-taken') ? t(problemText['name-taken']) : undefined}
          onChange={(next: string) => patch({ name: next.toLowerCase().replace(/\s+/g, '-') })} />

        <div data-vesta="backup-form-field">
          <span data-vesta="backup-form-label">{t('servers.backup-setup.mode')}</span>
          <SegmentedControl size="sm" aria-label={t('servers.backup-setup.mode')} value={props.row.profile.mode} disabled={props.readOnly}
            onChange={(value) => patch({ mode: value as BackupProfileConfig['mode'] })}
            options={[{ value: 'online', label: t('servers.backups.mode-online') }, { value: 'stopped', label: t('servers.backups.mode-stopped') }]} />
          <span data-vesta="backup-form-help">
            {t(props.row.profile.mode === 'online' ? 'servers.backup-setup.mode-online-help' : 'servers.backup-setup.mode-stopped-help')}
          </span>
        </div>

        <div data-vesta="backup-form-field">
          <span data-vesta="backup-form-label">{t('servers.backup-setup.retention')}</span>
          <Show when={simple()} fallback={<span data-vesta="backup-form-help">{retentionText(props.row.profile)}</span>}>
            {(value) => (
              <>
                <div data-vesta="backup-keep-row">
                  <span>{t('servers.backup-setup.keep-up-to')}</span>
                  <NumberField size="sm" aria-label={t('servers.backup-setup.keep-total')} value={value().total} min={0} max={MAX_KEEP} disabled={props.readOnly}
                    onChange={(next: number) => setSimple({ total: next })} />
                  <span>{t('servers.backup-setup.keep-backups', { count: value().total })}</span>
                </div>
                <div data-vesta="backup-keep-row">
                  <span>{t('servers.backup-setup.thinning')}</span>
                  <SegmentedControl size="sm" aria-label={t('servers.backup-setup.thinning')} value={value().thinning} disabled={props.readOnly}
                    onChange={(next) => setSimple({ thinning: next as Thinning })}
                    options={[
                      { value: 'none', label: t('servers.backup-setup.thinning-none') },
                      { value: 'hourly', label: t('servers.backup-setup.thinning-hour') },
                      { value: 'daily', label: t('servers.backup-setup.thinning-day') },
                    ]} />
                </div>
              </>
            )}
          </Show>
          <details data-vesta="backup-advanced" open={advanced()} onToggle={(event) => setAdvanced(event.currentTarget.open)}>
            <summary>{t('servers.backup-setup.advanced')}</summary>
            <div data-vesta="backup-keep-grid">
              <For each={ADVANCED_FIELDS}>
                {([field, label]) => (
                  <NumberField size="sm" label={t(label)} value={(props.row.profile[field] as number | null | undefined) ?? 0} min={0} max={MAX_KEEP} disabled={props.readOnly}
                    onChange={(next: number) => patch({ [field]: next })} />
                )}
              </For>
            </div>
            <Show when={!simple() && !props.readOnly}>
              <Button size="sm" variant="ghost" onClick={() => setSimple({})}>{t('servers.backup-setup.use-simple')}</Button>
            </Show>
          </details>
          <Show when={has('keep-range')}><p data-vesta="server-callout" data-tone="danger">{t(problemText['keep-range'])}</p></Show>
          <Show when={!has('keep-range') && keepsEverything(props.row.profile)}>
            <p data-vesta="server-callout" data-tone="warning">{t('servers.backup-setup.keeps-everything')}</p>
          </Show>
        </div>
      </div>

      <div data-vesta="backup-form-column">
        <div data-vesta="backup-form-field">
          <span data-vesta="backup-form-label">{t('servers.backup-setup.scope')}</span>
          <SegmentedControl size="sm" aria-label={t('servers.backup-setup.scope')} value={props.row.scope} disabled={props.readOnly}
            onChange={(value) => props.onChange({ scope: value as Row['scope'] })}
            options={[{ value: 'all', label: t('servers.backup-setup.scope-all') }, { value: 'some', label: t('servers.backup-setup.scope-some') }]} />
        </div>
        <Show when={props.row.scope === 'some'}>
          <TextArea size="sm" rows={3} label={t('servers.backup-setup.include')}
            placeholder={'world\nconfig\nserver.properties'} value={props.row.includeText} disabled={props.readOnly}
            error={has('include') ? t(problemText.include) : undefined} onChange={(next: string) => props.onChange({ includeText: next })} />
        </Show>
        <TextArea size="sm" rows={2} label={t('servers.backup-setup.exclude')}
          placeholder={'logs/\n*.tmp'} value={props.row.excludeText} disabled={props.readOnly}
          error={has('exclude') ? t(problemText.exclude) : undefined} onChange={(next: string) => props.onChange({ excludeText: next })} />
      </div>
    </div>
  );
}

/** Where backups live, as one muted line. The location is fixed by the server's host. */
function StorageNote(props: { configuration: BackupConfiguration }) {
  return (
    <p data-vesta="backup-location">
      <Icon name="icons/content/storage" size={12} />
      <span>{t(props.configuration.repository.initialized ? 'servers.backup-setup.storage' : 'servers.backup-setup.storage-new')}</span>
      <Show when={props.configuration.repository.location} fallback={<span>{t('servers.backup-setup.storage-unknown')}</span>}>
        {(location) => <code title={location()}>{location()}</code>}
      </Show>
    </p>
  );
}

/** Saves the complete profile set against a revision; the same retry reuses its intent id. */
function useConfigSave(snapshot: () => ServerSnapshot, configuration: () => BackupConfiguration | undefined, reload: () => Promise<void>) {
  const intents = new IntentMemo();
  const [saving, setSaving] = createSignal(false, { name: 'server-backup-config:saving' });
  const [error, setError] = createSignal<ServerCommandError | null>(null, { name: 'server-backup-config:error' });
  const [stale, setStale] = createSignal(false, { name: 'server-backup-config:stale' });
  const [uncertain, setUncertain] = createSignal(false, { name: 'server-backup-config:uncertain' });
  const save = async (draft: BackupConfigDraft): Promise<boolean> => {
    const id = snapshot().connection.id;
    const revision = configuration()?.revision ?? null;
    const intentId = intents.idFor({ draft, revision });
    setSaving(true); setError(null);
    try {
      await serverCommand((client) => client.backupConfigure(id, draft, revision, intentId));
      intents.settle();
      setStale(false); setUncertain(false);
      invalidateServerResources(id, ['backup-config', 'backups', 'backup-storage']);
      return true;
    } catch (reason) {
      const failure = reason as ServerCommandError;
      intents.settle(failure);
      setUncertain(intents.uncertain);
      if (failure.code === 'stale_target') {
        // Someone else saved first: load theirs and keep this draft on top for review.
        setStale(true);
        await reload();
      } else setError(failure);
      return false;
    } finally { setSaving(false); }
  };
  return { save, saving, error, stale, uncertain };
}

/** First-time setup, inline: one suggested profile in two columns, then turn on. */
export function BackupSetup(props: { snapshot: ServerSnapshot; onEnabled: (profile: string) => void }) {
  const connection = stableConnectionId(() => props.snapshot);
  const config = useServerResource(connection, backupConfigResource);
  const [row, setRow] = createSignal<Row>(toRow(suggestedProfile()), { name: 'server-backup-setup:row' });
  const saver = useConfigSave(() => props.snapshot, () => config.value(), () => config.refresh());
  const profile = () => fromRow(row());
  const valid = () => profileProblems(profile(), []).length === 0;
  const turnOn = async () => {
    const current = config.value();
    if (!current || !valid()) return;
    const draft = { ...setupDraft(current), profiles: [profile()] };
    if (await saver.save(draft)) {
      toast.show({ title: t('servers.backup-setup.enabled-title'), tone: 'success' });
      props.onEnabled(draft.profiles[0].name);
    }
  };
  return (
    <section data-vesta="settings-panel" data-server-panel="backup-setup">
      <header data-vesta="server-panel-head">
        <div><h3>{t('servers.backup-setup.title')}</h3></div>
      </header>
      <div data-vesta="settings-panel-body">
        <ServerErrorNote error={saver.error() ?? config.error()} onRetry={() => void config.refresh()} />
        <Show when={config.value()} fallback={<Show when={!config.error()}><Skeleton height={220} radius={10} /></Show>}>
          {(current) => (
            <>
              <ProfileFields row={row()} others={[]} onChange={(patch) => setRow((value) => ({ ...value, ...patch }))} />
              <Show when={saver.stale()}><p data-vesta="server-callout" data-tone="warning" role="status">{t('servers.backup-setup.stale')}</p></Show>
              <Show when={saver.uncertain()}><p data-vesta="server-callout" data-tone="warning" role="status">{t('servers.backup-setup.uncertain')}</p></Show>
              <div data-vesta="backup-form-actions">
                <StorageNote configuration={current()} />
                <Button tone="accent" icon={<Icon name="icons/content/storage" />} disabled={saver.saving() || !valid()} onClick={() => void turnOn()}>
                  {t(saver.saving() ? 'servers.backup-setup.turning-on' : saver.uncertain() ? 'servers.backup-setup.retry' : 'servers.backup-setup.turn-on')}
                </Button>
              </div>
            </>
          )}
        </Show>
      </div>
    </section>
  );
}

/** After setup: offer the nightly Automation template (pre-filled with the new profile). */
export function BackupsEnabled(props: { snapshot: ServerSnapshot; profile: string; onDismiss: () => void; onRun: () => void }) {
  const canSchedule = () => gate(props.snapshot.capabilities, 'automation.manage') !== 'denied';
  const [busy, setBusy] = createSignal(false, { name: 'server-backup-setup:scheduling' });
  const schedule = async () => {
    const id = props.snapshot.connection.id;
    setBusy(true);
    try {
      const draft = await draftFromTemplate(id, 'nightly-backup', t(templateLabels['nightly-backup'].name));
      // The template picks the first profile it finds; use the one just turned on.
      handOffDraft({ ...draft, steps: draft.steps.map((step) => (step.action.kind === 'backup' ? { ...step, action: { ...step.action, profile: props.profile } } : step)) });
      transitionTo(`/servers/${id}/automation/new`);
    } finally { setBusy(false); }
  };
  return (
    <div data-vesta="server-callout" data-tone="success" role="status" data-server-backups-enabled>
      <p><strong>{t('servers.backup-setup.enabled-title')}</strong> {t('servers.backup-setup.enabled-body', { name: props.profile })}</p>
      <div data-vesta="server-backup-actions">
        <Button size="sm" variant="ghost" onClick={props.onDismiss}>{t('servers.backup-setup.dismiss')}</Button>
        <Show when={gate(props.snapshot.capabilities, 'backups.create') !== 'denied'}>
          <Button size="sm" variant="outline" onClick={props.onRun}>{t('servers.backups.run')}</Button>
        </Show>
        <Show when={canSchedule()}>
          <Button size="sm" tone="accent" icon={<Icon name="icons/content/timer" />} disabled={busy()} onClick={() => void schedule()}>{t('servers.backup-setup.schedule')}</Button>
        </Show>
      </div>
    </div>
  );
}

/**
 * The "Backup profiles" panel for owners and administrators: each profile expands into its
 * settings, and the whole set saves together. `actions` renders a saved profile's run and
 * backup-list controls.
 */
export function BackupProfilesEditor(props: { snapshot: ServerSnapshot; actions: (name: string) => JSX.Element; details: (name: string) => JSX.Element }) {
  const connection = stableConnectionId(() => props.snapshot);
  const config = useServerResource(connection, backupConfigResource);
  const base = createMemo(() => { const value = config.value(); return value ? editDraft(value) : null; }, { name: 'server-backup-config:base' });
  const [rows, setRows] = createSignal<Row[] | null>(null, { name: 'server-backup-config:rows' });
  const [open, setOpen] = createSignal<number | null>(null, { name: 'server-backup-config:open' });
  const saver = useConfigSave(() => props.snapshot, () => config.value(), () => config.refresh());
  const baseRows = createMemo(() => base()?.profiles.map(toRow) ?? [], { name: 'server-backup-config:base-rows' });
  const current = () => rows() ?? baseRows();
  const profiles = () => current().map(fromRow);
  const savedNames = () => new Set(base()?.profiles.map((profile) => profile.name) ?? []);
  const diff = createMemo(() => draftDiff(base()?.profiles ?? [], profiles()), { name: 'server-backup-config:diff' });
  const count = () => (rows() ? diffCount(diff()) : 0);
  const others = (key: number) => current().filter((row) => row.key !== key).map(fromRow);
  const valid = () => current().every((row) => profileProblems(fromRow(row), others(row.key)).length === 0);
  const edit = (key: number, patch: Partial<Row>) => setRows(current().map((row) => (row.key === key ? { ...row, ...patch } : row)));
  const add = () => {
    const row = toRow(withSimpleRetention({ ...suggestedProfile(), name: nextProfileName(profiles().map((profile) => profile.name)) }, { total: 10, thinning: 'none' }));
    setRows([...current(), row]);
    setOpen(row.key);
  };
  const remove = (key: number) => { setRows(current().filter((row) => row.key !== key)); setOpen(null); };
  const discard = () => { setRows(null); setOpen(null); };
  const save = async () => {
    const value = base();
    if (!value || !valid()) return;
    if (await saver.save({ ...value, profiles: profiles() })) {
      toast.show({ title: t('servers.backup-setup.saved'), tone: 'success' });
      setRows(null); setOpen(null);
    }
  };
  const state = (row: Row): 'new' | 'edited' | null => {
    const name = fromRow(row).name;
    if (!savedNames().has(name)) return 'new';
    return diff().changed.includes(name) ? 'edited' : null;
  };
  const renamed = (row: Row) => {
    const original = baseRows().find((entry) => entry.key === row.key)?.profile.name;
    return original && original !== row.profile.name ? original : null;
  };
  // Rows keep their key across a reload so an open editor stays open; a fresh base re-keys them.
  return (
    <section data-vesta="settings-panel" data-server-panel="backup-profiles">
      <header data-vesta="server-panel-head">
        <div><h3>{t('servers.backups.profiles')}</h3></div>
        <div data-vesta="server-panel-head-action">
          <Button size="sm" variant="ghost" icon={<Icon name="icons/actions/add" />} disabled={current().length >= MAX_PROFILES || !base()} onClick={add}>
            {t('servers.backup-setup.add-profile')}
          </Button>
        </div>
      </header>
      <div data-vesta="settings-panel-body">
        <ServerErrorNote error={saver.error() ?? config.error()} onRetry={() => void config.refresh()} />
        <Show when={saver.stale()}><p data-vesta="server-callout" data-tone="warning" role="status">{t('servers.backup-setup.stale')}</p></Show>
        <Show when={saver.uncertain()}>
          <div data-vesta="server-callout" data-tone="warning" role="status">
            <p>{t('servers.backup-setup.uncertain')}</p>
            <Button size="sm" variant="outline" disabled={saver.saving()} onClick={() => void save()}>{t('servers.backup-setup.retry')}</Button>
          </div>
        </Show>
        <Show when={base()} fallback={<Show when={!config.error()}><Skeleton height={64} radius={10} /></Show>}>
          <Show when={current().length} fallback={<p data-vesta="server-callout" data-tone="warning">{t('servers.backup-setup.disable-warning')}</p>}>
            <For each={current()} keyed={(row) => row.key}>
              {(row) => {
                const saved = () => savedNames().has(row().profile.name) && state(row()) !== 'new';
                const isOpen = () => open() === row().key;
                return (
                  <div data-vesta="server-backup-profile" data-open={isOpen() ? '' : undefined}>
                    <div data-vesta="setting-row">
                      <div data-vesta="setting-row-copy">
                        <span data-vesta="setting-row-label">
                          {row().profile.name || '—'}
                          <Badge size="sm" variant="soft" tone="neutral">{t(row().profile.mode === 'online' ? 'servers.backups.mode-online' : 'servers.backups.mode-stopped')}</Badge>
                          <Show when={state(row())}>
                            {(kind) => <Badge size="sm" variant="soft" tone="warning">{t(kind() === 'new' ? 'servers.backup-setup.badge-new' : 'servers.backup-setup.badge-edited')}</Badge>}
                          </Show>
                        </span>
                        <span data-vesta="setting-row-description">{retentionText(row().profile)}</span>
                      </div>
                      <div data-vesta="setting-row-control">
                        <Show when={saved() && !count()}>{props.actions(row().profile.name)}</Show>
                        <Button size="sm" variant={isOpen() ? 'outline' : 'ghost'} icon={<Icon name="icons/actions/edit" />} aria-expanded={isOpen() ? 'true' : 'false'}
                          onClick={() => setOpen(isOpen() ? null : row().key)}>
                          {t(isOpen() ? 'servers.backup-setup.done' : 'servers.backup-setup.edit')}
                        </Button>
                      </div>
                    </div>
                    <Show when={isOpen()}>
                      <div data-vesta="settings-reveal">
                        <ProfileFields row={row()} others={others(row().key)} onChange={(patch) => edit(row().key, patch)} />
                        <Show when={renamed(row())}>
                          {(old) => <p data-vesta="server-callout" data-tone="neutral">{t('servers.backup-setup.rename-note', { name: old() })}</p>}
                        </Show>
                        <div data-vesta="backup-form-actions">
                          <span data-vesta="backup-location">{t('servers.backup-setup.remove-help')}</span>
                          <Button size="sm" variant="ghost" tone="danger" icon={<Icon name="icons/actions/delete" />} onClick={() => remove(row().key)}>
                            {t('servers.backup-setup.remove')}
                          </Button>
                        </div>
                      </div>
                    </Show>
                    <Show when={saved() && !isOpen()}>{props.details(row().profile.name)}</Show>
                  </div>
                );
              }}
            </For>
          </Show>
          <div data-vesta="backup-form-actions"><StorageNote configuration={config.value()!} /></div>
        </Show>
      </div>
      <SaveBar show={count() > 0 || saver.uncertain()} label={t('servers.backup-setup.unsaved', { count: count() })} busy={saver.saving()} disabled={!valid()}
        onDiscard={discard} onSave={() => void save()} />
    </section>
  );
}

/** Retention in plain words, e.g. "Up to 14 · one per day", or the advanced counts. */
export function retentionText(profile: Pick<BackupProfileConfig, 'keepTotal' | 'keepHourly' | 'keepLast' | 'keepDaily' | 'keepWeekly' | 'keepMonthly'>) {
  const simple = simpleRetention(profile);
  if (simple) {
    if (!simple.total) return t('servers.backups.keep-all');
    const total = t('servers.backups.keep-up-to', { count: simple.total });
    return simple.thinning === 'none' ? total : `${total} · ${t(simple.thinning === 'hourly' ? 'servers.backups.one-per-hour' : 'servers.backups.one-per-day')}`;
  }
  const parts = [
    profile.keepTotal && t('servers.backups.keep-up-to', { count: profile.keepTotal }),
    profile.keepLast && t('servers.backups.keep-last', { count: profile.keepLast }),
    profile.keepHourly && t('servers.backups.keep-hourly', { count: profile.keepHourly }),
    profile.keepDaily && t('servers.backups.keep-daily', { count: profile.keepDaily }),
    profile.keepWeekly && t('servers.backups.keep-weekly', { count: profile.keepWeekly }),
    profile.keepMonthly && t('servers.backups.keep-monthly', { count: profile.keepMonthly }),
  ].filter(Boolean);
  return parts.join(' · ');
}
