import { createSignal } from 'solid-js';
import art1 from '../../assets/images/placeholders/placeholder-image1.jpg';
import art2 from '../../assets/images/placeholders/placeholder-image2.png';
import art3 from '../../assets/images/placeholders/placeholder-image3.png';
import art4 from '../../assets/images/placeholders/placeholder-image4.png';
import art5 from '../../assets/images/placeholders/placeholder-image5.png';
import art6 from '../../assets/images/placeholders/placeholder-image6.png';
import type { InstanceCardData, InstanceCardState } from './instance-card';

/**
 * Fixture instances for building the UI before the backend is wired.
 * Replace with the real instance store; the card only needs data plus a state.
 */
const seed: { instance: InstanceCardData; state: InstanceCardState }[] = [
  { instance: { id: 'survival', name: 'Survival', minecraftVersion: '1.21.4', modloader: 'fabric', image: art1, pinned: true }, state: { kind: 'idle' } },
  { instance: { id: 'create', name: 'Create Skyblock', minecraftVersion: '1.20.1', modloader: 'forge', image: art2, pinned: true }, state: { kind: 'running' } },
  { instance: { id: 'snapshot', name: 'Vanilla Snapshot', minecraftVersion: '24w44a', modloader: 'vanilla', image: art3 }, state: { kind: 'idle' } },
  { instance: { id: 'friends', name: 'Old Friends Pack', minecraftVersion: '1.12.2', modloader: 'quilt', image: art4 }, state: { kind: 'crashed', summary: 'java.lang.OutOfMemoryError: Java heap space' } },
  { instance: { id: 'atm', name: 'All the Mods 10', minecraftVersion: '1.21.1', modloader: 'neoforge', image: art5 }, state: { kind: 'interrupted', label: 'Update' } },
  { instance: { id: 'server', name: 'Friends Server', minecraftVersion: '1.21.4', modloader: 'fabric', image: art6 }, state: { kind: 'failed', reason: 'Could not download Fabric loader 0.16.9: connection reset by peer' } },
  { instance: { id: 'builds', name: 'Creative Builds', minecraftVersion: '1.21.4', modloader: 'vanilla', image: art2 }, state: { kind: 'idle' } },
  { instance: { id: 'pvp', name: 'PvP Practice', minecraftVersion: '1.8.9', modloader: 'forge', image: art4 }, state: { kind: 'idle' } },
];

const [items, setItems] = createSignal(seed, { name: 'fixtureInstances' });

export const instances = items;
export const findInstance = (id: string | undefined) => items().find((entry) => entry.instance.id === id);
export const pinnedInstances = () => items().filter((entry) => entry.instance.pinned);

const update = (id: string, state: InstanceCardState) =>
  setItems((list) => list.map((entry) => (entry.instance.id === id ? { ...entry, state } : entry)));

/** Stand-in for the real launch/stop flows: each click advances the state. */
export function playInstance(id: string) {
  const current = findInstance(id)?.state;
  if (!current) return;
  switch (current.kind) {
    case 'idle':
    case 'crashed':
      update(id, { kind: 'warming' });
      window.setTimeout(() => update(id, { kind: 'running' }), 1400);
      break;
    case 'running':
      update(id, { kind: 'idle' });
      break;
    default:
      break;
  }
}

/** Stand-in for retry/resume: shows the busy overlay, then settles. */
export function retryInstance(id: string, label: string) {
  update(id, { kind: 'installing', label });
  window.setTimeout(() => update(id, { kind: 'idle' }), 2200);
}
