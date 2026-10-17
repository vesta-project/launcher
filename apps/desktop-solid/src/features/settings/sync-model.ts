export type SyncCategoryId = 'options' | 'keybinds' | 'servers' | 'resourcepacks';
export const hostCategory = { options: 'gameOptions', keybinds: 'keybinds', servers: 'servers', resourcepacks: 'resourcePacks' } as const;
export interface SyncedServer { id: string; name: string; address: string; icon?: string | null }
export interface SyncSnapshot {
  category: typeof hostCategory[SyncCategoryId];
  revision: number;
  preferences: { enabled: boolean; sourceInstanceId: number | null; instanceIds: number[]; selectedKeys: string[] | null };
  sharedValues: Record<string, string>;
  servers: SyncedServer[];
  catalog: { key: string; [key: string]: unknown }[];
  pending: string[];
  initialized: boolean;
}
export interface CategoryState {
  enabled: boolean;
  selected: string[];
  linked: string[];
  servers: SyncedServer[];
  source?: string | null;
}
export function syncOptionKeys(snapshot: SyncSnapshot): string[] {
  return snapshot.category === 'gameOptions'
    ? [...new Set([...snapshot.catalog.map((entry) => entry.key), ...Object.keys(snapshot.sharedValues)])].filter((key) => key in snapshot.sharedValues)
    : Object.keys(snapshot.sharedValues);
}
export function categoryState(snapshot: SyncSnapshot): CategoryState {
  return {
    enabled: snapshot.preferences.enabled,
    selected: snapshot.preferences.selectedKeys ?? syncOptionKeys(snapshot),
    linked: snapshot.preferences.instanceIds.map(String),
    servers: snapshot.servers,
  };
}
export function syncPreferences(snapshot: SyncSnapshot, patch: Partial<CategoryState>) {
  const preferences = { ...snapshot.preferences };
  if (patch.enabled !== undefined) preferences.enabled = patch.enabled;
  if (patch.linked) {
    preferences.instanceIds = patch.linked.map((id) => {
      if (!/^\d+$/.test(id) || !Number.isSafeInteger(Number(id))) throw new Error('Invalid instance ID');
      return Number(id);
    });
    if (preferences.sourceInstanceId !== null && !preferences.instanceIds.includes(preferences.sourceInstanceId))
      preferences.sourceInstanceId = preferences.instanceIds[0] ?? null;
  }
  if (patch.source !== undefined) {
    const source = patch.source === null ? null : Number(patch.source);
    if (source !== null && (!/^\d+$/.test(patch.source!) || !Number.isSafeInteger(source) || source <= 0))
      throw new Error('Invalid source instance ID');
    preferences.sourceInstanceId = source;
    if (source !== null) preferences.instanceIds = [...new Set([source, ...preferences.instanceIds])];
  }
  if (patch.selected) preferences.selectedKeys = [...new Set(patch.selected)];
  return preferences;
}
