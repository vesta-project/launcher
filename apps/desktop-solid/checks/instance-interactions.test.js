import { describe, expect, test } from "bun:test";
import {
  matchesLog,
  parseLog,
  selectVisible,
} from "../src/features/instances/interaction-utils";

describe("resource selection", () => {
  test("selecting a filtered view retains other selections without duplicates", () => {
    expect(selectVisible(["hidden", "one"], ["one", "two"], true)).toEqual([
      "hidden",
      "one",
      "two",
    ]);
    expect(
      selectVisible(["hidden", "one", "two"], ["one", "two"], false),
    ).toEqual(["hidden"]);
  });
  test("an empty filtered view cannot erase the selection", () => {
    expect(selectVisible(["hidden"], [], false)).toEqual(["hidden"]);
  });
});
describe("console log contracts retained from the original store", () => {
  test("parses log4j output without duplicating thread and level in the message", () => {
    const line = parseLog("[12:34:56] [Render thread/INFO]: Loading world", 7);
    expect(line).toMatchObject({
      id: 7,
      timestamp: "12:34:56",
      thread: "Render thread",
      level: "INFO",
      message: "Loading world",
    });
  });
  test("raw multiline and stack trace output remains selectable and filterable", () => {
    const raw =
      "\tat net.minecraft.server.Main.main(Main.java:42)\nCaused by: allocation failed";
    const line = parseLog(raw, 8);
    expect(line.message).toBe(raw);
    expect(matchesLog(line, ["ERROR"], "allocation")).toBe(true);
    expect(matchesLog(line, [], "")).toBe(true);
  });
  test("FATAL uses the error category and searches ignore case", () => {
    const line = parseLog("[12:34:56] [main/FATAL]: Out of memory", 9);
    expect(matchesLog(line, ["ERROR"], "MEMORY")).toBe(true);
    expect(matchesLog(line, ["INFO"], "")).toBe(false);
  });
  test("unknown formatted levels retain the raw output", () => {
    const line = parseLog("[12:34:56] [main/TRACE]: diagnostic output", 10);
    expect(line.level).toBe("UNKNOWN");
    expect(matchesLog(line, ["WARN"], "diagnostic")).toBe(true);
  });
});
