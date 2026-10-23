import { Button, Dialog, NumberField, Select, Skeleton, Switch, TextField, toast } from '@vesta/ui';
import { MotdPreview } from '../motd-preview';
import type { JSX } from '@solidjs/web';
import { For, Show, createEffect, createMemo, createSignal } from 'solid-js';
import { Icon } from '../../../components/icon';
import { SettingRow } from '../../../components/setting-row';
import { t } from '../../../localization';
import type { MessageId } from '../../../localization/messages';
import { gate } from '../../../features/servers/capabilities';
import { stableConnectionId } from '../../../features/servers/connection-id';
import { errorMessage } from '../../../features/servers/errors';
import { IntentMemo } from '../../../features/servers/model';
import {
  MAX_CHANGES, diffChanges, effectiveValue, parseProperties, propertyDef, propertyGroups, propertySchema, valueProblem, weakeningKeys,
  type ParsedProperties, type PropertyDef,
} from '../../../features/servers/properties-model';
import { putSnapshot, serverCommand, useServersClock } from '../../../features/servers/store';
import type { PropertyValue, ServerCommandError, ServerSnapshot } from '../../../features/servers/native';
import { Sensitive, ServerErrorNote } from '../parts';
import '../../library/instance/settings-tab.css';
import './files-tab.css';

const optionLabels: Record<string, MessageId> = {
  peaceful: 'server-settings.option.peaceful', easy: 'server-settings.option.easy', normal: 'server-settings.option.normal', hard: 'server-settings.option.hard',
  survival: 'server-settings.option.survival', creative: 'server-settings.option.creative', adventure: 'server-settings.option.adventure', spectator: 'server-settings.option.spectator',
};
const optionLabel = (value: string) => (optionLabels[value] ? t(optionLabels[value]) : value.replace(/^minecraft:/, '').replace(/_/g, ' '));

/** Keys whose raw values can carry addresses; blurred in privacy mode. */
const ADDRESS_KEYS = new Set(['server-ip', 'query.address', 'rcon.address']);

function Panel(props: { title: string; children: JSX.Element }) {
  return (
    <section data-vesta="settings-panel">
      <h3>{props.title}</h3>
      <div data-vesta="settings-panel-body">{props.children}</div>
    </section>
  );
}

interface PendingConfirmation {
  intentId: string;
  token: string;
  expiresAtMs: number;
  changes: Record<string, PropertyValue>;
  sha256: string;
  keys: string[];
}

