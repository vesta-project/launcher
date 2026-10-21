import { describe, expect, test } from 'bun:test';
import { createFixtureServers } from '../src/features/servers/fixtures';
import {
  childPath, decodeRouteSegments, encodeRouteSegments, fileActions, folderActions, isExecutableContent, isSafeSegment,
  nameProblem, openMode, protectedHome, saveTextFile, sortEntries, splitPath, uploadProblem, WRITE_LIMIT,
} from '../src/features/servers/files-model';
import {
  diffChanges, effectiveValue, parseProperties, propertyDef, valueProblem, weakeningKeys,
} from '../src/features/servers/properties-model';
import { capabilitiesForRole } from '../src/features/servers/capabilities';

const api = () => createFixtureServers({ latencyMs: 0 });
const ID = 'fixture-survival';
let intent = 0;
const next = () => `intent-${++intent}`;

describe('[paths] game-root segments', () => {
  test('route segments are encoded one by one and round-trip', () => {
    const path = 'config/my mod#1/a%b.toml';
    const encoded = encodeRouteSegments(path);
    expect(encoded).toEqual(['config', 'my%20mod%231', 'a%25b.toml']);
    expect(decodeRouteSegments(encoded)).toBe(path);
    expect(decodeRouteSegments([])).toBe('');
    expect(decodeRouteSegments([undefined])).toBe('');
  });
  test('dot segments, encoded separators and bad escapes never escape the root', () => {
    for (const segments of [['..'], ['config', '..', '..'], ['%2E%2E'], ['a%2Fb'], ['a%5Cb'], ['%E0%A4%A'], ['C%3A'], ['.']]) {
      expect(decodeRouteSegments(segments)).toBeNull();
    }
    expect(splitPath('../etc/passwd')).toBeNull();
    expect(splitPath('/abs')).toBeNull();
    expect(splitPath('a//b')).toBeNull();
  });
  test('joins accept one safe segment only', () => {
    expect(childPath('', 'mods')).toBe('mods');
    expect(childPath('config', ' spark.toml ')).toBe('config/spark.toml');
    for (const name of ['..', 'a/b', 'a\\b', 'CON', 'nul.txt', 'trailing.', 'é.txt', '', 'x:y']) {
      expect(childPath('config', name)).toBeNull();
    }
    expect(isSafeSegment('fabric-api-0.110.5+1.21.4.jar')).toBe(true);
  });
  test('names are validated against siblings and admission documents', () => {
    const siblings = [{ name: 'Spark.toml', kind: 'file', size: '1', modifiedAtMs: null }];
    expect(nameProblem('spark.toml', siblings)).toBe('server-files.name.exists');
    expect(nameProblem('Spark.toml', siblings, 'Spark.toml')).toBeNull();
    expect(nameProblem('server.properties', [])).toBe('server-files.protected-name');
    expect(protectedHome('server.properties')).toBe('settings');
    expect(protectedHome('world/OPS.JSON')).toBe('players');
  });
  test('folders sort first, then case-insensitive names', () => {
    const entries = [
      { name: 'b.txt', kind: 'file' }, { name: 'Zeta', kind: 'directory' }, { name: 'A.txt', kind: 'file' }, { name: 'alpha', kind: 'directory' },
    ].map((entry) => ({ ...entry, size: '0', modifiedAtMs: null }));
    expect(sortEntries(entries).map((entry) => entry.name)).toEqual(['alpha', 'Zeta', 'A.txt', 'b.txt']);
  });
});

