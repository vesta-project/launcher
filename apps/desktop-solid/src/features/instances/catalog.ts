import { createSignal } from "solid-js";
import art1 from "../../assets/images/placeholders/placeholder-image1.jpg";
import art2 from "../../assets/images/placeholders/placeholder-image2.png";
import art3 from "../../assets/images/placeholders/placeholder-image3.png";
import art4 from "../../assets/images/placeholders/placeholder-image4.png";
import art5 from "../../assets/images/placeholders/placeholder-image5.png";
import art6 from "../../assets/images/placeholders/placeholder-image6.png";
import type { InstanceCardData, InstanceCardState } from "./instance-card";

import { nativeInstances, nativeEntries, runInstance, resumeNativeInstance, clearNativeCrash, deleteNativeInstance } from './native-service';

/**
 * Application catalog: native records in Tauri, isolated preview data in browsers.
 * Components consume the same small identity/state Interface in either environment.
 */
const seed: { instance: InstanceCardData; state: InstanceCardState }[] = [
  {
    instance: {
      id: "survival",
      name: "Survival",
      minecraftVersion: "1.21.4",
      modloader: "fabric",
      image: art1,
      pinned: true,
    },
    state: { kind: "idle" },
  },
  {
    instance: {
      id: "create",
      name: "Create Skyblock",
      minecraftVersion: "1.20.1",
      modloader: "forge",
      image: art2,
      pinned: true,
    },
    state: { kind: "idle" },
  },
  {
    instance: {
      id: "modded",
      name: "Modded Survival",
      minecraftVersion: "1.21.4",
      modloader: "fabric",
      image: art6,
    },
    state: { kind: "idle" },
  },
  {
    instance: {
      id: "snapshot",
      name: "Vanilla Snapshot",
      minecraftVersion: "24w44a",
      modloader: "vanilla",
      image: art3,
    },
    state: { kind: "idle" },
  },
  {
    instance: {
      id: "friends",
      name: "Old Friends Pack",
      minecraftVersion: "1.12.2",
      modloader: "quilt",
      image: art4,
    },
    state: {
      kind: "crashed",
      summary: "java.lang.OutOfMemoryError: Java heap space",
    },
  },
  {
    instance: {
      id: "atm",
      name: "All the Mods 10",
      minecraftVersion: "1.21.1",
      modloader: "neoforge",
      image: art5,
    },
    state: { kind: "interrupted", label: "Update" },
  },
  {
    instance: {
      id: "server",
      name: "Friends Server",
      minecraftVersion: "1.21.4",
      modloader: "fabric",
      image: art6,
    },
    state: {
      kind: "failed",
      reason:
        "Could not download Fabric loader 0.16.9: connection reset by peer",
    },
  },
  {
    instance: {
      id: "builds",
      name: "Creative Builds",
      minecraftVersion: "1.21.4",
      modloader: "vanilla",
      image: art2,
    },
    state: { kind: "idle" },
  },
  {
    instance: {
      id: "pvp",
      name: "PvP Practice",
      minecraftVersion: "1.8.9",
      modloader: "forge",
      image: art4,
    },
    state: { kind: "idle" },
  },
];

const PIN_KEY = nativeInstances ? "vesta:instance:pins" : "vesta:fixture:pins";
function loadPins(): string[] {
  try {
    const saved: unknown =
      typeof localStorage === "undefined"
        ? null
        : JSON.parse(localStorage.getItem(PIN_KEY) ?? "null");
    if (Array.isArray(saved))
      return [
        ...new Set(
          saved.filter(
            (id): id is string =>
              typeof id === "string" &&
              (nativeInstances ? /^\d+$/.test(id) : seed.some((entry) => entry.instance.id === id)),
          ),
        ),
      ];
  } catch {
    /* A damaged preview preference should not prevent startup. */
  }
  if (nativeInstances) return [];
  return seed
    .filter((entry) => entry.instance.pinned)
    .map((entry) => entry.instance.id);
}
const initialPins = loadPins();
const [pinIds, setPinIds] = createSignal(initialPins, {
  name: "pinnedInstanceOrder",
});
const [items, setItems] = createSignal(
  seed.map((entry) => ({
    ...entry,
    instance: {
      ...entry.instance,
      pinned: initialPins.includes(entry.instance.id),
    },
  })),
  { name: "fixtureInstances" },
);

