import { Badge, Button, IconButton, Skeleton, Switch, toast } from '@vesta/ui';
import { For, Show, createEffect, createMemo, createSignal, onCleanup, untrack } from 'solid-js';
import { transitionTo } from '../../../app/transition';
import { EmptyState } from '../../../components/empty-state';
import { Icon } from '../../../components/icon';
import { t } from '../../../localization';
import { initials, serverArt } from '../../../features/servers/art';
import { stableConnectionId } from '../../../features/servers/connection-id';
import { errorMessage } from '../../../features/servers/errors';
import type { ServerWorld } from '../../../features/servers/hosting-native';
import { age, IntentMemo } from '../../../features/servers/model';
import type { ServerCommandError, ServerOperation, ServerSnapshot } from '../../../features/servers/native';
import { seedServerResource, useServerResource } from '../../../features/servers/resources';
import { worldResource } from '../../../features/servers/server-resources';
import { putOperations, serverCommand, serverOperations, useServersClock } from '../../../features/servers/store';
import {
  SEED_REVEAL_MS, datapackBlocker, datapackKindMessage, datapackStateMessage, datapackViews, dimensionViews, seedRevealed, seedText,
  retainDatapackIntent, settleDatapackIntent, toggleFeedback, toggleRejection, worldSize, type DatapackView, type PendingDatapack, type ToggleFeedback,
} from '../../../features/servers/world-model';
import { setting } from '../../../features/settings/config';
import { copyText, SettingsPage, SettingsPanel } from '../settings-parts';
import { HostingError } from './parts';
import './hosting.css';
import './world-section.css';

/** Settings → World: the one world this server loads, shown like an instance's world page. */
export function WorldSection(props: { snapshot: ServerSnapshot }) {
  const id = stableConnectionId(() => props.snapshot);
  const world = useServerResource(id, worldResource);

  return (
    <SettingsPage>
      <HostingError error={world.error()} onRetry={() => void world.refresh()} />
      <Show when={world.value()} fallback={<Show when={!world.error()}><Skeleton height={168} radius={12} /><Skeleton height={120} radius={12} /></Show>}>
        {(current) => (
          // One column: a datapack list can be long, so it lives inline with a bounded preview.
          <>
            <WorldHero snapshot={props.snapshot} world={current()} />
            <Datapacks snapshot={props.snapshot} world={current()} onChanged={() => void world.refresh()} />
            <Dimensions world={current()} />
          </>
        )}
      </Show>
    </SettingsPage>
  );
}

/** Name, art, size, when it was last played and saved, the Minecraft version, and the masked seed. */
function WorldHero(props: { snapshot: ServerSnapshot; world: ServerWorld }) {
  const now = useServersClock();
  const art = () => serverArt(`${props.snapshot.connection.serverId || props.snapshot.connection.id}:world:${props.world.name}`, initials(props.world.name));
  const size = () => worldSize(props.world);
  const when = (ms: number | null) => (ms === null ? null : t('server-world.ago', { time: t(age(ms, now()).message, { count: age(ms, now()).count }) }));
  const version = () => props.snapshot.info?.minecraftVersion || null;
  return (
    <section data-vesta="server-world-hero" style={{ '--world-art': `url("${art()}")` }}>
      <div data-vesta="server-world-hero-main">
        <img data-vesta="server-world-art" src={art()} alt="" draggable="false" />
        <div data-vesta="server-world-hero-copy">
          <span data-vesta="server-software-eyebrow">{t('server-world.eyebrow')}</span>
          <h2>{props.world.name}</h2>
          <p data-vesta="server-software-meta">
            <Show when={props.world.exists} fallback={<span>{t('server-world.not-generated')}</span>}>
              <Show when={version()}>{(value) => <span>{t('server-hosting.minecraft-version', { version: value() })}</span>}</Show>
              <Show when={size()}>{(value) => <><span>{t(value().message, { size: value().size })}</span></>}</Show>
            </Show>
          </p>
        </div>
        <SeedValue seed={props.world.seed} exists={props.world.exists} />
      </div>
      <dl data-vesta="server-world-stats">
        <Stat label={t('server-world.stat-size')} value={size() ? t(size()!.message, { size: size()!.size }) : null}
          note={size() && !props.world.sizeComplete ? t('server-world.size-partial-note') : null} />
        <Stat label={t('server-world.stat-played')} value={when(props.world.lastPlayedAtMs)} />
        <Stat label={t('server-world.stat-saved')} value={when(props.world.lastModifiedAtMs)} />
        <Stat label={t('server-world.stat-datapacks')} value={String(props.world.datapacks.filter((pack) => pack.enabled).length)}
          note={t('server-world.stat-datapacks-note', { count: props.world.datapacks.length })} />
      </dl>
    </section>
  );
}