/** Schema-driven `server.properties` with validator-bound saves and the agent's weakening confirmation. */
export function PropertiesTab(props: { snapshot: ServerSnapshot }) {
  const id = stableConnectionId(() => props.snapshot);
  const now = useServersClock();
  const [base, setBase] = createSignal<ParsedProperties | null>(null, { name: 'server-properties:base' });
  const [sha, setSha] = createSignal('', { name: 'server-properties:sha' });
  const [draft, setDraft] = createSignal<Record<string, PropertyValue>>({}, { name: 'server-properties:draft' });
  const [error, setError] = createSignal<ServerCommandError | null>(null, { name: 'server-properties:error' });
  const [stale, setStale] = createSignal(false, { name: 'server-properties:stale' });
  const [saving, setSaving] = createSignal(false, { name: 'server-properties:saving' });
  const [pending, setPending] = createSignal<PendingConfirmation | null>(null, { name: 'server-properties:pending' });
  const intents = new IntentMemo();
  const canEdit = () => gate(props.snapshot.capabilities, 'config.edit') !== 'denied';

  const load = async () => {
    setError(null);
    try {
      const result = await serverCommand((client) => client.propertiesGet(id()));
      setBase(parseProperties(result.values));
      setSha(result.sha256);
    } catch (reason) { setError(reason as ServerCommandError); }
  };
  createEffect(id, () => { void load(); }, { name: 'server-properties:load' });

  const typed = () => base()?.typed ?? {};
  const value = (def: PropertyDef): PropertyValue => (def.key in draft() ? draft()[def.key] : def.secret ? '' : effectiveValue(def, typed()));
  const set = (key: string, next: PropertyValue) => setDraft((current) => ({ ...current, [key]: next }));
  const changes = createMemo(() => diffChanges(typed(), draft()), { name: 'server-properties:changes' });
  const dirty = () => Object.keys(changes()).length > 0;
  const problems = createMemo(() => Object.fromEntries(Object.entries(draft()).flatMap(([key, next]) => {
    const def = propertyDef(key);
    const problem = def && !(def.secret && next === '') ? valueProblem(def, next) : null;
    return problem ? [[key, problem]] : [];
  })), { name: 'server-properties:problems' });
  const invalid = () => Object.keys(problems()).length > 0 || Object.keys(changes()).length > MAX_CHANGES;
  const remaining = () => Math.max(0, Math.ceil(((pending()?.expiresAtMs ?? 0) - now()) / 1000));

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
      setDraft({});
      setStale(false);
      putSnapshot({ ...props.snapshot, restartRequired: props.snapshot.restartRequired || result.restartNeeded });
      toast.show({ title: t('server-settings.saved'), tone: 'success' });
      await load();
    } catch (reason) {
      const failure = reason as ServerCommandError;
      intents.settle(failure);
      if (failure.code === 'stale_target') {
        // The file changed on the server: re-read it and keep this draft on top for review.
        setPending(null);
        setStale(true);
        await load();
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

  const control = (def: PropertyDef) => {
    const disabled = () => !canEdit() || !!def.readOnly;
    const label = () => t(def.label);
    const problem = () => (problems()[def.key] ? t(problems()[def.key] as MessageId, { min: (def as { min?: number }).min ?? 0, max: (def as { max?: number }).max ?? 0 }) : undefined);
    switch (def.type) {
      case 'boolean':
        return <Switch size="sm" aria-label={label()} checked={value(def) as boolean} disabled={disabled()} onChange={(checked: boolean) => set(def.key, checked)} />;
      case 'integer':
        return <NumberField size="sm" aria-label={label()} value={value(def) as number} min={def.min} max={def.max} disabled={disabled()} error={problem()} onChange={(next: number) => set(def.key, next)} />;
      case 'enum':
        return <Select size="sm" aria-label={label()} value={value(def) as string} disabled={disabled()} onChange={(next: string) => set(def.key, next)}
          options={def.options.map((option) => ({ value: option, label: optionLabel(option) }))} />;
      case 'string':
        return <TextField size="sm" aria-label={label()} value={value(def) as string} disabled={disabled()} error={problem()}
          type={def.secret ? 'password' : 'text'} placeholder={def.secret ? t('server-settings.secret-unchanged') : undefined}
          autocomplete="off" spellcheck="false" onChange={(next: string) => set(def.key, next)} />;
    }
  };
  const description = (def: PropertyDef) => {
    if (def.readOnly) return t('server-settings.read-only-key', { name: def.key });
    if (base()?.malformed.includes(def.key)) return t('server-settings.malformed', { name: def.key });
    if (def.secret) return t('server-settings.secret-description', { name: def.key });
    return def.key;
  };

  return (
    <div data-vesta="settings-content" data-dirty={dirty() ? '' : undefined} class="server-properties">
      <div data-vesta="instance-settings-scroll">
        <Show when={!canEdit()}><p data-vesta="server-callout" data-tone="neutral">{t('server-settings.view-only')}</p></Show>
        <Show when={stale()}><p data-vesta="server-callout" data-tone="warning" role="status">{t('server-settings.stale')}</p></Show>
        <ServerErrorNote error={error()} onRetry={() => void load()} />
        <Show when={base()} fallback={<Show when={!error()}><For each={[0, 1, 2]}>{() => <Skeleton height={148} radius={10} />}</For></Show>}>
          <For each={propertyGroups}>
            {(group) => (
              <Panel title={t(group.label)}>
                <For each={propertySchema.filter((def) => def.group === group.id)}>
                  {(def) => (
                    <>
                      <SettingRow label={t(def.label)} description={description(def)}>
                        <Show when={!def.readOnly || def.key in typed()} fallback={<span data-vesta="server-setting-value">{t('server-settings.hidden-value')}</span>}>
                          {control(def)}
                        </Show>
                      </SettingRow>
                      <Show when={def.key === 'motd'}>
                        <div data-vesta="settings-reveal">
                          <MotdPreview
                            name={props.snapshot.connection.name}
                            template={(value(def) as string) || ''}
                            players={`${props.snapshot.status?.playerCount ?? 0}/${value(propertyDef('max-players')!)}`}
                          />
                        </div>
                      </Show>
                    </>
                  )}
                </For>
              </Panel>
            )}
          </For>
          <Show when={base()!.raw.length}>
            <Panel title={t('server-settings.group.other')}>
              <p data-vesta="settings-feedback">{t('server-settings.other-description')}</p>
              <For each={base()!.raw}>
                {(entry) => (
                  <SettingRow label={entry.key}>
                    <span data-vesta="server-setting-value">
                      <Show when={ADDRESS_KEYS.has(entry.key)} fallback={<code>{entry.value}</code>}><Sensitive><code>{entry.value}</code></Sensitive></Show>
                    </span>
                  </SettingRow>
                )}
              </For>
            </Panel>
          </Show>
        </Show>
      </div>
      <Show when={dirty()}>
        <div data-vesta="settings-savebar" role="region" aria-label={t('server-settings.unsaved', { count: Object.keys(changes()).length })}>
          <span data-vesta="settings-savebar-dot" />
          <span>{t('server-settings.unsaved', { count: Object.keys(changes()).length })}</span>
          <Button size="sm" variant="ghost" disabled={saving()} onClick={() => { setDraft({}); setStale(false); }}>{t('server-files.discard')}</Button>
          <Button size="sm" tone="accent" disabled={invalid() || saving() || !canEdit()} onClick={save}>{t('server-files.save')}</Button>
        </div>
      </Show>
      <Dialog open={!!pending()} onOpenChange={(open) => { if (!open) setPending(null); }} closeLabel={t('nav.close')} size="sm"
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
    </div>
  );
}
