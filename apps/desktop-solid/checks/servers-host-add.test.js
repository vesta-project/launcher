import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ADD_BLOCKERS, awaitingStart, CREATE_ERRORS, CREATE_WARNINGS, acknowledgedWarnings, acknowledgements, addProblem, addSupport, buildOptions, chosenBuild, experimentalChoice,
  folderVerdict, formatMemory, keepKind, localDefaults, memoryBudget, memoryOverFree, memoryRange, needsBuild, needsFreshPlan, notOffered, overallPercent, phaseAt, phaseProgress, phaseSteps, readDefaults,
  readNearby, readResources, readRestoreSources, recommendedBuild, reviewFacts, reviewProblems, settingsProblem, softwareChoice, softwareKinds, startVersion,
  supportedModes, unavailableKinds, versionOptions, waitingFor,
} from '../src/features/servers/host-add-model';
import { createHostFixtures } from '../src/features/servers/host-fixtures';

const root = join(import.meta.dir, '..');
const source = (path) => readFileSync(join(root, path), 'utf8');
const until = async (check, timeout = 12_000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('timed out');
};

const kind = (id, builds, extra = {}) => ({ kind: id, label: id, stable: true, experimental: false, recommended: id === 'vanilla', available: builds.length > 0, builds, ...extra });
const build = (id, extra = {}) => ({ id, build: null, loaderVersion: id, stable: true, experimental: false, recommended: false, ...extra });
const createReview = (overrides = {}) => ({
  planId: 'p', confirmation: 'c', expiresAt: '2026-11-14T00:00:00Z', blockers: [], warnings: [],
  summary: {
    kind: 'new', name: 'Survival', minecraftVersion: '1.21.4', software: { kind: 'paper', version: '1.21.4', build: 130, loaderVersion: null },
    resources: { gamePort: 25566, memoryMiB: 4096 }, runtime: { requiredMajor: 21, downloadRequired: true, automatic: true },
    destination: { serverId: 's', displayPath: '/var/lib/vesta/servers/s/game', freeBytes: 9e10 }, pack: null, restore: null,
  },
  ...overrides,
});
const importReview = (overrides = {}) => ({
  planId: 'p', confirmation: 'c', expiresAt: 'x', blockers: [], warnings: [],
  source: { displayPath: '/srv/survival', snapshot: 'f', files: 10, bytes: 2048 }, detected: { minecraftVersion: '1.21.1', loader: 'fabric' }, runtime: { requiredMajor: 21 },
  destination: { serverId: 's', displayPath: '/d', freeBytes: 9 }, resources: { gamePort: 25566, memoryMiB: 4096 }, processes: [], ports: [], inspection: {},
  ...overrides,
});

describe('[add] ways to add a server', () => {
  test('wizard order is New, Restore, Import, Modpack is not a way, and a way the machine can not do is left out', () => {
    expect(supportedModes({ new: true, modpack: true, restore: true, import: true })).toEqual(['new', 'restore', 'import']);
    expect(supportedModes(addSupport({ capabilities: ['create-jobs', 'create-modpack', 'import-jobs'], defaults: true, restoreSources: 0 }))).toEqual(['new', 'import']);
    expect(supportedModes({ new: false, import: true })).toEqual(['import']);
    // Today's machine: create defaults answer, no backups, import jobs advertised.
    const today = addSupport({ capabilities: ['folders', 'import-jobs'], defaults: true, restoreSources: 0 });
    expect(supportedModes(today)).toEqual(['new', 'import']);
    // An older machine lists no capabilities but still imports.
    expect(addSupport({ capabilities: [], defaults: false, restoreSources: null })).toEqual({ new: false, import: true, restore: false });
    expect(addSupport({ capabilities: ['folders'], defaults: true, restoreSources: 2 })).toMatchObject({ import: false, restore: true });
  });

  test('New stays when the suggestions fail on a machine that creates servers', () => {
    // The owner's machine refused defaults because memory looked used up: New must not vanish.
    expect(supportedModes(addSupport({ capabilities: ['create-jobs', 'import-jobs'], defaults: false, restoreSources: 1 }))).toEqual(['new', 'restore', 'import']);
    expect(addSupport({ capabilities: ['folders', 'import-jobs'], defaults: false, catalogue: true, restoreSources: 0 }).new).toBe(true);
    expect(addSupport({ capabilities: ['folders', 'import-jobs'], defaults: false, catalogue: false, restoreSources: 0 }).new).toBe(false);
    // Local starting values: a name, the machine's free port when it said one, 2 GB.
    expect(localDefaults(null)).toEqual({ name: 'Minecraft Server', gamePort: 25565, memoryMiB: 2048 });
    expect(localDefaults({ availableMiB: 0, budgetMiB: 12288, totalMiB: 16384, suggestedPort: 25567, portProblem: null, warnings: [] })).toMatchObject({ gamePort: 25567, memoryMiB: 2048 });
  });

  test('a missing route reads as not offered, a failure does not', () => {
    expect(notOffered({ code: 'not_found', reason: 'not_found' })).toBe(true);
    expect(notOffered({ code: 'unsupported', reason: 'not_supported_yet' })).toBe(true);
    expect(notOffered({ code: 'server_busy', reason: 'creates_unavailable' })).toBe(true);
    expect(notOffered({ code: 'unreachable' })).toBe(false);
  });
});

