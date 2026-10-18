import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

async function harness(run) {
  const directory = await mkdtemp(join(tmpdir(), 'vesta-project-cache-'));
  const key = `projectCache${crypto.randomUUID().replaceAll('-', '')}`;
  const control = {
    project: { id: 'p', source: 'modrinth', description: 'Full description' },
    batch: [{ id: 'p', source: 'modrinth', description: null }],
    versions: [{ id: 'v', version_number: '1.0' }],
    projectReads: 0,
    detailReads: [],
    peerReads: 0,
    peer: null,
  };
  globalThis[key] = control;
  try {
    const entry = join(directory, 'entry.ts');
    await Bun.write(entry, `
      export * from ${JSON.stringify(new URL('../src/features/browse/browse-projects.ts', import.meta.url).pathname)};
      export { createRoot, createEffect, flush } from 'solid-js';
      export { captureArtifact } from '@solidjs/diagnostics';
    `);
    const built = await Bun.build({ entrypoints: [entry], target: 'bun', conditions: ['browser', 'development'],
      plugins: [{ name: 'project-cache-boundaries', setup(build) {
        build.onResolve({ filter: /^solid-js$|^@solidjs\/diagnostics$/ }, ({ path }) => ({ path: new URL(path === 'solid-js' ? '../node_modules/solid-js/dist/solid.dev.js' : '../node_modules/@solidjs/diagnostics/dist/index.js', import.meta.url).pathname }));
        build.onResolve({ filter: /^\.\/browse-api$/ }, () => ({ path: 'api', namespace: 'fixture' }));
        build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ loader: 'js', contents: `
          const c = globalThis[${JSON.stringify(key)}];
          export const fetchProject = async () => { c.projectReads++; return c.project; };
          export const fetchProjects = async () => c.batch;
          export const fetchVersions = async () => c.versions;
          export const fetchPeerProject = async (project) => { c.peerReads++; return typeof c.peer === 'function' ? c.peer(project) : c.peer; };
          export const fetchVersionDetails = async (...args) => { c.detailReads.push(args); return {version: c.versions[0], changelog_status: args[3] ? 'available' : 'unavailable'}; };
        ` }));
      } }] });
    if (!built.success) throw new AggregateError(built.logs, 'Project cache harness failed');
    const path = join(directory, 'harness.mjs');
    await Bun.write(path, built.outputs[0]);
    await run(await import(pathToFileURL(path).href), control);
  } finally {
    delete globalThis[key];
    await rm(directory, { recursive: true, force: true });
  }
}

test('dependency summaries cannot satisfy or overwrite full project detail loads', () => harness(async (api, c) => {
  await api.loadProjects('modrinth', ['p']);
  expect(api.peekProject('modrinth', 'p').description).toBeNull();
  expect((await api.loadProject('modrinth', 'p')).description).toBe('Full description');
  expect(c.projectReads).toBe(1);
  let finish;
  c.batch = new Promise((resolve) => { finish = resolve; });
  const batch = api.loadProjects('modrinth', ['alias']);
  finish([{ id: 'p', source: 'modrinth', description: null }]);
  await batch;
  expect(api.peekProject('modrinth', 'p').description).toBe('Full description');
}));

test('reactive peeks observe the committed project and version cache contents', () => harness(async (api) => {
  const seen = [];
  let dispose;
  const { artifact } = await api.captureArtifact(async () => {
    api.createRoot((stop) => {
      dispose = stop;
      api.createEffect(() => [api.peekProject('modrinth', 'p'), api.peekVersions('modrinth', 'p')],
        (values) => { seen.push(values); }, { name: 'projectBreadcrumbCache' });
    });
    api.flush();
    await api.loadProject('modrinth', 'p');
    api.flush();
    expect(seen.at(-1)[0]?.description).toBe('Full description');
    await api.loadVersions('modrinth', 'p');
    api.flush();
    expect(seen.at(-1)[1]?.[0].id).toBe('v');
    dispose();
    api.flush();
  }, { scenario: 'project-cache-reactive-peeks' });
  expect(artifact.diagnostics.filter((event) => event.severity === 'error')).toEqual([]);
}));

test('changelog retry bypasses frontend freshness and the host cache', () => harness(async (api, c) => {
  expect((await api.loadVersionDetails('modrinth', 'p', 'v')).changelog_status).toBe('unavailable');
  expect((await api.loadVersionDetails('modrinth', 'p', 'v', true)).changelog_status).toBe('available');
  expect(c.detailReads.map((args) => args[3])).toEqual([false, true]);
}));


test('peer lookup is lazy, joins concurrent calls, caches misses and reuses reverse identity', () => harness(async (api, c) => {
  api.seedProjects([c.project]);
  await api.loadProject('modrinth', 'p');
  expect(c.peerReads).toBe(0);
  const peer = { source: 'curseforge', id: '42' };
  c.peer = peer;
  const [full, identity] = await Promise.all([api.loadPeerProject(c.project), api.loadPeerProjectId(c.project)]);
  expect(full).toEqual(peer);
  expect(identity).toEqual(peer);
  expect(c.peerReads).toBe(1);
  expect(await api.loadPeerProjectId(peer)).toEqual({ source: 'modrinth', id: 'p' });
  expect(c.peerReads).toBe(1);
  c.peer = null;
  const missing = { source: 'modrinth', id: 'absent' };
  expect(await api.loadPeerProjectId(missing)).toBeNull();
  expect(await api.loadPeerProjectId(missing)).toBeNull();
  expect(c.peerReads).toBe(2);
  expect(await api.loadPeerProjectId({ source: 'smithed', id: 'pack' })).toBeNull();
  expect(c.peerReads).toBe(2);
}));


test('opposite-direction peer lookups do not invalidate each other in flight', () => harness(async (api, c) => {
  const first = { source: 'modrinth', id: 'p' };
  const second = { source: 'curseforge', id: '42' };
  c.peer = (project) => project.source === 'modrinth' ? second : first;
  expect(await Promise.all([api.loadPeerProjectId(first), api.loadPeerProjectId(second)])).toEqual([second, first]);
  expect(c.peerReads).toBe(2);
}));
