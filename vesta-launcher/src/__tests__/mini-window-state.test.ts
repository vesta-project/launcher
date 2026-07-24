import {
	createMiniWindowSessionId,
	createMiniWindowSnapshot,
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
		const first = createMiniWindowSnapshot(
			"instance-7-primary",
			"/instance",
			{ id: 7 },
		);
		const second = createMiniWindowSnapshot(
			"instance-7-secondary",
			"/instance",
			{ id: 7 },
		);
		expect(first.sessionId).not.toBe(second.sessionId);
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