describe('[add] catalogue', () => {
  const versions = { latestStable: '1.21.4', versions: [
    { id: '25w05a', stable: false, experimental: true, recommended: false },
    { id: '1.21.4', stable: true, experimental: false, recommended: true },
    { id: '1.21.1', stable: true, experimental: false, recommended: false },
  ] };

  test('versions hide snapshots unless asked, keep the chosen one, and start on the suggestion', () => {
    expect(versionOptions(versions, false).map((v) => v.value)).toEqual(['1.21.4', '1.21.1']);
    expect(versionOptions(versions, true).map((v) => v.value)).toEqual(['25w05a', '1.21.4', '1.21.1']);
    expect(versionOptions(versions, false, '25w05a').map((v) => v.value)).toContain('25w05a');
    expect(startVersion(versions, '1.21.1')).toBe('1.21.1');
    expect(startVersion(versions, 'gone')).toBe('1.21.4');
    expect(startVersion(null, '1.20.1')).toBe('1.20.1');
  });

  test('software that can not be had is named in a word, never hidden silently or offered greyed', () => {
    const catalogue = { minecraftVersion: '1.8.9', kinds: [
      kind('vanilla', [{ id: 'v', build: null, loaderVersion: null }]),
      kind('spigot', [{ id: 's', build: null, loaderVersion: null }]),
      kind('fabric', []),
      kind('quilt', []),
      kind('forge', [build('47.1')], { unavailableReason: 'provider_unavailable' }),
      kind('neoforge', [build('21.4')], { available: false, unavailableReason: 'unsupported_version' }),
    ] };
    expect(softwareKinds(catalogue).map((k) => k.kind)).toEqual(['vanilla', 'spigot']);
    expect(unavailableKinds(catalogue)).toEqual([
      { reason: 'server-add.software.reason-version', names: ['fabric', 'quilt', 'neoforge'] },
      { reason: 'server-add.software.reason-offline', names: ['forge'] },
    ]);
    expect(keepKind(softwareKinds(catalogue), 'fabric')).toBe('vanilla');
    expect(keepKind(softwareKinds(catalogue), 'spigot')).toBe('spigot');
  });

  test('the recommended build is the default, an experimental one is never picked silently', () => {
    const paper = kind('paper', [build('a', { build: 130, loaderVersion: null, recommended: true }), build('b', { build: 129, loaderVersion: null })]);
    expect(recommendedBuild(paper)?.build).toBe(130);
    expect(softwareChoice(paper, null)).toEqual({ kind: 'paper', build: 130, loaderVersion: null });
    expect(softwareChoice(paper, 'b')).toEqual({ kind: 'paper', build: 129, loaderVersion: null });
    const folia = kind('folia', [build('f1', { build: 12, loaderVersion: null, experimental: true, stable: false })], { experimental: true });
    expect(recommendedBuild(folia)).toBeNull();
    expect(needsBuild(folia, null)).toBe(true);
    expect(needsBuild(folia, 'f1')).toBe(false);
    expect(experimentalChoice({ kind: folia, build: chosenBuild(folia, 'f1') })).toBe(true);
    expect(needsBuild(kind('vanilla', [{ id: 'v', build: null, loaderVersion: null }]), null)).toBe(false);
    expect(buildOptions(kind('fabric', [build('0.16.9')])).map((o) => o.label)).toEqual(['0.16.9']);
  });

  test('memory goes from 512 MB to the budget, and above what is free is only a warning', () => {
    // The budget wins, even when other servers leave nothing free.
    expect(memoryRange({ budgetMiB: 12288, totalMiB: 16384 })).toEqual({ min: 512, max: 12288, step: 256 });
    expect(memoryBudget({ budgetMiB: 0, totalMiB: 8192 })).toBe(8192 - 1024);
    expect(memoryBudget({ budgetMiB: null, totalMiB: 32768 })).toBe(32768 - 4096);
    expect(memoryBudget(null)).toBe(16384);
    expect(memoryRange({ budgetMiB: 6000, totalMiB: null }).max).toBe(5888);
    expect(memoryOverFree(4096, { availableMiB: 3072 })).toBe(true);
    expect(memoryOverFree(2048, { availableMiB: 3072 })).toBe(false);
    expect(memoryOverFree(99999, { availableMiB: null })).toBe(false);
    // Said on the memory row of the review, not as one more tick.
    const facts = reviewFacts('new', createReview({ warnings: ['memory_overcommitted'] }));
    expect(acknowledgements(facts).map((row) => row.id)).toEqual(['eula']);
    expect(acknowledgedWarnings(facts)).toEqual(['memory_overcommitted']);
  });

  test('defaults and the resource preview are read defensively', () => {
    expect(readDefaults({ name: 'Minecraft Server 2', minecraftVersion: '1.21.4', gamePort: 25566, memoryMiB: 3072 })).toMatchObject({ name: 'Minecraft Server 2', gamePort: 25566, memoryMiB: 3072, software: { kind: 'vanilla' } });
    expect(readDefaults(null)).toMatchObject({ name: 'Minecraft Server', gamePort: 25565, memoryMiB: 4096 });
    expect(readResources({ memory: { availableMib: 12288, totalMib: 16384 }, port: { gamePort: 25565, blocker: 'game_port_in_use' } }))
      .toEqual({ availableMiB: 12288, budgetMiB: null, totalMiB: 16384, suggestedPort: 25565, portProblem: 'in-use', warnings: [] });
    expect(readResources({ memory: { availableMib: 0, budgetMib: 12288 }, warnings: ['memory_overcommitted', 'game_port_in_use', 7] }))
      .toMatchObject({ availableMiB: 0, budgetMiB: 12288, portProblem: 'in-use', warnings: ['memory_overcommitted', 'game_port_in_use'] });
    expect(formatMemory(4096)).toBe('4 GB');
    expect(formatMemory(5632)).toBe('5.5 GB');
    expect(settingsProblem({ name: ' ', gamePort: 25565, memoryMiB: 4096 })).toBe('name');
    expect(settingsProblem({ name: 'a', gamePort: 80, memoryMiB: 4096 })).toBe('port');
    expect(settingsProblem({ name: 'a', gamePort: 25565, memoryMiB: 256 })).toBe('memory');
    expect(readRestoreSources({ sources: [{ sourceId: 'a', createdAt: '2026-01-01' }, { sourceId: 'b', createdAt: '2026-03-01' }, { nope: 1 }] }).map((s) => s.sourceId)).toEqual(['b', 'a']);
  });
});

