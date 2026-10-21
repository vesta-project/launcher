// Schema-driven `server.properties` editing. The schema mirrors the agent's typed key
// set (management API contract §2.2 "Properties schema and confirmation"); the agent
// rejects unknown keys, wrong types and out-of-range values, and asks for confirmation
// of weakening changes. The UI applies the same rules so it can explain them up front.
import type { MessageId } from '../../localization/messages';
import type { PropertyValue } from './native';

export const REDACTED = '[redacted]';
/** The agent accepts 1–32 changed keys per PATCH. */
export const MAX_CHANGES = 32;

export type PropertyGroup = 'gameplay' | 'world' | 'players' | 'network' | 'advanced';

export type PropertyDef = {
  key: string;
  group: PropertyGroup;
  label: MessageId;
  /** Not accepted by the agent's PATCH; shown read-only when the agent reports a typed value. */
  readOnly?: boolean;
  /** Write-only: always reported as redacted; an empty draft leaves it unchanged. */
  secret?: boolean;
} & (
  | { type: 'boolean'; default: boolean }
  | { type: 'integer'; min: number; max: number; default: number }
  | { type: 'enum'; options: readonly string[]; default: string }
  | { type: 'string'; maxBytes: number; minBytes?: number; default: string }
);

const bool = (key: string, group: PropertyGroup, label: MessageId, fallback: boolean): PropertyDef => ({ key, group, label, type: 'boolean', default: fallback });
const int = (key: string, group: PropertyGroup, label: MessageId, min: number, max: number, fallback: number): PropertyDef => ({ key, group, label, type: 'integer', min, max, default: fallback });

export const propertySchema: readonly PropertyDef[] = [
  { key: 'difficulty', group: 'gameplay', label: 'server-settings.key.difficulty', type: 'enum', options: ['peaceful', 'easy', 'normal', 'hard'], default: 'easy' },
  { key: 'gamemode', group: 'gameplay', label: 'server-settings.key.gamemode', type: 'enum', options: ['survival', 'creative', 'adventure', 'spectator'], default: 'survival' },
  bool('force-gamemode', 'gameplay', 'server-settings.key.force-gamemode', false),
  bool('hardcore', 'gameplay', 'server-settings.key.hardcore', false),
  bool('pvp', 'gameplay', 'server-settings.key.pvp', true),
  bool('allow-flight', 'gameplay', 'server-settings.key.allow-flight', false),
  bool('spawn-monsters', 'gameplay', 'server-settings.key.spawn-monsters', true),
  bool('spawn-animals', 'gameplay', 'server-settings.key.spawn-animals', true),
  bool('spawn-npcs', 'gameplay', 'server-settings.key.spawn-npcs', true),
  bool('enable-command-block', 'gameplay', 'server-settings.key.enable-command-block', false),

  { key: 'level-type', group: 'world', label: 'server-settings.key.level-type', type: 'enum', options: ['minecraft:normal', 'minecraft:flat', 'minecraft:large_biomes', 'minecraft:amplified', 'minecraft:single_biome_surface'], default: 'minecraft:normal', readOnly: true },
  bool('allow-nether', 'world', 'server-settings.key.allow-nether', true),
  int('view-distance', 'world', 'server-settings.key.view-distance', 2, 32, 10),
  int('simulation-distance', 'world', 'server-settings.key.simulation-distance', 2, 32, 10),
  int('spawn-protection', 'world', 'server-settings.key.spawn-protection', 0, 1024, 16),

  int('max-players', 'players', 'server-settings.key.max-players', 1, 1000, 20),
  bool('white-list', 'players', 'server-settings.key.white-list', false),
  bool('enforce-whitelist', 'players', 'server-settings.key.enforce-whitelist', false),
  int('op-permission-level', 'players', 'server-settings.key.op-permission-level', 1, 4, 4),
  int('function-permission-level', 'players', 'server-settings.key.function-permission-level', 1, 4, 2),
  int('player-idle-timeout', 'players', 'server-settings.key.player-idle-timeout', 0, 10080, 0),
  bool('hide-online-players', 'players', 'server-settings.key.hide-online-players', false),

  { key: 'motd', group: 'network', label: 'server-settings.key.motd', type: 'string', maxBytes: 256, default: 'A Minecraft Server' },
  int('server-port', 'network', 'server-settings.key.server-port', 1, 65535, 25565),
  bool('online-mode', 'network', 'server-settings.key.online-mode', true),
  bool('enforce-secure-profile', 'network', 'server-settings.key.enforce-secure-profile', true),
  bool('prevent-proxy-connections', 'network', 'server-settings.key.prevent-proxy-connections', false),
  bool('enable-status', 'network', 'server-settings.key.enable-status', true),
  bool('log-ips', 'network', 'server-settings.key.log-ips', true),

  bool('enable-rcon', 'advanced', 'server-settings.key.enable-rcon', false),
  int('rcon.port', 'advanced', 'server-settings.key.rcon-port', 1, 65535, 25575),
  { key: 'rcon.password', group: 'advanced', label: 'server-settings.key.rcon-password', type: 'string', minBytes: 1, maxBytes: 128, default: '', secret: true },
  bool('enable-query', 'advanced', 'server-settings.key.enable-query', false),
  int('query.port', 'advanced', 'server-settings.key.query-port', 1, 65535, 25565),
];

export const propertyGroups: readonly { id: PropertyGroup; label: MessageId; icon: string }[] = [
  { id: 'gameplay', label: 'server-settings.group.gameplay', icon: 'icons/actions/play' },
  { id: 'world', label: 'server-settings.group.world', icon: 'icons/content/globe' },
  { id: 'players', label: 'server-settings.group.players', icon: 'icons/content/chat' },
  { id: 'network', label: 'server-settings.group.network', icon: 'icons/security/network' },
  { id: 'advanced', label: 'server-settings.group.advanced', icon: 'icons/content/code' },
];

