// Schema-driven `server.properties` editing. The schema mirrors the agent's typed key
// set (management API contract §2.2 "Properties schema and confirmation"); the agent
// rejects unknown keys, wrong types and out-of-range values, and asks for confirmation
// of weakening changes. The UI applies the same rules so it can explain them up front.
import type { MessageId } from '../../localization/messages';
import type { PropertyValue } from './native';

export const REDACTED = '[redacted]';
/** The agent accepts 1–32 changed keys per PATCH. */
export const MAX_CHANGES = 32;

/**
 * Display groups. Essentials are what most owners change and stay open; the rest are
 * collapsed until opened or searched.
 */
export type PropertyGroup = 'essentials' | 'world' | 'network' | 'advanced';

export type PropertyDef = {
  key: string;
  group: PropertyGroup;
  label: MessageId;
  /** One plain-language line about what the setting does. */
  help: MessageId;
  /** Not accepted by the agent's PATCH; shown read-only when the agent reports a typed value. */
  readOnly?: boolean;
  /** Write-only: always reported as redacted; an empty draft leaves it unchanged. */
  secret?: boolean;
  /** Only meaningful while this boolean key is on; shown inset under it. */
  parent?: string;
} & (
  | { type: 'boolean'; default: boolean }
  | { type: 'integer'; min: number; max: number; default: number }
  | { type: 'enum'; options: readonly string[]; default: string }
  | { type: 'string'; maxBytes: number; minBytes?: number; default: string }
);

const slug = (key: string) => key.replace(/\./g, '-');
const label = (key: string) => `server-settings.key.${slug(key)}` as MessageId;
const help = (key: string) => `server-settings.help.${slug(key)}` as MessageId;
const bool = (key: string, group: PropertyGroup, fallback: boolean, extra: Partial<PropertyDef> = {}): PropertyDef =>
  ({ key, group, label: label(key), help: help(key), type: 'boolean', default: fallback, ...extra }) as PropertyDef;
const int = (key: string, group: PropertyGroup, min: number, max: number, fallback: number, extra: Partial<PropertyDef> = {}): PropertyDef =>
  ({ key, group, label: label(key), help: help(key), type: 'integer', min, max, default: fallback, ...extra }) as PropertyDef;
const choice = (key: string, group: PropertyGroup, options: readonly string[], fallback: string, extra: Partial<PropertyDef> = {}): PropertyDef =>
  ({ key, group, label: label(key), help: help(key), type: 'enum', options, default: fallback, ...extra }) as PropertyDef;

/** `motd` is edited in its own panel; the rest render as rows in schema order. */
export const MOTD_KEY = 'motd';

export const propertySchema: readonly PropertyDef[] = [
  choice('difficulty', 'essentials', ['peaceful', 'easy', 'normal', 'hard'], 'easy'),
  choice('gamemode', 'essentials', ['survival', 'creative', 'adventure', 'spectator'], 'survival'),
  bool('pvp', 'essentials', true),
  int('max-players', 'essentials', 1, 1000, 20),
  bool('white-list', 'essentials', false),
  bool('enforce-whitelist', 'essentials', false, { parent: 'white-list' }),
  int('view-distance', 'essentials', 2, 32, 10),
  int('spawn-protection', 'essentials', 0, 1024, 16),

  bool('hardcore', 'world', false),
  bool('force-gamemode', 'world', false),
  bool('allow-flight', 'world', false),
  bool('allow-nether', 'world', true),
  bool('spawn-monsters', 'world', true),
  bool('spawn-animals', 'world', true),
  bool('spawn-npcs', 'world', true),
  int('simulation-distance', 'world', 2, 32, 10),
  choice('level-type', 'world', ['minecraft:normal', 'minecraft:flat', 'minecraft:large_biomes', 'minecraft:amplified', 'minecraft:single_biome_surface'], 'minecraft:normal', { readOnly: true }),

  { key: MOTD_KEY, group: 'network', label: label(MOTD_KEY), help: help(MOTD_KEY), type: 'string', maxBytes: 1024, default: 'A Minecraft Server' },
  int('server-port', 'network', 1, 65535, 25565),
  bool('online-mode', 'network', true),
  bool('enforce-secure-profile', 'network', true),
  bool('prevent-proxy-connections', 'network', false),
  bool('enable-status', 'network', true),
  bool('hide-online-players', 'network', false),
  bool('log-ips', 'network', true),
  int('player-idle-timeout', 'network', 0, 10080, 0),

  bool('enable-command-block', 'advanced', false),
  int('op-permission-level', 'advanced', 1, 4, 4),
  int('function-permission-level', 'advanced', 1, 4, 2),
  bool('enable-rcon', 'advanced', false),
  int('rcon.port', 'advanced', 1, 65535, 25575, { parent: 'enable-rcon' }),
  { key: 'rcon.password', group: 'advanced', label: label('rcon.password'), help: help('rcon.password'), type: 'string', minBytes: 1, maxBytes: 128, default: '', secret: true, parent: 'enable-rcon' },
  bool('enable-query', 'advanced', false),
  int('query.port', 'advanced', 1, 65535, 25565, { parent: 'enable-query' }),
];