describe('[add] import folders', () => {
  test('only a readable server folder goes on; others say why and offer the server folders inside', () => {
    expect(folderVerdict({ blockers: [] }, '/srv/x')).toEqual({ kind: 'server' });
    expect(folderVerdict({ blockers: ['source_unreadable'], remediationCommand: "sudo vesta import-root add '/srv/x'" }, '/srv/x'))
      .toEqual({ kind: 'unreadable', command: "sudo vesta import-root add '/srv/x'" });
    expect(folderVerdict({ blockers: ['source_unreadable'] }, '/srv/x')).toEqual({ kind: 'unreadable', command: 'sudo vesta import-root add /srv/x' });
    const other = folderVerdict({ blockers: ['not_minecraft_server'], missing: ['server_properties'], nearby: [{ folderToken: 't', path: '/srv/x/survival', looksLikeServer: true }] }, '/srv/x');
    expect(other).toMatchObject({ kind: 'not-server', reason: 'vesta-server.import.why-no-server-file', nearby: [{ name: 'survival', token: 't' }] });
    // An older machine has no nearby list: the folder's own listing stands in.
    expect(readNearby(null, [{ name: 'creative', folderToken: 'c', readable: true, looksLikeServer: true }, { name: 'logs', folderToken: 'l', readable: true, looksLikeServer: false }], '/srv/x'))
      .toEqual([{ name: 'creative', path: '/srv/x/creative', token: 'c' }]);
  });
});

