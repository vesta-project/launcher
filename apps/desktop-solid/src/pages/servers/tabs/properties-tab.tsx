import { Badge, Button, Dialog, NumberField, Select, Skeleton, Switch, TextField, toast } from '@vesta/ui';
import { For, Show, createMemo, createSignal } from 'solid-js';
import { EmptyLine } from '../../../components/empty-state';
import { Icon } from '../../../components/icon';
import { t } from '../../../localization';
import type { MessageId } from '../../../localization/messages';
import { gate } from '../../../features/servers/capabilities';
import { stableConnectionId } from '../../../features/servers/connection-id';
import { errorMessage } from '../../../features/servers/errors';
import { IntentMemo } from '../../../features/servers/model';
import {
  MAX_CHANGES, MOTD_KEY, diffChanges, effectiveValue, groupRows, groupSummary, matchedByKey, matchesSearch, parseProperties, propertyDef,
  propertyGroups, propertySearchText, unreportedKeys, valueProblem, weakeningKeys, type PropertyDef, type PropertyGroup,
} from '../../../features/servers/properties-model';
import { useServerResource } from '../../../features/servers/resources';
import { propertiesResource } from '../../../features/servers/server-resources';
import { putSnapshot, serverCommand, useServersClock } from '../../../features/servers/store';
import type { PropertyValue, ServerCommandError, ServerSnapshot } from '../../../features/servers/native';
import { MotdEditor } from '../motd-editor';
import { Sensitive, ServerErrorNote } from '../parts';
import { SaveBar, SettingsGroup, SettingsPage, SettingsPanel, SettingsSearch } from '../settings-parts';

const optionLabels: Record<string, MessageId> = {
  peaceful: 'server-settings.option.peaceful', easy: 'server-settings.option.easy', normal: 'server-settings.option.normal', hard: 'server-settings.option.hard',
  survival: 'server-settings.option.survival', creative: 'server-settings.option.creative', adventure: 'server-settings.option.adventure', spectator: 'server-settings.option.spectator',
};
const optionLabel = (value: string) => (optionLabels[value] ? t(optionLabels[value]) : value.replace(/^minecraft:/, '').replace(/_/g, ' '));

/** Keys whose raw values can carry addresses; blurred in privacy mode. */
const ADDRESS_KEYS = new Set(['server-ip', 'query.address', 'rcon.address']);

/** File keys stay hidden unless asked for; the choice lasts for the session. */
const [showKeys, setShowKeys] = createSignal(false, { name: 'server-properties:show-keys' });

interface PendingConfirmation {
  intentId: string;
  token: string;
  expiresAtMs: number;
  changes: Record<string, PropertyValue>;
  sha256: string;
  keys: string[];
}

/**
 * The Game section: `server.properties` as plain-language settings. The message of the
 * day and the essentials lead; everything else waits in collapsed groups. Saves are
 * bound to the file's hash and weakening changes go through the agent's confirmation.
 */
