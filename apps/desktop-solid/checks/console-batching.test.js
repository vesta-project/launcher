import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Bundle the real session with inert host/data adapters, without installing global
// module mocks that would affect the other checks. No DOM or browser is involved.
async function sessionHarness() {
  const built = await Bun.build({
    entrypoints: [
      new URL("../src/features/instances/console-session.ts", import.meta.url)
        .pathname,
    ],
    target: "bun",
    conditions: ["browser", "development"],
    plugins: [
      {
        name: "console-host-fixture",
        setup(build) {
          build.onResolve(
            { filter: /^\.\.\/\.\.\/localization$/ },
            () => ({ path: 'localization', namespace: 'fixture' }),
          );
          build.onResolve(
            { filter: /^\.\/(native-service|details)$/ },
            ({ path }) => ({ path, namespace: "fixture" }),
          );
          build.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({
            contents:
              path === "localization"
                ? "export const t = (id) => id;"
                : path === "./details"
                ? "export const logFor = () => [];"
                : "export const nativeInstances = false; export const nativeRecord = () => undefined; export const reportInstanceError = () => {};",
            loader: "js",
          }));
          build.onLoad(
            { filter: /console-session\.ts$/ },
            async ({ path }) => ({
              contents:
                `
          import { flush as flushSignals } from 'solid-js';
          export { flushSignals };
          export { captureArtifact, expectNoDiagnostics } from '@solidjs/diagnostics';
          const frames = new Map(); let frameId = 0;
          function requestAnimationFrame(callback) { frames.set(++frameId, callback); return frameId; }
          function cancelAnimationFrame(id) { frames.delete(id); }
          export const pendingFrames = () => frames.size;
          export function flushFrame() { for (const [id, callback] of [...frames]) { frames.delete(id); callback(); } flushSignals(); }
        ` + (await Bun.file(path).text()),
              loader: "ts",
            }),
          );
        },
      },
    ],
  });
  if (!built.success)
    throw new AggregateError(built.logs, "Console harness did not build");
  const directory = await mkdtemp(join(tmpdir(), "vesta-console-check-"));
  try {
    const path = join(directory, "session.mjs");
    await Bun.write(path, built.outputs[0]);
    return await import(pathToFileURL(path).href);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe("console frame batching", () => {
  test("bursts publish once in order, stay capped, and clear includes queued output", async () => {
    const harness = await sessionHarness();
    const { artifact } = await harness.captureArtifact(
      () => {
        const session = harness.consoleSession("batched-output");
        const initial = session.lines();
        const firstId = initial.at(-1).id + 1;
        session.append(["first"]);
        session.append(["second", "third"]);
        expect(harness.pendingFrames()).toBe(1);
        expect(session.lines()).toBe(initial);
        harness.flushFrame();
        expect(
          session
            .lines()
            .slice(-3)
            .map((line) => line.raw),
        ).toEqual(["first", "second", "third"]);
        expect(
          session
            .lines()
            .slice(-3)
            .map((line) => line.id),
        ).toEqual([firstId, firstId + 1, firstId + 2]);
        expect(harness.pendingFrames()).toBe(0);

        const nextId = session.lines().at(-1).id + 1;
        session.append(
          Array.from({ length: 7000 }, (_, index) => `burst ${index}`),
        );
        harness.flushFrame();
        expect(session.lines()).toHaveLength(5000);
        expect(session.lines()[0]).toMatchObject({
          raw: "burst 2000",
          id: nextId + 2000,
        });
        expect(session.lines().at(-1)).toMatchObject({
          raw: "burst 6999",
          id: nextId + 6999,
        });

        session.append(["before clear"]);
        session.clearDisplay();
        harness.flushSignals();
        expect(harness.pendingFrames()).toBe(0);
        const hidden = session.state().hiddenUntil.live;
        expect(hidden).toBe(session.lines().at(-1).id + 1);
        session.append(["after clear"]);
        harness.flushFrame();
        expect(
          session
            .lines()
            .filter((line) => line.id >= hidden)
            .map((line) => line.raw),
        ).toEqual(["after clear"]);
        session.append(["stack one\r\nstack two\n"]);
        harness.flushFrame();
        expect(
          session
            .lines()
            .slice(-2)
            .map((line) => line.raw),
        ).toEqual(["stack one", "stack two"]);
        session.restoreDisplay();
        harness.flushSignals();
        expect(session.state().hiddenUntil.live).toBe(0);
      },
      { scenario: "console-frame-burst-and-clear" },
    );
    harness.expectNoDiagnostics(artifact);
  });
});