describe('[add] one review', () => {
  test('create and import reviews read as the same facts', () => {
    const created = reviewFacts('new', createReview());
    expect(created).toMatchObject({ mode: 'new', name: 'Survival', softwareKind: 'paper', software: 'Paper', softwareVersion: '130', minecraftVersion: '1.21.4', gamePort: 25566, javaMajor: 21, sourcePath: null });
    const imported = reviewFacts('import', importReview(), 'Survival');
    expect(imported).toMatchObject({ mode: 'import', softwareKind: 'fabric', software: 'Fabric', minecraftVersion: '1.21.1', sourcePath: '/srv/survival', bytes: 2048 });
  });

  test('problems are root causes only, each with its fix inline', () => {
    const unreadable = reviewFacts('import', importReview({ confirmation: null, blockers: ['source_unreadable', 'insufficient_space', 'java_unresolved', 'software_unresolved'] }));
    expect(reviewProblems(unreadable)).toEqual([{ code: 'source_unreadable', message: 'server-add.blocker.permission', fix: { kind: 'command', command: 'sudo vesta import-root add /srv/survival' } }]);

    const port = reviewFacts('new', createReview({ confirmation: null, blockers: ['game_port_in_use', 'port_state_unknown', 'name_in_use'] }));
    expect(reviewProblems(port)).toEqual([
      { code: 'game_port_in_use', message: 'server-add.blocker.port-in-use', fix: { kind: 'field', field: 'port' } },
      { code: 'name_in_use', message: 'server-add.blocker.name', fix: { kind: 'field', field: 'name' } },
    ]);
    const software = reviewFacts('new', createReview({ confirmation: null, blockers: ['software_unresolved', 'java_unresolved'] }));
    expect(reviewProblems(software)).toEqual([{ code: 'software_unresolved', message: 'server-add.blocker.software', fix: { kind: 'back' } }]);
    // Import space only counts when the size is known and does not fit.
    const space = reviewFacts('import', importReview({ confirmation: null, blockers: ['insufficient_space'], destination: { serverId: 's', displayPath: '/d', freeBytes: 1e12 } }));
    expect(reviewProblems(space).map((p) => p.code)).toEqual(['unknown']);
    // Blocked without a reason is still one honest line.
    expect(reviewProblems(reviewFacts('new', createReview({ confirmation: null })))).toEqual([{ code: 'unknown', message: 'vesta-server.blocker.other', fix: null }]);
    expect(reviewProblems(reviewFacts('new', createReview()))).toEqual([]);
  });

  test('every documented blocker, warning and error has its own line', () => {
    const blockers = ['name_in_use', 'game_port_in_use', 'port_unresolved', 'port_state_unknown', 'memory_budget_exceeded', 'memory_unresolved', 'memory_invalid',
      'insufficient_space', 'software_unresolved', 'java_unresolved', 'provider_unavailable', 'pack_invalid', 'pack_client_only', 'pack_review_blocked',
      'restore_source_unavailable', 'unsafe_archive', 'source_too_large', 'source_unreadable', 'source_running', 'source_port_listening', 'source_recently_active',
      'source_changed', 'unsafe_path', 'launch_unresolved', 'not_minecraft_server', 'world_outside_source', 'launch_arguments_unsupported'];
    expect(ADD_BLOCKERS).toEqual(expect.arrayContaining(blockers));
    for (const code of blockers) {
      const [problem] = reviewProblems(reviewFacts('new', createReview({ confirmation: null, blockers: [code] })));
      expect(problem.message, code).not.toBe('vesta-server.blocker.other');
    }
    expect(CREATE_WARNINGS).toEqual(expect.arrayContaining(['experimental_software', 'legacy_checksum', 'pack_review_warning', 'restore_version_unknown', 'unsupported_upstream']));
    const errors = ['create_job_not_found', 'creates_unavailable', 'create_jobs_saturated', 'not_supported_yet', 'request_too_large', 'download_failed', 'integrity_conflict',
      'install_failed', 'java_unresolved', 'invalid_request', 'idempotency_key_required', 'replan_required'];
    expect(CREATE_ERRORS).toEqual(expect.arrayContaining(errors));
    for (const code of [...errors, 'start_failed', 'plan_expired', 'game_port_in_use', 'eula_required', 'unavailable']) {
      expect(addProblem(code, 'new'), code).not.toBe('server-add.error.step');
      expect(addProblem({ code: 'conflict', reason: code }, 'new'), code).toBe(addProblem(code, 'new'));
    }
    expect(addProblem('import_jobs_saturated', 'new')).toBe('server-add.error.busy');
    expect(addProblem('something_new', 'new')).toBe('server-add.error.step');
    expect(needsFreshPlan({ code: 'conflict', reason: 'plan_expired' })).toBe(true);
    expect(needsFreshPlan({ code: 'unreachable' })).toBe(false);
  });

  test('acknowledgements are a short list above the button, which says why it waits', () => {
    const created = reviewFacts('new', createReview({ warnings: ['experimental_software'] }));
    const rows = acknowledgements(created);
    expect(rows.map((row) => row.id)).toEqual(['experimental_software', 'eula']);
    expect(waitingFor(rows, [])).toBe('server-add.review.need-ticks');
    expect(waitingFor(rows, ['experimental_software'])).toBe('server-add.review.need-eula');
    expect(waitingFor(rows, ['experimental_software', 'eula'])).toBeNull();
    expect(acknowledgedWarnings(created)).toEqual(['experimental_software']);
    // Import: the stopped tick covers the warnings that promise the same thing, and they are still sent.
    const imported = reviewFacts('import', importReview({ warnings: ['disable_amp_auto_restart', 'source_process_unknown', 'rcon_disabled'] }));
    expect(acknowledgements(imported).map((row) => row.id)).toEqual(['rcon_disabled', 'source-stopped', 'eula']);
    expect(acknowledgedWarnings(imported)).toEqual(['disable_amp_auto_restart', 'source_process_unknown', 'rcon_disabled']);
  });
});

