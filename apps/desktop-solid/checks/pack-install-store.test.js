// The per-server install job store: one job per server that outlives any page, attaches instead
// of restarting, refuses a second install, and picks up agent jobs after a launcher restart.
import { beforeEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// The store runs against stub server, localization, activity and cache modules, scoped to this
// build so nothing leaks into other test files.
async function harness() {
  const app = fileURLToPath(new URL('..', import.meta.url));
  const storePath = JSON.stringify(fileURLToPath(new URL('../src/features/servers/pack-install-store.ts', import.meta.url)));
  const activityPath = JSON.stringify(fileURLToPath(new URL('../src/features/servers/pack-install-activity.ts', import.meta.url)));
  const built = await Bun.build({
    entrypoints: ['pack-install-store-check'], target: 'bun', conditions: ['browser', 'development'],
    plugins: [{ name: 'pack-install-store-check', setup(build) {
      build.onResolve({ filter: /^pack-install-store-check$/ }, () => ({ path: 'check', namespace: 'check' }));
      build.onLoad({ filter: /.*/, namespace: 'check' }, () => ({ loader: 'js', resolveDir: app, contents: `
        export * as store from ${storePath};
        export * as activity from ${activityPath};
        export { state } from 'harness-state';
        export { untrack, flush } from 'solid-js';
      ` }));
      build.onResolve({ filter: /^harness-state$/ }, () => ({ path: 'state', namespace: 'harness-state' }));
      build.onLoad({ filter: /.*/, namespace: 'harness-state' }, () => ({ loader: 'js', contents:
        'export const state = { calls: [], handlers: {}, activities: new Map(), cancels: new Map(), invalidations: [] };' }));
      const stub = (pattern, contents) => build.onLoad({ filter: pattern }, () => ({ loader: 'js', contents: "import { state } from 'harness-state';\n" + contents }));
      stub(/features[\\/]servers[\\/]store\.ts$/, `
        export const serverCommand = (fn) => fn(new Proxy({}, { get: (_, name) => (...args) => {
          state.calls.push([name, ...args]);
          return state.handlers[name] ? state.handlers[name](...args) : Promise.reject({ code: 'internal' });
        } }));
        export const serverSnapshot = () => ({ connection: { name: 'Survival' } });`);
      stub(/localization[\\/]index\.ts$/, 'export const t = (id, args) => (args ? id + JSON.stringify(args) : id);');
      stub(/features[\\/]activity[\\/]activity-store\.ts$/, `
        export const receiveActivity = (patch) => state.activities.set(patch.id, { ...state.activities.get(patch.id), ...patch });
        export const registerActivityCancel = (prefix, handler) => state.cancels.set(prefix, handler);`);
      stub(/features[\\/]servers[\\/]resources\.ts$/, `
        export const invalidateServerResources = (id, names) => state.invalidations.push([id, names]);
        export const seedServerResource = () => {};`);
      stub(/features[\\/]servers[\\/]server-resources\.ts$/, "export const CONTENT_RESOURCES = ['content']; export const packWorkspaceResource = { name: 'pack-workspace' };");
    } }],
  });
  if (!built.success) throw new AggregateError(built.logs);
  const dir = await mkdtemp(join(tmpdir(), 'vesta-pack-install-store-'));
  try {
    const path = join(dir, 'check.mjs');
    await Bun.write(path, built.outputs[0]);
    return await import(pathToFileURL(path).href);
  } finally { await rm(dir, { recursive: true, force: true }); }
}

const check = await harness();
const { store, untrack, flush } = check;
check.activity.installPackActivity();
const { calls, handlers, activities, cancels, invalidations } = check.state;
// Logic reads the always-current store state; views read the signal after a flush.
const state = (id) => store.peekPackInstallJob(id);
const phase = (id) => store.peekPackJobPhase(id);
const busy = (id) => store.peekPackInstallBusy(id);

let serial = 0;
const freshId = () => `server-${++serial}`;
const source = { source: 'provider', provider: 'modrinth', projectId: 'atm', versionId: 'v1' };
const request = { source, name: 'All the Mods', mode: 'link' };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const plan = (extra = {}) => ({ planId: 'p', confirmationToken: 'c', expiresAtMs: Date.now() + 600_000, files: [], warnings: [], removed: [], valid: true, softwareSwitchRequired: false, ...extra });
const workspace = (installJob, installProgress = null) => ({ installJob, installProgress, draft: { revision: '1', manifest: { entries: [] } } });
const until = async (check, ms = 4000) => { const end = Date.now() + ms; while (!check()) { if (Date.now() > end) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 20)); } };

