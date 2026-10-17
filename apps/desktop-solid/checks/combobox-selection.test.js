import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { transform } from '@solidjs/compiler';

// Exercise the real wrapper and installed Kobalte state, replacing only DOM children.
async function harness() {
  const app = new URL('../', import.meta.url).pathname;
  const directory = await mkdtemp(join(tmpdir(), 'vesta-combobox-'));
  try {
    const entry = join(directory, 'fixture.tsx');
    await Bun.write(entry, `
      import {createRoot, createSignal, createRenderEffect, flatten, flush} from '${app}node_modules/solid-js/dist/solid.dev.js';
      import {Combobox} from '${app}ui/components/combobox/combobox.tsx';
      import {probe} from 'probe';
      export {captureArtifact} from '${app}node_modules/@solidjs/diagnostics/dist/index.js';
      export {flush};
      export function mount() {return createRoot(dispose => {
        const [selected, setSelected] = createSignal('one', {name:'test.release'});
        const changes = []; let reads = 0;
        const [releases] = createSignal(['one', 'two'], {name:'test.releases'});
        const output = <Combobox
          options={releases().map(value => {if (++reads > 100) throw Error('unbounded option reads'); return {value, label:value};})}
          value={selected()}
          onChange={value => {changes.push(value); setSelected(value);}}
        />;
        createRenderEffect(() => flatten(output), () => {});
        return {dispose, changes, reads: () => reads, context: () => probe.current};
      });}
    `);
    const built = await Bun.build({entrypoints: [entry], target: 'browser', conditions: ['browser','development'],
      plugins: [{name: 'state-only-combobox', setup(build) {
        build.onLoad({filter:/fixture\.tsx$/}, async ({path}) => ({loader:'ts',contents:transform(await readFile(path,'utf8'),{filename:path,generate:'dom',dev:true,moduleName:app+'node_modules/@solidjs/web/dist/web.dev.js'}).code}));
        build.onResolve({filter: /^@solid-primitives\/presence$/}, () => ({path:'presence', namespace:'presence-fixture'}));
        build.onLoad({filter: /.*/, namespace:'presence-fixture'}, () => ({loader:'js',contents:'export const createPresence = visible => ({isMounted: visible});'}));
        build.onResolve({filter: /^probe$/}, () => ({path:'probe', namespace:'fixture'}));
        build.onLoad({filter: /.*/, namespace:'fixture'}, () => ({loader:'js', contents: `
          import {useComboboxContext} from '${app}node_modules/@kobalte/core/dist/combobox/index.js';
          export const probe = {};
          export function Probe() {probe.current = useComboboxContext(); return null;}
        ` }));
        build.onLoad({filter: /ui\/components\/combobox\/combobox.tsx$/}, async ({path}) => {
          let source = await readFile(path, 'utf8');
          source = source.replace(/      <Show when=\{label\(\)\}>[\s\S]*    <\/KobalteCombobox>/, '      <Probe />\n    </KobalteCombobox>');
          source = source.replace(/      itemComponent=\{[\s\S]*?    >/, '    >');
          source = `import {Probe} from 'probe';\n` + source;
          return {loader:'ts', contents:transform(source, {filename:path, generate:'dom', dev:true}).code};
        });
        build.onLoad({filter:/ui\/internal\/icons.tsx$/}, () => ({loader:'js',contents:'export const CheckGlyph = () => null, ChevronDownGlyph = () => null;'}));
        build.onLoad({filter:/components\/overlay\/mount.tsx?$/}, () => ({loader:'js',contents:'export const useOverlayMount = () => undefined;'}));
        build.onLoad({filter:/\.css$/}, () => ({loader:'js',contents:''}));
        build.onLoad({filter:/polymorphic\/index\.js$/}, () => ({loader:'js',contents:`import {children} from '${app}node_modules/solid-js/dist/solid.dev.js'; export const Polymorphic = props => children(() => props.children);`}));
        build.onLoad({filter:/@solid-primitives\/platform\/dist\/index\.js$/}, () => ({loader:'js',contents:'export const isWebKit=false,isAppleDevice=false,isMac=false,isIOS=false,isAndroid=false,isFirefox=false,isSafari=false;'}));
      }}]});
    if (!built.success) throw new AggregateError(built.logs, 'Combobox state harness failed');
    const output = join(directory, 'fixture.mjs'); await Bun.write(output, built.outputs[0]);
    return await import(pathToFileURL(output).href);
  } finally {await rm(directory, {recursive:true,force:true});}
}
const runtime = await harness();

test('opening and selecting releases stabilizes mapped options and never echoes the controlled release', async () => {
  const {artifact} = await runtime.captureArtifact(() => {
    const mounted = runtime.mount();
    try {
      runtime.flush();
      mounted.context().open(false, 'manual'); runtime.flush();
      expect(mounted.context().selectedOptions()[0].value).toBe('one');
      mounted.context().listState().selectionManager().setSelectedKeys(['one']); runtime.flush();
      expect(mounted.changes).toEqual([]);
      mounted.context().listState().selectionManager().setSelectedKeys(['two']); runtime.flush();
      expect(mounted.changes).toEqual(['two']);
      expect(mounted.reads()).toBe(2);
    } finally {mounted.dispose(); runtime.flush();}
  }, {scenario:'pack-release-open-and-select'});
  expect(artifact.diagnostics.filter(event => event.severity === 'error')).toEqual([]);
});
