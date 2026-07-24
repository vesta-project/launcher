import {
	createMiniWindowSessionId,
	createMiniWindowSnapshot,
	createPopOutSnapshot,
	sanitizeMiniWindowSnapshot,
} from "@components/page-viewer/mini-window-state";
import { describe, expect, it } from "vitest";

describe("mini-window session identity", () => {
	it("reuses a logical window for the same route identity", () => {
		expect(createMiniWindowSessionId("/instance", { id: 7 })).toBe(
			createMiniWindowSessionId("/instance", { id: 7, activeTab: "logs" }),
		);
	});

	it("keeps different identities available concurrently", () => {
		expect(createMiniWindowSessionId("/instance", { id: 7 })).not.toBe(
			createMiniWindowSessionId("/instance", { id: 8 }),
		);
	});

	it("supports an explicit caller session for duplicate route windows", () => {
		const first = createMiniWindowSnapshot("instance-7-primary", "/instance", {
			id: 7,
		});
		const second = createMiniWindowSnapshot(
			"instance-7-secondary",
			"/instance",
			{ id: 7 },
		);
		expect(first.sessionId).not.toBe(second.sessionId);
	});

	it("uses the popped-out route instead of the parent router session", () => {
		const settings = createPopOutSnapshot(
			createMiniWindowSnapshot("main-router", "/config"),
		);
		const instance = createPopOutSnapshot(
			createMiniWindowSnapshot("main-router", "/instance", { slug: "sky" }),
		);

		expect(settings.sessionId).toBe("/config");
		expect(instance.sessionId).toBe("/instance|slug:sky");
		expect(settings.sessionId).not.toBe(instance.sessionId);
	});

	it("reuses pop-outs for the same logical route identity", () => {
		const first = createPopOutSnapshot(
			createMiniWindowSnapshot("main-router", "/instance", {
				slug: "sky",
				activeTab: "home",
			}),
		);
		const second = createPopOutSnapshot(
			createMiniWindowSnapshot("main-router", "/instance", {
				slug: "sky",
				activeTab: "logs",
			}),
		);

		expect(first.sessionId).toBe(second.sessionId);
	});
});

describe("mini-window snapshot transfer", () => {
	it("retains serializable view state and removes runtime-only values", () => {
		const cyclic: Record<string, unknown> = { selected: "versions" };
		cyclic.self = cyclic;
		const snapshot = createMiniWindowSnapshot(
			"settings",
			"/config",
			{ activeTab: "appearance" },
			{
				form: cyclic,
				close: () => undefined,
				router: { current: "/config" },
			},
		);

		const transferred = sanitizeMiniWindowSnapshot(snapshot);

		expect(transferred.current.params).toEqual({ activeTab: "appearance" });
		expect(transferred.current.props).toEqual({
			form: { selected: "versions" },
		});
	});
});