beforeEach(() => {
  calls.length = 0; invalidations.length = 0;
  for (const key of Object.keys(handlers)) delete handlers[key];
  handlers.packDraft = () => Promise.resolve(workspace(null));
});

test('a review request belongs to the server, not the page that opened it', () => {
  const id = freshId();
  store.openInstallReview(id, request);
  expect(state(id).request).toEqual(request);
  // Another server is unaffected; reading this one again (as a remounted page would) finds it.
  expect(state(freshId()).request).toBeNull();
  expect(state(id).request?.name).toBe('All the Mods');
  // Views see the same state once Solid flushes.
  flush();
  expect(untrack(() => store.packInstallJob(id)).request?.name).toBe('All the Mods');
  expect(untrack(() => store.packJobPhase(id))).toBeNull();
  store.openInstallReview(id, null);
  expect(state(id).request).toBeNull();
});

test('reopening the review attaches to the running preparation instead of restarting it', async () => {
  const id = freshId();
  const pending = deferred();
  handlers.packInstallPlan = () => pending.promise;
  const first = store.preparePlan(id, source);
  const second = store.preparePlan(id, source);
  expect(second).toBe(first);
  expect(calls.filter(([name]) => name === 'packInstallPlan')).toHaveLength(1);
  expect(phase(id)).toBe('preparing');
  pending.resolve(plan());
  await first;
  expect(phase(id)).toBeNull();
  // A prepared, unexpired plan is reused without another agent request.
  expect(store.preparedPlan(id, source)).toBeDefined();
  await store.preparePlan(id, source);
  expect(calls.filter(([name]) => name === 'packInstallPlan')).toHaveLength(1);
});

test('preparation polls live progress and records when it last moved', async () => {
  const id = freshId();
  const pending = deferred();
  handlers.packInstallPlan = () => pending.promise;
  handlers.packDraft = () => Promise.resolve(workspace(null, { stage: 'download_verify', completed: 0, total: 0, bytesCompleted: 5 * 1048576 }));
  const before = Date.now();
  const prepared = store.preparePlan(id, source);
  await until(() => state(id).progress?.stage === 'download_verify');
  expect(state(id).progress.bytesCompleted).toBe(5 * 1048576);
  expect(state(id).lastChangeAt).toBeGreaterThanOrEqual(before);
  pending.resolve(plan());
  await prepared;
});

test('cancelling preparation abandons it, closes the review and cancels an uploaded archive', async () => {
  const id = freshId();
  const pending = deferred();
  handlers.packInstallPlan = () => pending.promise;
  handlers.packUploadCancel = () => Promise.resolve(true);
  store.openInstallReview(id, { ...request, uploadId: 'upload-1' });
  const prepared = store.preparePlan(id, source);
  store.cancelInstall(id);
  expect(phase(id)).toBeNull();
  expect(state(id).request).toBeNull();
  expect(calls.some(([name, , uploadId]) => name === 'packUploadCancel' && uploadId === 'upload-1')).toBe(true);
  pending.resolve(plan());
  await expect(prepared).rejects.toMatchObject({ reason: store.PREPARATION_CANCELLED });
  expect(store.preparationCancelled(await prepared.catch((e) => e))).toBe(true);
});

