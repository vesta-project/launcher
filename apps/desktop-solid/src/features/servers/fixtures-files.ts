// Fixture game roots for browser previews and checks: files, logs, trash, uploads and
// `server.properties`, with the agent's semantics (SHA-256 validators that go stale,
// create-never-upserts, trash on delete/overwrite, upload limits, protected admission
// documents, weakening confirmation). Wired into `fixtures.ts` with one spread.
import type {
  ConnectionId, FileChange, FileEntry, LogPage, Page, PropertiesUpdateResult, PropertyValue, ServerCommandError,
  ServerSnapshot, TextFile, TrashEntry, UploadCandidate, UploadProgress,
} from './native';
import type { ServersApi } from './service';
import { TEXT_READ_LIMIT, UPLOAD_CHUNK, WRITE_LIMIT, baseName, isArchivedLog, isProtectedPath, parentPath, splitPath } from './files-model';
import { MAX_CHANGES, REDACTED, parseSourceValue, propertyDef, serializeValue, valueProblem, weakeningKeys } from './properties-model';

export interface FileFixtureContext<T extends { snapshot: ServerSnapshot }> {
  wait: (ms?: number) => Promise<unknown>;
  server: (id: ConnectionId) => T;
  requireOnline: (target: T) => void;
  requireCapability: (target: T, capability: string) => void;
  /** Re-emit the snapshot after it changed (e.g. restart required). */
  publish: (target: T) => void;
}

type FileCommands = Pick<ServersApi,
  | 'filesList' | 'fileReadText' | 'fileWriteText' | 'fileMkdir' | 'fileRename' | 'fileDelete' | 'trashList' | 'trashRestore'
  | 'uploadPick' | 'uploadBegin' | 'uploadChunk' | 'uploadFinish' | 'uploadAbort' | 'fileDownload' | 'logTail' | 'logLines'
  | 'propertiesGet' | 'propertiesUpdate'>;

const fail = (code: ServerCommandError['code']): never => {
  throw { code, retryAfterMs: null } satisfies ServerCommandError;
};

interface FileNode {
  kind: 'file' | 'directory';
  /** Text content, or a seed standing in for binary bytes. */
  content: string;
  binary: boolean;
  size: number;
  modifiedAtMs: number;
  /** Decompressed text of a rotated `.log.gz`. */
  gzText?: string;
}

interface Root {
  nodes: Map<string, FileNode>;
  trash: (TrashEntry & { node: FileNode })[];
  uploads: Map<string, { path: string; candidate: UploadCandidate; offset: number; expectedSha256: string | null }>;
  /** Intent id → canonical payload and result, like the agent's idempotency receipts. */
  intents: Map<string, { payload: string; result: unknown }>;
  confirmations: Map<string, { token: string; payload: string; expiresAtMs: number }>;
}

const bytes = (text: string) => new TextEncoder().encode(text).length;
let hexCounter = 0;
const id = (prefix: string) => `${prefix}-${Date.now().toString(36)}${(++hexCounter).toString(36)}`;

export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

const nodeHash = (path: string, node: FileNode) => sha256(node.binary ? `binary:${path}:${node.size}:${node.content}` : node.content);

const DAY = 86_400_000;

function logText(day: string, count: number, offset = 0): string {
  const events = [
    '[Server thread/INFO]: Starting minecraft server version 1.21.4',
    '[Server thread/INFO]: Loading properties',
    '[Server thread/INFO]: Default game type: SURVIVAL',
    '[Server thread/INFO]: Preparing level "world"',
    '[Server thread/INFO]: Preparing spawn area: 83%',
    '[Server thread/INFO]: Done (6.214s)! For help, type "help"',
    '[Server thread/INFO]: Alex joined the game',
    '[Server thread/INFO]: <Alex> morning all',
    '[Server thread/INFO]: RedstoneRae joined the game',
    '[Server thread/INFO]: RedstoneRae has made the advancement [Hot Stuff]',
    '[Server thread/WARN]: Can\'t keep up! Is the server overloaded? Running 2112ms or 42 ticks behind',
    '[Server thread/INFO]: <Kai_builds> who moved my chest',
    '[Server thread/INFO]: Saving the game (this may take a moment!)',
    '[Server thread/INFO]: Saved the game',
    '[Server thread/INFO]: Kai_builds left the game',
  ];
  const lines: string[] = [];
  for (let index = 0; index < count; index++) {
    const seconds = 8 * 3600 + (index + offset) * 37;
    const time = [Math.floor(seconds / 3600) % 24, Math.floor(seconds / 60) % 60, seconds % 60].map((part) => String(part).padStart(2, '0')).join(':');
    lines.push(`[${day} ${time}] ${events[(index + offset) % events.length]}`);
  }
  return `${lines.join('\n')}\n`;
}

