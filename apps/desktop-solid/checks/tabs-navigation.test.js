import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Installed Kobalte state/collection code with an inert host boundary: no DOM or browser.
async function harness() {
  const app = new URL('../', import.meta.url).pathname;
  const directory = await mkdtemp(join(tmpdir(), 'vesta-tabs-'));
  try {
    const entrypoint = join(directory, 'fixture.js');
    await Bun.write(entrypoint, `
      import {createRoot, createSignal, createRenderEffect, flatten, flush, For} from '${app}node_modules/solid-js/dist/solid.dev.js';
      import {Tabs, useTabsContext} from '${app}node_modules/@kobalte/core/dist/tabs/index.js';
      import {t as registerItem} from '${app}node_modules/@kobalte/core/dist/create-dom-collection/F5MPGch0.js';
      export {captureArtifact} from '${app}node_modules/@solidjs/diagnostics/dist/index.js';
      export {flush};
      export async function navigation() {
        const saved = Object.fromEntries(['window', 'location', 'history'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
        const listeners = new Map(), entries = [{hash: '#/library', state: null}];
        let index = 0;
        const location = {get hash() {return entries[index].hash;}};
        const history = {
          get state() {return entries[index].state;},
          get length() {return entries.length;},
          pushState(state, _, hash) {entries.splice(++index); entries.push({state, hash});},
          replaceState(state, _, hash) {entries[index] = {state, hash};},
          back() {
            if (!index) return;
            index--;
            for (const type of ['popstate', 'hashchange'])
              for (const handler of [...(listeners.get(type) ?? [])]) handler();
          }
        };
        Object.assign(globalThis, {location, history, window: {
          addEventListener(type, handler) {if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(handler);},
          removeEventListener(type, handler) {listeners.get(type)?.delete(handler);}
        }});
        const router = await import('${app}src/app/router.ts');
        const transition = await import('${app}src/app/transition.ts');
        return {router, transition, history, location, restore() {
          for (const [key, descriptor] of Object.entries(saved))
            if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
        }};
      }
      export function mount(controlled = true) {
        return createRoot(dispose => {
          const [value, setValue] = createSignal('overview', {name: 'test.tab'});
          const [available, setAvailable] = createSignal(['overview', 'resources'], {name: 'test.tabs'});
          const changes = [], refs = new Map();
          let context;
          const output = Tabs({
            get value() {return controlled ? value() : undefined;},
            onChange(key) {changes.push(key);},
            get children() {
              context = useTabsContext();
              return For({get each() {return available();}, children(key) {
                const [ref, setRef] = createSignal(undefined, {ownedWrite: true});
                refs.set(key, setRef);
                registerItem({getItem: () => ({type: 'item', key, textValue: key, disabled: false, ref})});
                return null;
              }});
            }
          });
          createRenderEffect(() => flatten(output), () => {});
          return {dispose, setValue, setAvailable, changes, refs, context: () => context};
        });
      }
    `);
    const built = await Bun.build({
      entrypoints: [entrypoint], target: 'browser', conditions: ['browser', 'development'],
      plugins: [{name: 'state-only-host', setup(build) {
        build.onResolve({filter: /^\.\.\/features\/settings\/config$/}, () => ({path: 'settings', namespace: 'fixture'}));
        build.onLoad({filter: /.*/, namespace: 'fixture'}, () => ({loader: 'js', contents: 'export const setting = () => false;'}));
        build.onLoad({filter: /polymorphic\/index\.js$/}, () => ({loader: 'js', contents: `
          import {children} from '${app}node_modules/solid-js/dist/solid.dev.js';
          export const Polymorphic = props => children(() => props.children);
        `}));
        build.onLoad({filter: /@solid-primitives\/platform\/dist\/index\.js$/}, () => ({loader: 'js',
          contents: 'export const isWebKit = false, isAppleDevice = false, isMac = false, isIOS = false, isAndroid = false, isFirefox = false, isSafari = false;'
        }));
      }}],
    });
    if (!built.success) throw new AggregateError(built.logs, 'Tabs state harness failed');
    const output = join(directory, 'fixture.mjs');
    await Bun.write(output, built.outputs[0]);
    return await import(pathToFileURL(output).href);
  } finally {await rm(directory, {recursive: true, force: true});}
}
const runtime = await harness();

test('controlled overview selects at mount and follows external back/forward values', async () => {
  const {artifact} = await runtime.captureArtifact(() => {
    const mounted = runtime.mount();
    try {
      runtime.flush();
      const state = mounted.context().listState();
      expect(state.selectedKey()).toBe('overview');
      expect(state.selectionManager().isSelected('overview')).toBe(true);
      mounted.setValue('resources'); runtime.flush();
      expect(state.selectionManager().isSelected('resources')).toBe(true);
      mounted.setValue('overview'); runtime.flush();
      expect(state.selectionManager().isSelected('overview')).toBe(true);
      expect(mounted.changes).toEqual([]);
    } finally {mounted.dispose(); runtime.flush();}
  }, {scenario: 'controlled-tab-route-values'});
  expect(artifact.diagnostics.filter(event => event.severity === 'error')).toEqual([]);
  expect(artifact.diagnostics.filter(event => event.code === 'EFFECT_RELAY_TEAR')).toEqual([]);
});

