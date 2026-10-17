import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { nativeInstances } from '../instances/native-service';
import {
  fixtureCategories,
  fixtureCurseforgeCategories,
  fixtureProjects,
  fixtureSearch,
  fixtureVersions,
} from './browse-fixtures';
import type {
  ResourceCategory,
  ResourceProject,
  ResourceType,
  ResourceVersion,
  SearchResponse,
  SourceId,
  hostQuery,
} from './browse-model';

/**
 * Host access for Browse. In Tauri every call is a command from `resources.rs`; in a plain
 * browser the same calls are answered from a small fixture set so the page stays explorable.
 */

export type HostQuery = ReturnType<typeof hostQuery>;

/** A row of `get_installed_resources`; only the fields Browse reads. */
export interface InstalledRow {
  id: number;
  platform: string;
  remote_id: string;
  remote_version_id: string;
  resource_type: string;
  display_name: string;
}

const pause = (ms = 180) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function searchResources(platform: SourceId, query: HostQuery): Promise<SearchResponse> {
  if (nativeInstances) return invoke<SearchResponse>('search_resources', { platform, query });
  await pause(260);
  return fixtureSearch(platform, query);
}

export async function fetchCategories(platform: SourceId): Promise<ResourceCategory[]> {
  if (nativeInstances) return invoke<ResourceCategory[]>('get_resource_categories', { platform });
  await pause();
  return platform === 'curseforge' ? fixtureCurseforgeCategories : platform === 'modrinth' ? fixtureCategories : [];
}

export async function fetchProject(platform: SourceId, id: string): Promise<ResourceProject> {
  if (nativeInstances) return invoke<ResourceProject>('get_resource_project', { platform, id });
  await pause();
  const found = fixtureProjects.find((item) => item.source === platform && item.id === id);
  if (!found) throw new Error(`Unknown project ${id}`);
  return found;
}

export async function fetchVersions(platform: SourceId, projectId: string): Promise<ResourceVersion[]> {
  if (nativeInstances)
    return invoke<ResourceVersion[]>('get_resource_versions', { platform, projectId, ignoreCache: false });
  await pause();
  return fixtureVersions(projectId);
}

const fixtureInstalled = new Map<string, InstalledRow[]>();

export async function fetchInstalled(instanceId: string): Promise<InstalledRow[]> {
  if (nativeInstances) return invoke<InstalledRow[]>('get_installed_resources', { instanceId: Number(instanceId) });
  await pause(80);
  return [...(fixtureInstalled.get(instanceId) ?? [])];
}

/* ---- Install events ---- */

type RowsListener = (instanceId: string) => void;
type ErrorListener = (taskId: string) => void;
const rowsListeners = new Set<RowsListener>();
const errorListeners = new Set<ErrorListener>();
let rowsSubscription: Promise<unknown> | undefined;
let errorSubscription: Promise<unknown> | undefined;

/**
 * Registers handlers for install progress. The native subscription is created once and lives
 * for the session: the events are cheap and an install keeps running when Browse is closed.
 */
export function onInstallEvents(rows: RowsListener, error: ErrorListener) {
  rowsListeners.add(rows);
  errorListeners.add(error);
  if (!nativeInstances) return Promise.resolve();
  rowsSubscription ??= listen<{ instanceId: number; revision: string }>('core://instance-resource-rows-changed', (event) => {
    for (const listener of rowsListeners) listener(String(event.payload.instanceId));
  }).catch(() => { rowsSubscription = undefined; });
  errorSubscription ??= listen<string>('resource-install-error', (event) => {
    for (const listener of errorListeners) listener(event.payload);
  }).catch(() => { errorSubscription = undefined; });
  return Promise.all([rowsSubscription, errorSubscription]).then(() => undefined);
}

export interface InstallRequest {
  instanceId: string;
  world?: { instanceId: number; directoryName: string };
  project: ResourceProject;
  version: ResourceVersion;
  type: ResourceType;
}

/** Returns the host task id. */
export async function installResource(request: InstallRequest): Promise<string> {
  const { project, version, type } = request;
  if (nativeInstances) {
    // The host keeps project metadata (icon, name) for offline lists; the old launcher cached it first.
    await invoke('cache_resource_metadata', { platform: project.source, project }).catch(() => undefined);
    return invoke<string>('install_resource', {
      target: request.world ? { kind: 'world', world: request.world } : { kind: 'instance', instanceId: Number(request.instanceId) },
      platform: project.source,
      projectId: project.id,
      projectName: project.name,
      version,
      installType: type,
      compatibilityAcknowledged: false,
      replacementResourceId: null,
    });
  }
  const scope = request.world ? `${request.instanceId}/world/${request.world.directoryName}` : request.instanceId;
  setTimeout(() => {
    const rows = (fixtureInstalled.get(scope) ?? []).filter(
      (row) => !(row.platform === project.source && row.remote_id === project.id),
    );
    rows.push({
      id: Date.now(),
      platform: project.source,
      remote_id: project.id,
      remote_version_id: version.id,
      resource_type: type,
      display_name: project.name,
    });
    fixtureInstalled.set(scope, rows);
    for (const listener of rowsListeners) listener(request.instanceId);
  }, 1400);
  return `fixture-${project.id}`;
}