const SERVER_PROPERTIES = `#Minecraft server properties
#Sat Oct 18 09:12:40 UTC 2026
accepts-transfers=false
allow-flight=false
allow-nether=true
broadcast-console-to-ops=true
difficulty=normal
enable-command-block=false
enable-query=false
enable-rcon=false
enable-status=true
enforce-secure-profile=true
enforce-whitelist=true
force-gamemode=false
function-permission-level=2
gamemode=survival
generate-structures=true
hardcore=false
hide-online-players=false
level-name=world
level-seed=-4172144997902289642
level-type=minecraft\\:normal
log-ips=true
max-players=20
max-tick-time=60000
motd=Riverside SMP - season 3, be kind
network-compression-threshold=256
online-mode=true
op-permission-level=4
player-idle-timeout=0
prevent-proxy-connections=false
pvp=true
query.port=25565
rate-limit=0
rcon.password=hunter2-but-longer
rcon.port=25575
server-ip=
server-port=25565
simulation-distance=10
spawn-animals=true
spawn-monsters=true
spawn-npcs=true
spawn-protection=16
sync-chunk-writes=true
view-distance=12
white-list=true
`;

function seedRoot(): Root {
  const now = Date.now();
  const nodes = new Map<string, FileNode>();
  const dir = (path: string, ageDays = 3) => nodes.set(path, { kind: 'directory', content: '', binary: false, size: 0, modifiedAtMs: now - ageDays * DAY });
  const text = (path: string, content: string, ageMs = 2 * DAY) => nodes.set(path, { kind: 'file', content, binary: false, size: bytes(content), modifiedAtMs: now - ageMs });
  const binary = (path: string, size: number, ageMs = 9 * DAY) => nodes.set(path, { kind: 'file', content: path, binary: true, size, modifiedAtMs: now - ageMs });

  for (const path of ['config', 'config/chunky', 'crash-reports', 'libraries', 'logs', 'mods', 'world', 'world/datapacks', 'world/playerdata', 'world/region', 'world_nether', 'world_the_end']) dir(path);
  text('server.properties', SERVER_PROPERTIES, 3 * DAY);
  text('eula.txt', '#By changing the setting below to TRUE you are indicating your agreement to our EULA (https://aka.ms/MinecraftEULA).\n#Tue Sep 30 18:02:11 UTC 2026\neula=true\n', 21 * DAY);
  text('whitelist.json', '[\n  {\n    "uuid": "853c80ef-3c37-49fd-aa49-938b674adae6",\n    "name": "Alex"\n  }\n]\n');
  text('ops.json', '[]\n');
  text('banned-players.json', '[]\n');
  text('banned-ips.json', '[]\n');
  text('usercache.json', '[{"name":"Alex","uuid":"853c80ef-3c37-49fd-aa49-938b674adae6","expiresOn":"2026-11-18 09:12:40 +0000"}]\n', 3600_000);
  text('start.sh', '#!/usr/bin/env sh\nexec java -Xms2G -Xmx6G -jar fabric-server-launch.jar nogui\n', 21 * DAY);
  binary('fabric-server-launch.jar', 182_316, 21 * DAY);
  binary('server.jar', 51_627_403, 21 * DAY);
  binary('mods/fabric-api-0.110.5+1.21.4.jar', 2_311_442);
  binary('mods/lithium-fabric-0.14.3+mc1.21.4.jar', 794_120);
  binary('mods/ferritecore-7.1.1-fabric.jar', 120_884);
  binary('mods/spark-1.10.119-fabric.jar', 3_921_558);
  binary('mods/chunky-fabric-1.4.27.jar', 361_402);
  text('config/lithium.properties', '# This is the configuration file for Lithium.\n#\n# mixin.ai.pathing=false\n', 9 * DAY);
  text('config/ferritecore.mixin.properties', 'replaceNeighborLookup = true\nreplacePropertyMap = true\ncacheMultipartPredicates = true\nmodelSides = true\nuseSmallThreadingDetector = false\n', 9 * DAY);
  text('config/spark.toml', '# spark profiler\n[backgroundProfiler]\nenabled = true\nengine = "async"\ninterval = 10\n\n[viewer]\nurl = "https://spark.lucko.me/"\n', 9 * DAY);
  text('config/c2me.toml', 'version = 3\nclientSideConfig = false\n\n[ioSystem]\ngcFreeChunkSerializer = true\n\n[noTickViewDistance]\nmaxViewDistance = 12\n', 9 * DAY);
  text('config/chunky/config.json', '{\n  "version": 2,\n  "language": "en",\n  "continueOnRestart": false,\n  "forceLoadExistingChunks": false,\n  "silent": false,\n  "updateInterval": 1\n}\n', 9 * DAY);
  text('crash-reports/crash-2026-10-12_18.22.05-server.txt', '---- Minecraft Crash Report ----\n// Shall we play a game?\n\nTime: 2026-10-12 18:22:05\nDescription: Exception ticking world\n\njava.lang.NullPointerException: Cannot invoke "net.minecraft.class_2338.method_10263()" because "pos" is null\n\tat net.minecraft.server.world.ServerWorld.tick(ServerWorld.java:412)\n', 10 * DAY);
  text('logs/latest.log', logText('18Oct2026', 420), 40_000);
  const archived = logText('17Oct2026', 300, 3);
  nodes.set('logs/2026-10-17-1.log.gz', { kind: 'file', content: 'gz:2026-10-17-1', binary: true, size: Math.round(bytes(archived) / 9), modifiedAtMs: now - DAY, gzText: archived });
  const older = logText('16Oct2026', 180, 7);
  nodes.set('logs/2026-10-16-1.log.gz', { kind: 'file', content: 'gz:2026-10-16-1', binary: true, size: Math.round(bytes(older) / 9), modifiedAtMs: now - 2 * DAY, gzText: older });
  binary('world/level.dat', 4_812, 60_000);
  binary('world/level.dat_old', 4_806, 120_000);
  binary('world/session.lock', 3, 3 * DAY);
  for (const region of ['r.0.0', 'r.0.-1', 'r.-1.0', 'r.-1.-1']) binary(`world/region/${region}.mca`, 4_198_400 + region.length * 8192, 300_000);
  binary('world/playerdata/853c80ef-3c37-49fd-aa49-938b674adae6.dat', 2_041, 600_000);
  binary('libraries/placeholder.bin', 1_024, 21 * DAY);
  return { nodes, trash: [], uploads: new Map(), intents: new Map(), confirmations: new Map() };
}

