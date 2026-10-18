import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

test('capture deletion guard survives stopped propagation, unloaded catalog and saved back overrides', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vesta-deletion-'));
  const key = `deletion${crypto.randomUUID().replaceAll('-', '')}`;
  const c = { ready: false, listeners: [], navigations: 0 };
  globalThis[key] = c;
  const names = ['window', 'Element', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'history'];
  const saved = names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
  class Element {
    closest(selector) { return selector === '[data-recording]' ? null : this.editor ? this : null; }
  }
  class Input extends Element {
    constructor(type) { super(); this.editor = true; this.type = type; }
  }
  class TextArea extends Element { constructor() { super(); this.editor = true; } }
  try {
    Object.assign(globalThis, {
      Element, HTMLElement: Element, HTMLInputElement: Input, HTMLTextAreaElement: TextArea,
      window: {
        addEventListener: (type, handler, options) => c.listeners.push({ type, handler, options }),
        removeEventListener: (type, handler) => { c.listeners = c.listeners.filter((item) => item.handler !== handler); },
      },
      history: { back: () => c.navigations++, forward: () => c.navigations++ },
    });
    const fixtures = {
      'solid-js': `export const onSettled = (fn) => { c.cleanup = fn(); };`,
      '@tauri-apps/api/core': 'export const isTauri = () => true;',
      '../../app/platform': "export const detectPlatform = () => 'windows';",
      '../../app/router': 'export const navigate = () => c.navigations++;',
      '../instances/catalog': 'export const pinnedInstances = () => [];',
      './shortcuts': `export const useShortcutSync = () => {}, shortcutCatalog = {ready: () => c.ready},
        shortcuts = () => [{id: 'back', chord: 'Backspace'}, {id: 'forward', chord: 'Delete'}];`,
    };
    const built = await Bun.build({
      entrypoints: [new URL('../src/features/settings/shortcut-runtime.ts', import.meta.url).pathname], target: 'bun',
      plugins: [{ name: 'shortcut-boundaries', setup(build) {
        build.onResolve({ filter: /.*/ }, ({ path }) => path in fixtures ? { path, namespace: 'fixture' } : undefined);
        build.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ loader: 'js', contents: `const c = globalThis[${JSON.stringify(key)}];` + fixtures[path] }));
      } }],
    });
    if (!built.success) throw new AggregateError(built.logs);
    const path = join(directory, 'runtime.mjs');
    await Bun.write(path, built.outputs[0]);
    (await import(pathToFileURL(path).href)).useShortcutRuntime();
    const capture = c.listeners.find((item) => item.options?.capture);
    const bubble = c.listeners.find((item) => !item.options?.capture);
    expect(capture).toBeDefined();
    for (const ready of [false, true]) {
      c.ready = ready;
      for (const key of ['Backspace', 'Delete']) {
        for (const repeat of [false, true]) {
          for (const target of [new Element(), ...['checkbox', 'radio', 'button', 'range', 'submit', 'file', 'color', 'date'].map((type) => new Input(type)), Object.assign(new Input('text'), { readOnly: true })]) {
            const event = { key, code: key, target, repeat, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
            capture.handler(event);
            // Even if the widget stops propagation here, the default is already cancelled.
            expect(event.defaultPrevented).toBe(true);
            bubble.handler(event);
            expect(c.navigations).toBe(0);
          }
        }
        for (const target of [new Input('text'), new Input('search'), new TextArea(), Object.assign(new Element(), { editor: true, isContentEditable: true })]) {
          const event = { key, code: key, target, preventDefault() { throw new Error('Text editing must keep its default'); } };
          capture.handler(event);
          bubble.handler(event);
          expect(c.navigations).toBe(0);
        }
      }
    }
    c.cleanup();
    expect(c.listeners).toEqual([]);
  } finally {
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
    delete globalThis[key];
    await rm(directory, { recursive: true, force: true });
  }
});

test('empty search deletion cannot implicitly remove filters or replace target history', async () => {
  const source = await Bun.file(new URL('../src/pages/browse/search-field.tsx', import.meta.url)).text();
  const start = source.indexOf('const onKeyDown =');
  expect(source.slice(start, source.indexOf('\n  return (', start))).not.toMatch(/Backspace|Delete|\.remove\(|chooseTarget/);
});
