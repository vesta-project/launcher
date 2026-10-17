import { createSignal } from "solid-js";
import { nativeInstances, nativeRecord } from "./native-service";
import { preferencesFromNative } from "./native-model";
export interface InstancePreferences {
  java: string;
  javaPath: string;
  inheritMemory: boolean;
  minMemory: number;
  maxMemory: number;
  inheritArgs: boolean;
  args: string;
  inheritResolution: boolean;
  width: number;
  height: number;
  inheritCommands: boolean;
  preLaunch: string;
  postExit: string;
  wrapper: string;
  inheritEnvironment: boolean;
  environment: string;
  inheritLauncherAction: boolean;
  launcherAction: string;
  inheritSandbox: boolean;
  sandboxPreset: string;
  sandboxWrapper: boolean;
}
const defaults: InstancePreferences = {
  java: "default",
  javaPath: "",
  inheritMemory: true,
  minMemory: 1024,
  maxMemory: 4096,
  inheritArgs: true,
  args: "",
  inheritResolution: true,
  width: 1280,
  height: 720,
  inheritCommands: true,
  preLaunch: "",
  postExit: "",
  wrapper: "",
  inheritEnvironment: true,
  environment: "",
  inheritLauncherAction: true,
  launcherAction: "keep",
  inheritSandbox: true,
  sandboxPreset: "standard",
  sandboxWrapper: false,
};
const stores = new Map<string, ReturnType<typeof createPreferences>>();
function createPreferences(id: string) {
  const [values, setValues] = createSignal(
    { ...defaults },
    { name: `instance-preferences:${id}` },
  );
  return { values, setValues };
}
export function instancePreferences(id: string) {
  if (nativeInstances) return {
    values: () => { const record = nativeRecord(id); return record ? preferencesFromNative(record) : { ...defaults }; },
    setValues: (_values: InstancePreferences) => {},
  };
  let store = stores.get(id);
  if (!store) {
    store = createPreferences(id);
    stores.set(id, store);
  }
  return store;
}
