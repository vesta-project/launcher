import { createSignal } from "solid-js";
import art1 from "../../assets/images/placeholders/placeholder-image1.jpg";
import art2 from "../../assets/images/placeholders/placeholder-image2.png";
import art3 from "../../assets/images/placeholders/placeholder-image3.png";
import art4 from "../../assets/images/placeholders/placeholder-image4.png";
import art5 from "../../assets/images/placeholders/placeholder-image5.png";
import art6 from "../../assets/images/placeholders/placeholder-image6.png";

/*
 * Fixture detail data for an instance. Shapes follow what the old launcher showed so the
 * real backend can replace the generators without changing the screens.
 */

export type ResourceKind = "mod" | "resourcepack" | "shader" | "datapack";

export interface InstalledResource {
  id: string;
  kind: ResourceKind;
  filename: string;
  bundled?: boolean;
  name: string;
  author: string;
  version: string;
  enabled: boolean;
  /** Newer version available, if any. */
  update?: string;
  sizeKb: number;
  /** Where it was installed from. */
  source: "Modrinth" | "CurseForge" | "Local";
  /** Square icon art. */
  icon: string;
}

export interface WorldInfo {
  id: string;
  name: string;
  lastPlayed: string;
  sizeMb: number;
  mode: "Survival" | "Creative" | "Hardcore";
  image: string;
  /** Days played in game. */
  days: number;
}

export interface Screenshot {
  id: string;
  src: string;
  title: string;
  date: string;
}

export interface InstanceStats {
  playtimeMinutes: number;
  lastPlayed: string;
  sizeMb: number;
  java: string;
  memoryMb: number;
  created: string;
}

export interface LogLine {
  level: "debug" | "info" | "warn" | "error";
  time: string;
  text: string;
}

const art = [art1, art2, art3, art4, art5, art6];

const hash = (value: string) =>
  [...value].reduce(
    (total, char) => (total * 31 + char.charCodeAt(0)) >>> 0,
    7,
  );

const modNames: [string, string][] = [
  ["Sodium", "jellysquid3"],
  ["Lithium", "jellysquid3"],
  ["Iris Shaders", "coderbot"],
  ["Fabric API", "modmuss50"],
  ["Mod Menu", "Prospector"],
  ["Xaero’s Minimap", "xaero96"],
  ["JourneyMap", "techbrew"],
  ["Create", "simibubi"],
  ["Farmer’s Delight", "vectorwing"],
  ["Jade", "Snownee"],
  ["Just Enough Items", "mezz"],
  ["Cloth Config", "shedaniel"],
  ["Architectury API", "shedaniel"],
  ["Ferrite Core", "malte0811"],
  ["Entity Culling", "tr7zw"],
  ["Dynamic Lights", "LambdAurora"],
  ["Continuity", "Pepperoni"],
  ["Indium", "comp500"],
  ["Lazy DFU", "astei"],
  ["Starlight", "Spottedleaf"],
  ["AppleSkin", "squeek502"],
  ["Roughly Enough Items", "shedaniel"],
  ["Sophisticated Backpacks", "P3pp3rF1y"],
  ["Chunky", "pop4959"],
];
const packNames: [string, string][] = [
  ["Faithful 32x", "Faithful Team"],
  ["Fresh Animations", "FreshLX"],
  ["Better Leaves", "Motschen"],
];
const shaderNames: [string, string][] = [
  ["Complementary Reimagined", "EminGT"],
  ["BSL Shaders", "capttatsu"],
];

