import { createSignal } from 'solid-js';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { cachedResource } from './cached-resource';
import { categoryState, hostCategory, syncOptionKeys, syncPreferences, type CategoryState, type SyncSnapshot } from './sync-model';

import type { MessageId } from '../../localization/messages';

export type SyncCategoryId = 'options' | 'keybinds' | 'servers' | 'resourcepacks';

export const syncCategories: {
  id: SyncCategoryId;
  label: MessageId;
  description: MessageId;
  icon: string;
  disabled?: boolean;
}[] = [
  {
    id: 'options',
    label: 'prefs.sync.options',
    description: 'prefs.sync.options-description',
    icon: 'icons/content/sliders',
  },
  {
    id: 'keybinds',
    label: 'prefs.sync.keybinds',
    description: 'prefs.sync.keybinds-description',
    icon: 'icons/content/keyboard',
  },
  {
    id: 'servers',
    label: 'prefs.sync.servers',
    description: 'prefs.sync.servers-description',
    icon: 'icons/content/server',
  },
  {
    id: 'resourcepacks',
    label: 'prefs.sync.resourcepacks',
    description: 'prefs.sync.resourcepacks-description',
    icon: 'icons/content/resource-pack',
    disabled: true,
  },
];

/** Minecraft option keys that can be shared; the host reads the real list from each instance's options.txt. */
export const sharedOptions = {
  options: [
    'fov',
    'renderDistance',
    'simulationDistance',
    'maxFps',
    'guiScale',
    'gamma',
    'musicVolume',
    'soundCategory_master',
    'language',
    'fullscreen',
    'enableVsync',
    'chatOpacity',
  ],
  keybinds: [
    'key_key.forward',
    'key_key.back',
    'key_key.left',
    'key_key.right',
    'key_key.jump',
    'key_key.sneak',
    'key_key.sprint',
    'key_key.inventory',
    'key_key.drop',
    'key_key.chat',
  ],
};

const [state, setState] = createSignal<Record<SyncCategoryId, CategoryState>>(
  {
    options: {
      enabled: true,
      selected: ['fov', 'renderDistance', 'guiScale'],
      linked: [],
      servers: [],
    },
    keybinds: { enabled: false, selected: [], linked: [], servers: [] },
    servers: {
      enabled: true,
      selected: [],
      linked: [],
      servers: [{ id: 'hypixel', name: 'Hypixel', address: 'mc.hypixel.net' }],
    },
    resourcepacks: { enabled: false, selected: [], linked: [], servers: [] },
  },
  { name: 'settingsSync' },
);
const native = typeof window !== 'undefined' && isTauri();
export const settingsSync = cachedResource<SyncSnapshot[]>({
  key: 'settings-sync', fallback: [],
  load: async () => native ? invoke<SyncSnapshot[]>('get_settings_sync') : [],
});
const empty: CategoryState = { enabled: false, selected: [], linked: [], servers: [] };
export const syncState = (): Record<SyncCategoryId, CategoryState> => native
  ? Object.fromEntries(Object.entries(hostCategory).map(([id, category]) => {
      const snapshot = settingsSync.data().find((item) => item.category === category);
      return [id, snapshot ? categoryState(snapshot) : empty];
    })) as Record<SyncCategoryId, CategoryState>
  : state();
export const availableSyncOptions = (id: SyncCategoryId) => {
  if (!native) return sharedOptions[id as 'options' | 'keybinds'] ?? [];
  const snapshot = settingsSync.data().find((item) => item.category === hostCategory[id]);
  return snapshot ? syncOptionKeys(snapshot) : [];
};
const [error, setError] = createSignal('', { name: 'settingsSyncError' });
export const syncError = () => error() || (settingsSync.error() ? String(settingsSync.error()) : "");
const [sourceRequest, setSourceRequest] = createSignal<SyncCategoryId | undefined>(undefined, { name: 'syncSourceRequest' });
export { sourceRequest as syncSourceRequest };
export const cancelSyncSourceRequest = () => setSourceRequest(undefined);
export function confirmSyncSource(source: string) {
  const id = sourceRequest();
  if (!id) return;
  setSourceRequest(undefined);
  return setSyncState(id, { enabled: true, source });
}
let writes = Promise.resolve();
function change(id: SyncCategoryId, apply: (snapshot: SyncSnapshot) => Promise<SyncSnapshot> | undefined) {
  writes = writes.then(async () => {
    setError('');
    try {
      if (!settingsSync.ready()) await settingsSync.refresh();
      const snapshot = settingsSync.data().find((item) => item.category === hostCategory[id]);
      if (!snapshot) throw new Error('Sync settings could not be loaded. Try again.');
      const next = await apply(snapshot);
      if (next) settingsSync.set(settingsSync.data().map((item) => item.category === next.category ? next : item));
    } catch (reason) {
      setError(String(reason));
      await settingsSync.refresh(true);
    }
  });
  return writes;
}
export function setSyncState(id: SyncCategoryId, patch: Partial<CategoryState> | ((current: CategoryState) => Partial<CategoryState>)) {
  if (!native) {
    setState((current) => ({ ...current, [id]: { ...current[id], ...(typeof patch === 'function' ? patch(current[id]) : patch) } }));
    return;
  }
  return change(id, (snapshot) => {
    const preferences = syncPreferences(snapshot, typeof patch === 'function' ? patch(categoryState(snapshot)) : patch);
    if (preferences.enabled && !snapshot.initialized && (id === 'options' || id === 'keybinds')) {
      if (preferences.sourceInstanceId === null) {
        setSourceRequest(id);
        return undefined;
      }
    }
    return invoke<SyncSnapshot>('save_settings_sync', {
      category: snapshot.category, revision: snapshot.revision, preferences, changes: null,
    });
  });
}
export const toggleInstanceLink = (id: SyncCategoryId, instance: string, on: boolean) => {
  if (!native) return setSyncState(id, { linked: on
    ? [...new Set([...state()[id].linked, instance])]
    : state()[id].linked.filter((item) => item !== instance) });
  return change(id, (snapshot) => {
    const linked = snapshot.preferences.instanceIds.map(String);
    return invoke<SyncSnapshot>('save_settings_sync', {
      category: snapshot.category, revision: snapshot.revision, changes: null,
      preferences: syncPreferences(snapshot, { linked: on ? [...new Set([...linked, instance])] : linked.filter((item) => item !== instance) }),
    });
  });
};
export const linkAllInstances = (id: SyncCategoryId, on: boolean, all: string[]) =>
  setSyncState(id, { linked: on ? all : [] });
export function addSyncedServer(name: string, address: string) {
  if (!native) return setSyncState('servers', { servers: [...state().servers.servers, { id: address, name, address }] });
  return change('servers', (snapshot) => invoke<SyncSnapshot>('add_synced_server', { revision: snapshot.revision, name, address }));
}
export function removeSyncedServer(serverId: string) {
  if (!native) return setSyncState('servers', { servers: state().servers.servers.filter((item) => item.id !== serverId) });
  return change('servers', (snapshot) => invoke<SyncSnapshot>('remove_synced_server', { revision: snapshot.revision, serverId }));
}
