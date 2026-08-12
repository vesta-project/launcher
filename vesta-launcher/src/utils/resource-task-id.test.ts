import { describe, expect, it } from "vitest";
import { parseDownloadTaskId } from "./resource-task-id";

describe("parseDownloadTaskId", () => {
	it("parses base64url-encoded pipe task ids", () => {
		expect(
			parseDownloadTaskId("download|instance-123|cGFjaw|MS4wLjA"),
		).toEqual({ projectId: "pack", versionId: "1.0.0" });
	});

	it("supports delimiters inside ids when encoded", () => {
		expect(
			parseDownloadTaskId("download|world-1-my|cHJvfGplY3Q|djF8ZXh0cmE"),
		).toEqual({ projectId: "pro|ject", versionId: "v1|extra" });
	});


	it("parses the destination-branch underscore format", () => {
		expect(
			parseDownloadTaskId("download_instance-1_sodium_mc1.21"),
		).toEqual({ projectId: "sodium", versionId: "mc1.21" });
	});

	it("returns null for malformed task ids", () => {
		expect(parseDownloadTaskId("launch|instance-1")).toBeNull();
		expect(parseDownloadTaskId("download|only-two")).toBeNull();
		expect(parseDownloadTaskId("download|instance|myriad|2.1")).toBeNull();
		expect(parseDownloadTaskId("download|instance|not-base64|still-not")).toBeNull();
	});
});
