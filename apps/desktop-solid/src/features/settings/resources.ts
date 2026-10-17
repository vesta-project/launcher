import { listen } from "@tauri-apps/api/event";
import { route } from "../../app/router";
import { createEffect, onSettled } from "solid-js";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { notificationSubscriptions } from "./notifications";
import { shortcutCatalog } from "./shortcuts";
import { settingsSync } from "./sync";
import { cachedResource } from "./cached-resource";
import { javaFixture, type JavaInventory } from "./java-model";
import { storageFixture, storageSnapshotFromHost, type StorageSnapshot } from "./storage-model";

const native = typeof window !== "undefined" && isTauri();

/**
 * Data behind the Settings pages. Each resource shows its last known value immediately and
 * refreshes in the background; the ones that describe this machine (Java, storage) are
 * mirrored to localStorage so the first open after launch is instant too.
 */
export const javaInventory = cachedResource<JavaInventory>({
  key: "java-inventory",
  persist: true,
  staleTimeMs: 120_000,
  fallback: { requirements: [], detected: [], managed: [], global: [] },
  load: async () => {
    if (!native) return javaFixture;
    const [requirements, detected, managed, global] = await Promise.all([
      invoke<JavaInventory["requirements"]>("get_required_java_versions"),
      invoke<JavaInventory["detected"]>("detect_java"),
      invoke<JavaInventory["managed"]>("get_managed_javas"),
      invoke<JavaInventory["global"]>("get_global_java_paths"),
    ]);
    return { requirements, detected, managed, global };
  },
});

export const storageUsage = cachedResource<StorageSnapshot>({
  key: "storage-usage",
  persist: true,
  staleTimeMs: 60_000,
  fallback: {
    ...storageFixture,
    totalBytes: 0,
    categories: [],
    instances: [],
    instancesTotalBytes: 0,
    artifactCacheUsageBytes: 0,
  },
  load: async (force) =>
    native
      ? storageSnapshotFromHost(await invoke<StorageSnapshot>("get_storage_snapshot", { forceRefresh: force }))
      : storageFixture,
});

export const systemMemory = cachedResource<number>({
  key: "system-memory",
  persist: true,
  staleTimeMs: 3_600_000,
  fallback: 16384,
  load: async () => (native ? invoke<number>("get_system_memory_mb") : 16384),
});

let prefetched = false;
/**
 * Warms every Settings resource. Called once shortly after startup (idle) and again when the
 * pointer reaches the Settings button, so by the time the page opens there is nothing to wait for.
 */
export function prefetchSettings() {
  if (typeof window === "undefined") return;
  const run = () => {
    void javaInventory.refresh();
    void storageUsage.refresh();
    void systemMemory.refresh();
    void notificationSubscriptions.refresh();
    void shortcutCatalog.refresh();
    void settingsSync.refresh();
  };
  if (prefetched) return run();
  prefetched = true;
  run();
}

/** Schedules the first prefetch for when the browser is idle after startup. */
export function prefetchSettingsWhenIdle() {
  if (typeof window === "undefined") return;
  const schedule =
    window.requestIdleCallback ?? ((callback: () => void) => window.setTimeout(callback, 800));
  schedule(() => prefetchSettings());
}

/** Subscribe once in the shell; native mutations retire stale snapshots without polling. */
export function useSettingsResourceSync() {
  // Re-entering Settings revalidates stale data without dropping visible snapshots.
  createEffect(() => route().page, (page) => {
    if (page === 'settings') prefetchSettings();
  });
  if (!native) return;
  onSettled(() => {
    let disposed = false;
    const stops: (() => void)[] = [];
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    for (const [event, resource] of [
      ["java-paths-updated", javaInventory],
      ["storage-snapshot-invalidated", storageUsage],
    ] as const) {
      void listen(event, () => {
        clearTimeout(timers.get(event));
        timers.set(
          event,
          setTimeout(() => {
            if (!disposed) void resource.refresh(true);
          }, 50),
        );
      })
        .then((stop) => {
          if (disposed) stop();
          else stops.push(stop);
        })
        .catch(() => console.error(`Unable to subscribe to ${event}`));
    }
    return () => {
      disposed = true;
      for (const timer of timers.values()) clearTimeout(timer);
      for (const stop of stops) stop();
    };
  });
}