/** Local files the simulated native picker offers, one per pick in turn. */
const PICKS: Omit<UploadCandidate, 'localId'>[] = [
  { name: 'carpet-1.4.161+v241203.jar', size: '3287040' },
  { name: 'welcome-book.txt', size: '2418' },
  { name: 'world-backup-2026-10-01.zip', size: String(40 * 1_048_576) },
];

export function createFileFixtures<T extends { snapshot: ServerSnapshot }>(ctx: FileFixtureContext<T>): FileCommands {
  const roots = new Map<ConnectionId, Root>();
  const locals = new Map<string, UploadCandidate>();
  let picks = 0;

  const open = (connectionId: ConnectionId) => {
    const target = ctx.server(connectionId);
    ctx.requireOnline(target);
    let root = roots.get(connectionId);
    if (!root) { root = seedRoot(); roots.set(connectionId, root); }
    return { target, root };
  };
  /** Generic file routes refuse traversal and admission documents with 400. */
  const checkPath = (path: string, allowRoot = false) => {
    const segments = splitPath(path);
    if (!segments || (!allowRoot && !segments.length) || isProtectedPath(path)) fail('invalid_input');
  };
  const file = (root: Root, path: string) => {
    const node = root.nodes.get(path) ?? fail('not_found');
    if (node.kind !== 'file') fail('invalid_input');
    return node;
  };
  const parentExists = (root: Root, path: string) => {
    const parent = parentPath(path);
    if (parent && root.nodes.get(parent)?.kind !== 'directory') fail('not_found');
  };
  /** Same intent and payload replays the original result; a changed payload is a conflict. */
  const replay = <R,>(root: Root, intentId: string, payload: unknown): R | undefined => {
    const known = root.intents.get(intentId);
    if (!known) return undefined;
    if (known.payload !== JSON.stringify(payload)) fail('conflict');
    return structuredClone(known.result) as R;
  };
  const remember = <R,>(root: Root, intentId: string, payload: unknown, result: R) => {
    root.intents.set(intentId, { payload: JSON.stringify(payload), result: structuredClone(result) });
    return result;
  };
  const toTrash = async (root: Root, path: string, node: FileNode) => {
    const entry = { id: id('trash'), path, sha256: await nodeHash(path, node), size: String(node.size), trashedAtMs: Date.now(), expiresAtMs: Date.now() + 7 * DAY, node };
    root.trash.unshift(entry);
    return entry.id;
  };
  const precondition = async (root: Root, path: string, expectedSha256: string | null) => {
    const current = root.nodes.get(path);
    if (expectedSha256 === null) { if (current) fail('stale_target'); return; }
    if (!current || current.kind !== 'file' || (await nodeHash(path, current)) !== expectedSha256) fail('stale_target');
  };
  const change = async (path: string, node: FileNode, trashId: string | null = null): Promise<FileChange> =>
    ({ sha256: await nodeHash(path, node), size: String(node.size), trashId });

  const page = (text: string, start: number, end: number, size: number): LogPage => ({
    text: text.slice(start, end), binary: false, startByte: String(start), endByte: String(end),
    nextByte: end < size ? String(end) : null, prevByte: start > 0 ? String(start) : null, size: String(size), etag: `"fixture-${size}"`,
  });
  const logSource = (root: Root, path: string, decompress: boolean) => {
    checkPath(path);
    const node = file(root, path);
    if (decompress) {
      if (!isArchivedLog(path) || node.gzText === undefined) fail('invalid_input');
      return node.gzText!;
    }
    return node.binary ? null : node.content;
  };
  const lineStarts = (text: string) => {
    const starts = [0];
    for (let index = 0; index < text.length; index++) if (text[index] === '\n' && index + 1 < text.length) starts.push(index + 1);
    return text.length ? starts : [];
  };
  const binaryPage = (size: number): LogPage => ({ text: '', binary: true, startByte: '0', endByte: '0', nextByte: null, prevByte: null, size: String(size), etag: '"fixture-binary"' });

  const readProperties = async (root: Root) => {
    const node = root.nodes.get('server.properties') ?? fail('not_found');
    const values: Record<string, PropertyValue> = {};
    for (const line of node.content.split('\n')) {
      if (!line.trim() || /^\s*[#!]/.test(line)) continue;
      const match = /^\s*([^=:\s]+)\s*[=:]\s*(.*)$/.exec(line);
      if (!match) continue;
      const [, key, source] = match;
      const def = propertyDef(key);
      const text = source.replace(/\\(.)/g, '$1');
      const typed = def && !def.secret ? parseSourceValue(def, text) : undefined;
      values[key] = def && typed !== undefined && valueProblem(def, typed) === null && !def.readOnly ? typed : REDACTED;
    }
    return { values, sha256: await sha256(node.content), node };
  };

  return {
    async filesList(connectionId, path, cursor): Promise<Page<FileEntry>> {
      await ctx.wait();
      const { target, root } = open(connectionId);
      ctx.requireCapability(target, 'files.list');
      if (!splitPath(path)) fail('invalid_input');
      if (path && root.nodes.get(path)?.kind !== 'directory') fail(root.nodes.has(path) ? 'invalid_input' : 'not_found');
      const prefix = path ? `${path}/` : '';
      const children = [...root.nodes.entries()]
        .filter(([key]) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
        .map(([key, node]): FileEntry => ({ name: baseName(key), kind: node.kind, size: String(node.size), modifiedAtMs: node.modifiedAtMs }))
        .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase(), 'en') || (a.name < b.name ? -1 : 1));
      const start = cursor ? Number(cursor) : 0;
      if (!Number.isInteger(start) || start < 0 || start > children.length) fail('conflict');
      const limit = 100;
      return { items: children.slice(start, start + limit), nextCursor: start + limit < children.length ? String(start + limit) : null };
    },

    async fileReadText(connectionId, path): Promise<TextFile> {
      await ctx.wait();
      const { target, root } = open(connectionId);
      ctx.requireCapability(target, 'files.read');
      checkPath(path);
      const node = file(root, path);
      if (node.binary) return { text: '', sha256: await nodeHash(path, node), size: String(node.size), binary: true, truncated: false };
      if (node.size > TEXT_READ_LIMIT) return { text: node.content.slice(0, 64 * 1024), sha256: null, size: String(node.size), binary: false, truncated: true };
      return { text: node.content, sha256: await nodeHash(path, node), size: String(node.size), binary: false, truncated: false };
    },

    async fileWriteText(connectionId, path, text, expectedSha256, intentId) {
      await ctx.wait();
      const { target, root } = open(connectionId);
      ctx.requireCapability(target, expectedSha256 === null ? 'files.create' : 'files.overwrite');
      checkPath(path);
      const payload = { op: 'write', path, digest: await sha256(text), expectedSha256 };
      const replayed = replay<FileChange>(root, intentId, payload);
      if (replayed) return replayed;
      if (bytes(text) > WRITE_LIMIT) fail('invalid_input');
      parentExists(root, path);
      await precondition(root, path, expectedSha256);
      const previous = root.nodes.get(path);
      const trashId = previous ? await toTrash(root, path, previous) : null;
      const node: FileNode = { kind: 'file', content: text, binary: false, size: bytes(text), modifiedAtMs: Date.now() };
      root.nodes.set(path, node);
      return remember(root, intentId, payload, await change(path, node, trashId));
    },

    async fileMkdir(connectionId, path, intentId) {
      await ctx.wait();
      const { target, root } = open(connectionId);
      ctx.requireCapability(target, 'files.mkdir');
      checkPath(path);
      if (replay(root, intentId, { op: 'mkdir', path }) !== undefined) return;
      parentExists(root, path);
      if (root.nodes.has(path)) fail('stale_target');
      root.nodes.set(path, { kind: 'directory', content: '', binary: false, size: 0, modifiedAtMs: Date.now() });
      remember(root, intentId, { op: 'mkdir', path }, null);
    },

    async fileRename(connectionId, from, to, expectedSha256, intentId) {
      await ctx.wait();
      const { target, root } = open(connectionId);
      ctx.requireCapability(target, 'files.rename');
      checkPath(from); checkPath(to);
      const payload = { op: 'rename', from, to, expectedSha256 };
      const replayed = replay<FileChange>(root, intentId, payload);
      if (replayed) return replayed;
      const node = file(root, from);
      if (expectedSha256 !== null && (await nodeHash(from, node)) !== expectedSha256) fail('stale_target');
      parentExists(root, to);
      if (root.nodes.has(to)) fail('stale_target');
      root.nodes.delete(from);
      root.nodes.set(to, { ...node, modifiedAtMs: Date.now() });
      return remember(root, intentId, payload, await change(to, root.nodes.get(to)!));
    },

    async fileDelete(connectionId, path, expectedSha256, intentId) {
      await ctx.wait();
      const { target, root } = open(connectionId);
      ctx.requireCapability(target, 'files.delete');
      checkPath(path);
      const payload = { op: 'delete', path, expectedSha256 };
      const replayed = replay<{ trashId: string }>(root, intentId, payload);
      if (replayed) return replayed;
      const node = file(root, path);
      if (expectedSha256 !== null && (await nodeHash(path, node)) !== expectedSha256) fail('stale_target');
      root.nodes.delete(path);
      return remember(root, intentId, payload, { trashId: await toTrash(root, path, node) });
    },

    async trashList(connectionId, cursor): Promise<Page<TrashEntry>> {
      await ctx.wait();
      const { target, root } = open(connectionId);
      ctx.requireCapability(target, 'files.read');
      const start = cursor ? Number(cursor) : 0;
      const items = root.trash.filter((entry) => entry.expiresAtMs > Date.now()).slice(start, start + 50).map(({ node: _, ...entry }) => entry);
      return { items, nextCursor: start + 50 < root.trash.length ? String(start + 50) : null };
    },

    async trashRestore(connectionId, trashId, intentId) {
      await ctx.wait();
      const { target, root } = open(connectionId);
      ctx.requireCapability(target, 'files.read');
      ctx.requireCapability(target, 'files.create');
      const payload = { op: 'restore', trashId };
      const replayed = replay<FileChange>(root, intentId, payload);
      if (replayed) return replayed;
      const index = root.trash.findIndex((entry) => entry.id === trashId);
      if (index < 0) fail('not_found');
      const entry = root.trash[index];
      if (root.nodes.has(entry.path)) fail('stale_target');
      parentExists(root, entry.path);
      root.trash.splice(index, 1);
      root.nodes.set(entry.path, entry.node);
      return remember(root, intentId, payload, await change(entry.path, entry.node));
    },

    async uploadPick() {
      await ctx.wait(120);
      const pick = PICKS[picks++ % PICKS.length];
      const candidate = { ...pick, localId: id('local') };
      locals.set(candidate.localId, candidate);
      return [candidate];
    },

    async uploadBegin(connectionId, localId, path, expectedSha256, intentId): Promise<UploadProgress> {
      await ctx.wait();
      const { target, root } = open(connectionId);
      ctx.requireCapability(target, expectedSha256 === null ? 'files.create' : 'files.overwrite');
      checkPath(path);
      const candidate = locals.get(localId) ?? fail('not_found');
      const payload = { op: 'upload', localId, path, expectedSha256 };
      const replayed = replay<UploadProgress>(root, intentId, payload);
      if (replayed) return replayed;
      if (Number(candidate.size) > WRITE_LIMIT) fail('invalid_input');
      parentExists(root, path);
      await precondition(root, path, expectedSha256);
      const uploadId = id('upload');
      root.uploads.set(uploadId, { path, candidate, offset: 0, expectedSha256 });
      return remember(root, intentId, payload, { uploadId, offset: '0', totalSize: candidate.size });
    },

    async uploadChunk(connectionId, uploadId) {
      await ctx.wait(140);
      const { root } = open(connectionId);
      const upload = root.uploads.get(uploadId) ?? fail('not_found');
      const total = Number(upload.candidate.size);
      upload.offset = Math.min(total, upload.offset + UPLOAD_CHUNK);
      return { uploadId, offset: String(upload.offset), totalSize: upload.candidate.size };
    },

    async uploadFinish(connectionId, uploadId) {
      await ctx.wait();
      const { target, root } = open(connectionId);
      const upload = root.uploads.get(uploadId) ?? fail('not_found');
      ctx.requireCapability(target, upload.expectedSha256 === null ? 'files.create' : 'files.overwrite');
      if (upload.offset !== Number(upload.candidate.size)) fail('invalid_input');
      await precondition(root, upload.path, upload.expectedSha256);
      root.uploads.delete(uploadId);
      const previous = root.nodes.get(upload.path);
      const trashId = previous ? await toTrash(root, upload.path, previous) : null;
      const text = upload.candidate.name.endsWith('.txt');
      const content = text ? 'Welcome to Riverside!\nBe kind, build big, and ask before you borrow.\n' : `upload:${upload.candidate.localId}`;
      const node: FileNode = { kind: 'file', content, binary: !text, size: text ? bytes(content) : Number(upload.candidate.size), modifiedAtMs: Date.now() };
      root.nodes.set(upload.path, node);
      return change(upload.path, node, trashId);
    },

    async uploadAbort(connectionId, uploadId) {
      await ctx.wait(40);
      open(connectionId).root.uploads.delete(uploadId);
    },

    async fileDownload(connectionId, path, decompress) {
      await ctx.wait(400);
      const { target, root } = open(connectionId);
      ctx.requireCapability(target, 'files.read');
      checkPath(path);
      const node = file(root, path);
      if (decompress && node.gzText === undefined) fail('invalid_input');
      return { kind: 'saved', size: String(decompress ? bytes(node.gzText!) : node.size) };
    },

    async logTail(connectionId, path, lines, decompress) {
      await ctx.wait();
      const { target, root } = open(connectionId);
      ctx.requireCapability(target, 'files.read');
      if (!Number.isInteger(lines) || lines < 1 || lines > 1000) fail('invalid_input');
      const text = logSource(root, path, decompress);
      if (text === null) return binaryPage(file(root, path).size);
      const starts = lineStarts(text);
      const start = starts.length > lines ? starts[starts.length - lines] : 0;
      return page(text, start, text.length, text.length);
    },

    async logLines(connectionId, path, fromByte, limit, direction, decompress) {
      await ctx.wait();
      const { target, root } = open(connectionId);
      ctx.requireCapability(target, 'files.read');
      if (!Number.isInteger(limit) || limit < 1 || limit > 1000) fail('invalid_input');
      const text = logSource(root, path, decompress);
      if (text === null) return binaryPage(file(root, path).size);
      const starts = lineStarts(text);
      const size = text.length;
      const from = fromByte === null ? (direction === 'forward' ? 0 : size) : Number(fromByte);
      const index = from === size ? starts.length : starts.indexOf(from);
      if (!Number.isInteger(from) || index < 0) fail('invalid_input');
      if (direction === 'backward') {
        const start = starts[Math.max(0, index - limit)] ?? 0;
        return page(text, start, from, size);
      }
      const end = starts[index + limit] ?? size;
      return page(text, from, end, size);
    },

    async propertiesGet(connectionId) {
      await ctx.wait();
      const { target, root } = open(connectionId);
      ctx.requireCapability(target, 'config.view');
      ctx.requireCapability(target, 'files.read');
      const { values, sha256: digest } = await readProperties(root);
      return { values, sha256: digest };
    },

    async propertiesUpdate(connectionId, changes, expectedSha256, confirmationToken, intentId): Promise<PropertiesUpdateResult> {
      await ctx.wait();
      const { target, root } = open(connectionId);
      ctx.requireCapability(target, 'config.edit');
      ctx.requireCapability(target, 'files.read');
      ctx.requireCapability(target, 'files.overwrite');
      const payload = JSON.stringify({ changes, expectedSha256 });
      const done = root.intents.get(intentId);
      if (done) {
        if (done.payload !== payload) fail('conflict');
        return structuredClone(done.result) as PropertiesUpdateResult;
      }
      const keys = Object.keys(changes);
      if (!keys.length || keys.length > MAX_CHANGES) fail('invalid_input');
      for (const key of keys) {
        const def = propertyDef(key);
        if (!def || def.readOnly || valueProblem(def, changes[key]) !== null) fail('invalid_input');
      }
      const current = await readProperties(root);
      if (current.sha256 !== expectedSha256) fail('stale_target');
      const typed = Object.fromEntries(Object.entries(current.values).filter(([, value]) => value !== REDACTED));
      if (weakeningKeys(typed, changes).length) {
        const pending = root.confirmations.get(intentId);
        if (!confirmationToken) {
          // Repreparation supersedes an earlier receipt for the same intent.
          const token = id('confirm');
          const expiresAtMs = Date.now() + 120_000;
          root.confirmations.set(intentId, { token, payload, expiresAtMs });
          return { kind: 'awaitingConfirmation', operationId: id('op'), confirmationToken: token, expiresAtMs };
        }
        if (!pending || pending.token !== confirmationToken || pending.payload !== payload || pending.expiresAtMs < Date.now()) {
          root.confirmations.delete(intentId);
          fail('confirmation_expired');
        }
        root.confirmations.delete(intentId);
      }
      // Untouched lines keep comments, order and unknown keys; changed keys are rewritten in place.
      const remaining = new Set(keys);
      const lines = current.node.content.replace(/\n$/, '').split('\n').map((line) => {
        const key = /^\s*([^=:\s#!]+)\s*[=:]/.exec(line)?.[1];
        if (!key || !remaining.has(key)) return line;
        remaining.delete(key);
        return `${key}=${serializeValue(changes[key])}`;
      });
      for (const key of remaining) lines.push(`${key}=${serializeValue(changes[key])}`);
      const content = `${lines.join('\n')}\n`;
      root.nodes.set('server.properties', { ...current.node, content, size: bytes(content), modifiedAtMs: Date.now() });
      target.snapshot.restartRequired = true;
      ctx.publish(target);
      return remember(root, intentId, JSON.parse(payload), { kind: 'applied', sha256: await sha256(content), restartNeeded: true } as PropertiesUpdateResult);
    },
  };
}
