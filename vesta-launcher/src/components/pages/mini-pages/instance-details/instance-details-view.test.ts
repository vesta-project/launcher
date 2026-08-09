import { describe, expect, it } from "vitest";
import { getInstancePrimaryAction, normalizeInstanceTab, summarizeResources } from "./instance-details-view";

describe("normalizeInstanceTab", () => {
	it("keeps canonical tabs and redirects legacy screenshots", () => {
		expect(normalizeInstanceTab("resources")).toBe("resources");
		expect(normalizeInstanceTab("worlds")).toBe("worlds");
		expect(normalizeInstanceTab("screenshots")).toBe("home");
		expect(normalizeInstanceTab("unknown")).toBe("home");
	});
});

describe("getInstancePrimaryAction", () => {
	it.each([
		[{ running: true }, "Stop", "stop"],
		[{ launching: true }, "Starting…", "spinner"],
		[{ operationInProgress: true, operationLabel: "Repairing" }, "Repairing…", "spinner"],
		[{ interrupted: true, lastOperation: "repair" }, "Resume repair", "recovery"],
		[{ needsInstallation: true, installationFailed: true }, "Retry install", "error"],
		[{ updateRecovery: true }, "Resume recovery", "error"],
		[{ hasCrash: true }, "View crash", "error"],
		[{}, "Play", "play"],
	])("maps %o to %s", (state, label, icon) => {
		const action = getInstancePrimaryAction(state);
		expect(action.label).toBe(label);
		expect(action.icon).toBe(icon);
	});
});

describe("summarizeResources", () => {
	it("describes mixed ownership and known updates without filler", () => {
		expect(summarizeResources([{ source_kind: "modpack" }, {}], 1)).toBe("2 installed · 1 bundled · 1 custom · 1 update");
	});
});
