import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  DEFAULT_SOFTWARE, SETUP_SOFTWARE, choiceProblem, needsReplan, phaseText, planRequest, releaseVersions, reviewSize, setupReason, setupRow, stepFor,
} from '../src/features/servers/first-server-model.ts';
import { addRoute } from '../src/features/servers/onboarding-model.ts';

test('software is offered in plain words, Vanilla first and the rarer types under More', () => {
  expect(DEFAULT_SOFTWARE).toBe('vanilla');
  expect(SETUP_SOFTWARE.filter((entry) => !entry.more).map((entry) => entry.id)).toEqual(['vanilla', 'paper', 'fabric', 'neoforge', 'forge']);
  expect(SETUP_SOFTWARE.filter((entry) => entry.more).map((entry) => entry.id)).toEqual(['purpur', 'quilt', 'folia']);
});

test('only full releases are offered, newest first', () => {
  expect(releaseVersions(['1.21.4', '24w44a', '1.21.4-rc1', '1.21.3-pre2', '1.21.1'])).toEqual(['1.21.4', '1.21.1']);
});

test('a choice needs a name and a version; the host picks the newest build and loader', () => {
  expect(choiceProblem({ name: '  ', software: 'vanilla', version: '1.21.4' })).toBe('servers.first.name-empty');
  expect(choiceProblem({ name: 'x'.repeat(65), software: 'vanilla', version: '1.21.4' })).toBe('servers.first.name-long');
  expect(choiceProblem({ name: 'Riverside', software: 'paper', version: '' })).toBe('servers.first.version-empty');
  expect(choiceProblem({ name: 'Riverside', software: 'paper', version: '1.21.4' })).toBeNull();
  expect(planRequest({ name: '  Riverside ', software: 'fabric', version: '1.21.4' })).toEqual({
    kind: 'install', name: 'Riverside', software: 'fabric', version: '1.21.4', build: null, loaderVersion: null, experimental: false,
  });
});

test('host job states map onto the setup steps', () => {
  expect(stepFor('planning')).toBe('preparing');
  expect(stepFor('review')).toBe('review');
  expect(stepFor('applying')).toBe('installing');
  expect(stepFor('ready')).toBe('installing');
  expect(stepFor('complete')).toBe('finishing');
  expect(stepFor('failed')).toBe('failed');
  expect(stepFor('interrupted')).toBe('failed');
});

test('the step row shows where setup is, and where it failed', () => {
  const row = (step, at) => setupRow(step, at).map((entry) => `${entry.id}:${entry.state}`).join(' ');
  expect(row('choose')).toBe('choose:current prepare:upcoming install:upcoming ready:upcoming');
  expect(row('preparing')).toBe('choose:done prepare:current install:upcoming ready:upcoming');
  expect(row('review')).toBe('choose:done prepare:current install:upcoming ready:upcoming');
  expect(row('installing')).toBe('choose:done prepare:done install:current ready:upcoming');
  expect(row('ready')).toBe('choose:done prepare:done install:done ready:done');
  expect(row('failed', 'prepare')).toBe('choose:done prepare:failed install:upcoming ready:upcoming');
  expect(row('failed', 'install')).toBe('choose:done prepare:done install:failed ready:upcoming');
});

test('host phases read as words; unknown phases fall back to the step', () => {
  expect(phaseText('preparing', 'metadata')).toBe('servers.first.phase-metadata');
  expect(phaseText('preparing', 'Downloading')).toBe('servers.first.phase-downloading');
  expect(phaseText('installing', 'something-new')).toBe('servers.first.phase-installing');
  expect(phaseText('finishing', null)).toBe('servers.first.phase-finishing');
});

test('sizes and failure reasons are presented plainly', () => {
  expect(reviewSize(String(61 * 1048576))).toBe('61 MB');
  expect(reviewSize('2048')).toBe('2 KB');
  expect(reviewSize('not-a-number')).toBe('');
  expect(setupReason('setup_interrupted_replan_required')).toBe('servers.first.error-interrupted');
  expect(setupReason('setup_local_configuration_required')).toBe('servers.first.error-local-config');
  expect(setupReason('something_else')).toBeNull();
  expect(needsReplan('setup_review_changed')).toBe(true);
  expect(needsReplan('setup_provisioning_failed')).toBe(false);
});

test('/servers/add/setup/<id> opens first-server setup for that connection', () => {
  expect(addRoute('setup', 'c1')).toEqual({ kind: 'setup', connectionId: 'c1' });
  expect(addRoute('setup', undefined)).toEqual({ kind: 'reconnect', connectionId: 'setup' });
});

// ---- Store: the whole journey against a host that behaves like the real one, isolated build.
async function harness() {
  const app = fileURLToPath(new URL('..', import.meta.url));
  const storePath = JSON.stringify(fileURLToPath(new URL('../src/features/servers/first-server-store.ts', import.meta.url)));
  const built = await Bun.build({
    entrypoints: ['first-server-check'], target: 'bun', conditions: ['browser', 'development'],
    plugins: [{ name: 'first-server-check', setup(build) {
      build.onResolve({ filter: /^first-server-check$/ }, () => ({ path: 'check', namespace: 'check' }));
      build.onLoad({ filter: /.*/, namespace: 'check' }, () => ({ loader: 'js', resolveDir: app, contents: `
        export * as store from ${storePath};
        export { state } from 'harness-state';
      ` }));
      build.onResolve({ filter: /^harness-state$/ }, () => ({ path: 'state', namespace: 'harness-state' }));
      build.onLoad({ filter: /.*/, namespace: 'harness-state' }, () => ({ loader: 'js', contents: 'export const state = { snapshots: new Map(), put: [] };' }));
      const stub = (pattern, contents) => build.onLoad({ filter: pattern }, () => ({ loader: 'js', contents: "import { state } from 'harness-state';\n" + contents }));
      stub(/features[\\/]servers[\\/]store\.ts$/, `
        export const serverCommand = (run) => run({});
        export const serverSnapshot = (id) => state.snapshots.get(id);
        export const putSnapshot = (snapshot) => { state.put.push(snapshot); state.snapshots.set(snapshot.connection.id, snapshot); };`);
      stub(/features[\\/]servers[\\/]service\.ts$/, 'export const usingFixtures = false;');
      stub(/features[\\/]servers[\\/]native-setup\.ts$/, 'export const serversSetupNative = {};');
    } }],
  });
  if (!built.success) throw new AggregateError(built.logs);
  const dir = await mkdtemp(join(tmpdir(), 'vesta-first-server-'));
  try {
    const path = join(dir, 'check.mjs');
    await Bun.write(path, built.outputs[0]);
    return await import(pathToFileURL(path).href);
  } finally { await rm(dir, { recursive: true, force: true }); }
}

