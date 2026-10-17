import { expect, test } from 'bun:test';
import { transform } from '@solidjs/compiler';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Installed Kobalte state/collection code with an inert host boundary: no DOM or browser.
async function harness() {
  const app = new URL('../', import.meta.url).pathname;
  const directory = await mkdtemp(join(tmpdir(), 'vesta-loader-switch-'));
  try {
    const entrypoint = join(directory, 'fixture.js');
    await Bun.write(entrypoint, `
      import {createRoot, createSignal, createRenderEffect, flatten, flush, createComponent} from '${app}node_modules/solid-js/dist/solid.dev.js';
      import {Combobox} from '${app}ui/components/combobox/combobox.tsx';
      export {captureArtifact} from '${app}node_modules/@solidjs/diagnostics/dist/index.js';
      export {flush};
      export function mount() {
        return createRoot(dispose => {
          const [loader, setLoader] = createSignal('fabric', {name: 'test.loader'});
          const [selected, setSelected] = createSignal('fabric-399', {name: 'test.selected'});
          let reads = 0;
          const options = () => {
            if (++reads > 300) throw new Error('options read runaway: ' + reads);
            const key = loader(); return Array.from({length: 400}, (_, i) => ({value: key + '-' + i, label: key + '-' + i}));
          };
          const output = createComponent(Combobox, { maxOptions: 80,
            get options() {return options();},
            get value() {return selected();},
            onChange(value) {setSelected(value);}, 'aria-label': 'Loader version'
          });
          createRenderEffect(() => flatten(output), () => {});
          return {dispose, setLoader, setSelected, context: () => globalThis.__vestaVersionPickerContext, reads: () => reads};
        });
      }
    `);
    const built = await Bun.build({
      entrypoints: [entrypoint], target: 'browser', conditions: ['browser', 'development'],
      plugins: [{name: 'state-only-host', setup(build) {
        build.onLoad({filter: /\.tsx$/}, async ({path}) => ({loader: 'ts', contents: transform(await Bun.file(path).text(), {filename: path, dev: true}).code}));
        build.onLoad({filter: /\.css$/}, () => ({loader: 'js', contents: ''}));
        build.onResolve({filter: /^@kobalte\/core\/combobox$/}, () => ({path: 'combo', namespace: 'combo'}));
        build.onLoad({filter: /.*/, namespace: 'combo'}, () => ({loader: 'js', contents: `
          import {Root, useComboboxContext} from '${app}node_modules/@kobalte/core/dist/combobox/index.js';
          import {merge} from '${app}node_modules/solid-js/dist/solid.dev.js';
          const Empty = () => null;
          const Wrapped = props => Root(merge(props, {get children() {
            globalThis.__vestaVersionPickerContext = useComboboxContext(); return props.children;
          }}));
          export const Combobox = Object.assign(Wrapped, Object.fromEntries(['Label','HiddenSelect','Control','Input','Trigger','Icon','Description','ErrorMessage','Portal','Content','Listbox','Item','ItemIndicator','ItemLabel','ItemDescription'].map(key => [key, Empty])));
        `}));
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
    if (!built.success) throw new AggregateError(built.logs, 'Loader state harness failed');
    const output = join(directory, 'fixture.mjs');
    await Bun.write(output, built.outputs[0]);
    return await import(pathToFileURL(output).href);
  } finally {await rm(directory, {recursive: true, force: true});}
}
const runtime = await harness();

test('mapped version options are read once per loader change and the Kobalte collection stays bounded', async () => {
  const {artifact} = await runtime.captureArtifact(() => {
    const mounted = runtime.mount();
    try {
      runtime.flush();
      expect(mounted.reads()).toBe(1);
      expect(mounted.context().selectedOptions()[0].value).toBe('fabric-399');
      expect([...mounted.context().listState().collection()].length).toBeLessThanOrEqual(81);
      for (const loader of ['forge', 'neoforge', 'fabric', 'quilt']) {
        mounted.setLoader(loader);
        mounted.setSelected(loader + '-399');
        runtime.flush();
        expect(mounted.context().selectedOptions()[0].value).toBe(loader + '-399');
        expect([...mounted.context().listState().collection()].length).toBeLessThanOrEqual(81);
      }
      expect(mounted.reads()).toBe(5);
    } finally {mounted.dispose(); runtime.flush();}
  }, {scenario: 'loader-switching'});
  expect(artifact.diagnostics.filter(event => event.severity === 'error')).toEqual([]);
});