test('a running install blocks a second review and a second run', async () => {
  const id = freshId();
  const apply = deferred();
  handlers.packInstallApply = () => apply.promise;
  const run = store.runInstall(id, { body: { planId: 'p' }, backupProfile: null, resetWorld: null, softwareSwitch: false });
  await until(() => phase(id) === 'installing');
  expect(busy(id)).toBe(true);
  store.openInstallReview(id, request);
  expect(state(id).request).toBeNull();
  await store.runInstall(id, { body: { planId: 'other' }, backupProfile: null, resetWorld: null, softwareSwitch: false });
  expect(calls.filter(([name]) => name === 'packInstallApply')).toHaveLength(1);
  // Agent writes cannot be stopped from the launcher.
  store.cancelInstall(id);
  expect(phase(id)).toBe('installing');
  apply.resolve({ state: 'applied', pendingIds: [], softwareJobId: null, decisions: ['kept:config/a.toml'] });
  await run;
  expect(phase(id)).toBe('succeeded');
  expect(state(id).outcome.decisions).toEqual(['kept:config/a.toml']);
  expect(busy(id)).toBe(false);
});

test('an accepted agent job is followed to completion and refreshes server pages', async () => {
  const id = freshId();
  let agent = { id: 'job-old', state: 'succeeded', error: null };
  handlers.packDraft = () => Promise.resolve(workspace(agent, agent.state === 'staging' ? { stage: 'writing', completed: 3, total: 10 } : null));
  handlers.softwareJobs = () => Promise.resolve([]);
  handlers.packInstallApply = () => { agent = { id: 'job-new', state: 'staging', error: null }; return Promise.resolve({ state: 'queued', pendingIds: [], softwareJobId: 'job-new', decisions: [] }); };
  const revision = state(id).revision;
  const run = store.runInstall(id, { body: { planId: 'p' }, backupProfile: null, resetWorld: null, softwareSwitch: false });
  await until(() => state(id).progress?.stage === 'writing');
  expect(phase(id)).toBe('installing');
  agent = { id: 'job-new', state: 'succeeded', error: null, decisions: ['replaced:mods/x.jar'] };
  await run;
  expect(phase(id)).toBe('succeeded');
  expect(state(id).outcome.decisions).toEqual(['replaced:mods/x.jar']);
  expect(state(id).revision).toBe(revision + 1);
  expect(invalidations.some(([target, names]) => target === id && names.includes('software'))).toBe(true);
});

test('a failed agent job ends the run with its reason and step', async () => {
  const id = freshId();
  let agent = null;
  handlers.packDraft = () => Promise.resolve(workspace(agent));
  handlers.softwareJobs = () => Promise.resolve([]);
  handlers.packInstallApply = () => { agent = { id: 'job-x', state: 'staging', error: null }; return Promise.resolve({ state: 'queued', pendingIds: [], softwareJobId: 'job-x', decisions: [] }); };
  const run = store.runInstall(id, { body: { planId: 'p' }, backupProfile: null, resetWorld: null, softwareSwitch: true });
  await until(() => state(id).agent?.id === 'job-x');
  agent = { id: 'job-x', state: 'recovery_required', error: 'software_activation_failed' };
  await run;
  expect(phase(id)).toBe('recovery');
  expect(state(id).failedAt).toBe('switch');
  expect(state(id).error).toMatchObject({ reason: 'software_activation_failed' });
});

test('a failed backup stops before installing and can be retried from the review', async () => {
  const id = freshId();
  handlers.backupRun = () => Promise.resolve({ id: 'b1', state: 'failed' });
  handlers.packInstallApply = () => Promise.reject({ code: 'internal' });
  store.openInstallReview(id, request);
  await store.runInstall(id, { body: { planId: 'p' }, backupProfile: 'daily', resetWorld: null, softwareSwitch: false });
  expect(phase(id)).toBe('failed');
  expect(state(id).failedAt).toBe('backup');
  expect(calls.some(([name]) => name === 'packInstallApply')).toBe(false);
  store.retryInstall(id);
  expect(phase(id)).toBeNull();
  expect(state(id).request).toEqual(request);
});