export const instances = () => nativeInstances ? nativeEntries().map((entry) => ({ ...entry,
  instance: { ...entry.instance, pinned: pinIds().includes(entry.instance.id) } })) : items();
export type InstanceEntry = (typeof seed)[number];
export const findInstance = (id: string | undefined) =>
  instances().find((entry) => entry.instance.id === id);
/** Instances whose game is running; a launch from any path shows up here once it succeeds. */
export const playingInstanceIds = () =>
  instances().flatMap((entry) => (entry.state.kind === "running" ? [entry.instance.id] : []));
export const pinnedInstances = () =>
  pinIds().flatMap((id) => {
    const entry = findInstance(id);
    return entry ? [entry] : [];
  });

function savePins(ids: string[]) {
  setPinIds(ids);
  try {
    localStorage.setItem(PIN_KEY, JSON.stringify(ids));
  } catch {
    /* Session-only pins still work. */
  }
}

const update = (id: string, state: InstanceCardState) =>
  setItems((list) =>
    list.map((entry) =>
      entry.instance.id === id ? { ...entry, state } : entry,
    ),
  );

/** Stand-in for the real launch/stop flows: each click advances the state. */
export function playInstance(id: string) {
  if (nativeInstances) { void runInstance(id); return; }
  const current = findInstance(id)?.state;
  if (!current) return;
  switch (current.kind) {
    case "idle":
    case "crashed":
      update(id, { kind: "warming" });
      window.setTimeout(() => update(id, { kind: "running" }), 1400);
      break;
    case "running":
      update(id, { kind: "idle" });
      break;
    default:
      break;
  }
}

/** Stand-in for retry/resume: shows the busy overlay, then settles. */
export function retryInstance(id: string, label: string) {
  if (nativeInstances) { void resumeNativeInstance(id); return; }
  update(id, { kind: "installing", label });
  window.setTimeout(() => update(id, { kind: "idle" }), 2200);
}

export function togglePin(id: string) {
  if (!findInstance(id)) return;
  savePins(
    pinIds().includes(id)
      ? pinIds().filter((pin) => pin !== id)
      : [...pinIds(), id],
  );
  setItems((list) =>
    list.map((entry) =>
      entry.instance.id === id
        ? {
            ...entry,
            instance: { ...entry.instance, pinned: !entry.instance.pinned },
          }
        : entry,
    ),
  );
}

export function movePin(id: string, direction: -1 | 1) {
  const ids = [...pinIds()];
  const at = ids.indexOf(id),
    next = at + direction;
  if (at < 0 || next < 0 || next >= ids.length) return;
  [ids[at], ids[next]] = [ids[next], ids[at]];
  savePins(ids);
}

export function editInstance(
  id: string,
  patch: Partial<
    Pick<InstanceCardData, "name" | "minecraftVersion" | "modloader" | "image">
  >,
) {
  if (nativeInstances) throw new Error('Native edits must use the instance service');
  setItems((list) =>
    list.map((entry) =>
      entry.instance.id === id
        ? { ...entry, instance: { ...entry.instance, ...patch } }
        : entry,
    ),
  );
}

export function removeInstance(id: string) {
  if (nativeInstances) return deleteNativeInstance(id);
  savePins(pinIds().filter((pin) => pin !== id));
  setItems((list) => list.filter((entry) => entry.instance.id !== id));
}

export function clearInstanceCrash(id: string) {
  if (nativeInstances) return clearNativeCrash(id);
  if (findInstance(id)?.state.kind === "crashed") update(id, { kind: "idle" });
}
