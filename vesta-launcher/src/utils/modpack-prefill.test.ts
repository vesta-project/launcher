import { describe, expect, it } from "vitest";
import {
	deriveVersionScopedResourceState,
	shouldFetchArchiveSummary,
} from "./modpack-prefill";

describe("modpack prefill resource state", () => {
	it("uses API dependency count when the selected version provides one", () => {
		const state = deriveVersionScopedResourceState({
			dependencies: [
				{ dependency_type: "required" },
				{ dependency_type: "optional" },
				{ dependency_type: "incompatible" },
			],
		} as any);

		expect(state).toEqual({
			modCount: 2,
			modCountSource: "api-dependencies",
			isCountingResources: false,
			modCountLookupFailed: false,
		});
	});

	it("resets to unknown when the selected version has no usable dependency count", () => {
		const state = deriveVersionScopedResourceState({
			dependencies: [{ dependency_type: "incompatible" }],
		} as any);

		expect(state).toEqual({
			modCount: 0,
			modCountSource: "unknown",
			isCountingResources: false,
			modCountLookupFailed: false,
		});
	});

	it("enters counting state immediately when fallback summary work is pending", () => {
		const state = deriveVersionScopedResourceState(
			{
				dependencies: [{ dependency_type: "incompatible" }],
			} as any,
			{ fallbackPending: true },
		);

		expect(state).toEqual({
			modCount: 0,
			modCountSource: "unknown",
			isCountingResources: true,
			modCountLookupFailed: false,
		});
	});

	it("requests archive summary only for unknown version-scoped counts", () => {
		expect(
			shouldFetchArchiveSummary({
				modCountSource: "unknown",
				modCountLookupFailed: false,
			}),
		).toBe(true);
		expect(
			shouldFetchArchiveSummary({
				modCountSource: "api-dependencies",
				modCountLookupFailed: false,
			}),
		).toBe(false);
		expect(
			shouldFetchArchiveSummary({
				modCountSource: "manifest",
				modCountLookupFailed: false,
			}),
		).toBe(false);
		expect(
			shouldFetchArchiveSummary({
				modCountSource: "unknown",
				modCountLookupFailed: false,
			}),
		).toBe(true);
		expect(
			shouldFetchArchiveSummary({
				modCountSource: "unknown",
				modCountLookupFailed: true,
			}),
		).toBe(false);
	});
});
