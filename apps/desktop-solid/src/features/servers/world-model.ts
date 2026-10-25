// Pure rules for the World page (D1): one world, shown like an instance's world detail.
// The seed stays masked until the owner asks for it, dimensions read as parts of one
// world even when the software splits their folders, and datapack toggles go through
// Minecraft's own command while the game runs.
import type { MessageId } from '../../localization/messages';
import { gate } from './capabilities';
import { formatBytes } from './files-model';
import type { ServerWorld, WorldDatapack, WorldDimension } from './hosting-native';
import type { CapabilityView, ServerOperation, ServerSnapshot } from './native';
import { isTerminal } from './operations-model';

// ------------------------------------------------------------------ seed

/** A fixed-width mask, so neither the digits nor the seed's length leak. */
export const SEED_MASK = '•••• •••• •••• ••••';

export interface SeedReveal {
  /** Clicked (or toggled with the keyboard) to stay visible for a while. */
  pinned: boolean;
  /** Pointer over the value, or keyboard focus on it. */
  hovering: boolean;
  /** Launcher privacy mode: hovering alone never reveals, only a deliberate click does. */
  privacy: boolean;
}

/** Hover or focus reveals; privacy mode needs a deliberate click. */
export const seedRevealed = (state: SeedReveal) => state.pinned || (state.hovering && !state.privacy);

/** What the seed slot shows: the seed, the mask, or a pending note before generation. */
export function seedText(seed: string | null, revealed: boolean): { text: string; masked: boolean } | null {
  if (!seed) return null;
  return revealed ? { text: seed, masked: false } : { text: SEED_MASK, masked: true };
}

/** How long a clicked seed stays visible before it hides itself again. */
export const SEED_REVEAL_MS = 8_000;

// ------------------------------------------------------------------ size and dates

/** "2.7 GB", "At least 2.7 GB" while the bounded scan was cut short, or null when unknown. */
export function worldSize(world: Pick<ServerWorld, 'sizeBytes' | 'sizeComplete'>): { message: MessageId; size: string } | null {
  if (world.sizeBytes === null) return null;
  const size = formatBytes(world.sizeBytes);
  if (!size) return null;
  return { message: world.sizeComplete ? 'server-world.size' : 'server-world.size-partial', size };
}

// ------------------------------------------------------------------ dimensions

const DIMENSION_ORDER = ['overworld', 'nether', 'end'];
const DIMENSION_LABELS: Record<string, MessageId> = {
  overworld: 'server-world.dimension-overworld',
  nether: 'server-world.dimension-nether',
  end: 'server-world.dimension-end',
};

export interface DimensionView {
  id: string;
  /** Known dimensions use a message; datapack dimensions show their namespaced id. */
  label: MessageId | null;
  name: string;
  present: boolean;
  split: boolean;
  folders: string[];
}

/** Overworld, Nether, End first (always shown, even when not generated yet), then any others by id. */
export function dimensionViews(dimensions: readonly WorldDimension[]): DimensionView[] {
  const byId = new Map(dimensions.map((entry) => [entry.id, entry]));
  const known = DIMENSION_ORDER.map((id) => byId.get(id) ?? { id, present: false, folders: [], layout: 'nested' as const });
  const extra = dimensions.filter((entry) => !DIMENSION_ORDER.includes(entry.id)).toSorted((a, b) => a.id.localeCompare(b.id));
  return [...known, ...extra].map((entry) => ({
    id: entry.id,
    label: DIMENSION_LABELS[entry.id] ?? null,
    name: entry.id.replace(/^minecraft:/, ''),
    present: entry.present,
    split: entry.layout === 'split',
    folders: [...entry.folders],
  }));
}

/** True when the software keeps some dimensions in sibling folders (Paper, Spigot…). */
export const splitLayout = (dimensions: readonly WorldDimension[]) => dimensions.some((entry) => entry.present && entry.layout === 'split');

// ------------------------------------------------------------------ datapacks

export type DatapackState = 'enabled' | 'disabled' | 'unknown' | 'missing';

export interface DatapackView {
  id: string;
  name: string;
  kind: WorldDatapack['kind'];
  path: string | null;
  state: DatapackState;
  /** The pack can be switched from here (not missing, not the vanilla base pack). */
  toggleable: boolean;
}