test('a failed world reset retries only the reset; the pack is already installed', async () => {
  const id = freshId();
  let resets = 0;
  handlers.packInstallApply = () => Promise.resolve({ state: 'applied', pendingIds: [], softwareJobId: null, decisions: [] });
  handlers.newWorld = () => (++resets === 1 ? Promise.reject({ code: 'timeout' }) : Promise.resolve({}));
  await store.runInstall(id, { body: { planId: 'p' }, backupProfile: null, resetWorld: { name: 'world', revision: 'r1' }, softwareSwitch: false });
  expect(phase(id)).toBe('failed');
  expect(state(id).failedAt).toBe('world');
  store.retryInstall(id);
  await until(() => phase(id) === 'succeeded');
  expect(calls.filter(([name]) => name === 'packInstallApply')).toHaveLength(1);
  expect(resets).toBe(2);
});

test('after a launcher restart, a workspace read adopts the running agent install', async () => {
  const id = freshId();
  let agent = { id: 'job-r', state: 'staging', error: null };
  handlers.packDraft = () => Promise.resolve(workspace(agent, { stage: 'writing', completed: 1, total: 4 }));
  store.observeWorkspace(id, workspace(agent, { stage: 'writing', completed: 1, total: 4 }));
  expect(phase(id)).toBe('installing');
  expect(state(id).shape.adopted).toBe(true);
  expect(busy(id)).toBe(true);
  expect(state(id).request).toBeNull();
  const revision = state(id).revision;
  agent = { id: 'job-r', state: 'succeeded', error: null };
  await until(() => state(id).revision === revision + 1);
  expect(phase(id)).toBe('succeeded');
  expect(state(id).error).toBeNull();
  expect(busy(id)).toBe(false);
});

test('an interrupted install is shown once and stays dismissed', () => {
  const saved = new Map();
  globalThis.localStorage = { getItem: (k) => saved.get(k) ?? null, setItem: (k, v) => saved.set(k, v) };
  try {
    const id = freshId();
    const interrupted = { id: 'job-i', state: 'failed', error: 'software_staging_interrupted' };
    store.observeWorkspace(id, workspace(interrupted));
    expect(phase(id)).toBe('interrupted');
    expect(busy(id)).toBe(false);
    store.dismissInstallResult(id);
    expect(phase(id)).toBeNull();
    // The same job read again (another visit, or after restart) stays dismissed.
    store.observeWorkspace(id, workspace(interrupted));
    expect(phase(id)).toBeNull();
    // An old success is not news.
    const other = freshId();
    store.observeWorkspace(other, workspace({ id: 'job-s', state: 'succeeded', error: null }));
    expect(phase(other)).toBeNull();
  } finally { delete globalThis.localStorage; }
});

test('the install appears in the activity panel and cancels through it while cancellable', async () => {
  const id = freshId();
  const pending = deferred();
  handlers.packInstallPlan = () => pending.promise;
  store.openInstallReview(id, request);
  const prepared = store.preparePlan(id, source).catch(() => {});
  const row = [...activities.values()].find((entry) => entry.id.startsWith(`server-pack:${id}:`));
  expect(row).toMatchObject({ kind: 'modpack_install', state: 'running', cancellable: true, target: { route: `/servers/${id}/pack` } });
  expect(row.title).toContain('All the Mods');
  expect(row.title).toContain('Survival');
  cancels.get('server-pack:')(row.id);
  expect(activities.get(row.id).state).toBe('cancelled');
  expect(phase(id)).toBeNull();
  pending.resolve(plan());
  await prepared;
});