const byKey = new Map(propertySchema.map((def) => [def.key, def]));
export const propertyDef = (key: string) => byKey.get(key);

function typedOk(def: PropertyDef, value: unknown): value is PropertyValue {
  switch (def.type) {
    case 'boolean': return typeof value === 'boolean';
    case 'integer': return typeof value === 'number' && Number.isInteger(value) && value >= def.min && value <= def.max;
    case 'enum': return typeof value === 'string' && def.options.includes(value);
    case 'string': return typeof value === 'string' && value !== REDACTED;
  }
}

export interface ParsedProperties {
  /** Schema keys the agent reported with a valid typed value. */
  typed: Record<string, PropertyValue>;
  /** Present secrets (always redacted by the agent). */
  secrets: string[];
  /** Schema keys present with a redacted or malformed value; edits start from the default. */
  malformed: string[];
  /** Keys outside the schema, read-only (the agent refuses changes to them). */
  raw: { key: string; value: string }[];
}

/** Splits the agent's `values` into typed editable entries and read-only raw entries. */
export function parseProperties(values: Record<string, unknown>): ParsedProperties {
  const typed: Record<string, PropertyValue> = {};
  const secrets: string[] = [];
  const malformed: string[] = [];
  const raw: { key: string; value: string }[] = [];
  for (const [key, value] of Object.entries(values)) {
    const def = byKey.get(key);
    if (def?.secret) secrets.push(key);
    else if (def && typedOk(def, value)) typed[key] = value;
    else if (def) malformed.push(key);
    else raw.push({ key, value: String(value) });
  }
  raw.sort((a, b) => a.key.localeCompare(b.key));
  return { typed, secrets, malformed, raw };
}

/** Effective value: the reported one, else the vanilla default the game would use. */
export const effectiveValue = (def: PropertyDef, typed: Record<string, PropertyValue>): PropertyValue =>
  def.key in typed ? typed[def.key] : def.default;

const asciiBytes = (value: string) => new TextEncoder().encode(value).length;

/** A localized problem with one draft value, or null. */
export function valueProblem(def: PropertyDef, value: PropertyValue): MessageId | null {
  switch (def.type) {
    case 'boolean': return typeof value === 'boolean' ? null : 'server-settings.invalid';
    case 'integer':
      if (typeof value !== 'number' || !Number.isInteger(value)) return 'server-settings.invalid';
      return value < def.min || value > def.max ? 'server-settings.out-of-range' : null;
    case 'enum': return typeof value === 'string' && def.options.includes(value) ? null : 'server-settings.invalid';
    case 'string': {
      if (typeof value !== 'string') return 'server-settings.invalid';
      if (!/^[\x20-\x7e]*$/.test(value)) return 'server-settings.ascii-only';
      if (/[/\\]/.test(value)) return 'server-settings.no-slashes';
      const bytes = asciiBytes(value);
      if (bytes > def.maxBytes || bytes < (def.minBytes ?? 0)) return 'server-settings.too-long';
      return null;
    }
  }
}

/**
 * The PATCH `changes`: only editable schema keys whose draft differs from the base.
 * An empty secret draft means "leave unchanged".
 */
export function diffChanges(base: Record<string, PropertyValue>, draft: Record<string, PropertyValue>): Record<string, PropertyValue> {
  const changes: Record<string, PropertyValue> = {};
  for (const def of propertySchema) {
    if (def.readOnly || !(def.key in draft)) continue;
    const next = draft[def.key];
    if (def.secret) { if (next !== '') changes[def.key] = next; continue; }
    if (next !== effectiveValue(def, base)) changes[def.key] = next;
  }
  return changes;
}

/** Parses a value as typed in `server.properties` source text (`true`, `20`, `normal`…). */
export function parseSourceValue(def: PropertyDef, text: string): PropertyValue | undefined {
  switch (def.type) {
    case 'boolean': return text === 'true' ? true : text === 'false' ? false : undefined;
    case 'integer': return /^-?\d+$/.test(text) ? Number(text) : undefined;
    default: return text;
  }
}

/** Serializes a typed value back to properties source text. */
export const serializeValue = (value: PropertyValue) => (typeof value === 'string' ? value.replace(/\\/g, '\\\\') : String(value));

/** Keys among `changes` that the agent classifies as security weakening, relative to `base`. */
export function weakeningKeys(base: Record<string, PropertyValue>, changes: Record<string, PropertyValue>): string[] {
  const current = (key: string) => {
    const def = byKey.get(key);
    return def ? effectiveValue(def, base) : undefined;
  };
  const keys: string[] = [];
  for (const [key, next] of Object.entries(changes)) {
    const before = current(key);
    switch (key) {
      case 'online-mode':
      case 'enforce-secure-profile':
        if (next === false && before !== false) keys.push(key); break;
      case 'white-list':
      case 'enforce-whitelist':
      case 'prevent-proxy-connections':
        if (next === false && before === true) keys.push(key); break;
      case 'enable-rcon':
      case 'enable-query':
      case 'enable-command-block':
      case 'allow-flight':
        if (next === true && before !== true) keys.push(key); break;
      case 'op-permission-level':
      case 'function-permission-level':
        if (typeof next === 'number' && typeof before === 'number' && next > before) keys.push(key); break;
      case 'spawn-protection':
        if (typeof next === 'number' && typeof before === 'number' && next < before) keys.push(key); break;
    }
  }
  return keys;
}
