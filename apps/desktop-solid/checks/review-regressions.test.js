import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Exercise real state modules with inert IPC/storage adapters. No browser or rendering.
async function harness(file, prelude, extra = "", fixtures = {}) {
  const built = await Bun.build({
    entrypoints: [new URL(`../src/${file}`, import.meta.url).pathname],
    target: "bun",
    conditions: ["browser", "development"],
    plugins: [{
      name: "review-boundaries",
      setup(build) {
        const fixturePattern = Object.keys(fixtures).map((path) => path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
        build.onResolve({ filter: new RegExp(`^(?:${fixturePattern})$`) }, ({ path }) => ({ path, namespace: "fixture" }));
        build.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ contents: fixtures[path], loader: "js" }));
        build.onLoad({ filter: new RegExp(`${file.replaceAll(".", "\\.")}$`) }, async ({ path }) => ({
          contents: prelude + await Bun.file(path).text() + extra,
          loader: "ts",
        }));
      },
    }],
  });
  if (!built.success) throw new AggregateError(built.logs, "Review harness failed");
  const directory = await mkdtemp(join(tmpdir(), "vesta-review-"));
  try {
    const path = join(directory, "harness.mjs");
    await Bun.write(path, built.outputs[0]);
    return await import(pathToFileURL(path).href);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const core = `
  export const isTauri = () => true;
  let handler;
  export const setInvoke = (next) => { handler = next; };
  export const invoke = (command, args) => Promise.resolve().then(() => handler(command, args));
`;
const tick = async (module) => {
  module.flushSignals();
  await new Promise((resolve) => setTimeout(resolve, 0));
  module.flushSignals();
};

test("skin mutations cannot publish across account changes or after disposal", async () => {
  const module = await harness("features/accounts/skins.ts", `
    import { createRoot, flush as flushSignals } from 'solid-js';
    export { flushSignals };
    import { captureArtifact, expectNoDiagnostics } from '@solidjs/diagnostics';
    export const captureSkinArtifact = (scenario) => captureArtifact(scenario, { scenario: 'skin-account-switch-and-dispose' });
    export const assertSkinDiagnostics = (artifact) => expectNoDiagnostics(artifact);
    export { setInvoke } from '@tauri-apps/api/core';
    const window = {};
  `, `
    export function mount(uuid) {
      return createRoot((dispose) => {
        const [account, setAccount] = createSignal({ uuid, account_type: 'Microsoft' });
        return { controller: createSkinController(account), setAccount, dispose };
      });
    }
  `, { "@tauri-apps/api/core": core });
  let finishMutation;
  const reads = [];
  module.setInvoke((command, args) => {
    if (command === "change_skin_variant") return new Promise((resolve) => { finishMutation = resolve; });
    if (command !== "get_complete_skin_data") return;
    reads.push(args.accountUuid);
    return {
      current_skin_base64: args.accountUuid,
      current_cape_base64: null,
      current_cape_profile_id: null,
      current_variant: "classic",
      recent_history: [],
      capes: [{ id: "cape", alias: "Cape", url: "http://textures.minecraft.net/texture/example" }],
    };
  });
  const { artifact } = await module.captureSkinArtifact(async () => {
    const mounted = module.mount("A");
    await tick(module);
    expect(mounted.controller.profile().capes[0].url).toBe("https://textures.minecraft.net/texture/example");
    const mutation = mounted.controller.setVariant("slim");
    await tick(module);
    mounted.setAccount({ uuid: "B", account_type: "Microsoft" });
    await tick(module);
    expect(mounted.controller.profile().skin).toEndWith(",B");
    finishMutation();
    await mutation;
    await tick(module);
    expect(reads).toEqual(["A", "B"]);
    expect(mounted.controller.profile().skin).toEndWith(",B");
    const afterDispose = mounted.controller.setVariant("slim");
    await tick(module);
    mounted.dispose();
    finishMutation();
    await afterDispose;
    expect(reads).toEqual(["A", "B"]);
  });
  module.assertSkinDiagnostics(artifact);
});

test("settings mirrors remove existing secrets and exclude subsequent secret edits", async () => {
  const module = await harness("features/settings/config.ts", `
    const window = { addEventListener() {} };
    const values = new Map([['vesta:launcher-config', JSON.stringify({
      developer_mode: true, proxy_url: 'credential', default_environment_variables: 'TOKEN=credential',
      default_pre_launch_hook: 'credential', default_java_args: 'credential'
    })]]);
    const localStorage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
    export const mirrorValues = values;
    export { flush as flushSignals } from 'solid-js';
  `, "", {
    "@tauri-apps/api/core": "export const isTauri = () => false; export const invoke = async () => ({});",
    "../../localization": "export const setLocale = () => {};",
    "../../app/preferences": "export const setHue = () => {}; export const setScheme = () => {};",
  });
  expect(JSON.parse(module.mirrorValues.get("vesta:launcher-config"))).toEqual({ developer_mode: true });
  for (const field of ["proxy_url", "default_environment_variables", "default_pre_launch_hook", "default_post_exit_hook", "default_wrapper_command", "default_java_args"])
    module.updateSetting(field, "credential");
  module.flushSignals();
  module.flushSettings();
  expect(module.mirrorValues.get("vesta:launcher-config")).not.toContain("credential");
});

test("queued sync selection edits build on the preceding saved selection", async () => {
  const module = await harness("features/settings/sync.ts", `
    const window = {};
    export { setInvoke } from '@tauri-apps/api/core';
  `, "", {
    "@tauri-apps/api/core": core,
    "./cached-resource": `export function cachedResource() {
      let data = [{ category: 'gameOptions', initialized: true, revision: 0,
        preferences: { enabled: true, sourceInstanceId: null, instanceIds: [1], selectedKeys: [] },
        sharedValues: {}, catalog: [], servers: [], pending: [] }];
      return { data: () => data, set: (next) => { data = next; }, ready: () => true, error: () => undefined, refresh: async () => {} };
    }`,
  });
  let finishFirst;
  const calls = [];
  module.setInvoke((_command, args) => {
    calls.push(args.preferences.selectedKeys);
    const snapshot = { ...module.settingsSync.data()[0], revision: args.revision + 1, preferences: args.preferences };
    return calls.length === 1 ? new Promise((resolve) => { finishFirst = () => resolve(snapshot); }) : snapshot;
  });
  const first = module.setSyncState("options", (current) => ({ selected: [...current.selected, "fov"] }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  const second = module.setSyncState("options", (current) => ({ selected: [...current.selected, "gamma"] }));
  finishFirst();
  await Promise.all([first, second]);
  expect(calls).toEqual([["fov"], ["fov", "gamma"]]);
  expect(module.syncState().options.selected).toEqual(["fov", "gamma"]);
});
