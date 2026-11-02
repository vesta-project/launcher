// Intent-driven warmups for the server workspace nav: hovering, focusing or pressing a tab
// or settings section starts its reads through the shared resource cache, so the pane
// opens with data. Nothing here navigates or writes view state.
import { onSettled } from 'solid-js';
import { anyVisible } from '../../features/servers/capabilities';
import { prefetchServerResource, readServerResource } from '../../features/servers/resources';
import { initialChoice, selectable } from '../../features/servers/software-flow';
import { gameStopped } from '../../features/servers/hosting-model';
import {
  accessSourcesResource, backupStorageResource, contentResource, backupsResource, bansResource, brandingResource, devicesResource, invitationsResource,
  motdPolicyResource, operationsResource, operatorsResource, propertiesResource, rolesResource, sleepPolicyResource, softwareJobsResource, softwareResource, sftpResource,
  usersResource, whitelistResource, worldResource, warmSoftwareMetadata, packWorkspaceResource, metricsHistoryResource,
} from '../../features/servers/server-resources';
import { workflowsResource } from './automation/resources';
import { agentReachable } from '../../features/servers/shell-model';
import type { ServerSnapshot } from '../../features/servers/native';
import { serverSnapshot } from '../../features/servers/store';
import { needsPackWorkspace } from './pack/get-modpack';
import { prefetchListing } from '../../features/servers/file-listing';
import { warmContentMetadata } from '../../features/servers/content-metadata';

type Prefetcher = (snapshot: ServerSnapshot) => void;
const prefetchers = new Map<string, Prefetcher>();

/** Adds or replaces the warmup for a tab or settings section id. */
export function registerServerPrefetch(target: string, prefetch: Prefetcher) {
  prefetchers.set(target, prefetch);
}

export function prefetchServerTarget(snapshot: ServerSnapshot, target: string) {
  const needs: Record<string, readonly string[]> = {
    overview: ['tasks.view', 'pack.edit', 'metrics.view'], files: ['files.list'], resources: ['files.list', 'pack.edit'], pack: ['pack.edit'], activity: ['tasks.view'],
    backups: ['backups.view'], general: ['config.view'], game: ['config.view'], world: ['config.view'],
    sftp: ['config.view'], software: ['content.install'], presence: ['config.view'], players: ['players.view'],
    access: ['principals.view', 'invitations.create', 'devices.revoke', 'access-sources.manage'], automation: ['automation.view'],
  };
  if (agentReachable(snapshot) && anyVisible(snapshot.capabilities, needs[target] ?? [])) prefetchers.get(target)?.(snapshot);
}

const can = (snapshot: ServerSnapshot, capability: string) => anyVisible(snapshot.capabilities, [capability]);