export const propertyGroups: readonly { id: PropertyGroup; label: MessageId; collapsible: boolean }[] = [
  { id: 'essentials', label: 'server-settings.group.essentials', collapsible: false },
  { id: 'world', label: 'server-settings.group.world', collapsible: true },
  { id: 'network', label: 'server-settings.group.network', collapsible: true },
  { id: 'advanced', label: 'server-settings.group.advanced', collapsible: true },
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
      if (def.key === MOTD_KEY) {
        if (/[/\\]/.test(value)) return 'server-settings.no-slashes';
        if (asciiBytes(value) > def.maxBytes || value.length > 512) return 'server-settings.too-long';
        const hasControl = Array.from(value).some((char) => {
          const code = char.charCodeAt(0);
          return (code < 32 && code !== 10) || (code >= 127 && code <= 159);
        });
        if (value.split('\n').length > 2 || hasControl) return 'server-settings.invalid';
        // The agent accepts Minecraft formatting codes, not arbitrary section escapes.
        if (/§(?![0-9a-fk-or])/i.test(value)) return 'server-settings.invalid';
        return null;
      }
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

/**
 * Rows a group shows: everything but the MOTD (its own panel) and read-only keys the
 * server didn't report (those are listed once, quietly, instead of as dead rows).
 */
export function groupRows(group: PropertyGroup, parsed: Pick<ParsedProperties, 'typed'>): PropertyDef[] {
  return propertySchema.filter((def) => def.group === group && def.key !== MOTD_KEY && !(def.readOnly && !(def.key in parsed.typed)));
}

/** Read-only keys the server didn't report, so the page can say so once. */
export const unreportedKeys = (parsed: Pick<ParsedProperties, 'typed'>) =>
  propertySchema.filter((def) => def.readOnly && !(def.key in parsed.typed)).map((def) => def.key);

/** What a collapsed group's header summarises: rows, unsaved edits, and values away from the default. */
export function groupSummary(defs: readonly PropertyDef[], typed: Record<string, PropertyValue>, changes: Record<string, PropertyValue>) {
  let edited = 0;
  let customized = 0;
  for (const def of defs) {
    if (def.key in changes) edited++;
    else if (!def.secret && def.key in typed && typed[def.key] !== def.default) customized++;
  }
  return { count: defs.length, edited, customized };
}

/** Lowercased text a search matches: label, help and the file key (also with separators as spaces). */
export const propertySearchText = (def: PropertyDef, label: string, help: string) =>
  `${label} ${help} ${def.key} ${def.key.replace(/[.-]/g, ' ')}`.toLowerCase();

/** Every query word must appear somewhere in the text. */
export function matchesSearch(text: string, query: string) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return words.every((word) => text.toLowerCase().includes(word));
}

/** True when the query matched only through the raw key, so the row should show it. */
export const matchedByKey = (def: PropertyDef, label: string, help: string, query: string) =>
  !!query.trim() && !matchesSearch(`${label} ${help}`, query) && matchesSearch(propertySearchText(def, '', ''), query);
