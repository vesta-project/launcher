import { describe, expect, test } from "bun:test";
import {
  enrichLocalPack,
  knownPackVersion,
  packArtwork,
} from "../src/features/installation/pack-metadata";

const archive = {
  name: "Local pack",
  version: "Unknown",
  author: null,
  description: null,
  iconUrl: null,
  minecraftVersion: "1.20.1",
  modloader: "forge",
  modloaderVersion: "47.4.20",
  modCount: 126,
  recommendedRamMb: 4096,
  format: "CurseForge",
  fullMetadata: { marker: "original archive contents" },
};

describe("uploaded pack metadata", () => {
  test("enriches exact source identity while preserving archive install configuration", () => {
    const result = enrichLocalPack(archive, {
      matched: true,
      modpackId: "123",
      modpackPlatform: "curseforge",
      modpackVersionId: "456",
      name: "Bountiful Wilds",
      version: "3.0.2",
      author: "Pack author",
      iconUrl: "https://example.com/icon.png",
      description: "Pack summary",
      downloadCount: 12345,
    });
    expect(result).toMatchObject({
      name: "Bountiful Wilds",
      version: "3.0.2",
      modpackId: "123",
      downloadCount: 12345,
    });
    expect(result.fullMetadata).toBe(archive.fullMetadata);
    expect(result.minecraftVersion).toBe(archive.minecraftVersion);
    expect(result.modloaderVersion).toBe(archive.modloaderVersion);
    expect(result.recommendedRamMb).toBe(archive.recommendedRamMb);
    expect(result.modCount).toBe(126);
    expect(archive.name).toBe("Local pack");
  });
  test("does not establish partial or unmatched project linkage", () => {
    expect(
      enrichLocalPack(archive, { matched: false, modpackId: "123", modpackPlatform: "curseforge" }),
    ).toBe(archive);
    expect(enrichLocalPack(archive, { matched: true, modpackId: "123" })).toBe(archive);
  });
  test("avoids displaying unknown releases and archive-relative broken artwork", () => {
    expect(knownPackVersion("Unknown")).toBeUndefined();
    expect(knownPackVersion("3.0.2")).toBe("3.0.2");
    expect(packArtwork("overrides/icon.png")).toBeUndefined();
    expect(packArtwork("https://example.com/icon.png")).toBe("https://example.com/icon.png");
    expect(packArtwork("data:image/png;base64,aQ==")).toBe("data:image/png;base64,aQ==");
  });
});
