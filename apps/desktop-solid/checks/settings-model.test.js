import { describe, expect, test } from "bun:test";
import { buildJavaEnvironments, javaFixture } from "../src/features/settings/java-model";
import { chordFromEvent, chordKeys } from "../src/features/settings/shortcuts";
import { formatBytes } from "../src/features/settings/storage-model";

describe("java environments", () => {
  const environments = buildJavaEnvironments(javaFixture);
  test("one environment per generation, with a managed slot even when not installed", () => {
    expect(environments.map((item) => item.major)).toEqual([8, 17, 21]);
    expect(environments[0].runtimes).toEqual([{ source: "managed", path: null, active: false }]);
  });
  test("the chosen global path is the only active runtime", () => {
    const java21 = environments[2];
    expect(java21.active?.source).toBe("managed");
    expect(java21.runtimes.filter((runtime) => runtime.active)).toHaveLength(1);
    expect(java21.runtimes.map((runtime) => runtime.source)).toEqual(["managed", "system"]);
  });
  test("custom paths that are not detected appear as custom", () => {
    const [java17] = buildJavaEnvironments({
      ...javaFixture,
      global: [{ major_version: 17, path: "/opt/java17/bin/java", is_managed: false, is_active: true }],
    }).filter((item) => item.major === 17);
    expect(java17.runtimes.at(-1)).toEqual({ source: "custom", path: "/opt/java17/bin/java", active: true });
  });
});

describe("shortcut chords", () => {
  const press = (key, modifiers = {}) => ({ key, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...modifiers });
  test("modifiers alone do not complete a chord", () => {
    expect(chordFromEvent(press("Shift", { shiftKey: true }), "linux")).toBeUndefined();
  });
  test("Mod is Command on macOS and Control elsewhere", () => {
    expect(chordFromEvent(press("k", { metaKey: true }), "macos")).toBe("Mod+K");
    expect(chordFromEvent(press("k", { ctrlKey: true }), "windows")).toBe("Mod+K");
    expect(chordFromEvent(press("k", { ctrlKey: true }), "macos")).toBe("Ctrl+K");
  });
  test("keycaps are platform specific", () => {
    expect(chordKeys("Mod+Shift+ArrowLeft", "macos")).toEqual(["⌘", "⇧", "←"]);
    expect(chordKeys("Mod+,", "linux")).toEqual(["Ctrl", ","]);
  });
});

test("formats byte sizes", () => {
  expect(formatBytes(512)).toBe("512 B");
  expect(formatBytes(1536)).toBe("1.5 KB");
  expect(formatBytes(1024 ** 3)).toBe("1.0 GB");
});