const check = await harness();
const { store } = check;
const until = async (predicate, ms = 8000) => { const end = Date.now() + ms; while (!predicate()) { if (Date.now() > end) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 20)); } };
const choice = { name: 'Riverside', software: 'paper', version: '1.21.4' };
let serial = 0;
const freshId = () => { const id = `host-${++serial}`; check.state.snapshots.set(id, { connection: { id, name: 'Riverside' } }); return id; };

test('setup goes choose → prepare → review → install → ready, and the managed server is published', async () => {
  store.configureSetupApi(store.createSetupFixtures({ plan: 50, apply: 50 }));
  const id = freshId();
  expect(store.peekFirstServer(id).step).toBe('choose');
  expect(await store.awaitingFirstServer(id)).toBe(true);
  await store.prepareFirstServer(id, choice);
  expect(['preparing', 'review']).toContain(store.peekFirstServer(id).step);
  await until(() => store.peekFirstServer(id).step === 'review');
  expect(store.peekFirstServer(id).job.review).toMatchObject({ name: 'Riverside', minecraftVersion: '1.21.4', software: 'paper' });
  await store.installFirstServer(id, false);
  await until(() => store.peekFirstServer(id).step === 'ready');
  expect(store.peekFirstServer(id).server.connection.id).toBe(id);
  expect(check.state.put.some((snapshot) => snapshot.connection.id === id)).toBe(true);
});

test('a second prepare while one runs is ignored; apply needs a reviewed job', async () => {
  store.configureSetupApi(store.createSetupFixtures({ plan: 200, apply: 50 }));
  const id = freshId();
  await store.prepareFirstServer(id, choice);
  const first = store.peekFirstServer(id).job.id;
  await store.prepareFirstServer(id, { ...choice, name: 'Other' });
  expect(store.peekFirstServer(id).job.id).toBe(first);
  await store.installFirstServer(id, false);
  expect(['preparing', 'review']).toContain(store.peekFirstServer(id).step);
});

test('a failed host job ends on the failure step with its reason, and Choose again starts over', async () => {
  const fixtures = store.createSetupFixtures({ plan: 50, apply: 50 });
  store.configureSetupApi({ ...fixtures, job: async (connection, jobId) => ({ ...(await fixtures.job(connection, jobId)), state: 'failed', error: 'setup_provisioning_failed' }) });
  const id = freshId();
  await store.prepareFirstServer(id, choice);
  await until(() => store.peekFirstServer(id).step === 'failed');
  expect(store.peekFirstServer(id).failedAt).toBe('prepare');
  expect(store.peekFirstServer(id).error.reason).toBe('setup_provisioning_failed');
  store.retryFirstServer(id);
  expect(store.peekFirstServer(id).step).toBe('choose');
  expect(store.peekFirstServer(id).choice).toEqual(choice);
}, 10000);

test('a job the host returns already failed names the step that failed', async () => {
  const fixtures = store.createSetupFixtures({ plan: 50, apply: 50 });
  store.configureSetupApi({ ...fixtures, plan: async (...args) => ({ ...(await fixtures.plan(...args)), state: 'interrupted', error: 'setup_interrupted_replan_required' }) });
  const id = freshId();
  await store.prepareFirstServer(id, choice);
  expect(store.peekFirstServer(id)).toMatchObject({ step: 'failed', failedAt: 'prepare', error: { reason: 'setup_interrupted_replan_required' } });
});

test('the handoff is retried while the host switches over', async () => {
  const fixtures = store.createSetupFixtures({ plan: 30, apply: 30 });
  let refusals = 2;
  store.configureSetupApi({ ...fixtures, handoff: async (connection) => { if (refusals-- > 0) throw { code: 'unreachable' }; return fixtures.handoff(connection); } });
  const id = freshId();
  await store.prepareFirstServer(id, choice);
  await until(() => store.peekFirstServer(id).step === 'review');
  await store.installFirstServer(id, false);
  await until(() => store.peekFirstServer(id).step === 'ready', 12000);
  expect(refusals).toBeLessThan(0);
}, 20000);

test('state is per server and survives leaving the page', async () => {
  store.configureSetupApi(store.createSetupFixtures({ plan: 50, apply: 50 }));
  const a = freshId(), b = freshId();
  await store.prepareFirstServer(a, choice);
  expect(store.peekFirstServer(b).step).toBe('choose');
  // Reopening resumes following without starting a new plan.
  const job = store.peekFirstServer(a).job.id;
  store.resumeFirstServer(a);
  await until(() => store.peekFirstServer(a).step === 'review');
  expect(store.peekFirstServer(a).job.id).toBe(job);
});