function Stat(props: { label: string; value: string | null; note?: string | null }) {
  return (
    <div data-vesta="server-world-stat">
      <dt>{props.label}</dt>
      <dd>
        {props.value ?? t('server-world.unknown')}
        <Show when={props.note}>{(note) => <small>{note()}</small>}</Show>
      </dd>
    </div>
  );
}

/**
 * The seed is masked by default so it can't leak on a screenshot or stream. Hover or focus
 * shows it; a click keeps it visible for a few seconds. With privacy mode on, only a click
 * reveals it. Copying never needs it on screen.
 */
function SeedValue(props: { seed: string | null; exists: boolean }) {
  const [pinned, setPinned] = createSignal(false, { name: 'server-world:seed-pinned' });
  const [hovering, setHovering] = createSignal(false, { name: 'server-world:seed-hover' });
  let timer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(timer));
  const revealed = () => seedRevealed({ pinned: pinned(), hovering: hovering(), privacy: setting('servers_privacy_mode') });
  const shown = () => seedText(props.seed, revealed());
  const toggle = () => {
    clearTimeout(timer);
    const next = !pinned();
    setPinned(next);
    if (next) timer = setTimeout(() => setPinned(false), SEED_REVEAL_MS);
  };
  return (
    <div data-vesta="server-world-seed">
      <span data-vesta="server-world-seed-label">{t('server-hosting.seed')}</span>
      <Show when={shown()} fallback={<span data-vesta="server-world-seed-pending">{t(props.exists ? 'server-world.seed-unknown' : 'server-world.seed-next-start')}</span>}>
        {(value) => (
          <div data-vesta="server-world-seed-row">
            <button type="button" data-vesta="server-world-seed-value" data-masked={value().masked ? '' : undefined}
              aria-label={value().masked ? t('server-world.seed-reveal') : t('server-world.seed-hide')} aria-pressed={pinned() ? 'true' : 'false'}
              onPointerEnter={() => setHovering(true)} onPointerLeave={() => setHovering(false)}
              onFocus={() => setHovering(true)} onBlur={() => setHovering(false)} onClick={toggle}>
              <code>{value().text}</code>
            </button>
            <IconButton size="sm" variant="ghost" label={t('server-world.copy-seed')} icon={<Icon name="icons/actions/copy" />}
              onClick={() => { if (props.seed) copyText(props.seed); }} />
          </div>
        )}
      </Show>
      <span data-vesta="server-world-seed-hint">{shown() ? t(setting('servers_privacy_mode') ? 'server-world.seed-hint-privacy' : 'server-world.seed-hint') : ''}</span>
    </div>
  );
}

/** Overworld, Nether and End as parts of one world, whatever folders the software keeps them in. */
function Dimensions(props: { world: ServerWorld }) {
  const views = createMemo(() => dimensionViews(props.world.dimensions), { name: 'server-world:dimensions' });
  return (
    <SettingsPanel title={t('server-world.dimensions')} name="world-dimensions">
      <ul data-vesta="server-world-dimensions">
        <For each={views()} keyed={(view) => view.id}>
          {(view) => (
            <li data-vesta="server-world-dimension" data-dimension={view().id} data-present={view().present ? '' : undefined}>
              <span data-vesta="server-world-dimension-swatch" aria-hidden="true" />
              <div>
                <strong>{view().label ? t(view().label!) : view().name}</strong>
                <span>{view().present ? t('server-world.dimension-generated') : t('server-world.dimension-missing')}</span>
                <Show when={view().present && view().folders.length}>
                  <code title={view().folders.join('\n')}>{view().folders.join(', ')}</code>
                </Show>
              </div>
            </li>
          )}
        </For>
      </ul>
    </SettingsPanel>
  );
}

/** Datapacks listed before "Show all"; the expanded list scrolls within a bounded height. */
const DATAPACK_PREVIEW = 6;

/**
 * The world's datapacks. Switching one sends Minecraft's own `datapack` command, so it only
 * works while the game runs; the list reads the world's last save and catches up after it.
 */
