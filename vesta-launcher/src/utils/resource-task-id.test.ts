import { describe, expect, it } from "vitest";
import { parseDownloadTaskId } from "./resource-task-id";

describe("parseDownloadTaskId", () => {
	it("parses base64url-encoded pipe task ids", () => {
		expect(
			parseDownloadTaskId("download|v2|instance-123|smithed|cGFjaw|MS4wLjA"),
		).toEqual({
			target: "instance-123",
			platform: "smithed",
			projectId: "pack",
			versionId: "1.0.0",
		});
	});

	it("supports delimiters inside world names and encoded ids", () => {
		expect(
			parseDownloadTaskId(
				"download|v2|world-1-my|copy|modrinth|cHJvfGplY3Q|djF8ZXh0cmE",
			),
		).toEqual({
			target: "world-1-my|copy",
			platform: "modrinth",
			projectId: "pro|ject",
			versionId: "v1|extra",
		});
	});

	it("does not reinterpret provider-like suffixes in legacy world names", () => {
		expect(
			parseDownloadTaskId("download|world-7-My|smithed|cGFjaw|dmVyc2lvbg"),
		).toEqual({
			target: "world-7-My|smithed",
			platform: null,
			projectId: "pack",
			versionId: "version",
		});
	});

	it("parses the earlier provider-less pipe format", () => {
		expect(parseDownloadTaskId("download|instance-123|cGFjaw|MS4wLjA")).toEqual(
			{
				target: "instance-123",
				platform: null,
				projectId: "pack",
				versionId: "1.0.0",
			},
		);
	});

	it("parses the destination-branch underscore format", () => {
		expect(parseDownloadTaskId("download_instance-1_sodium_mc1.21")).toEqual({
			target: "instance-1",
			platform: null,
			projectId: "sodium",
			versionId: "mc1.21",
		});
	});

	it("returns null for malformed task ids", () => {
		expect(parseDownloadTaskId("launch|instance-1")).toBeNull();
		expect(parseDownloadTaskId("download|only-two")).toBeNull();
		expect(parseDownloadTaskId("download|instance|myriad|2.1")).toBeNull();
		expect(
			parseDownloadTaskId("download|instance|not-base64|still-not"),
		).toBeNull();
	});
});
