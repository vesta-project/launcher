import { Badge, Button, Dialog, IconButton, Menu, MenuItem, MenuSeparator, Progress, toast } from '@vesta/ui';
import { For, Show, createEffect, createMemo, createSignal, onCleanup, onSettled, untrack } from 'solid-js';
import { navigate } from '../../../app/router';
import { transitionTo } from '../../../app/transition';
import { Icon } from '../../../components/icon';
import { projectPath, sourceById } from '../../../features/browse/browse-model';
import { loadProjects, loadVersions, peekProject, peekVersions } from '../../../features/browse/browse-projects';
import { gate } from '../../../features/servers/capabilities';
import { baseName, contentName, isModpackOwned, providerLookups } from '../../../features/servers/content-model';
import { IntentMemo, lifecycleControls } from '../../../features/servers/model';
import { offerModpack } from '../../../features/servers/modpack-handoff';
import {
  linkProvider, linkSourceKind, linkSourceLabel, updateCheckOutcome, type UnlinkChoice, type UpdateCheck,
} from '../../../features/servers/modpack-area-model';
import type { ServerCommandError } from '../../../features/servers/native';
import type { ServerContentEntry } from '../../../features/servers/native-content';
import type { PackInstallSource, ServerModpackVersion } from '../../../features/servers/native-pack';
import { invalidateServerResources, useServerResource } from '../../../features/servers/resources';
import { CONTENT_RESOURCES, contentResource } from '../../../features/servers/server-resources';
import { serverCommand } from '../../../features/servers/store';
import { formatNumber, t } from '../../../localization';
import { useLifecycle } from '../lifecycle';
import { ServerErrorNote } from '../parts';
import { useModpackArea } from './area';
import { FirstRun } from './first-run';

/**
 * Server → Modpack → Server modpack: the server installation's own, optional link. Unlinked it
 * says so calmly and offers to link one; linked it reads like an instance linked to a modpack.
 */
export function ServerModpack() {
  const area = useModpackArea();
  return (
    <div data-vesta="modpack-scroll">
      <Show when={area.link().phase !== 'unlinked'} fallback={<FirstRun section="server" />}>
        <div data-vesta="modpack-server">
          <LinkCard />
          <PendingPanel />
          <div data-vesta="modpack-overview">
            <div data-vesta="modpack-overview-main">
              <OwnedPanel />
            </div>
            <aside data-vesta="modpack-overview-side">
              <OfferingPanel />
            </aside>
          </div>
        </div>
      </Show>
    </div>
  );
}

/** A version label: the provider's version number when known, else what the agent recorded. */
function useVersionLabel() {
  const area = useModpackArea();
  createEffect(() => { const provider = linkProvider(area.link().source); return provider ? `${provider.provider}:${provider.projectId}` : null; }, (key) => {
    const provider = key ? linkProvider(untrack(area.link).source) : null;
    if (provider) void loadVersions(provider.provider, provider.projectId).catch(() => {});
  }, { name: 'modpack-server:versions' });
  return (version: ServerModpackVersion | PackInstallSource | null) => {
    if (!version) return '';
    const source = 'source' in version && typeof version.source === 'object' ? version.source : version as PackInstallSource;
    const recorded = 'displayVersion' in version ? version.displayVersion : '';
    const provider = linkProvider(source);
    if (!provider) return recorded;
    return peekVersions(provider.provider, provider.projectId)?.find((entry) => entry.id === provider.versionId)?.version_number ?? (recorded || provider.versionId);
  };
}