test('collection registration gaps cannot navigate a controlled route', () => {
  const mounted = runtime.mount();
  try {
    runtime.flush();
    mounted.setValue('resources'); runtime.flush();
    mounted.setAvailable(['overview']); runtime.flush();
    expect(mounted.context().listState().selectedKey()).toBe('resources');
    expect(mounted.changes).toEqual([]);
    mounted.setAvailable(['overview', 'resources']); runtime.flush();
    expect(mounted.context().listState().selectionManager().isSelected('resources')).toBe(true);
    expect(mounted.changes).toEqual([]);
    expect([...mounted.context().listState().collection().getKeys()]).toEqual(['overview', 'resources']);
    mounted.context().listState().selectionManager().replaceSelection('overview'); runtime.flush();
    expect(mounted.changes).toEqual(['overview']);
  } finally {mounted.dispose(); runtime.flush();}
});

test('a controlled route is not replaced by the first tab after a registration gap', () => {
  const mounted = runtime.mount();
  try {
    runtime.flush();
    mounted.setAvailable([]); runtime.flush();
    mounted.setAvailable(['resources']); runtime.flush();
    expect([...mounted.context().listState().collection().getKeys()]).toEqual(['resources']);
    expect(mounted.context().listState().selectedKey()).toBe('overview');
    expect(mounted.changes).toEqual([]);
  } finally {mounted.dispose(); runtime.flush();}
});

test('indicator follows a late registered ref without querying DOM attributes', () => {
  const mounted = runtime.mount();
  try {
    runtime.flush();
    const context = mounted.context();
    expect(context.selectedTab()).toBeUndefined();
    const element = {marker: 'overview'};
    mounted.refs.get('overview')(element); runtime.flush();
    expect(context.selectedTab()).toBe(element);
    mounted.setValue('resources'); runtime.flush();
    expect(context.selectedTab()).toBeUndefined();
    const other = {marker: 'resources'};
    mounted.refs.get('resources')(other); runtime.flush();
    expect(context.selectedTab()).toBe(other);
  } finally {mounted.dispose(); runtime.flush();}
});

test('uncontrolled tabs still choose an initial enabled tab', () => {
  const mounted = runtime.mount(false);
  try {
    runtime.flush();
    expect(mounted.changes).toEqual(['overview']);
  } finally {mounted.dispose(); runtime.flush();}
});


test('back goes from tab to overview to library without phantom entries; settings returns to its tab', async () => {
  const mounted = await runtime.navigation();
  const settle = async () => {
    for (let i = 0; i < 12; i++) {await Promise.resolve(); runtime.flush();}
  };
  try {
    const {router, transition, history, location} = mounted;
    router.navigate('/library/example'); runtime.flush();
    router.navigate('/library/example/resources', {replace: true}); runtime.flush();
    expect(history.length).toBe(2);
    transition.goBack('/library/example'); await settle();
    expect(location.hash).toBe('#/library/example');
    expect(history.length).toBe(2);
    transition.goBack('/library'); await settle();
    expect(location.hash).toBe('#/library');
    expect(router.canGoBack()).toBe(false);
    router.navigate('/library/example'); runtime.flush();
    router.navigate('/library/example/resources', {replace: true}); runtime.flush();
    router.navigate('/library/example/settings'); runtime.flush();
    expect(history.length).toBe(3);
    transition.goBack('/library/example'); await settle();
    expect(location.hash).toBe('#/library/example/resources');
  } finally {mounted.restore();}
});


test('version navigation preserves its real parent when replacing sibling releases', async () => {
  const mounted = await runtime.navigation();
  try {
    const {router} = mounted;
    router.navigate('/browse/project/modrinth/p/versions'); runtime.flush();
    router.navigate('/browse/project/modrinth/p/version/one'); runtime.flush();
    expect(router.previousPath()).toBe('/browse/project/modrinth/p/versions');
    router.navigate('/browse/project/modrinth/p/version/two', {replace: true}); runtime.flush();
    expect(router.previousPath()).toBe('/browse/project/modrinth/p/versions');
    router.navigate('/browse/project/modrinth/p'); runtime.flush();
    router.navigate('/browse/project/modrinth/p/version/one'); runtime.flush();
    expect(router.previousPath()).toBe('/browse/project/modrinth/p');
  } finally {mounted.restore();}
});
