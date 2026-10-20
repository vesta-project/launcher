import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Real theme sync/runtime and desktop presentation; only native IPC and DOM are substituted.
async function harness() {
  const app = new URL('../', import.meta.url).pathname;
  const directory = await mkdtemp(join(tmpdir(), 'vesta-theme-startup-'));
  try {
    const entry = join(directory, 'entry.ts');
    await Bun.write(entry, `
      import {createRoot, flush} from '${app}node_modules/solid-js/dist/solid.dev.js';
      import {useThemeRuntime} from '${app}src/features/settings/theme-runtime';
      import {startDesktop} from '${app}src/platform/desktop';
      export {refreshAuthorThemes, authorThemesReady} from '${app}src/features/settings/author-themes';
      export {defaultTheme} from '${app}src/features/settings/theme-model';
      export {probe} from 'probe';
      export {flush};
      export function mount() { return createRoot(dispose => {
        const ready = useThemeRuntime();
        const stop = startDesktop(ready);
        return {ready, dispose: () => {stop(); dispose();}};
      }); }
    `);
    const built = await Bun.build({ entrypoints: [entry], target: 'browser', conditions: ['browser', 'development'], plugins: [{name: 'theme-host', setup(build) {
      build.onResolve({filter: /^probe$/}, () => ({path:'probe',namespace:'stub'}));
      build.onLoad({filter:/.*/,namespace:'stub'}, () => ({loader:'js',contents:`export const probe={reads:[],calls:[],scheme:undefined};`}));
      build.onLoad({filter:/@tauri-apps\/api\/core\.(js|ts)$/}, () => ({loader:'js',contents:`
        import {probe} from 'probe'; export const isTauri=()=>true;
        export const invoke=(command,args)=>{probe.calls.push(command);if(command==='present_window_when_ready')probe.presented={author:document.documentElement.dataset.vestaAuthorTheme,scheme:probe.scheme};return command==='get_author_theme_state' ? new Promise((resolve,reject)=>probe.reads.push({resolve,reject})) : Promise.resolve();};
      `}));
      build.onLoad({filter:/@tauri-apps\/api\/event\.(js|ts)$/}, () => ({loader:'js',contents:`export const listen=async()=>()=>{};`}));
      build.onLoad({filter:/@tauri-apps\/api\/window\.(js|ts)$/}, () => ({loader:'js',contents:`export const getCurrentWindow=()=>({label:'main'});`}));
      build.onLoad({filter:/features\/activity\/activity-sync\.ts$/}, () => ({loader:'js',contents:`export const startActivitySync=()=>()=>{};`}));
      build.onLoad({filter:/app\/preferences\.ts$/}, () => ({loader:'js',contents:`import {probe} from 'probe'; export const setThemeSchemeOverride=value=>{probe.scheme=value;};`}));
      build.onLoad({filter:/features\/settings\/config\.ts$/}, ({path}) => ({loader:'js',contents:`import {defaultTheme,themeSettings} from '${join(path,'../theme-model.ts')}';export const setting=key=>themeSettings(defaultTheme)[key];`}));
      build.onLoad({filter:/\.css$/}, () => ({loader:'js',contents:''}));
    }}] });
    if (!built.success) throw new Error(built.logs.join('\n'));
    const output = join(directory, 'bundle.mjs'); await Bun.write(output, built.outputs[0]);
    return await import(pathToFileURL(output).href);
  } finally {await rm(directory,{recursive:true,force:true});}
}
function dom() {
  const sheets = [], events = new Map();
  const original = {window:globalThis.window,document:globalThis.document};
  globalThis.window = {setTimeout,clearTimeout,requestAnimationFrame:callback=>setTimeout(callback,0),cancelAnimationFrame:clearTimeout,addEventListener(){},removeEventListener(){}};
  globalThis.document = {
    visibilityState:'hidden', documentElement:{dataset:{},style:[]},
    head:{append(...nodes){sheets.push(...nodes);}},
    createElement(tag){return tag==='canvas'?{getContext:()=>null}:{dataset:{},textContent:'',remove(){}};},
    addEventListener(name,fn){events.set(name,fn);},removeEventListener(name){events.delete(name);},
  };
  return {sheets,events,restore(){Object.assign(globalThis,original);}};
}
const tick = async (runtime) => {runtime.flush(); await new Promise(resolve=>setTimeout(resolve,10));runtime.flush();};
const snapshot = (runtime, selected = 'custom', revision = 1) => ({revision,builtIn:runtime.defaultTheme,selected,imports:[{id:'custom',name:'Custom',base:{...runtime.defaultTheme,mode:'light',hue:35},css:'@layer theme.author { :root { --custom-test: ready; } }'}]});

test('hidden startup waits for the canonical custom sheet before presenting; refresh/hide preserve it', async () => {
  const environment=dom(), runtime=await harness(); let mounted;
  try {
    mounted=runtime.mount(); await tick(runtime);
    expect(runtime.probe.calls).not.toContain('present_window_when_ready');
    runtime.probe.reads[0].resolve(snapshot(runtime)); await mounted.ready; await tick(runtime);
    expect(runtime.authorThemesReady()).toBe(true);
    expect(environment.sheets.find(sheet=>sheet.dataset.vestaThemeStyles==='author').textContent).toContain('--custom-test: ready');
    expect(document.documentElement.dataset.vestaAuthorTheme).toBe('custom');
    expect(runtime.probe.scheme).toBe('light');
    expect(runtime.probe.presented).toEqual({author:'custom',scheme:'light'});
    expect(runtime.probe.calls.filter(command=>command==='present_window_when_ready')).toHaveLength(1);
    environment.events.get('visibilitychange')(); await tick(runtime);
    expect(runtime.authorThemesReady()).toBe(true);
    expect(document.documentElement.dataset.vestaAuthorTheme).toBe('custom');
    const refresh=runtime.refreshAuthorThemes(); runtime.probe.reads.at(-1).reject(new Error('offline'));
    await expect(refresh).rejects.toThrow('offline'); await tick(runtime);
    expect(document.documentElement.dataset.vestaAuthorTheme).toBe('custom');
    const disable=runtime.refreshAuthorThemes();runtime.probe.reads.at(-1).resolve(snapshot(runtime,null,2));await disable;await tick(runtime);
    expect(document.documentElement.dataset.vestaAuthorTheme).toBeUndefined();
  } finally {mounted?.dispose();environment.restore();}
});

test('failed initial load presents the fallback instead of leaving the window hidden', async () => {
  const environment=dom(),runtime=await harness();let mounted;
  try {
    mounted=runtime.mount();await tick(runtime);runtime.probe.reads[0].reject(new Error('offline'));
    await mounted.ready;await tick(runtime);
    expect(runtime.probe.calls).toContain('present_window_when_ready');
    expect(document.documentElement.dataset.vestaAuthorTheme).toBeUndefined();
  } finally {mounted?.dispose();environment.restore();}
});

test('disposing during startup never presents the obsolete window owner', async () => {
  const environment=dom(),runtime=await harness();let mounted;
  try {
    mounted=runtime.mount();await tick(runtime);mounted.dispose();mounted=undefined;
    runtime.probe.reads[0].resolve(snapshot(runtime));await tick(runtime);
    expect(runtime.probe.calls).not.toContain('present_window_when_ready');
  } finally {mounted?.dispose();environment.restore();}
});
