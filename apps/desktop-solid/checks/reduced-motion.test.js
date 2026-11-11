import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Run the actual Solid effects with deterministic media, pointer and frame boundaries.
async function harness() {
  const root = fileURLToPath(new URL('../', import.meta.url)).replaceAll('\\', '/');
  const fixtures = {
    'motion-entry': `
      import {createRoot, untrack, flush} from 'solid-js';
      import {useReducedMotion, reducedMotion} from '${root}src/features/settings/reduced-motion.ts';
      import {useWelcomeLight} from '${root}src/pages/welcome/welcome-light.ts';
      import {light} from 'motion-environment';
      export {captureArtifact, expectNoDiagnostics, assertBudget} from '@solidjs/diagnostics';
      export {flush};
      export * from 'motion-environment';
      export {setApp} from 'motion-settings';
      export function mount() {return createRoot(dispose => {
        useReducedMotion(); useWelcomeLight(() => light);
        return {dispose, effective: () => untrack(reducedMotion)};
      });}
    `,
    'motion-settings': `
      import {createSignal} from 'solid-js';
      const [app, setApp] = createSignal(false, {name:'testAppMotion'});
      export {setApp}; export const setting = () => app();
    `,
    'motion-environment': `
      const mediaListeners = new Set(), pointerListeners = new Set(), frames = new Map();
      let next = 0;
      const attributes = new Set(), styles = new Map();
      export const light = {style: {
        setProperty: (key,value) => styles.set(key,value), removeProperty: key => styles.delete(key)
      }};
      const media = {matches:false,
        addEventListener: (_, fn) => mediaListeners.add(fn),
        removeEventListener: (_, fn) => mediaListeners.delete(fn)
      };
      export const matchMedia = () => media;
      export const document = {documentElement: {
        toggleAttribute: (key,enabled) => enabled ? attributes.add(key) : attributes.delete(key),
        removeAttribute: key => attributes.delete(key)
      }};
      export const window = {innerWidth:1000, innerHeight:500,
        addEventListener: (_,fn) => pointerListeners.add(fn),
        removeEventListener: (_,fn) => pointerListeners.delete(fn)
      };
      export const requestAnimationFrame = fn => {frames.set(++next,fn); return next;};
      export const cancelAnimationFrame = id => frames.delete(id);
      export function setOS(value) {media.matches=value; for(const fn of mediaListeners) fn();}
      export function move(x,y) {for(const fn of pointerListeners) fn({clientX:x,clientY:y});}
      export function paint() {const list=[...frames.values()];frames.clear();for(const fn of list) fn();}
      export const snapshot = () => ({
        reduced: attributes.has('data-vesta-reduced-motion'),
        subscriptions:mediaListeners.size, pointers:pointerListeners.size, frames:frames.size,
        x:styles.get('--welcome-light-x'), y:styles.get('--welcome-light-y')
      });
    `,
  };
  const built = await Bun.build({ entrypoints: ['motion-entry'], target: 'bun', conditions: ['browser', 'development'],
    plugins: [{ name: 'motion-boundaries', setup(build) {
      build.onResolve({ filter: /^motion-(entry|settings|environment)$/ }, ({ path }) => ({ path, namespace: 'fixture' }));
      build.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ contents: fixtures[path], loader: 'js', resolveDir: root }));
      build.onResolve({ filter: /^\.\/config$/ }, () => ({ path: 'motion-settings', namespace: 'fixture' }));
      build.onLoad({ filter: /reduced-motion\.ts$/ }, async ({ path }) => ({ loader: 'ts', contents:
        `import {document, matchMedia} from 'motion-environment';\n` + await Bun.file(path).text() }));
      build.onLoad({ filter: /welcome-light\.ts$/ }, async ({ path }) => ({ loader: 'ts', contents:
        `import {window, requestAnimationFrame, cancelAnimationFrame} from 'motion-environment';\n` + await Bun.file(path).text() }));
    }}],
  });
  if (!built.success) throw new AggregateError(built.logs, 'Motion harness failed');
  const directory = await mkdtemp(join(tmpdir(), 'vesta-motion-'));
  try {
    const path = join(directory, 'harness.mjs'); await Bun.write(path, built.outputs[0]);
    return await import(pathToFileURL(path).href);
  } finally { await rm(directory, { recursive: true, force: true }); }
}
const runtime = await harness();
const tick = async () => { runtime.flush(); await new Promise(resolve => setTimeout(resolve, 0)); runtime.flush(); };

test('OS and app motion preferences combine reactively, including a live OS change', async () => {
  const { artifact } = await runtime.captureArtifact(async () => {
    runtime.setApp(false); runtime.setOS(false);
    const owner = runtime.mount();
    try {
      await tick();
      expect(owner.effective()).toBe(false);
      expect(runtime.snapshot()).toMatchObject({ reduced: false, subscriptions: 1, pointers: 1 });
      runtime.setOS(true); await tick();
      expect(owner.effective()).toBe(true);
      expect(runtime.snapshot()).toMatchObject({ reduced: true, pointers: 0 });
      runtime.setApp(true); runtime.setOS(false); await tick();
      expect(owner.effective()).toBe(true);
      runtime.setApp(false); await tick();
      expect(owner.effective()).toBe(false);
      expect(runtime.snapshot()).toMatchObject({ reduced: false, pointers: 1 });
    } finally { owner.dispose(); }
    expect(runtime.snapshot()).toMatchObject({ reduced: false, pointers: 0, subscriptions: 0 });
  }, { scenario: 'effective-motion-preference' });
  runtime.expectNoDiagnostics(artifact);
});

test('reduced motion cancels pending decoration frames and centers the light; normal tracking coalesces', async () => {
  const { artifact } = await runtime.captureArtifact(async () => {
    runtime.setApp(false); runtime.setOS(false);
    const owner = runtime.mount();
    try {
      await tick();
      runtime.move(100, 100); runtime.move(250, 200);
      expect(runtime.snapshot().frames).toBe(1);
      runtime.paint();
      expect(runtime.snapshot()).toMatchObject({ x: '25%', y: '40%', frames: 0 });
      runtime.move(500, 250);
      runtime.setOS(true); await tick();
      expect(runtime.snapshot()).toMatchObject({ pointers: 0, frames: 0, x: undefined, y: undefined });
      runtime.move(700, 400); runtime.paint();
      expect(runtime.snapshot()).toMatchObject({ frames: 0, x: undefined, y: undefined });
      runtime.setOS(false); await tick();
      runtime.move(500, 250); runtime.paint();
      expect(runtime.snapshot()).toMatchObject({ x: '50%', y: '50%' });
      runtime.move(100, 100);
    } finally { owner.dispose(); }
    expect(runtime.snapshot()).toMatchObject({ pointers: 0, frames: 0, subscriptions: 0 });
  }, { scenario: 'decorative-motion-cancellation' });
  runtime.expectNoDiagnostics(artifact);
});

test('an OS preference already enabled before mounting suppresses pointer tracking', async () => {
  runtime.setOS(true);
  const owner = runtime.mount();
  try {
    await tick();
    expect(runtime.snapshot()).toMatchObject({ reduced: true, pointers: 0 });
    expect(owner.effective()).toBe(true);
  } finally { owner.dispose(); runtime.setOS(false); }
});
