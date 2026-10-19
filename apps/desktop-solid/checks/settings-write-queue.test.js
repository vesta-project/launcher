import { expect, test } from "bun:test";
import { SettingsWriteQueue } from "../src/features/settings/write-queue";

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

test("coalesces same-turn edits, serializes writes, and retains newer pending edits", async () => {
  const first = deferred();
  const calls = [];
  let settled = 0;
  const queue = new SettingsWriteQueue(
    async (updates) => {
      calls.push(updates);
      if (calls.length === 1) await first.promise;
    },
    () => {
      throw new Error("Unexpected failure");
    },
    () => settled++,
  );
  const done = queue.enqueue("hue", 10);
  queue.enqueue("hue", 20);
  queue.enqueue("memory", 4096);
  await Promise.resolve();
  expect(calls).toEqual([{ hue: 20, memory: 4096 }]);
  queue.enqueue("hue", 30);
  expect(queue.pending()).toEqual({ hue: 30, memory: 4096 });
  first.resolve();
  await done;
  expect(calls).toEqual([{ hue: 20, memory: 4096 }, { hue: 30 }]);
  expect(queue.pending()).toEqual({});
  expect(settled).toBe(1);
});

test("a rejected write does not poison subsequent writes", async () => {
  const failures = [];
  const calls = [];
  const queue = new SettingsWriteQueue(
    async (updates) => {
      calls.push(updates);
      if (calls.length === 1) throw new Error("offline");
    },
    (error) => failures.push(error.message),
    () => {},
  );
  await queue.enqueue("enabled", true);
  await queue.enqueue("enabled", false);
  expect(failures).toEqual(["offline"]);
  expect(calls).toEqual([{ enabled: true }, { enabled: false }]);
  expect(queue.pending()).toEqual({});
});

const { persistSettings } = await import("../src/features/settings/native-config");

test("autostart applies the OS setting and rolls it back when persistence fails", async () => {
  const calls = [];
  await expect(
    persistSettings(
      async (command) => {
        calls.push(command);
        if (command.endsWith("is_enabled")) return false;
        if (command === "update_config_fields") throw new Error("database unavailable");
      },
      { autostart_enabled: true },
    ),
  ).rejects.toThrow("database unavailable");
  expect(calls).toEqual([
    "plugin:autostart|is_enabled",
    "plugin:autostart|enable",
    "update_config_fields",
    "plugin:autostart|disable",
  ]);
});

test("OS failure prevents persisting an autostart state that did not take effect", async () => {
  const calls = [];
  await expect(
    persistSettings(
      async (command) => {
        calls.push(command);
        if (command.endsWith("is_enabled")) return false;
        throw new Error("permission denied");
      },
      { autostart_enabled: true },
    ),
  ).rejects.toThrow("permission denied");
  expect(calls).toEqual(["plugin:autostart|is_enabled", "plugin:autostart|enable"]);
});

test("rewrite themes use their own command and never write legacy config fields", async () => {
  const calls = [];
  await persistSettings(
    async (command, args) => {
      calls.push({ command, args });
    },
    {
      theme_id: "vesta",
      theme_primary_hue: 185,
      theme_grain: 25,
    },
  );
  expect(calls).toEqual([
    {
      command: "update_rewrite_theme",
      args: {
        updates: { id: "vesta", hue: 185, grain: 25 },
      },
    },
  ]);
});

test("native window preferences remain outside the theme document", async () => {
  const calls = [];
  await persistSettings(
    async (command, args) => {
      calls.push({ command, args });
    },
    {
      theme_window_effect: "none",
      theme_background_opacity: 100,
    },
  );
  expect(calls).toEqual([
    {
      command: "update_config_fields",
      args: {
        updates: { theme_window_effect: "none", theme_background_opacity: 100 },
      },
    },
  ]);
});

test('default rewrite theme is Vesta and excludes all window settings', async () => {
  const { defaultTheme, themeSettings } = await import('../src/features/settings/theme-model');
  expect(defaultTheme.id).toBe('vesta');
  expect(defaultTheme.hue).toBe(207);
  const fields = themeSettings(defaultTheme);
  expect(fields.theme_id).toBe('vesta');
  expect(fields).not.toHaveProperty('theme_window_effect');
  expect(fields).not.toHaveProperty('theme_background_opacity');
});