describe('[add] progress', () => {
  test('phases read in order, with byte or file progress and a whole job percentage', () => {
    expect(phaseSteps('new').map((step) => step.id)).toEqual(['prepare', 'java', 'software', 'install', 'finish', 'start']);
    expect(phaseSteps('import').map((step) => step.id)).toEqual(['check', 'copy', 'finish', 'start']);
    expect(phaseAt('new', 'downloading_software', 'applying')).toBe(2);
    // Installed runs straight on into starting: ready and starting are the last step, online is done.
    expect(phaseAt('new', 'registering', 'ready')).toBe(5);
    expect(phaseAt('new', 'starting', 'starting')).toBe(5);
    expect(phaseAt('new', 'starting', 'online')).toBe(6);
    expect(awaitingStart({ state: 'ready', error: null })).toBe(true);
    expect(awaitingStart({ state: 'ready', error: 'start_failed' })).toBe(false);
    expect(awaitingStart({ state: 'starting', error: null })).toBe(false);
    expect(phaseAt('import', 'copy', 'applying')).toBe(1);
    expect(phaseProgress({ bytesDone: 25, bytesTotal: 100, filesDone: 0, filesTotal: 0 })).toEqual({ percent: 25, bytes: true, files: false });
    expect(phaseProgress({ bytesDone: 0, bytesTotal: 0, filesDone: 1, filesTotal: 4 })).toEqual({ percent: 25, bytes: false, files: true });
    expect(phaseProgress(null).percent).toBeNull();
    expect(overallPercent('new', { phase: 'downloading_software', state: 'applying', progress: { bytesDone: 50, bytesTotal: 100, filesDone: 0, filesTotal: 0 } })).toBe(41);
    expect(overallPercent('new', { phase: 'registering', state: 'ready', progress: null })).toBe(83);
    expect(overallPercent('new', { phase: 'starting', state: 'online', progress: null })).toBe(100);
  });
});

