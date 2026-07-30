import { describe, expect, test } from "vitest";
import {
	getInstanceId,
	getInstanceInstallationFailureReason,
	isInstanceInstallationFailed,
	needsInstanceInstallation,
} from "./instances";

describe("instances util", () => {
	test("getInstanceId returns numeric value", () => {
		const inst: any = {
			id: 42,
			name: "Test Instance",
		};
		expect(getInstanceId(inst)).toBe(42);
	});

	test("recognizes backend failure statuses that include a reason", () => {
		const inst: any = {
			installationStatus: "failed:Network request timed out",
		};

		expect(isInstanceInstallationFailed(inst)).toBe(true);
		expect(needsInstanceInstallation(inst)).toBe(true);
		expect(getInstanceInstallationFailureReason(inst)).toBe(
			"Network request timed out",
		);
	});

	test("does not treat a restored update as needing installation", () => {
		const inst: any = {
			installationStatus: "installed",
			lastOperation: "update",
		};

		expect(isInstanceInstallationFailed(inst)).toBe(false);
		expect(needsInstanceInstallation(inst)).toBe(false);
		expect(getInstanceInstallationFailureReason(inst)).toBeNull();
	});
});
