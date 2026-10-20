import { invoke, isTauri } from '@tauri-apps/api/core';
import { createSignal } from 'solid-js';
import { syncItems, type SyncItem, type SyncSnapshot } from '../settings/sync-model';

export interface GameOptionsSnapshot {
  revision: string;
  exists: boolean;
  values: Record<string, string>;
}
export type GameOptionsMode = 'options' | 'keybinds';
type Catalog = SyncSnapshot['catalog'];
export interface GameOptionsAdapter {
  catalog(): Promise<Catalog>;
  load(id: string, mode: GameOptionsMode): Promise<GameOptionsSnapshot>;
  save(id: string, mode: GameOptionsMode, revision: string, changes: Record<string, string>): Promise<GameOptionsSnapshot>;
}

/** Reuse the same host metadata, grouping and value controls as Settings, without a sync bundle. */
export function gameOptionItems(snapshot: GameOptionsSnapshot, catalog: Catalog, mode: GameOptionsMode): SyncItem[] {
  return syncItems({ category: mode === 'options' ? 'gameOptions' : 'keybinds', sharedValues: snapshot.values, catalog });
}

/** One editor owns one instance/mode; errors retain its draft and revision for explicit reload. */
export function createGameOptionsEditor(id: string, mode: GameOptionsMode, adapter: GameOptionsAdapter) {
  const [snapshot, setSnapshot] = createSignal<GameOptionsSnapshot | undefined>(undefined, { name: 'instanceOptionsSnapshot' });
  const [catalog, setCatalog] = createSignal<Catalog>([], { name: 'instanceOptionsCatalog' });
  const [changes, setChanges] = createSignal<Record<string, string>>({}, { name: 'instanceOptionsDraft' });
  const [pending, setPending] = createSignal(false, { name: 'instanceOptionsPending' });
  const [error, setError] = createSignal('', { name: 'instanceOptionsError' });
  let generation = 0;
  return {
    snapshot, changes, pending, error,
    items: () => snapshot() ? gameOptionItems({ ...snapshot()!, values: { ...snapshot()!.values, ...changes() } }, catalog(), mode) : [],
    change(key: string, value: string) {
      if (pending() || !snapshot()) return;
      setChanges((current) => {
        const next = { ...current };
        if (value === snapshot()?.values[key]) delete next[key];
        else next[key] = value;
        return next;
      });
    },
    async load() {
      if (pending()) return;
      const request = ++generation;
      setPending(true); setError('');
      try {
        const [saved, metadata] = await Promise.all([adapter.load(id, mode), adapter.catalog()]);
        if (generation !== request) return;
        setSnapshot(saved); setCatalog(metadata); setChanges({});
      } catch (reason) { if (generation === request) setError(String(reason)); }
      finally { if (generation === request) setPending(false); }
    },
    async save() {
      const current = snapshot();
      if (!current || pending() || !Object.keys(changes()).length) return;
      const request = ++generation;
      setPending(true); setError('');
      try {
        const saved = await adapter.save(id, mode, current.revision, { ...changes() });
        if (generation !== request) return;
        setSnapshot(saved); setChanges({});
      } catch (reason) { if (generation === request) setError(String(reason)); }
      finally { if (generation === request) setPending(false); }
    },
    dispose() { ++generation; },
  };
}

let catalogRequest: Promise<Catalog> | undefined;
const native = typeof window !== 'undefined' && isTauri();
const fixture = new Map<string, GameOptionsSnapshot>();
const previewCatalog: Catalog = [
  { key: 'renderDistance', id: 'renderDistance', category: 'video', kind: 'integer', min: 2, max: 32, step: 1 },
  { key: 'gamma', id: 'brightness', category: 'video', kind: 'decimal', min: 0, max: 1, step: 0.01, unit: 'percent' },
  { key: 'fullscreen', id: 'fullscreen', category: 'video', kind: 'boolean' },
  { key: 'soundCategory_master', id: 'masterVolume', category: 'sound', kind: 'decimal', min: 0, max: 1, step: 0.01, unit: 'percent' },
];
export const gameOptionsAdapter: GameOptionsAdapter = {
  catalog() {
    if (!native) return Promise.resolve(previewCatalog);
    return catalogRequest ??= invoke<Catalog>('get_game_options_catalog').catch((error) => { catalogRequest = undefined; throw error; });
  },
  async load(id, mode) {
    if (native) return invoke('get_instance_game_options', { instanceId: Number(id), editorValues: mode === 'options' });
    const key = `${id}:${mode}`;
    if (!fixture.has(key)) fixture.set(key, { revision: '0', exists: true, values: mode === 'options'
      ? { renderDistance: '12', gamma: '0.5', fullscreen: 'false', soundCategory_master: '1' }
      : { 'key_key.forward': 'key.keyboard.w', 'key_key.back': 'key.keyboard.s', 'key_key.jump': 'key.keyboard.space' } });
    return fixture.get(key)!;
  },
  async save(id, mode, revision, changes) {
    if (native) return invoke('save_instance_game_options', { instanceId: Number(id), editorValues: mode === 'options', patch: { revision, changes } });
    const current = await this.load(id, mode);
    if (current.revision !== revision) throw new Error('Options changed. Reload before saving.');
    const saved = { ...current, revision: String(Number(revision) + 1), exists: true, values: { ...current.values, ...changes } };
    fixture.set(`${id}:${mode}`, saved);
    return saved;
  },
};