describe('[add] preview machine', () => {
  const claimed = async (create = null) => {
    const api = createHostFixtures({ hosts: 'one', create });
    const [host] = await api.list();
    return { api, hostId: host.id };
  };
  const settle = (api, hostId, jobId, done) => until(async () => { const job = await api.createJob(hostId, jobId); return done(job) && job; });

  test('defaults suggest a free port beside the one in use, and 25565 is a port conflict', async () => {
    const { api, hostId } = await claimed();
    const defaults = await api.createDefaults(hostId);
    expect(defaults).toMatchObject({ name: 'Minecraft Server', gamePort: 25566, minecraftVersion: '1.21.4' });
    const catalogue = await api.catalogueSoftware(hostId, '1.21.4');
    expect(unavailableKinds(catalogue).map((group) => group.names).flat()).toContain('Forge');
    const body = { kind: 'new', name: 'Survival', minecraftVersion: '1.21.4', software: { kind: 'vanilla', build: null, loaderVersion: null }, gamePort: 25565, memoryMiB: 4096, eulaAccepted: false };
    const { jobId } = await api.createPlan(hostId, body, 'k1');
    const blocked = await settle(api, hostId, jobId, (job) => job.state !== 'planning');
    expect(blocked.state).toBe('blocked');
    expect(blocked.review.blockers).toEqual(['game_port_in_use']);
    expect(blocked.review.confirmation).toBeNull();
    await expect(api.createPlan(hostId, { kind: 'modpack', name: 'x', source: { kind: 'provider', provider: 'modrinth', projectId: 'p', versionId: 'v' }, gamePort: null, memoryMiB: null, eulaAccepted: false }, 'k2'))
      .rejects.toMatchObject({ reason: 'not_supported_yet' });
  });

  test('a busy machine refuses its suggestions but still plans above free memory with a warning', async () => {
    const { api, hostId } = await claimed('busy');
    await expect(api.createDefaults(hostId)).rejects.toMatchObject({ reason: 'memory_budget_exceeded' });
    const spare = readResources(await api.importResources(hostId, null, 4096));
    expect(spare.availableMiB).toBeLessThan(4096);
    expect(spare.budgetMiB).toBe(12288);
    expect(spare.warnings).toContain('memory_overcommitted');
    const body = { kind: 'new', name: 'Survival', minecraftVersion: '1.21.4', software: { kind: 'vanilla', build: null, loaderVersion: null }, gamePort: 25570, memoryMiB: 4096, eulaAccepted: false };
    const { jobId } = await api.createPlan(hostId, body, 'k1');
    const review = await settle(api, hostId, jobId, (job) => job.state !== 'planning');
    expect(review.state).toBe('review');
    expect(review.review.warnings).toContain('memory_overcommitted');
    const over = await api.createPlan(hostId, { ...body, memoryMiB: 13312 }, 'k2');
    expect((await settle(api, hostId, over.jobId, (job) => job.state !== 'planning')).review.blockers).toEqual(['memory_budget_exceeded']);
  });

  test('an interrupted job waits to resume, then finishes and can start', async () => {
    const { api, hostId } = await claimed('interrupt');
    const body = { kind: 'new', name: 'Survival', minecraftVersion: '1.21.4', software: { kind: 'paper', build: null, loaderVersion: null }, gamePort: 25566, memoryMiB: 4096, eulaAccepted: false };
    const { jobId } = await api.createPlan(hostId, body, 'k');
    const review = await settle(api, hostId, jobId, (job) => job.state === 'review');
    await expect(api.createApply(hostId, { planId: review.review.planId, confirmation: review.review.confirmation, acknowledgedWarnings: [], eulaAccepted: false }, 'a')).rejects.toMatchObject({ reason: 'eula_required' });
    await api.createApply(hostId, { planId: review.review.planId, confirmation: review.review.confirmation, acknowledgedWarnings: [], eulaAccepted: true }, 'a');
    const paused = await settle(api, hostId, jobId, (job) => job.state === 'interrupted');
    expect(paused.error).toBe('interrupted');
    await api.createResume(hostId, jobId, 'r');
    const ready = await settle(api, hostId, jobId, (job) => job.state === 'ready');
    expect((await api.servers(hostId)).servers.map((server) => server.name)).toContain('Survival');
    expect((await api.createStart(hostId, ready.jobId, 's')).state).toBe('starting');
  }, 30_000);
});