const KIND_ORDER: Record<WorldDatapack['kind'], number> = { builtin: 0, folder: 1, zip: 1, missing: 2 };

export function datapackState(pack: Pick<WorldDatapack, 'kind' | 'enabled'>): DatapackState {
  if (pack.kind === 'missing') return 'missing';
  return pack.enabled === null ? 'unknown' : pack.enabled ? 'enabled' : 'disabled';
}

/** Built-in first, then by name, missing last. Order never depends on on/off, so a toggled row stays put. */
export function datapackViews(packs: readonly WorldDatapack[]): DatapackView[] {
  return packs
    .map((pack): DatapackView => ({
      id: pack.id,
      name: pack.name,
      kind: pack.kind,
      path: pack.path,
      state: datapackState(pack),
      toggleable: pack.kind !== 'missing' && pack.id !== 'vanilla',
    }))
    .toSorted((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.name.localeCompare(b.name));
}

export const datapackKindMessage: Record<WorldDatapack['kind'], MessageId> = {
  builtin: 'server-world.pack-builtin',
  folder: 'server-world.pack-folder',
  zip: 'server-world.pack-zip',
  missing: 'server-world.pack-missing',
};

export const datapackStateMessage: Record<DatapackState, MessageId> = {
  enabled: 'server-world.pack-enabled',
  disabled: 'server-world.pack-disabled',
  unknown: 'server-world.pack-unknown',
  missing: 'server-world.pack-missing',
};

/** Why datapacks can't be switched right now, or null. The agent checks all of this again. */
export function datapackBlocker(snapshot: Pick<ServerSnapshot, 'state' | 'status'> & { capabilities?: CapabilityView }): MessageId | null {
  const view = snapshot.capabilities;
  if (gate(view, 'config.edit') === 'denied' || gate(view, 'console.write') === 'denied') return 'server-world.pack-no-permission';
  if (snapshot.state.phase !== 'online') return 'server-world.pack-offline';
  if (snapshot.status?.state !== 'running' || !snapshot.status.generation) return 'server-world.pack-needs-running';
  return null;
}

/** Live feedback for one toggle: its command was sent, Minecraft ran it, or it failed. */
export type ToggleFeedback = { step: 'sending' } | { step: 'sent' } | { step: 'done' } | { step: 'failed'; message: MessageId };

/** Feedback from the toggle's operation as it advances. Command completion proves submission only. */
export function toggleFeedback(operation: Pick<ServerOperation, 'state' | 'reconciling' | 'outcome'> | undefined): ToggleFeedback {
  if (!operation) return { step: 'sending' };
  if (!isTerminal(operation) || operation.reconciling) return { step: 'sent' };
  if (operation.state === 'succeeded') return { step: 'done' };
  return { step: 'failed', message: operation.outcome === 'stale_generation' ? 'server-world.pack-restarted' : 'server-world.pack-failed' };
}

/** Rejection copy for a toggle the agent refused outright. */
export function toggleRejection(reason: string | null | undefined, code: string): MessageId {
  if (reason === 'datapack_requires_running_game' || code === 'stale_target') return 'server-world.pack-needs-running';
  if (code === 'forbidden') return 'server-world.pack-no-permission';
  return 'server-world.pack-failed';
}

/** One intent per present pack and game generation. Submission does not prove a save. */
export interface PendingDatapack {
  operationId: string | null;
  enabled: boolean;
  generation: string;
  terminal?: Extract<ToggleFeedback, { step: 'done' | 'failed' }>;
  error?: import('./native').ServerCommandError;
}
export function retainDatapackIntent(entry: PendingDatapack, pack: DatapackView | undefined, generation: string | null | undefined, operation: ServerOperation | undefined): boolean {
  if (!pack || entry.generation !== generation) return false;
  return !((entry.terminal ?? (operation ? toggleFeedback(operation) : null))?.step === 'done' && (pack.state === 'enabled' || pack.state === 'disabled') && entry.enabled === (pack.state === 'enabled'));
}

/** Remember completion before the bounded global operation history can evict it. */
export function settleDatapackIntent(entry: PendingDatapack, operation: ServerOperation | undefined): PendingDatapack {
  if (entry.terminal || !operation) return entry;
  const feedback = toggleFeedback(operation);
  return feedback.step === 'done' || feedback.step === 'failed' ? { ...entry, terminal: feedback } : entry;
}
