import { describe, expect, it } from "vitest";
import { getConsoleLogDisplay } from "./console-log-display";

const history = [{ name: "2026-07-09-1.log.gz", path: "/logs/2026-07-09-1.log.gz", size: 1228, last_modified: 1785744000 }];

describe("getConsoleLogDisplay", () => {
	it("uses latest.log for a live stream", () => {
		expect(getConsoleLogDisplay({ isLive: true, history: [], instanceSlug: "pack" }).title).toBe("latest.log");
	});
	it("uses the selected basename and metadata", () => {
		const result = getConsoleLogDisplay({ isLive: false, currentLogPath: history[0].path, history, instanceSlug: "pack" });
		expect(result.title).toBe("2026-07-09-1.log.gz");
		expect(result.metadata).toContain("1.2 KB");
	});
	it("uses newest history and launcher fallback for stopped instances", () => {
		expect(getConsoleLogDisplay({ isLive: false, history, instanceSlug: "pack" }).title).toBe(history[0].name);
		expect(getConsoleLogDisplay({ isLive: false, history: [], instanceSlug: "pack" }).title).toBe("pack.log");
	});
});
