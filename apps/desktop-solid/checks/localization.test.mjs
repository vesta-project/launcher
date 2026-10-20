import { readdir, readFile } from "node:fs/promises";
import { describe, expect, it } from "bun:test";
import {
  createFluentBundle,
  formatLocalizedMessage,
  formatMessage,
} from "../src/localization/catalog.ts";
import { messageIds } from "../src/localization/messages.ts";

const catalogDirectory = new URL("../src/localization/locales/en/", import.meta.url);
const files = (await readdir(catalogDirectory)).filter((file) => file.endsWith(".ftl")).sort();
const sources = await Promise.all(
  files.map((file) => readFile(new URL(file, catalogDirectory), "utf8")),
);
const english = createFluentBundle("en", sources);
const args = {
  stage: "Downloading",
  done: "12 MB",
  source: "Original",
  target: "Copy",
  amount: 16,
  author: "Pack author",
  code: 1,
  date: "Oct 17, 2026",
  message: "Network error",
  bits: "64",
  count: 2,
  visible: 1,
  total: 2,
  expected: 21,
  fallback: "none",
  found: 17,
  label: "installing",
  launcher: "Prism Launcher",
  limit: "1 GB",
  loader: "Fabric",
  max: 4,
  minecraft: "1.20.1",
  min: 2,
  name: "Test instance",
  path: "/tmp/folder",
  size: 18,
  source: "managed",
  time: "1 hour",
  title: "Test screenshot",
  type: "mods",
  value: "16 GB",
  version: "1.2.3",
};

describe("localization catalogs", () => {
  it("formats every typed message ID from a valid English Fluent entry", () => {
    for (const id of messageIds) {
      expect(formatMessage(english, id, args), id).toBeDefined();
    }
  });

  it("keeps the typed IDs and English Fluent entries in sync", () => {
    const typedIds = messageIds.map((id) => id.replaceAll(".", "-"));
    const catalogIds = sources.flatMap((source) =>
      [...source.matchAll(/^([a-z][a-z0-9-]*)\s*=/gm)].map((match) => match[1]),
    );

    expect(new Set(messageIds).size).toBe(messageIds.length);
    expect(new Set(catalogIds)).toEqual(new Set(typedIds));
  });

  it("supports Fluent variable interpolation and English plural selection", () => {
    const one = formatMessage(english, "console.line-count", { visible: 1, total: 1 });
    const many = formatMessage(english, "console.line-count", { visible: 2, total: 3 });
    const withoutIsolation = (value) => value?.replace(/[\u2068\u2069]/g, "");

    expect(withoutIsolation(one)).toBe("1 of 1 line");
    expect(withoutIsolation(many)).toBe("2 of 3 lines");
    expect(formatMessage(english, "worlds.delete-title", args)).toContain(
      "Test instance",
    );
  });

  it("falls back to English and exposes an unknown message ID safely", () => {
    const empty = createFluentBundle("en-GB", []);

    expect(formatLocalizedMessage(empty, english, "common.cancel")).toBe("Cancel");
    expect(formatLocalizedMessage(empty, english, "missing.message")).toBe(
      "missing.message",
    );
  });
});
