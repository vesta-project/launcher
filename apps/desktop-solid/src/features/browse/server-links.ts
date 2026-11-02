import { invoke } from '@tauri-apps/api/core';
import { createSignal, untrack } from 'solid-js';
import { RequestCache } from '../../platform/cache/request-cache';
import { findInstance, instances, type InstanceEntry } from '../instances/catalog';
import { nativeInstances, nativeRecord, refreshNativeInstances } from '../instances/native-service';
import { AERO_SMP_ID, fixtureProjects } from './browse-fixtures';
import type { ResourceProject } from './browse-model';
import {
  joinFit,
  parseInstanceServerStatus,
  serverPack,
  type InstancePackRef,
  type InstanceServerStatus,
  type ServerLink,
} from './server-listing';

/**
 * Instances linked to Modrinth server listings. In Tauri the link lives in the host's own
 * table, not on the instance record, so it is learned from `instance_server_status` (`null`
 * when unlinked) and kept here; `install_server_pack`, `link_instance_to_server` and
 * `unlink_instance_server` update it. A plain browser answers from fixtures: the "Aero SMP"
 * instance follows the Aero SMP listing one pack version behind.
 */

/** Known links by instance id: a link, `null` for none; absent until asked. */
const [overrides, setOverrides] = createSignal<Readonly<Record<string, ServerLink | null>>>(
  nativeInstances
    ? {}
    : { 'aero-smp': { platform: 'modrinth', projectId: AERO_SMP_ID, address: 'play.aerosmp.com' } },
  { name: 'serverLinkOverrides' },
);

/** The listing an instance follows; reactive. */
export function serverLinkOf(instanceId: string): ServerLink | undefined {
  return overrides()[instanceId] ?? undefined;
}

const fixturePacks: Record<string, InstancePackRef> = { 'aero-smp': { platform: 'modrinth', projectId: AERO_SMP_ID } };

/** The provider modpack an instance is linked to, if any. */
export function instancePackRef(instanceId: string): InstancePackRef | undefined {
  if (!nativeInstances) return fixturePacks[instanceId];
  const record = nativeRecord(instanceId);
  const projectId = record?.modpackId?.trim();
  return projectId && record?.modpackPlatform ? { platform: record.modpackPlatform, projectId } : undefined;
}

/** The instance that plays this listing, if one is linked (the first, by library order). */
export const linkedInstanceFor = (projectId: string): InstanceEntry | undefined =>
  instances().find((entry) => serverLinkOf(entry.instance.id)?.projectId === projectId);

/** Instances that can join a listing, with whether each already follows it. */
export function joinableInstances(project: ResourceProject) {
  const listing = project.server;
  if (!listing) return [];
  return instances().flatMap((entry) => {
    const instance = entry.instance;
    const fit = joinFit(listing, { ...instance, pack: instancePackRef(instance.id) });
    return fit === 'fits' ? [{ entry, linked: serverLinkOf(instance.id)?.projectId === project.id }] : [];
  });
}

const setOverride = (instanceId: string, link: ServerLink | null) =>
  setOverrides((current) => ({ ...current, [instanceId]: link }));
const linkOf = (project: ResourceProject): ServerLink => ({
  platform: 'modrinth',
  projectId: project.id,
  address: project.server?.address ?? '',
});

/**
 * Install & play: a new instance from the listing's pack version (modpack listings) or at its
 * recommended version (vanilla), linked to the listing. Returns the new instance id.
 */
export async function installServerPack(project: ResourceProject): Promise<string> {
  if (nativeInstances) {
    // Returns once the usual install task is scheduled; the instance page shows its progress.
    const id = String(await invoke<number | string>('install_server_pack', { projectId: project.id }));
    statusCache.invalidate(id);
    setOverride(id, linkOf(project));
    await refreshNativeInstances(true);
    return id;
  }
  await new Promise((resolve) => setTimeout(resolve, 400));
  // Preview: the fixture library already has an instance for each listing.
  const id = serverPack(project.server) ? 'aero-smp' : 'builds';
  setOverride(id, linkOf(project));
  return id;
}

/** Makes an existing instance follow a listing (same modpack project, or a supported version). */
export async function linkInstanceToServer(instanceId: string, project: ResourceProject): Promise<void> {
  if (nativeInstances) {
    await invoke('link_instance_to_server', { instanceId: Number(instanceId), projectId: project.id });
    statusCache.invalidate(instanceId);
    setOverride(instanceId, linkOf(project));
    await refreshNativeInstances(true);
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, 200));
  if (!findInstance(instanceId)) throw new Error(`Unknown instance ${instanceId}`);
  setOverride(instanceId, linkOf(project));
}

/** Drops the server link only: content and any modpack link stay. */
export async function unlinkInstanceServer(instanceId: string): Promise<void> {
  if (nativeInstances) {
    await invoke('unlink_instance_server', { instanceId: Number(instanceId) });
    statusCache.invalidate(instanceId);
    setOverride(instanceId, null);
    await refreshNativeInstances(true);
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, 200));
  setOverride(instanceId, null);
}

/* ---- Status ---- */

/** The host caches listings for about a minute; this keeps tabs from asking twice. */
const statusCache = new RequestCache<InstanceServerStatus | null>({ maxEntries: 16, staleTimeMs: 60_000, retentionMs: 10 * 60_000 });

function fixtureStatus(instanceId: string): InstanceServerStatus | null {
  const link = untrack(() => serverLinkOf(instanceId));
  const listing = fixtureProjects.find((project) => project.id === link?.projectId)?.server;
  if (!link || !listing) return null;
  const pack = serverPack(listing);
  // The Aero SMP instance has 4.1 installed while the listing moved to 4.2.
  const behind = !!pack && link.projectId === AERO_SMP_ID && instanceId === 'aero-smp';
  return {
    link,
    ping: listing.ping,
    versionId: pack?.versionId ?? null,
    updateAvailable: behind,
    updateRequired: behind,
  };
}

/** The cached listing ping and update state for a linked instance; `null` when not linked. */
export async function loadInstanceServerStatus(instanceId: string, force = false): Promise<InstanceServerStatus | null> {
  if (!nativeInstances) {
    await new Promise((resolve) => setTimeout(resolve, 120));
    return fixtureStatus(instanceId);
  }
  if (force) statusCache.invalidate(instanceId);
  const status = await statusCache.read(instanceId, () =>
    invoke<unknown>('instance_server_status', { instanceId: Number(instanceId) }).then(parseInstanceServerStatus),
  );
  // The status is where the link is learned; record it when it differs from what is known.
  const known = untrack(overrides);
  if (!(instanceId in known) || known[instanceId]?.projectId !== status?.link?.projectId)
    setOverride(instanceId, status?.link ?? null);
  return status;
}

let discovery: Promise<void> | undefined;
/**
 * Asks the host which library instances follow a listing (a listing page's "Play with" needs
 * it). Once per session, two at a time; links made later are recorded as they happen.
 */
export function discoverServerLinks(): Promise<void> {
  if (!nativeInstances) return Promise.resolve();
  discovery ??= (async () => {
    const known = untrack(overrides);
    const pending = untrack(instances)
      .map((entry) => entry.instance.id)
      .filter((id) => !(id in known));
    const worker = async () => {
      for (let id = pending.shift(); id !== undefined; id = pending.shift())
        await loadInstanceServerStatus(id).catch(() => undefined);
    };
    await Promise.all([worker(), worker()]);
  })();
  return discovery;
}

