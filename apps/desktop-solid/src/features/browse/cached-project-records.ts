// Provider names and icons from the host's local metadata table (`resource_project`, filled by
// `cache_resource_metadata` whenever a project is fetched). Reading it is a local DB query, so a
// list can show names and icons on first paint after a restart, before the provider answers.
import { invoke } from '@tauri-apps/api/core';
import { createSignal } from 'solid-js';
import { nativeInstances } from '../instances/native-service';
import type { SourceId } from './browse-model';

export interface CachedProjectRecord { name: string; icon_url?: string }
interface HostRecord { id: string; source: string; name: string; icon_url?: string | null }

const key = (source: string, id: string) => `${source.toLowerCase()}:${id}`;
const [records, setRecords] = createSignal<ReadonlyMap<string, CachedProjectRecord>>(new Map(), { name: 'browse:cached-project-records' });
/** Asked once per session; the host table only grows while the app runs. */
const asked = new Set<string>();

export const peekCachedProject = (source: string, id: string): CachedProjectRecord | undefined => records().get(key(source, id));

export function mergeCachedRecords(current: ReadonlyMap<string, CachedProjectRecord>, rows: readonly HostRecord[]): ReadonlyMap<string, CachedProjectRecord> {
  if (!rows.length) return current;
  const next = new Map(current);
  for (const row of rows) {
    if (!row.name) continue;
    next.set(key(row.source, row.id), { name: row.name, ...(row.icon_url?.startsWith('https://') || row.icon_url?.startsWith('data:image/') ? { icon_url: row.icon_url } : {}) });
  }
  return next;
}

/** One local query for every id not asked before. Never throws; a miss just waits for the provider. */
export async function loadCachedProjects(lookups: ReadonlyMap<SourceId, readonly string[]>): Promise<void> {
  if (!nativeInstances) return;
  const refs = [...lookups].flatMap(([platform, ids]) => ids.filter((id) => !asked.has(key(platform, id))).map((id) => ({ platform, id })));
  if (!refs.length) return;
  for (const ref of refs) asked.add(key(ref.platform, ref.id));
  try {
    const rows = await invoke<HostRecord[]>('get_cached_resource_projects', { refs });
    setRecords((current) => mergeCachedRecords(current, rows));
  } catch {
    for (const ref of refs) asked.delete(key(ref.platform, ref.id));
  }
}