describe('[files] fixture semantics', () => {
  test('listing pages a directory; protected documents are refused by generic reads', async () => {
    const servers = api();
    const root = await servers.filesList(ID, '', null);
    expect(root.items.map((entry) => entry.name)).toEqual(expect.arrayContaining(['mods', 'logs', 'server.properties', 'eula.txt']));
    await expect(servers.filesList(ID, '../outside', null)).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(servers.fileReadText(ID, 'server.properties')).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(servers.fileReadText(ID, 'nope.txt')).rejects.toMatchObject({ code: 'not_found' });
    const jar = await servers.fileReadText(ID, 'mods/spark-1.10.119-fabric.jar');
    expect(jar.binary).toBe(true);
  });

  test('a stale validator never overwrites: conflict returns the server copy, the fresh validator overwrites', async () => {
    const servers = api();
    const mine = await servers.fileReadText(ID, 'config/spark.toml');
    // Someone else saves first.
    const theirs = await servers.fileWriteText(ID, 'config/spark.toml', `${mine.text}# theirs\n`, mine.sha256, next());
    expect(theirs.sha256).not.toBe(mine.sha256);
    expect(theirs.trashId).toBeTruthy();
    const conflict = await saveTextFile(servers, ID, 'config/spark.toml', `${mine.text}# mine\n`, mine.sha256, next());
    expect(conflict.kind).toBe('conflict');
    expect(conflict.server.text).toContain('# theirs');
    expect(conflict.server.sha256).toBe(theirs.sha256);
    const saved = await saveTextFile(servers, ID, 'config/spark.toml', `${mine.text}# mine\n`, conflict.server.sha256, next());
    expect(saved.kind).toBe('saved');
    expect((await servers.fileReadText(ID, 'config/spark.toml')).text).toContain('# mine');
  });

  test('create never upserts and a deleted file reports gone', async () => {
    const servers = api();
    await expect(servers.fileWriteText(ID, 'eula.txt', 'x', null, next())).rejects.toMatchObject({ code: 'stale_target' });
    const read = await servers.fileReadText(ID, 'eula.txt');
    await servers.fileDelete(ID, 'eula.txt', read.sha256, next());
    expect((await saveTextFile(servers, ID, 'eula.txt', 'eula=true\n', read.sha256, next())).kind).toBe('gone');
  });

  test('delete moves to trash; restore puts it back and never replaces', async () => {
    const servers = api();
    const before = await servers.fileReadText(ID, 'config/c2me.toml');
    const { trashId } = await servers.fileDelete(ID, 'config/c2me.toml', before.sha256, next());
    await expect(servers.fileReadText(ID, 'config/c2me.toml')).rejects.toMatchObject({ code: 'not_found' });
    const trash = await servers.trashList(ID, null);
    expect(trash.items.find((entry) => entry.id === trashId)).toMatchObject({ path: 'config/c2me.toml', sha256: before.sha256 });
    // A new file at the original path blocks restore.
    await servers.fileWriteText(ID, 'config/c2me.toml', 'new\n', null, next());
    await expect(servers.trashRestore(ID, trashId, next())).rejects.toMatchObject({ code: 'stale_target' });
    const fresh = await servers.fileReadText(ID, 'config/c2me.toml');
    await servers.fileDelete(ID, 'config/c2me.toml', fresh.sha256, next());
    const restored = await servers.trashRestore(ID, trashId, next());
    expect(restored.sha256).toBe(before.sha256);
    expect((await servers.fileReadText(ID, 'config/c2me.toml')).text).toBe(before.text);
  });

  test('rename refuses an existing target; mkdir creates one directory', async () => {
    const servers = api();
    await expect(servers.fileRename(ID, 'config/spark.toml', 'config/c2me.toml', null, next())).rejects.toMatchObject({ code: 'stale_target' });
    await servers.fileRename(ID, 'config/spark.toml', 'config/spark-old.toml', null, next());
    await servers.fileMkdir(ID, 'config/backup', next());
    await expect(servers.fileMkdir(ID, 'config/backup', next())).rejects.toMatchObject({ code: 'stale_target' });
    await expect(servers.fileMkdir(ID, 'missing/child', next())).rejects.toMatchObject({ code: 'not_found' });
    const names = (await servers.filesList(ID, 'config', null)).items.map((entry) => entry.name);
    expect(names).toEqual(expect.arrayContaining(['spark-old.toml', 'backup']));
    expect(names).not.toContain('spark.toml');
  });

  test('uploads go in 1 MiB chunks and the 16 MiB total is enforced in the model and by the server', async () => {
    const servers = api();
    const [jar] = await servers.uploadPick();
    expect(uploadProblem([jar])).toBeNull();
    const begun = await servers.uploadBegin(ID, jar.localId, `mods/${jar.name}`, null, next());
    let offset = Number(begun.offset);
    let chunks = 0;
    while (offset < Number(jar.size)) { offset = Number((await servers.uploadChunk(ID, begun.uploadId)).offset); chunks++; }
    expect(chunks).toBe(Math.ceil(Number(jar.size) / 1_048_576));
    await servers.uploadFinish(ID, begun.uploadId);
    expect((await servers.filesList(ID, 'mods', null)).items.some((entry) => entry.name === jar.name)).toBe(true);

    await servers.uploadPick();
    const [big] = await servers.uploadPick();
    expect(Number(big.size)).toBeGreaterThan(WRITE_LIMIT);
    expect(uploadProblem([big])).toBe('server-files.upload.too-large');
    expect(uploadProblem([{ name: 'a.jar', size: String(WRITE_LIMIT / 2) }, { name: 'b.jar', size: String(WRITE_LIMIT / 2 + 1) }])).toBe('server-files.upload.too-large');
    expect(uploadProblem([])).toBe('server-files.upload.nothing');
    await expect(servers.uploadBegin(ID, big.localId, big.name, null, next())).rejects.toMatchObject({ code: 'invalid_input' });
  });

  test('unfinished uploads cannot finish', async () => {
    const servers = api();
    const [jar] = await servers.uploadPick();
    const begun = await servers.uploadBegin(ID, jar.localId, `plugins-${jar.name}`, null, next());
    await expect(servers.uploadFinish(ID, begun.uploadId)).rejects.toMatchObject({ code: 'invalid_input' });
  });

  test('logs read by tail and backward pages; rotated archives need decompress', async () => {
    const servers = api();
    const tail = await servers.logTail(ID, 'logs/latest.log', 100, false);
    expect(tail.text.trimEnd().split('\n')).toHaveLength(100);
    expect(tail.nextByte).toBeNull();
    const earlier = await servers.logLines(ID, 'logs/latest.log', tail.prevByte, 100, 'backward', false);
    expect(earlier.endByte).toBe(tail.startByte);
    expect(earlier.text.trimEnd().split('\n')).toHaveLength(100);
    const raw = await servers.logTail(ID, 'logs/2026-10-17-1.log.gz', 10, false);
    expect(raw.binary).toBe(true);
    const unpacked = await servers.logTail(ID, 'logs/2026-10-17-1.log.gz', 10, true);
    expect(unpacked.binary).toBe(false);
    expect(unpacked.text).toMatch(/\[Server thread\//);
    await expect(servers.logTail(ID, 'logs/latest.log', 10, true)).rejects.toMatchObject({ code: 'invalid_input' });
  });
});

describe('[files] executable content and open modes', () => {
  test('jar writes under mods/, plugins/ or the root warn; other jars do not', () => {
    expect(isExecutableContent('mods/carpet.jar')).toBe(true);
    expect(isExecutableContent('mods/sub/x.JAR')).toBe(true);
    expect(isExecutableContent('plugins/Essentials.jar')).toBe(true);
    expect(isExecutableContent('server.jar')).toBe(true);
    expect(isExecutableContent('libraries/com/x.jar')).toBe(false);
    expect(isExecutableContent('mods/readme.txt')).toBe(false);
  });
  test('text opens in the editor, logs in the viewer, binary and oversized files download only', () => {
    expect(openMode('config/spark.toml', { kind: 'file', size: '200' })).toBe('editor');
    expect(openMode('logs/latest.log', { kind: 'file', size: '9999999' })).toBe('log');
    expect(openMode('logs/2026-10-17-1.log.gz', { kind: 'file', size: '10' })).toBe('log');
    expect(openMode('mods/a.jar', { kind: 'file', size: '10' })).toBe('download');
    expect(openMode('config/huge.json', { kind: 'file', size: String(2 * 1_048_576) })).toBe('download');
  });
});

describe('[capabilities] gating', () => {
  const view = (role) => ({ source: 'role_defaults', granted: capabilitiesForRole(role) ?? [], refused: [] });
  test('viewers see no file actions; maintainers can edit, rename and delete', () => {
    const entry = { kind: 'file', size: '100' };
    expect(fileActions(view('viewer'), 'config/a.toml', entry)).toEqual({ open: false, edit: false, rename: false, delete: false, download: false });
    expect(folderActions(view('viewer'))).toEqual({ newFile: false, newFolder: false, upload: false, trash: false });
    expect(fileActions(view('maintainer'), 'config/a.toml', entry)).toEqual({ open: true, edit: true, rename: true, delete: true, download: true });
    expect(fileActions(view('maintainer'), 'server.properties', entry)).toMatchObject({ open: false, rename: false, delete: false });
    expect(fileActions(view('maintainer'), 'mods', { kind: 'directory', size: '0' })).toMatchObject({ open: true, rename: false, delete: false });
  });
  test('read-only grants open but cannot edit; a refusal hides the action', () => {
    const readOnly = { source: 'session', granted: ['files.list', 'files.read'], refused: [] };
    expect(fileActions(readOnly, 'config/a.toml', { kind: 'file', size: '1' })).toMatchObject({ open: true, edit: false, delete: false });
    const refused = { source: 'unknown', granted: [], refused: ['files.read'] };
    expect(fileActions(refused, 'config/a.toml', { kind: 'file', size: '1' })).toMatchObject({ open: false, rename: true });
  });
  test('the fixture enforces capabilities on file routes', async () => {
    const servers = api();
    await expect(servers.filesList('fixture-creative', '', null)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(servers.propertiesGet('fixture-creative')).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('[properties] typed parse, serialize and confirmation', () => {
  test('values parse into typed entries, malformed known keys and raw unknown keys', () => {
    const parsed = parseProperties({ pvp: true, 'max-players': 20, difficulty: 'hard', 'view-distance': 99, 'rcon.password': '[redacted]', 'level-name': '[redacted]', 'level-type': '[redacted]' });
    expect(parsed.typed).toEqual({ pvp: true, 'max-players': 20, difficulty: 'hard' });
    expect(parsed.malformed).toEqual(['view-distance', 'level-type']);
    expect(parsed.secrets).toEqual(['rcon.password']);
    expect(parsed.raw).toEqual([{ key: 'level-name', value: '[redacted]' }]);
    expect(effectiveValue(propertyDef('spawn-protection'), parsed.typed)).toBe(16);
  });
  test('only changed editable keys are sent, an empty secret is unchanged', () => {
    const base = { pvp: true, 'max-players': 20 };
    expect(diffChanges(base, { pvp: true, 'max-players': 30, 'rcon.password': '', 'level-type': 'minecraft:flat' })).toEqual({ 'max-players': 30 });
    expect(diffChanges(base, { 'rcon.password': 'secret' })).toEqual({ 'rcon.password': 'secret' });
  });
  test('values are validated like the agent', () => {
    expect(valueProblem(propertyDef('max-players'), 0)).toBe('server-settings.out-of-range');
    expect(valueProblem(propertyDef('view-distance'), 12)).toBeNull();
    expect(valueProblem(propertyDef('motd'), 'a/b')).toBe('server-settings.no-slashes');
    expect(valueProblem(propertyDef('motd'), 'é')).toBe('server-settings.ascii-only');
    expect(valueProblem(propertyDef('motd'), 'x'.repeat(257))).toBe('server-settings.too-long');
    expect(valueProblem(propertyDef('difficulty'), 'nightmare')).toBe('server-settings.invalid');
  });
  test('weakening keys follow the agent rules', () => {
    const base = { 'online-mode': true, 'white-list': true, 'op-permission-level': 4, 'function-permission-level': 2 };
    expect(weakeningKeys(base, { 'online-mode': false, 'white-list': false, 'enable-rcon': true, 'function-permission-level': 3, 'spawn-protection': 4, pvp: false }))
      .toEqual(['online-mode', 'white-list', 'enable-rcon', 'function-permission-level', 'spawn-protection']);
    expect(weakeningKeys(base, { 'online-mode': true, 'spawn-protection': 32, 'op-permission-level': 2 })).toEqual([]);
  });
  test('a safe change applies and marks restart required; the old validator then goes stale', async () => {
    const servers = api();
    const before = await servers.propertiesGet(ID);
    expect(before.values.motd).toBe('Riverside SMP - season 3, be kind');
    expect(before.values['rcon.password']).toBe('[redacted]');
    const result = await servers.propertiesUpdate(ID, { 'max-players': 30, motd: 'Hello there' }, before.sha256, null, next());
    expect(result).toMatchObject({ kind: 'applied', restartNeeded: true });
    const after = await servers.propertiesGet(ID);
    expect(after.values).toMatchObject({ 'max-players': 30, motd: 'Hello there' });
    expect((await servers.snapshot(ID)).restartRequired).toBe(true);
    await expect(servers.propertiesUpdate(ID, { pvp: false }, before.sha256, null, next())).rejects.toMatchObject({ code: 'stale_target' });
    await expect(servers.propertiesUpdate(ID, { 'level-name': 'x' }, after.sha256, null, next())).rejects.toMatchObject({ code: 'invalid_input' });
  });
  test('a weakening change needs the token with the same intent, changes and validator', async () => {
    const servers = api();
    const { sha256 } = await servers.propertiesGet(ID);
    const intentId = next();
    const changes = { 'online-mode': false };
    const prepared = await servers.propertiesUpdate(ID, changes, sha256, null, intentId);
    expect(prepared.kind).toBe('awaitingConfirmation');
    expect((await servers.propertiesGet(ID)).values['online-mode']).toBe(true);
    await expect(servers.propertiesUpdate(ID, changes, sha256, 'wrong-token', intentId)).rejects.toMatchObject({ code: 'confirmation_expired' });
    const again = await servers.propertiesUpdate(ID, changes, sha256, null, intentId);
    const applied = await servers.propertiesUpdate(ID, changes, sha256, again.confirmationToken, intentId);
    expect(applied.kind).toBe('applied');
    expect((await servers.propertiesGet(ID)).values['online-mode']).toBe(false);
    // An exact retry replays the committed outcome without a new receipt.
    expect(await servers.propertiesUpdate(ID, changes, sha256, null, intentId)).toEqual(applied);
  });
});