// The Overview waits for the client pack answer and draws Performance from history, so both warm too.
registerServerPrefetch('overview', (snapshot) => {
  const id = snapshot.connection.id;
  if (can(snapshot, 'tasks.view')) prefetchServerResource(id, operationsResource);
  if (needsPackWorkspace(snapshot)) prefetchServerResource(id, packWorkspaceResource);
  if (can(snapshot, 'metrics.view')) prefetchServerResource(id, metricsHistoryResource, '1h');
});
// Files opens on the game root; the shared listing cache dedupes repeat hovers.
registerServerPrefetch('files', (snapshot) => prefetchListing(snapshot.connection.id, ''));
registerServerPrefetch('resources', (snapshot) => {
  // The inventory, then its provider names/icons (local records, then providers), so the list
  // opens with names instead of filenames that later re-sort.
  if (can(snapshot, 'files.list')) void readServerResource(snapshot.connection.id, contentResource).then((inventory) => warmContentMetadata(inventory.items)).catch(() => {});
  if (can(snapshot, 'pack.edit')) prefetchServerResource(snapshot.connection.id, packWorkspaceResource);
});
registerServerPrefetch('pack', (snapshot) => {
  if (can(snapshot, 'pack.edit')) {
    prefetchServerResource(snapshot.connection.id, packWorkspaceResource);
  }
});
registerServerPrefetch('activity', (snapshot) => prefetchServerResource(snapshot.connection.id, operationsResource));
registerServerPrefetch('backups', (snapshot) => {
  prefetchServerResource(snapshot.connection.id, backupsResource);
  prefetchServerResource(snapshot.connection.id, backupStorageResource);
});
registerServerPrefetch('general', (snapshot) => prefetchServerResource(snapshot.connection.id, brandingResource));
registerServerPrefetch('game', (snapshot) => prefetchServerResource(snapshot.connection.id, propertiesResource));
registerServerPrefetch('world', (snapshot) => prefetchServerResource(snapshot.connection.id, worldResource));
registerServerPrefetch('sftp', (snapshot) => prefetchServerResource(snapshot.connection.id, sftpResource));
registerServerPrefetch('software', (snapshot) => {
  void readServerResource(snapshot.connection.id, softwareResource).then((state) => {
    if (!state.available || state.recoveryRequired || !gameStopped(snapshot)) return;
    const choice = initialChoice(state.catalog, state.current, snapshot.info?.minecraftVersion ?? null);
    if (choice.software && state.catalog.some(entry => entry.software === choice.software && selectable(entry))) void warmSoftwareMetadata(snapshot.connection.id, choice.software, choice.minecraft);
  }).catch(() => {});
  prefetchServerResource(snapshot.connection.id, softwareJobsResource);
});
registerServerPrefetch('presence', (snapshot) => {
  prefetchServerResource(snapshot.connection.id, sleepPolicyResource);
  prefetchServerResource(snapshot.connection.id, motdPolicyResource);
});
registerServerPrefetch('players', (snapshot) => {
  const id = snapshot.connection.id;
  for (const list of [whitelistResource, operatorsResource, bansResource]) prefetchServerResource(id, list);
  if (can(snapshot, 'config.view')) prefetchServerResource(id, propertiesResource);
});
registerServerPrefetch('access', (snapshot) => {
  const id = snapshot.connection.id;
  if (can(snapshot, 'principals.view')) { prefetchServerResource(id, usersResource); prefetchServerResource(id, rolesResource); }
  if (can(snapshot, 'invitations.create')) prefetchServerResource(id, invitationsResource);
  if (can(snapshot, 'devices.revoke')) prefetchServerResource(id, devicesResource);
  if (can(snapshot, 'access-sources.manage')) prefetchServerResource(id, accessSourcesResource);
});
// Workflow summaries only; definitions and run history wait until they are shown.
registerServerPrefetch('automation', (snapshot) => {
  if (can(snapshot, 'automation.view')) prefetchServerResource(snapshot.connection.id, workflowsResource);
});

/** Server cards and rail pins (data-preload-server = connection id) warm the page they open on. */
export function prefetchServerOpen(connectionId: string) {
  const snapshot = serverSnapshot(connectionId);
  if (snapshot) prefetchServerTarget(snapshot, 'overview');
}

const HOVER_DELAY_MS = 120;
const ATTRIBUTE = 'data-server-prefetch';

/** The element's prefetch target: itself, or a marked label inside a nav tab. */
function targetOf(node: EventTarget | null): string | null {
  if (!(node instanceof Element)) return null;
  const marked = node.closest(`[${ATTRIBUTE}]`) ?? node.closest('[data-vesta="tab"]')?.querySelector(`[${ATTRIBUTE}]`);
  return marked?.getAttribute(ATTRIBUTE) ?? null;
}

/** Listens inside `root` for intent on elements marked with `data-server-prefetch`. */
export function useServerNavPrefetch(root: () => HTMLElement | undefined, snapshot: () => ServerSnapshot) {
  onSettled(() => {
    const element = root();
    if (!element) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let hovered: string | null = null;
    const warm = (target: string | null) => { if (target) prefetchServerTarget(snapshot(), target); };
    const over = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      const next = targetOf(event.target);
      if (next === hovered) return;
      clearTimeout(timer);
      hovered = next;
      if (next) timer = setTimeout(() => warm(next), HOVER_DELAY_MS);
    };
    const out = (event: PointerEvent) => {
      if (hovered && targetOf(event.relatedTarget) !== hovered) { clearTimeout(timer); hovered = null; }
    };
    const focus = (event: FocusEvent) => warm(targetOf(event.target));
    const down = (event: PointerEvent) => warm(targetOf(event.target));
    element.addEventListener('pointerover', over);
    element.addEventListener('pointerout', out);
    element.addEventListener('focusin', focus);
    element.addEventListener('pointerdown', down);
    return () => {
      clearTimeout(timer);
      element.removeEventListener('pointerover', over);
      element.removeEventListener('pointerout', out);
      element.removeEventListener('focusin', focus);
      element.removeEventListener('pointerdown', down);
    };
  });
}