function makeResources(id: string): InstalledResource[] {
  const seed = hash(id);
  const take = (list: [string, string][], kind: ResourceKind, count: number) =>
    list.slice(0, count).map(([name, author], index) => {
      const n = (seed + index * 17) % 100;
      const major = 1 + (n % 4);
      return {
        id: `${kind}-${index}`,
        kind,
        filename: `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${major}.${n % 10}.0.${kind === "mod" ? "jar" : "zip"}`,
        bundled: ["create", "atm"].includes(id) && kind === "mod" && index < 6,
        name,
        author,
        version: `${major}.${n % 10}.${(n * 3) % 10}`,
        enabled: n % 11 !== 0,
        update: n % 5 === 0 ? `${major}.${(n % 10) + 1}.0` : undefined,
        sizeKb: 120 + ((n * 211) % 5200),
        source: (["Modrinth", "Modrinth", "CurseForge", "Local"] as const)[
          n % 4
        ],
        icon: art[(seed + index) % art.length],
      };
    });
  if (id.includes("/world/"))
    return take(
      [
        ["Terralith", "Stardust Labs"],
        ["Vanilla Tweaks", "Vanilla Tweaks"],
      ],
      "datapack",
      2,
    );
  const mods = 8 + (seed % (modNames.length - 7));
  return [
    ...take(modNames, "mod", mods),
    ...take(packNames, "resourcepack", 1 + (seed % 3)),
    ...take(shaderNames, "shader", seed % 3),
  ];
}

const worldSeeds: Omit<WorldInfo, "id" | "image">[] = [
  {
    name: "New World",
    lastPlayed: "2 hours ago",
    sizeMb: 148,
    mode: "Survival",
    days: 142,
  },
  {
    name: "Creative Playground",
    lastPlayed: "Yesterday",
    sizeMb: 612,
    mode: "Creative",
    days: 31,
  },
  {
    name: "Hardcore Attempt 7",
    lastPlayed: "3 days ago",
    sizeMb: 89,
    mode: "Hardcore",
    days: 12,
  },
  {
    name: "Skyblock Start",
    lastPlayed: "Last week",
    sizeMb: 34,
    mode: "Survival",
    days: 4,
  },
];

function makeWorlds(id: string): WorldInfo[] {
  if (id === "server") return [];
  const seed = hash(id);
  return worldSeeds.slice(0, 1 + (seed % 4)).map((world, index) => ({
    ...world,
    id: `world-${index}`,
    image: art[(seed + index) % art.length],
  }));
}

export function screenshotsFor(id: string): Screenshot[] {
  if (id === "server") return [];
  const seed = hash(id);
  const dates = [
    "Today, 18:42",
    "Today, 17:05",
    "Yesterday",
    "Yesterday",
    "3 days ago",
    "Last week",
    "Last week",
    "Two weeks ago",
  ];
  return dates.map((date, index) => ({
    id: `shot-${index}`,
    src: art[(seed + index * 2) % art.length],
    title: `Screenshot ${index + 1}`,
    date,
  }));
}

export function statsFor(id: string): InstanceStats {
  const seed = hash(id);
  return {
    playtimeMinutes: 90 + (seed % 5400),
    lastPlayed: ["2 hours ago", "Yesterday", "3 days ago", "Last week"][
      seed % 4
    ],
    sizeMb: 380 + (seed % 3200),
    java: ["Java 21", "Java 17", "Java 8"][seed % 3],
    memoryMb: [2048, 4096, 6144, 8192][seed % 4],
    created: "March 12, 2026",
  };
}

export function logFor(id: string): LogLine[] {
  const base: Omit<LogLine, "time">[] = [
    {
      level: "info",
      text: "[main/INFO] Loading Minecraft 1.21.4 with Fabric Loader 0.16.9",
    },
    {
      level: "info",
      text: "[main/INFO] Loading 24 mods: fabric-api, sodium, lithium, iris, modmenu…",
    },
    { level: "debug", text: "[main/DEBUG] Remapping 1,284 classes" },
    { level: "info", text: "[Render thread/INFO] Setting user: PlayerOne" },
    {
      level: "warn",
      text: "[Render thread/WARN] Missing sound for event: minecraft:entity.glow_squid.ambient",
    },
    {
      level: "info",
      text: "[Render thread/INFO] Backend library: LWJGL version 3.3.3-snapshot",
    },
    {
      level: "info",
      text: "[Render thread/INFO] Reloading ResourceManager: vanilla, fabric, Faithful 32x",
    },
    {
      level: "warn",
      text: '[Worker-Main-2/WARN] Unable to parse shader pack option "shadowDistance"; using default',
    },
    {
      level: "info",
      text: "[Server thread/INFO] Starting integrated minecraft server version 1.21.4",
    },
    { level: "info", text: "[Server thread/INFO] Preparing spawn area: 100%" },
    {
      level: "error",
      text: "[Render thread/ERROR] Failed to load texture minecraft:textures/block/custom_ore.png (missing)",
    },
    { level: "info", text: "[Server thread/INFO] PlayerOne joined the game" },
    { level: "info", text: "[Render thread/INFO] Saving worlds" },
  ];
  const seed = hash(id);
  return base.map((line, index) => ({
    ...line,
    time: `18:${String(10 + ((seed + index) % 40)).padStart(2, "0")}:${String((index * 7) % 60).padStart(2, "0")}`,
  }));
}