/** The link as one card: identity, source, installed version, update state and actions. */
function LinkCard() {
  const area = useModpackArea();
  const label = useVersionLabel();
  const [check, setCheck] = createSignal<UpdateCheck>({ step: 'idle' }, { name: 'modpack-server:update' });
  const [unlinking, setUnlinking] = createSignal(false, { name: 'modpack-server:unlinking' });
  let disposed = false;
  onCleanup(() => { disposed = true; });
  const source = () => area.link().source!;
  const kind = () => linkSourceKind(source());
  const provider = () => linkProvider(source());
  const name = () => area.linkProject()?.name ?? (kind() === 'upload' || kind() === 'vesta' ? t(linkSourceLabel[kind() as 'upload' | 'vesta']) : provider()!.projectId);
  const sourceName = () => (kind() === 'modrinth' || kind() === 'curseforge' ? sourceById(kind() as 'modrinth' | 'curseforge').label : t(linkSourceLabel[kind() as 'upload' | 'vesta']));
  const path = () => { const value = provider(); return value ? projectPath(value.provider, value.projectId) : undefined; };
  const canManage = () => area.gates().installOnServer;

  const runCheck = async () => {
    if (!untrack(area.link).canChange) { setCheck({ step: 'pending' }); return; }
    setCheck({ step: 'checking' });
    try {
      const update = await serverCommand((api) => api.serverModpackUpdate(area.id()));
      if (!disposed) setCheck(updateCheckOutcome(update));
    } catch (reason) { if (!disposed) setCheck({ step: 'failed', error: reason as ServerCommandError }); }
  };
  // Provider links are checked once on open, like a linked instance; files have nothing to find.
  onSettled(() => { if (provider() && canManage()) void runCheck(); });
  // A staged review or restart changes what "newer" means: check again when the phase changes.
  let seenPhase: string | undefined;
  createEffect(() => area.link().phase, (phase) => {
    const changed = seenPhase !== undefined && phase !== seenPhase;
    seenPhase = phase;
    if (changed && untrack(provider) && untrack(canManage)) void runCheck();
  }, { name: 'modpack-server:recheck' });

  const reviewUpdate = (next: PackInstallSource) => area.startInstall({ source: next, name: name(), mode: 'update' });
  const changeVersion = () => {
    const value = provider();
    if (!value) return;
    offerModpack({ serverId: area.id(), provider: value.provider, projectId: value.projectId, versionId: null, name: name(), iconUrl: area.linkProject()?.icon_url ?? null });
  };

  return (
    <section data-vesta="modpack-link-card" data-phase={area.link().phase}>
      <a data-vesta="modpack-link-identity" href={path() ? `#${path()}` : undefined}
        onClick={(event) => {
          const next = path();
          if (!next || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          navigate(next);
        }}>
        <img data-vesta="modpack-link-icon" src={area.linkIcon()} alt="" width={56} height={56} draggable="false" />
        <span data-vesta="modpack-link-title">
          <span data-vesta="modpack-link-name">
            <strong>{name()}</strong>
            <span data-vesta="source-tag" data-source={kind()}>{sourceName()}</span>
          </span>
          <span data-vesta="modpack-link-meta">
            <Show when={area.link().installed} fallback={<span>{t('server-pack.link-not-confirmed')}</span>}>
              {(installed) => <span>{t('server-pack.link-installed', { version: label(installed()) })}</span>}
            </Show>
            <span aria-hidden="true">·</span>
            <span>{t('server-pack.minecraft', { version: area.workspace()!.serverMinecraftVersion })}</span>
          </span>
        </span>
      </a>
      <div data-vesta="modpack-link-status">
        <Show when={area.link().phase === 'installed'} fallback={
          <Badge size="sm" tone="warning" icon={<Icon name="icons/actions/reload" size={11} />}>{t('server-pack.link-pending-badge', { version: label(area.link().pending) })}</Badge>
        }>
          <Show when={check().step === 'available' ? (check() as Extract<UpdateCheck, { step: 'available' }>).source : undefined} keyed fallback={
            <Show when={check().step === 'checking'} fallback={
              <Show when={check().step === 'current'}>
                <span data-vesta="pack-current"><Icon name="icons/controls/check" size={12} />{t('server-pack.link-current')}</span>
              </Show>
            }>
              <span data-vesta="modpack-link-checking"><Progress size="sm" label={t('server-pack.link-checking')} /></span>
            </Show>
          }>
            {(next) => (
              <Button size="sm" tone="accent" icon={<Icon name="icons/actions/download" size={14} />} disabled={!canManage()} onClick={() => reviewUpdate(next)}>
                {t('server-pack.link-update-to', { version: label(next) })}
              </Button>
            )}
          </Show>
        </Show>
        <Show when={canManage()}>
          <Menu placement="bottom-end" trigger={(menuProps) => (
            <IconButton {...menuProps} size="sm" variant="ghost" label={t('server-pack.link-actions')} icon={<Icon name="icons/controls/ellipsis-horizontal" size={16} />} />
          )}>
            <MenuItem icon={<Icon name="icons/actions/refresh" />} disabled={!provider() || !area.link().canChange || check().step === 'checking'} onSelect={() => void runCheck()}>
              {t('server-pack.link-check')}
            </MenuItem>
            <Show when={provider()}>
              <MenuItem icon={<Icon name="icons/actions/swap" />} disabled={!area.link().canChange} onSelect={changeVersion}>{t('server-pack.change-version')}</MenuItem>
            </Show>
            <MenuItem icon={<Icon name="icons/content/storage" />} onSelect={() => transitionTo(`/servers/${area.id()}/resources`)}>{t('server-pack.link-open-resources')}</MenuItem>
            <MenuSeparator />
            <MenuItem tone="danger" icon={<Icon name="icons/actions/close" />} disabled={!area.link().canChange} onSelect={() => setUnlinking(true)}>
              {t('server-pack.unlink')}
            </MenuItem>
          </Menu>
        </Show>
      </div>
      <Show when={check().step === 'failed' ? (check() as Extract<UpdateCheck, { step: 'failed' }>).error : undefined}>
        {(failure) => <div data-vesta="modpack-link-error"><ServerErrorNote error={failure()} onRetry={() => void runCheck()} /></div>}
      </Show>
      <Show when={unlinking()}><UnlinkDialog name={name()} onClose={() => setUnlinking(false)} /></Show>
    </section>
  );
}

/** A reviewed link or update waits for a restart; nothing new can be staged until then. */
function PendingPanel() {
  const area = useModpackArea();
  const lifecycle = useLifecycle(area.snapshot);
  const label = useVersionLabel();
  const running = () => area.snapshot().status?.state === 'running';
  return (
    <Show when={area.link().pending}>
      {(pending) => (
        <div data-vesta="server-callout" data-tone="warning" role="status" data-vesta-pending="server-modpack">
          <span data-vesta="modpack-pending-copy">
            <strong>{t(area.link().phase === 'installing' ? 'server-pack.link-pending-install' : 'server-pack.link-pending-update', { version: label(pending()) })}</strong>
            <span>{t('server-pack.link-pending-help', { count: area.link().pendingIds.length })}</span>
          </span>
          <span data-vesta="modpack-inline-actions">
            <Button size="sm" variant="ghost" onClick={() => transitionTo(`/servers/${area.id()}/resources`)}>{t('server-pack.link-open-resources')}</Button>
            <Show when={running() && lifecycleControls(area.snapshot()).restart}>
              <Button size="sm" variant="outline" icon={<Icon name="icons/actions/reload" />} disabled={!!lifecycle.busy() || lifecycle.pending('restart')}
                onClick={() => void lifecycle.submit('restart')}>{t('server-pack.install-restart')}</Button>
            </Show>
          </span>
        </div>
      )}
    </Show>
  );
}

/** Tiles shown before "+N more"; two columns of four rows. */
const OWNED_TILES = 8;

/**
 * The resources the link installed, as a two-column grid of icon and name; the rest is one
 * "+N more" tile. Resources lists them all under the modpack's group.
 */
function OwnedPanel() {
  const area = useModpackArea();
  const content = useServerResource(() => area.id(), contentResource, { enabled: () => gate(area.snapshot().capabilities, 'files.list') !== 'denied' });
  const items = createMemo(() => ownedResources(area.link().owned, content.value()?.items), { name: 'modpack-server:owned' });
  createEffect(items, (value) => {
    for (const [provider, ids] of providerLookups(value.flatMap((item) => (item.entry ? [item.entry] : [])))) void loadProjects(provider, ids).catch(() => {});
  }, { name: 'modpack-server:owned-projects' });
  const overflow = () => items().length > OWNED_TILES;
  const shown = () => (overflow() ? items().slice(0, OWNED_TILES - 1) : items());
  const openResources = () => transitionTo(`/servers/${area.id()}/resources`);
  return (
    <Show when={items().length}>
      <section data-vesta="modpack-panel">
        <header data-vesta="modpack-panel-head">
          <h3>{t('server-pack.owned-title')}<span data-vesta="modpack-panel-count">{formatNumber(items().length)}</span></h3>
          <Button size="sm" variant="ghost" iconEnd={<Icon name="icons/navigation/arrow-forward" />} onClick={openResources}>
            {t('server-pack.link-open-resources')}
          </Button>
        </header>
        <ul data-vesta="modpack-owned">
          <For each={shown()}>
            {(item) => {
              const project = () => (item.entry?.provider ? peekProject(item.entry!.provider!.provider, item.entry!.provider!.projectId) : undefined);
              const name = () => (item.entry ? contentName(item.entry!, project()) : baseName(item.path.split('/').at(-1)!));
              return (
                <li data-vesta="modpack-owned-item" title={item.path}>
                  <Show when={project()?.icon_url} fallback={
                    <span data-vesta="modpack-owned-placeholder" aria-hidden="true"><Icon name={ownedKindIcon[item.kind]} size={14} /></span>
                  }>
                    {(src) => <img src={src()} alt="" loading="lazy" decoding="async" width={24} height={24} draggable="false" />}
                  </Show>
                  <span data-vesta="modpack-owned-name">{name()}</span>
                </li>
              );
            }}
          </For>
          <Show when={overflow()}>
            <li>
              <button type="button" data-vesta="modpack-owned-item" data-more="" onClick={openResources}>
                <span data-vesta="modpack-owned-placeholder" aria-hidden="true"><Icon name="icons/content/layers" size={14} /></span>
                <span data-vesta="modpack-owned-name">{t('server-pack.owned-more', { count: items().length - shown().length })}</span>
              </button>
            </li>
          </Show>
        </ul>
      </section>
    </Show>
  );
}

const ownedKindIcon: Record<ServerContentEntry['kind'], string> = {
  mod: 'icons/content/cube',
  plugin: 'icons/content/dependencies',
  datapack: 'icons/content/layers',
};

interface OwnedResource { path: string; kind: ServerContentEntry['kind']; entry?: ServerContentEntry }

/**
 * The link's files that are resources: the inventory's own rows when it is readable, else the
 * archives by path (config and other override files are not resources).
 */
function ownedResources(owned: readonly string[], inventory: readonly ServerContentEntry[] | undefined): OwnedResource[] {
  if (inventory) {
    const paths = new Set(owned);
    return inventory.filter((entry) => isModpackOwned(entry, paths)).map((entry) => ({ path: entry.path, kind: entry.kind, entry }));
  }
  return owned.flatMap((path): OwnedResource[] => {
    if (!/\.(jar|zip)$/i.test(path)) return [];
    return [{ path, kind: path.startsWith('plugins/') ? 'plugin' : path.includes('datapacks/') ? 'datapack' : 'mod' }];
  });
}

/** The client pack is separate: say what players get and where to change it. */
function OfferingPanel() {
  const area = useModpackArea();
  const copy = () => (area.clientMode() === 'server-modpack' ? 'server-pack.offering-server' : area.clientMode() === 'custom' ? 'server-pack.offering-custom' : 'server-pack.offering-none');
  return (
    <section data-vesta="modpack-panel">
      <header data-vesta="modpack-panel-head"><h3>{t('server-pack.client-title')}</h3></header>
      <div data-vesta="modpack-panel-body">
        <p data-vesta="server-muted">{t(copy())}</p>
        <Button size="sm" variant="outline" icon={<Icon name="icons/content/modpack" />} onClick={() => area.open('overview')}>{t('server-pack.offering-open')}</Button>
      </div>
    </section>
  );
}

/** Unlink: keep the pack's files as ordinary content, or stage deletion of the files it owns. */
function UnlinkDialog(props: { name: string; onClose: () => void }) {
  const area = useModpackArea();
  const [choice, setChoice] = createSignal<UnlinkChoice>('keep', { name: 'modpack-unlink:choice' });
  const [busy, setBusy] = createSignal(false, { name: 'modpack-unlink:busy' });
  const [error, setError] = createSignal<ServerCommandError | null>(null, { name: 'modpack-unlink:error' });
  const intents = new IntentMemo();
  const owned = () => area.link().owned.length;
  const unlink = async () => {
    setBusy(true); setError(null);
    const remove = choice() === 'remove';
    try {
      const outcome = await serverCommand((api) => api.serverModpackUnlink(area.id(), remove, intents.idFor(['unlink', remove])));
      intents.settle();
      invalidateServerResources(area.id(), CONTENT_RESOURCES);
      toast.show({
        title: t('server-pack.unlinked', { name: props.name }),
        description: remove ? t('server-pack.unlinked-removing', { count: outcome.pendingIds.length }) : undefined,
        tone: 'success',
      });
      props.onClose();
      await area.reload();
    } catch (reason) {
      intents.settle(reason as ServerCommandError);
      setError(reason as ServerCommandError);
    } finally { setBusy(false); }
  };
  const options = [
    { id: 'keep' as const, title: 'server-pack.unlink-keep' as const, description: 'server-pack.unlink-keep-help' as const },
    { id: 'remove' as const, title: 'server-pack.unlink-remove' as const, description: 'server-pack.unlink-remove-help' as const },
  ];
  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy()) props.onClose(); }} closeLabel={t('nav.close')} size="sm"
      title={t('server-pack.unlink-title', { name: props.name })} description={t('server-pack.unlink-description')}
      footer={<>
        <Button variant="ghost" disabled={busy()} onClick={props.onClose}>{t('common.cancel')}</Button>
        <Button tone="danger" disabled={busy()} onClick={() => void unlink()}>{t('server-pack.unlink')}</Button>
      </>}>
      <div data-vesta="modpack-modes" role="radiogroup" aria-label={t('server-pack.unlink-title', { name: props.name })}>
        <For each={options}>
          {(option) => (
            <label data-vesta="modpack-mode" data-selected={choice() === option.id ? '' : undefined}>
              <input type="radio" name="modpack-unlink" value={option.id} checked={choice() === option.id} disabled={busy()} onChange={() => setChoice(option.id)} />
              <span data-vesta="modpack-mode-copy">
                <span data-vesta="modpack-mode-title">{t(option.title)}</span>
                <span data-vesta="modpack-mode-description">{t(option.description, { count: owned() })}</span>
              </span>
            </label>
          )}
        </For>
      </div>
      <Show when={area.clientMode() === 'server-modpack'}>
        <p data-vesta="server-callout" data-tone="warning">{t('server-pack.unlink-offering')}</p>
      </Show>
      <ServerErrorNote error={error()} />
    </Dialog>
  );
}
