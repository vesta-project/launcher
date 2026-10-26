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
  usersResource, whitelistResource, worldResource, warmSoftwareMetadata,
} from '../../features/servers/server-resources';
import { workflowsResource } from './automation/resources';
import { agentReachable } from '../../features/servers/shell-model';
import type { ServerSnapshot } from '../../features/servers/native';

type Prefetcher = (snapshot: ServerSnapshot) => void;
const prefetchers = new Map<string, Prefetcher>();

/** Adds or replaces the warmup for a tab or settings section id. */
export function registerServerPrefetch(target: string, prefetch: Prefetcher) {
  prefetchers.set(target, prefetch);
}

export function prefetchServerTarget(snapshot: ServerSnapshot, target: string) {
  if (agentReachable(snapshot)) prefetchers.get(target)?.(snapshot);
}

const can = (snapshot: ServerSnapshot, capability: string) => anyVisible(snapshot.capabilities, [capability]);

registerServerPrefetch('overview', (snapshot) => {
  const id = snapshot.connection.id;
  if (can(snapshot, 'tasks.view')) prefetchServerResource(id, operationsResource);
});
registerServerPrefetch('resources', (snapshot) => {
  if (can(snapshot, 'files.list')) prefetchServerResource(snapshot.connection.id, contentResource);
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
