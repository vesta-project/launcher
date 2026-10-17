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
    source: snapshot.preferences.sourceInstanceId === null ? null : String(snapshot.preferences.sourceInstanceId),
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

export interface SyncItem {
  key: string;
  label: string;
  group: string;
  value: string;
  /** Unknown extras travel with the bundle and cannot be deselected. */
  fixed: boolean;
  /** How the host says the value is edited; absent for keybinds and unknown keys. */
  editor?: SyncEditor;
}
export interface SyncEditor {
  kind: 'boolean' | 'integer' | 'decimal' | 'enum' | 'language' | string;
  min: number | null;
  max: number | null;
  step: number | null;
  values: string[];
  unit: string | null;
}
const editorOf = (entry: Record<string, unknown> | undefined): SyncEditor | undefined =>
  entry && typeof entry.kind === 'string'
    ? {
        kind: entry.kind,
        min: typeof entry.min === 'number' ? entry.min : null,
        max: typeof entry.max === 'number' ? entry.max : null,
        step: typeof entry.step === 'number' ? entry.step : null,
        values: Array.isArray(entry.values) ? entry.values.map(String) : [],
        unit: typeof entry.unit === 'string' ? entry.unit : null,
      }
    : undefined;
const acronyms = new Set(['ao', 'fov', 'fps', 'gui', 'gl', 'gpu', 'cpu', 'ui', 'rgb', 'msaa', 'vbo']);
/** Format a physical options.txt key for display without changing the key. */
export function formatOptionName(key: string): string {
  const words = key.replace(/^key_key\./, '').replace(/^key_/, '')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/[_.:-]+/g, ' ').trim().split(/\s+/).filter(Boolean)
    .map((word) => (acronyms.has(word.toLowerCase()) ? word.toUpperCase() : word.toLowerCase()));
  const label = words.join(' ');
  return label ? label.charAt(0).toUpperCase() + label.slice(1) : key;
}
const keybindGroups: Record<string, string[]> = {
  movement: ['forward', 'back', 'left', 'right', 'jump', 'sneak', 'sprint'],
  gameplay: ['attack', 'use', 'pickitem'],
  inventory: ['inventory', 'drop', 'swapoffhand', 'loadtoolbaractivator', 'savetoolbaractivator'],
  multiplayer: ['chat', 'command', 'playerlist', 'socialinteractions'],
  miscellaneous: ['advancements', 'screenshot', 'toggleperspective', 'smoothcamera', 'fullscreen', 'spectatoroutlines', 'zoom'],
};
function keybindGroup(key: string): string {
  const name = key.replace(/^key_key\./, '').replace(/^key_/, '').toLowerCase();
  if (/^hotbar\.\d+$/.test(name)) return 'inventory';
  return Object.entries(keybindGroups).find(([, names]) => names.includes(name))?.[0] ?? 'other';
}
/** Every value the source bundle holds, grouped for the category sidebar. */
export function syncItems(snapshot: SyncSnapshot): SyncItem[] {
  const known = new Map(snapshot.catalog.map((entry) => [entry.key, entry]));
  return Object.entries(snapshot.sharedValues)
    .filter(([key]) => (snapshot.category === 'keybinds') === key.startsWith('key_'))
    .map(([key, value]) => {
      const entry = known.get(key);
      const group = snapshot.category === 'keybinds' ? keybindGroup(key)
        : typeof entry?.category === 'string' && entry.category ? entry.category : 'custom';
      const label = formatOptionName(typeof entry?.id === 'string' ? entry.id : key);
      return { key, value, group, label, fixed: snapshot.category === 'gameOptions' && !entry, editor: editorOf(entry) };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}