// ---- Editable resource state, kept per instance so toggles survive navigation ----

const stores = new Map<
  string,
  ReturnType<typeof createSignal<InstalledResource[]>>
>();

function store(id: string) {
  let entry = stores.get(id);
  if (!entry) {
    const [list, setList] = createSignal(makeResources(id), {
      name: `resources:${id}`,
    });
    entry = [list, setList];
    stores.set(id, entry);
  }
  return entry;
}

export const resourcesFor = (id: string) => {
  const [list] = store(id);
  return list();
};
const worldStores = new Map<string, ReturnType<typeof createWorldStore>>();
function createWorldStore(id: string) {
  const [worlds, setWorlds] = createSignal(makeWorlds(id), {
    name: `worlds:${id}`,
  });
  return { worlds, setWorlds };
}
function worldStore(id: string) {
  let store = worldStores.get(id);
  if (!store) {
    store = createWorldStore(id);
    worldStores.set(id, store);
  }
  return store;
}
export const worldsFor = (id: string) => worldStore(id).worlds();
export function deleteWorldFixture(id: string, worldId: string) {
  worldStore(id).setWorlds((list) =>
    list.filter((world) => world.id !== worldId),
  );
}
export function copyWorldFixture(
  from: string,
  to: string,
  worldId: string,
  move = false,
) {
  const source = worldsFor(from).find((world) => world.id === worldId);
  if (!source) return;
  const copy = {
    ...source,
    id: `world-${crypto.randomUUID()}`,
    name: from === to ? `${source.name} (copy)` : source.name,
  };
  worldStore(to).setWorlds((list) => [...list, copy]);
  if (move) deleteWorldFixture(from, worldId);
}
export function importWorldFixture(id: string, name: string) {
  worldStore(id).setWorlds((list) => [
    ...list,
    {
      id: `world-${crypto.randomUUID()}`,
      name,
      lastPlayed: "Not played",
      sizeMb: 0,
      mode: "Survival",
      image: art[0],
      days: 0,
    },
  ]);
}
export function unlinkBundledResources(id: string, remove: boolean) {
  update(id, (list) =>
    remove
      ? list.filter((item) => !item.bundled)
      : list.map((item) => ({ ...item, bundled: false })),
  );
}
export function setResourceVersion(
  id: string,
  resourceId: string,
  version: string,
) {
  update(id, (list) =>
    list.map((item) =>
      item.id === resourceId
        ? {
            ...item,
            version,
            update: item.update === version ? undefined : item.update,
          }
        : item,
    ),
  );
}

function update(
  instanceId: string,
  change: (list: InstalledResource[]) => InstalledResource[],
) {
  const [, setList] = store(instanceId);
  setList(change);
}

export function setResourcesEnabled(
  instanceId: string,
  ids: string[],
  enabled: boolean,
) {
  update(instanceId, (list) =>
    list.map((item) => (ids.includes(item.id) ? { ...item, enabled } : item)),
  );
}

export function removeResources(instanceId: string, ids: string[]) {
  update(instanceId, (list) => list.filter((item) => !ids.includes(item.id)));
}

export function applyUpdates(instanceId: string, ids: string[]) {
  update(instanceId, (list) =>
    list.map((item) =>
      ids.includes(item.id) && item.update
        ? { ...item, version: item.update, update: undefined }
        : item,
    ),
  );
}

export function formatPlaytime(minutes: number) {
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

export function formatSize(kb: number) {
  return kb >= 1024 * 1024
    ? `${(kb / 1024 / 1024).toFixed(1)} GB`
    : kb >= 1024
      ? `${(kb / 1024).toFixed(1)} MB`
      : `${kb} KB`;
}