describe('[add] store', () => {
  test('one key per intent: a retry reuses it, a changed request gets a new one, and polls stay two seconds apart', async () => {
    const store = await import('../src/features/servers/hosts-store');
    expect(store.POLL_MS).toBeGreaterThanOrEqual(2000);
    const lan = await store.hostCommand((client) => client.discover());
    const ready = lan.find((entry) => entry.state === 'unclaimed');
    if (ready) await store.hostCommand((client) => client.claim(ready.address, 'K7Q4MX29P3AB', 'uuid', 'Windows PC')).catch(() => {});
    await store.refreshHosts();
    const hostId = store.hosts()[0].id;

    const seen = [];
    const reads = [];
    const original = await store.hostCommand(async (client) => client);
    const plan = original.createPlan;
    const job = original.createJob;
    let fail = true;
    original.createPlan = async (id, body, key) => {
      seen.push({ port: body.gamePort, key });
      if (fail) { fail = false; throw { code: 'timeout' }; }
      return plan(id, body, key);
    };
    original.createJob = async (id, jobId) => { reads.push(Date.now()); return job(id, jobId); };
    try {
      const body = (gamePort) => ({ kind: 'new', name: 'Keys', minecraftVersion: '1.21.4', software: { kind: 'vanilla', build: null, loaderVersion: null }, gamePort, memoryMiB: 2048, eulaAccepted: false });
      await store.planAdd(hostId, { mode: 'new', body: body(25570) }, 'Keys');
      expect(store.addTask(hostId).error?.code).toBe('timeout');
      await store.replanAdd(hostId);
      await store.planAdd(hostId, { mode: 'new', body: body(25571) }, 'Keys');
      expect(seen[0].key).toBe(seen[1].key);
      expect(seen[2].key).not.toBe(seen[1].key);
      await until(() => store.addTask(hostId)?.job?.review);
      store.recheckAdd(hostId);
      store.recheckAdd(hostId);
      await new Promise((resolve) => setTimeout(resolve, 2500));
      for (let index = 1; index < reads.length; index += 1) expect(reads[index] - reads[index - 1]).toBeGreaterThanOrEqual(1900);
    } finally {
      original.createPlan = plan;
      original.createJob = job;
      store.clearAdd(hostId);
    }
  }, 30_000);

  test('an older machine that stops at ready is started once, and the job follows on to online', async () => {
    const store = await import('../src/features/servers/hosts-store');
    const activity = await import('../src/features/activity/activity-store');
    await store.refreshHosts();
    const hostId = store.hosts()[0].id;
    const client = await store.hostCommand(async (api) => api);
    const start = client.createStart;
    let starts = 0;
    client.createStart = async (...args) => { starts += 1; return start(...args); };
    try {
      const body = { kind: 'new', name: 'Autostart', minecraftVersion: '1.21.4', software: { kind: 'vanilla', build: null, loaderVersion: null }, gamePort: 25580, memoryMiB: 2048, eulaAccepted: false };
      await store.planAdd(hostId, { mode: 'new', body }, 'Autostart');
      await until(() => store.addTask(hostId)?.job?.review?.confirmation, 20_000);
      const destination = await store.applyAdd(hostId, store.addTask(hostId).job.review.warnings);
      expect(destination).toBeTruthy();
      expect(store.serverAddJob(destination)?.job?.state).toBe('applying');
      const activityId = `server-add:${hostId}:${store.addTask(hostId).jobId}`;
      activity.flushActivityProgress();
      expect(activity.activities().find((entry) => entry.id === activityId)).toMatchObject({
        state: 'running', target: { route: `/servers/${destination}` },
      });
      await until(() => store.addTask(hostId)?.job?.state === 'online', 40_000);
      expect(starts).toBe(1);
      expect(store.activeAdds().some((task) => task.hostId === hostId)).toBe(false);
      expect(activity.activities().find((entry) => entry.id === activityId)?.state).toBe('done');
      const { serverSnapshot } = await import('../src/features/servers/store');
      await until(() => serverSnapshot(destination)?.connection.name === 'Autostart');
    } finally {
      client.createStart = start;
      store.clearAdd(hostId);
    }
  }, 60_000);

  test('refreshing host info clears an offline status and ignores an older failure', async () => {
    const store = await import('../src/features/servers/hosts-store');
    await store.refreshHosts();
    const hostId = store.hosts()[0].id;
    const client = await store.hostCommand(async (api) => api);
    const servers = client.servers;
    try {
      client.servers = async () => { throw { code: 'timeout' }; };
      await expect(store.loadHostServers(hostId)).rejects.toMatchObject({ code: 'timeout' });
      expect(store.hostReach(hostId)).toBe('offline');
      expect(store.hostProblem(hostId)?.code).toBe('timeout');

      let failOlder;
      const sent = Promise.withResolvers();
      client.servers = () => {
        const reply = Promise.withResolvers();
        failOlder = reply.reject;
        sent.resolve();
        return reply.promise;
      };
      const older = store.loadHostServers(hostId).catch(() => undefined);
      await sent.promise;
      await store.loadHostInfo(hostId);
      failOlder({ code: 'timeout' });
      await older;
      expect(store.hostReach(hostId)).toBe('online');
      expect(store.hostProblem(hostId)).toBeUndefined();
    } finally {
      client.servers = servers;
    }
  });

  test('a completed import stays stopped and its installation task finishes', async () => {
    const store = await import('../src/features/servers/hosts-store');
    const activity = await import('../src/features/activity/activity-store');
    const client = await store.hostCommand(async (api) => api);
    const fixture = createHostFixtures({ hosts: 'one' });
    const [host] = await fixture.list();
    const hostId = host.id;
    const original = { importPlan: client.importPlan, importJob: client.importJob, importApply: client.importApply, importStart: client.importStart, servers: client.servers };
    let starts = 0;
    Object.assign(client, {
      importPlan: fixture.importPlan, importJob: fixture.importJob, importApply: fixture.importApply, servers: fixture.servers,
      importStart: async (...args) => { starts += 1; return fixture.importStart(...args); },
    });
    try {
      const displayPath = '/home/eatham/servers/Survival';
      const { folderToken: token } = await fixture.folderCheck(hostId, displayPath);
      expect(token).toBeTruthy();
      const folder = { displayPath, token };
      const body = { folderToken: token, name: 'Imported', gamePort: 25582, memoryMiB: 2048, launchChoice: null, minecraftVersion: null };
      await store.planAdd(hostId, { mode: 'import', folder, body }, body.name);
      await until(() => store.addTask(hostId)?.job?.state === 'blocked');
      await store.replanAdd(hostId);
      await until(() => store.addTask(hostId)?.job?.review?.confirmation);
      const id = await store.applyAdd(hostId, store.addTask(hostId).job.review.warnings);
      expect(id).toBeTruthy();
      await until(() => store.addTask(hostId)?.job?.state === 'ready');
      const task = store.addTask(hostId);
      expect(store.isActiveAdd(task)).toBe(false);
      expect(activity.activities().find((entry) => entry.id === `server-add:${hostId}:${task.jobId}`)?.state).toBe('done');
      await until(() => store.hostServers(hostId).some((server) => server.serverId === task.serverId && server.state === 'stopped'));
      expect(starts).toBe(0);
    } finally {
      Object.assign(client, original);
      store.clearAdd(hostId);
    }
  }, 30_000);

  test('the wizard offers modes in order, reattaches to jobs and never uses details triangles', () => {
    const wizard = source('src/pages/servers/host-add.tsx');
    expect(wizard).not.toMatch(/<details|<summary/);
    expect(source('src/pages/servers/host-import.tsx')).not.toMatch(/<details|<summary/);
    expect(wizard).toContain('recheckAdd(props.hostId)');
    // No separate Start: the finished screen is View server, with Browse modpacks beside it for a new server.
    expect(wizard).not.toContain("t('vesta-server.import.start')");
    expect(wizard).toContain("t('server-add.progress.view')");
    expect(wizard).toContain("type: 'modpack', destination: 'server'");
    expect(wizard).not.toMatch(/modpack: 'server-add/);
    expect(source('src/pages/servers/servers-page.tsx')).toContain('<InstallingServerCard');
  });

  test('the wizard never drops New quietly, offers Start over, and uses the install memory card', () => {
    const wizard = source('src/pages/servers/host-add.tsx');
    // Failing suggestions fall back to local ones with a retry line.
    expect(wizard).toContain('localDefaults(spare)');
    expect(wizard).toContain("t('server-add.defaults.failed'");
    expect(wizard).toContain('catalogue: versions() !== null');
    // Start over only when something came back or changed, and never while a job runs.
    expect(wizard).toContain('const canDiscard = () => (restored() || changed()) && !working()');
    expect(wizard.slice(wizard.indexOf('const reset = '), wizard.indexOf('const stage = '))).not.toContain('cancelAdd');
    // One memory control everywhere the wizard asks, the install page's card.
    expect(wizard).toContain('<ServerMemoryCard');
    expect(wizard).not.toContain('<Slider');
    expect(source('src/pages/servers/server-memory-card.tsx')).toContain('data-vesta="install-memory-card"');
    expect(source('src/pages/create/memory-card.tsx')).toContain("import \"./memory-card.css\"");
  });

  test('copy has no dashes, semicolons or arrows and never says agent', () => {
    const lines = source('src/localization/locales/en/server-add.ftl').split('\n').filter((line) => /^server-add-[a-z0-9-]+ = /.test(line));
    expect(lines.length).toBeGreaterThan(100);
    for (const line of lines) {
      const value = line.slice(line.indexOf('=') + 1);
      expect(value, line).not.toMatch(/\bagent\b|\bAMP\b| - | – | — |;|→|->/i);
    }
  });
});