function Datapacks(props: { snapshot: ServerSnapshot; world: ServerWorld; onChanged: () => void }) {
  const id = stableConnectionId(() => props.snapshot);
  const views = createMemo(() => datapackViews(props.world.datapacks), { name: 'server-world:datapacks' });
  const blocker = () => datapackBlocker(props.snapshot);
  const stopped = () => props.snapshot.status?.state === 'stopped';
  const [offlineBusy, setOfflineBusy] = createSignal<{ id: string; enabled: boolean } | null>(null, { name: 'server-world:offline-datapack' });
  /** Per pack: the operation its last toggle started, or the moment it was sent. */
  const [pending, setPending] = createSignal<Record<string, PendingDatapack>>({}, { name: 'server-world:pending' });
  const intents = new Map<string, IntentMemo>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let disposed = false;
  onCleanup(() => { disposed = true; timers.forEach(clearTimeout); });
  const later = (ms: number, run: () => void) => { const timer = setTimeout(() => { timers.delete(timer); run(); }, ms); timers.add(timer); };

  const operation = (operationId: string | null): ServerOperation | undefined =>
    operationId ? serverOperations(id()).find((entry) => entry.operationId === operationId) : undefined;
  createEffect(() => ({ packs: views(), generation: props.snapshot.status?.generation, operations: serverOperations(id()) }), ({ packs, generation, operations }) => {
    const current = untrack(pending);
    const retained = Object.fromEntries(Object.entries(current).flatMap(([key, entry]) => {
      const op = operations.find((value) => value.operationId === entry.operationId);
      const settled = settleDatapackIntent(entry, op);
      return retainDatapackIntent(settled, packs.find((pack) => pack.id === key), generation, op) ? [[key, settled]] : [];
    }));
    if (Object.keys(retained).length !== Object.keys(current).length || Object.entries(retained).some(([key, entry]) => current[key] !== entry)) setPending(retained);
  }, { name: 'server-world:reconcile-packs' });
  const feedback = (pack: DatapackView): ToggleFeedback | null => {
    const entry = pending()[pack.id];
    if (!entry) return null;
    if (entry.error) return { step: 'failed', message: toggleRejection(entry.error.reason, entry.error.code) };
    return entry.terminal ?? (entry.operationId ? toggleFeedback(operation(entry.operationId)) : { step: 'sending' });
  };
  /** While a toggle is in flight, the switch shows what was asked for, not the last save. */
  const shownEnabled = (pack: DatapackView) => {
    if (offlineBusy()?.id === pack.id) return offlineBusy()!.enabled;
    const entry = pending()[pack.id];
    const step = feedback(pack)?.step;
    return entry && step !== 'failed' ? entry.enabled : pack.state === 'enabled';
  };

  const toggle = async (pack: DatapackView, enabled: boolean) => {
    if (blocker() || offlineBusy()) return;
    if (stopped()) {
      if (pack.kind !== 'folder' && pack.kind !== 'zip') return;
      const memo = intents.get(pack.id) ?? new IntentMemo();
      intents.set(pack.id, memo);
      const expectedRevision = props.world.revision;
      const intentId = memo.idFor({ pack: pack.id, enabled, expectedRevision });
      setOfflineBusy({ id: pack.id, enabled });
      try {
        const world = await serverCommand((client) => client.worldDatapackOffline(id(), pack.id, enabled, expectedRevision, intentId));
        memo.settle();
        if (!disposed) seedServerResource(id(), worldResource, world);
      } catch (reason) {
        const failure = reason as ServerCommandError;
        memo.settle(failure);
        if (!disposed) {
          props.onChanged();
          toast.show({ title: t(errorMessage(failure)), tone: 'danger' });
        }
      } finally { if (!disposed) setOfflineBusy(null); }
      return;
    }
    const generation = props.snapshot.status?.generation;
    if (!generation || blocker()) return;
    const memo = intents.get(pack.id) ?? new IntentMemo();
    intents.set(pack.id, memo);
    const intentId = memo.idFor({ pack: pack.id, enabled, generation });
    const request: PendingDatapack = { operationId: null, enabled, generation };
    setPending((all) => ({ ...all, [pack.id]: request }));
    const current = () => !disposed && props.snapshot.status?.generation === generation && pending()[pack.id] === request;
    try {
      const started = await serverCommand((client) => client.worldDatapackToggle(id(), pack.id, enabled, generation, intentId));
      memo.settle();
      if (!current()) return;
      putOperations(id(), [{ ...started, intent: started.intent ?? 'console.command' }]);
      setPending((all) => ({ ...all, [pack.id]: { operationId: started.operationId, enabled, generation } }));
      // Minecraft writes level.dat on its next save; reread then, and once more a little later.
      later(1_500, () => props.onChanged());
      later(6_000, () => props.onChanged());
    } catch (reason) {
      const failure = reason as ServerCommandError;
      memo.settle(failure);
      if (!current()) return;
      setPending((all) => ({ ...all, [pack.id]: { operationId: null, enabled, generation, error: failure } }));
      toast.show({ title: t(toggleRejection(failure.reason, failure.code)), description: t(errorMessage(failure)), tone: 'danger' });
    }
  };

  const openFolder = () => transitionTo(`/servers/${id()}/files/${encodeURIComponent(props.world.name)}/datapacks`);
  const [expanded, setExpanded] = createSignal(false, { name: 'server-world:datapacks-expanded' });
  const shownPacks = createMemo(() => (expanded() ? views() : views().slice(0, DATAPACK_PREVIEW)), { name: 'server-world:shown-datapacks' });

  return (
    <SettingsPanel title={views().length ? t('server-world.datapacks-count', { count: views().length }) : t('server-world.datapacks')} name="world-datapacks"
      description={!stopped() && props.world.datapackStateSource === 'saved_level_dat' ? t('server-world.datapacks-saved-help') : undefined}
      action={<Button size="sm" variant="ghost" icon={<Icon name="icons/content/folder" />} onClick={openFolder}>{t('server-world.open-datapacks')}</Button>}>
      <Show when={views().length} fallback={
        <EmptyState variant="inline" icon="icons/content/layers" title={t('server-world.no-datapacks')} description={t('server-world.no-datapacks-help')} />
      }>
        <Show when={blocker()}>{(message) => <p data-vesta="server-world-note" data-server-world-blocker><Icon name="icons/status/info" size={13} />{t(message())}</p>}</Show>
        <ul data-vesta="server-world-packs" data-expanded={expanded() ? '' : undefined}>
          <For each={shownPacks()} keyed={(pack) => pack.id}>
            {(pack) => {
              const state = () => feedback(pack());
              return (
                <li data-vesta="server-world-pack" data-state={pack().state} data-kind={pack().kind}>
                  <span data-vesta="server-world-pack-icon" aria-hidden="true">
                    <Icon name={pack().kind === 'zip' ? 'icons/content/storage' : pack().kind === 'builtin' ? 'icons/content/cube' : 'icons/content/folder'} size={16} />
                  </span>
                  <div data-vesta="server-world-pack-copy">
                    <span>
                      <strong>{pack().name}</strong>
                      <Badge size="sm" variant="soft" tone={pack().kind === 'missing' ? 'danger' : 'neutral'}>{t(datapackKindMessage[pack().kind])}</Badge>
                      <Show when={pack().state === 'unknown'}><Badge size="sm" variant="soft" tone="warning">{t('server-world.pack-new')}</Badge></Show>
                    </span>
                    <Show when={state()} fallback={<Show when={pack().path}>{(path) => <code>{path()}</code>}</Show>}>
                      {(current) => <PackFeedback feedback={current()} />}
                    </Show>
                  </div>
                  <Show when={pack().toggleable && (!stopped() || pack().kind === 'folder' || pack().kind === 'zip')} fallback={<span data-vesta="server-world-pack-state">{t(datapackStateMessage[pack().state])}</span>}>
                    <span data-vesta="server-world-pack-switch" data-tip={blocker() ? t(blocker()!) : t(shownEnabled(pack()) ? 'server-world.pack-disable' : 'server-world.pack-enable')}>
                      <Switch size="sm" aria-label={t('server-world.pack-toggle', { name: pack().name })} checked={shownEnabled(pack())}
                        disabled={!!blocker() || !!offlineBusy() || (state()?.step === 'sending' || state()?.step === 'sent')} onChange={(value: boolean) => void toggle(pack(), value)} />
                    </span>
                  </Show>
                </li>
              );
            }}
          </For>
        </ul>
        <Show when={views().length > DATAPACK_PREVIEW}>
          <div data-vesta="server-world-packs-more">
            <Button size="sm" variant="ghost" aria-expanded={expanded() ? 'true' : 'false'} onClick={() => setExpanded((value) => !value)}
              iconEnd={<Icon name={expanded() ? 'icons/navigation/chevron-up' : 'icons/navigation/chevron-down'} size={14} />}>
              {expanded() ? t('server-world.datapacks-show-fewer') : t('server-world.datapacks-show-all', { count: views().length })}
            </Button>
          </div>
        </Show>
      </Show>
    </SettingsPanel>
  );
}

function PackFeedback(props: { feedback: ToggleFeedback }) {
  return (
    <span data-vesta="server-world-pack-feedback" data-step={props.feedback.step} role="status">
      <Show when={props.feedback.step === 'sending' || props.feedback.step === 'sent'}><span data-vesta="server-world-pack-spinner" aria-hidden="true" /></Show>
      {props.feedback.step === 'failed'
        ? t((props.feedback as { message: Parameters<typeof t>[0] }).message)
        : t(props.feedback.step === 'done' ? 'server-world.pack-done' : props.feedback.step === 'sent' ? 'server-world.pack-sent' : 'server-world.pack-sending')}
    </span>
  );
}
