import { expect, test } from "bun:test";
import { SettingsWriteQueue } from "../src/features/settings/write-queue";

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

test("debounced writes run after their timeout", async () => {
  const calls = [];
  const queue = new SettingsWriteQueue(
    async (updates) => calls.push(updates),
    () => {},
    () => {},
    10,
  );
  const done = queue.enqueue("hue", 10);
  await Promise.resolve();
  expect(calls).toEqual([]);
  await done;
  expect(calls).toEqual([{ hue: 10 }]);
});

test("drain flushes a pending debounce and an idle drain resolves", async () => {
  const calls = [];
  const queue = new SettingsWriteQueue(
    async (updates) => calls.push(updates),
    () => {},
    () => {},
    60_000,
  );
  await queue.drain();
  queue.enqueue("hue", 10);
  await Promise.resolve();
  queue.enqueue("hue", 20);
  await queue.drain();
  expect(calls).toEqual([{ hue: 20 }]);
}, 1000);

test("drain waits for active and queued writes, including edits added during drain", async () => {
  const first = deferred();
  const second = deferred();
  const calls = [];
  let settled = 0;
  const queue = new SettingsWriteQueue(
    async (updates) => {
      calls.push(updates);
      await (calls.length === 1 ? first.promise : second.promise);
    },
    () => {},
    () => settled++,
    60_000,
  );
  const running = queue.enqueue("hue", 10);
  queue.flush();
  await Promise.resolve();
  queue.enqueue("hue", 20);
  let drained = false;
  const done = queue.drain().then(() => { drained = true; });
  queue.enqueue("memory", 4096);
  first.resolve();
  await Promise.resolve();
  await Promise.resolve();
  expect(calls).toEqual([{ hue: 10 }, { hue: 20, memory: 4096 }]);
  expect(drained).toBe(false);
  second.resolve();
  await done;
  await running;
  expect(settled).toBe(1);
  expect(queue.pending()).toEqual({});
}, 1000);

test("drain rejects a failed current batch after remaining writes settle and recovers", async () => {
  const second = deferred();
  const failure = new Error("offline");
  const failures = [];
  let calls = 0;
  const queue = new SettingsWriteQueue(
    async () => {
      if (++calls === 1) throw failure;
      if (calls === 2) await second.promise;
    },
    (error) => failures.push(error),
    () => {},
  );
  const running = queue.enqueue("hue", 10);
  await Promise.resolve();
  queue.enqueue("hue", 20);
  await Promise.resolve();
  // The first write has already failed, but its running batch is still active.
  expect(failures).toEqual([failure]);
  let drained = false;
  const done = queue.drain();
  const rejected = done.catch((error) => error);
  done.then(() => { drained = true; }, () => { drained = true; });
  await Promise.resolve();
  expect(drained).toBe(false);
  second.resolve();
  expect(await rejected).toBe(failure);
  await expect(running).resolves.toBeUndefined();
  await queue.drain();
  queue.enqueue("hue", 30);
  await queue.drain();
  expect(calls).toBe(3);
}, 1000);

test("concurrent drains reject a write that fails while draining", async () => {
  const active = deferred();
  const failure = new Error("offline");
  const queue = new SettingsWriteQueue(async () => {
    await active.promise;
    throw failure;
  }, () => {}, () => {}, 60_000);
  const running = queue.enqueue("hue", 10);
  const first = queue.drain().catch((error) => error);
  const second = queue.drain().catch((error) => error);
  active.resolve();
  expect(await Promise.all([first, second])).toEqual([failure, failure]);
  await expect(running).resolves.toBeUndefined();
  await queue.drain();
}, 1000);

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

test("rewrite themes use the revision authority and never write legacy config fields", async () => {
  const calls = [];
  await persistSettings(
    async (command, args) => {
      calls.push({ command, args });
      if (command === 'get_author_theme_state') return { revision: 7 };
    },
    {
      theme_id: "vesta",
      theme_primary_hue: 185,
      theme_grain: 25,
    },
  );
  expect(calls).toEqual([
    { command: 'get_author_theme_state', args: undefined },
    {
      command: "update_rewrite_theme",
      args: {
        expectedRevision: 7,
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
