import { describe, expect, it } from "vitest";
import { selectEligibleModpackUpdate } from "./modpack-update";

const version = (
	id: string,
	version_number: string,
	release_type: "alpha" | "beta" | "release",
	game_versions = ["1.21.1"],
) => ({
	id,
	version_number,
	release_type,
	game_versions,
});

describe("selectEligibleModpackUpdate", () => {
	it("does not suggest a lower version on the same stability track", () => {
		const update = selectEligibleModpackUpdate(
			[
				version("older", "12.2.2", "alpha"),
				version("current", "13.2.2", "alpha"),
			],
			"current",
			"1.21.1",
		);

		expect(update).toBeNull();
	});

	it("suggests a higher version with equal or higher stability on the same Minecraft version", () => {
		const update = selectEligibleModpackUpdate(
			[
				version("beta", "14.0.0", "beta"),
				version("current", "13.2.2", "alpha"),
			],
			"current",
			"1.21.1",
		);

		expect(update?.id).toBe("beta");
	});

	it("does not suggest updates for a different Minecraft version", () => {
		const update = selectEligibleModpackUpdate(
			[
				version("next-mc", "14.0.0", "alpha", ["1.22"]),
				version("current", "13.2.2", "alpha", ["1.21.1"]),
			],
			"current",
			"1.21.1",
		);

		expect(update).toBeNull();
	});

	it("does not suggest lower stability updates for an installed release", () => {
		const update = selectEligibleModpackUpdate(
			[
				version("alpha", "14.0.0", "alpha"),
				version("current", "13.2.2", "release"),
			],
			"current",
			"1.21.1",
		);

		expect(update).toBeNull();
	});

	it("does not produce unsafe suggestions when the installed version is unknown", () => {
		const update = selectEligibleModpackUpdate(
			[version("candidate", "14.0.0", "release")],
			"missing-current",
			"1.21.1",
		);

		expect(update).toBeNull();
	});
});