export function PropertiesTab(props: { snapshot: ServerSnapshot }) {
  const id = stableConnectionId(() => props.snapshot);
  const now = useServersClock();
  const file = useServerResource(id, propertiesResource);
  const [draft, setDraft] = createSignal<Record<string, PropertyValue>>({}, { name: 'server-properties:draft' });
  const [error, setError] = createSignal<ServerCommandError | null>(null, { name: 'server-properties:error' });
  const [stale, setStale] = createSignal(false, { name: 'server-properties:stale' });
  const [saving, setSaving] = createSignal(false, { name: 'server-properties:saving' });
  const [pending, setPending] = createSignal<PendingConfirmation | null>(null, { name: 'server-properties:pending' });
  const [query, setQuery] = createSignal('', { name: 'server-properties:query' });
  const [open, setOpen] = createSignal<ReadonlySet<string>>(new Set(), { name: 'server-properties:open-groups' });
  const intents = new IntentMemo();
  const canEdit = () => gate(props.snapshot.capabilities, 'config.edit') === 'allowed';

  const base = createMemo(() => { const value = file.value(); return value ? parseProperties(value.values) : null; }, { name: 'server-properties:base' });
  const sha = () => file.value()?.sha256 ?? '';
  const typed = () => base()?.typed ?? {};
  const value = (def: PropertyDef): PropertyValue => (def.key in draft() ? draft()[def.key] : def.secret ? '' : effectiveValue(def, typed()));
  const set = (key: string, next: PropertyValue) => setDraft((current) => ({ ...current, [key]: next }));
  const changes = createMemo(() => diffChanges(typed(), draft()), { name: 'server-properties:changes' });
  const changeCount = () => Object.keys(changes()).length;
  const problems = createMemo(() => Object.fromEntries(Object.entries(draft()).flatMap(([key, next]) => {
    const def = propertyDef(key);
    const problem = def && !(def.secret && next === '') ? valueProblem(def, next) : null;
    return problem ? [[key, problem]] : [];
  })), { name: 'server-properties:problems' });
  const invalid = () => Object.keys(problems()).length > 0 || changeCount() > MAX_CHANGES;
  const remaining = () => Math.max(0, Math.ceil(((pending()?.expiresAtMs ?? 0) - now()) / 1000));
  const problemText = (def: PropertyDef) => {
    const problem = problems()[def.key] as MessageId | undefined;
    return problem ? t(problem, { min: (def as { min?: number }).min ?? 0, max: (def as { max?: number }).max ?? 0 }) : undefined;
  };

  // ---- Search ----
  const searching = () => !!query().trim();
  const matches = (def: PropertyDef) => matchesSearch(propertySearchText(def, t(def.label), t(def.help)), query());
  const motdDef = propertyDef(MOTD_KEY)!;
  const rows = (group: PropertyGroup) => {
    const parsed = base();
    if (!parsed) return [];
    const all = groupRows(group, parsed);
    return searching() ? all.filter(matches) : all;
  };
  const rawRows = () => (base()?.raw ?? []).filter((entry) => !searching() || matchesSearch(`${entry.key} ${entry.key.replace(/[.-]/g, ' ')} ${entry.value}`, query()));
  const isOpen = (group: string) => searching() || open().has(group);
  const toggle = (group: string) => setOpen((current) => { const next = new Set(current); if (!next.delete(group)) next.add(group); return next; });
  const nothingFound = () => searching() && !matches(motdDef) && propertyGroups.every((group) => rows(group.id).length === 0) && rawRows().length === 0;

  // ---- Saving ----
  const submit = async (submitted: Record<string, PropertyValue>, expected: string, token: string | null, intentId: string) => {
    setSaving(true); setError(null);
    try {
      const result = await serverCommand((client) => client.propertiesUpdate(id(), submitted, expected, token, intentId));
      intents.settle();
      if (result.kind === 'awaitingConfirmation') {
        setPending({ intentId, token: result.confirmationToken, expiresAtMs: result.expiresAtMs, changes: submitted, sha256: expected, keys: weakeningKeys(typed(), submitted) });
        return;
      }
      setPending(null);
      setStale(false);
      putSnapshot({ ...props.snapshot, restartRequired: props.snapshot.restartRequired || result.restartNeeded });
      toast.show({ title: t('server-settings.saved'), tone: 'success' });
      await file.refresh();
      setDraft({});
    } catch (reason) {
      const failure = reason as ServerCommandError;
      intents.settle(failure);
      if (failure.code === 'stale_target') {
        // The file changed on the server: re-read it and keep this draft on top for review.
        setPending(null);
        setStale(true);
        await file.refresh();
      } else if (failure.code === 'confirmation_expired') {
        setPending(null);
        toast.show({ title: t('server-settings.confirmation-expired'), tone: 'warning' });
      } else setError(failure);
    } finally { setSaving(false); }
  };
  const save = () => {
    const submitted = changes();
    void submit(submitted, sha(), null, intents.idFor({ changes: submitted, sha: sha() }));
  };
  const confirm = () => {
    const current = pending();
    if (current) void submit(current.changes, current.sha256, current.token, current.intentId);
  };

  // ---- Rows ----
  const control = (def: PropertyDef) => {
    const disabled = () => !canEdit();
    const label = () => t(def.label);
    if (def.readOnly) return <span data-vesta="server-setting-value">{optionLabel(String(value(def)))}</span>;
    switch (def.type) {
      case 'boolean':
        return <Switch size="sm" aria-label={label()} checked={value(def) as boolean} disabled={disabled()} onChange={(checked: boolean) => set(def.key, checked)} />;
      case 'integer':
        return <NumberField size="sm" aria-label={label()} value={value(def) as number} min={def.min} max={def.max} disabled={disabled()} error={problemText(def)} onChange={(next: number) => set(def.key, next)} />;
      case 'enum':
        return <Select size="sm" aria-label={label()} value={value(def) as string} disabled={disabled()} onChange={(next: string) => set(def.key, next)}
          options={def.options.map((option) => ({ value: option, label: optionLabel(option) }))} />;
      case 'string':
        return <TextField size="sm" aria-label={label()} value={value(def) as string} disabled={disabled()} error={problemText(def)}
          type={def.secret ? 'password' : 'text'} placeholder={def.secret ? t('server-settings.secret-unchanged') : undefined}
          autocomplete="off" spellcheck="false" onChange={(next: string) => set(def.key, next)} />;
    }
  };
  const description = (def: PropertyDef) => {
    if (base()?.malformed.includes(def.key)) return t('server-settings.malformed-short');
    return t(def.help);
  };
  const Row = (row: { def: PropertyDef }) => (
    <div data-vesta="setting-row" data-edited={row.def.key in changes() ? '' : undefined} data-server-property={row.def.key}>
      <div data-vesta="setting-row-copy">
        <span data-vesta="setting-row-label" title={row.def.key}>{t(row.def.label)}</span>
        <span data-vesta="setting-row-description">{description(row.def)}</span>
        <Show when={showKeys() || matchedByKey(row.def, t(row.def.label), t(row.def.help), query())}>
          <code data-vesta="server-setting-key">{row.def.key}</code>
        </Show>
      </div>
      <div data-vesta="setting-row-control">{control(row.def)}</div>
    </div>
  );
  /** Rows of a group; a child shows inset under its switch while that switch is on. */
  const GroupRows = (group: { id: PropertyGroup }) => (
    <Show when={!searching()} fallback={<For each={rows(group.id)}>{(def) => <Row def={def} />}</For>}>
      <For each={rows(group.id).filter((def) => !def.parent)}>
        {(def) => {
          const children = () => rows(group.id).filter((child) => child.parent === def.key);
          return (
            <>
              <Row def={def} />
              <Show when={children().length > 0 && value(def) === true}>
                <div data-vesta="settings-reveal"><For each={children()}>{(child) => <Row def={child} />}</For></div>
              </Show>
            </>
          );
        }}
      </For>
    </Show>
  );
  const Summary = (group: { id: PropertyGroup }) => {
    const summary = () => groupSummary(rows(group.id), typed(), changes());
    return (
      <>
        <Show when={summary().edited > 0}><Badge size="sm" variant="soft" tone="warning">{t('server-settings.summary-edited', { count: summary().edited })}</Badge></Show>
        <Show when={summary().edited === 0 && summary().customized > 0}><Badge size="sm" variant="soft" tone="neutral">{t('server-settings.summary-customized', { count: summary().customized })}</Badge></Show>
        <span>{t('server-settings.summary-count', { count: summary().count })}</span>
      </>
    );
  };

  const onlinePlayers = () => (props.snapshot.status?.playerCountKnown ? props.snapshot.status.playerCount ?? 0 : 0);

  return (
    <SettingsPage
      saveBar={
        <SaveBar show={changeCount() > 0} label={t('server-settings.unsaved', { count: changeCount() })} busy={saving()} disabled={invalid() || !canEdit()}
          onDiscard={() => { setDraft({}); setStale(false); }} onSave={save} />
      }
    >
      <div data-vesta="server-settings-bar">
        <SettingsSearch value={query()} onChange={setQuery} placeholder={t('server-settings.search')} />
        <Switch size="sm" checked={showKeys()} onChange={setShowKeys} label={t('server-settings.show-keys')} />
      </div>
      <Show when={!canEdit()}><p data-vesta="server-callout" data-tone="neutral">{t('server-settings.view-only')}</p></Show>
      <Show when={stale()}><p data-vesta="server-callout" data-tone="warning" role="status">{t('server-settings.stale')}</p></Show>
      <ServerErrorNote error={error() ?? file.error()} onRetry={() => void file.refresh()} />

      <Show when={base()} fallback={<Show when={!file.error()}><For each={[0, 1, 2]}>{() => <Skeleton height={148} radius={10} />}</For></Show>}>
        <Show when={!searching() || matches(motdDef)}>
          <SettingsPanel title={t('server-settings.motd-title')} name="motd">
            <MotdEditor
              id={id()}
              name={props.snapshot.connection.name}
              label={t(motdDef.label)}
              value={String(value(motdDef))}
              onChange={(next) => set(MOTD_KEY, next)}
              formatting
              readOnly={!canEdit()}
              error={problemText(motdDef)}
              players={`${onlinePlayers()}/${value(propertyDef('max-players')!)}`}
            />
          </SettingsPanel>
        </Show>

        <For each={propertyGroups}>
          {(group) => (
            <Show when={rows(group.id).length > 0}>
              <Show
                when={group.collapsible}
                fallback={
                  <SettingsPanel title={t(group.label)}>
                    <div data-vesta="settings-panel-body"><GroupRows id={group.id} /></div>
                  </SettingsPanel>
                }
              >
                <SettingsGroup title={t(group.label)} open={isOpen(group.id)} onToggle={() => toggle(group.id)} summary={<Summary id={group.id} />}>
                  <GroupRows id={group.id} />
                </SettingsGroup>
              </Show>
            </Show>
          )}
        </For>

        <Show when={rawRows().length > 0}>
          <SettingsGroup title={t('server-settings.group.other')} open={isOpen('other')} onToggle={() => toggle('other')}
            summary={<span>{t('server-settings.summary-count', { count: rawRows().length })}</span>}>
            <p data-vesta="settings-feedback">{t('server-settings.other-description')}</p>
            <For each={rawRows()}>
              {(entry) => (
                <div data-vesta="setting-row">
                  <div data-vesta="setting-row-copy"><code data-vesta="setting-row-label">{entry.key}</code></div>
                  <div data-vesta="setting-row-control">
                    <span data-vesta="server-setting-value">
                      <Show when={ADDRESS_KEYS.has(entry.key)} fallback={entry.value || t('servers.unknown')}><Sensitive>{entry.value}</Sensitive></Show>
                    </span>
                  </div>
                </div>
              )}
            </For>
          </SettingsGroup>
        </Show>

        <Show when={nothingFound()}>
          <EmptyLine role="status">{t('server-settings.no-results')}</EmptyLine>
        </Show>
        <Show when={!searching() && unreportedKeys(base()!).length > 0}>
          <p data-vesta="server-settings-footnote">
            {t('server-settings.unreported', { name: unreportedKeys(base()!).map((key) => t(propertyDef(key)!.label)).join(', ') })}
          </p>
        </Show>
      </Show>

      <Dialog open={!!pending()} onOpenChange={(isOpen) => { if (!isOpen) setPending(null); }} closeLabel={t('nav.close')} size="sm"
        title={t('server-settings.confirm-title')}
        description={t('server-settings.confirm-description')}
        footer={<>
          <Button variant="ghost" onClick={() => setPending(null)}>{t('common.cancel')}</Button>
          <Button tone="danger" disabled={saving() || remaining() === 0} onClick={confirm}>{t('server-settings.confirm', { count: remaining() })}</Button>
        </>}
      >
        <ul data-vesta="server-weakening-list">
          <For each={pending()?.keys.length ? pending()!.keys : Object.keys(pending()?.changes ?? {})}>
            {(key) => {
              const def = propertyDef(key);
              const next = pending()?.changes[key];
              return (
                <li>
                  <Icon name="icons/controls/warning" size={14} />
                  <span>{def ? t(def.label) : key}</span>
                  <code>{typeof next === 'boolean' ? t(next ? 'server-settings.on' : 'server-settings.off') : String(next)}</code>
                </li>
              );
            }}
          </For>
        </ul>
        <Show when={error()}><p data-vesta="server-callout" data-tone="danger">{t(errorMessage(error()))}</p></Show>
      </Dialog>
    </SettingsPage>
  );
}
