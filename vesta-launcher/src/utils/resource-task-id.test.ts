import { describe, expect, it } from "vitest";
import { parseDownloadTaskId } from "./resource-task-id";

describe("parseDownloadTaskId", () => {
	it("parses pipe-delimited download task ids by field", () => {
		expect(
			parseDownloadTaskId("download|instance-123|pack|1.0.0"),
		).toEqual({ projectId: "pack", versionId: "1.0.0" });
	});

	it("does not treat target fragments as project ids", () => {
		expect(
			parseDownloadTaskId("download|instance-123|myriad|2.1")?.projectId,
		).toBe("myriad");
		expect(
			parseDownloadTaskId("download|instance-123|myriad|2.1"),
		).not.toMatchObject({ projectId: "123" });
	});

	it("keeps version ids that contain extra pipes", () => {
		expect(
			parseDownloadTaskId("download|world-1-save|pack|1.0|beta"),
		).toEqual({ projectId: "pack", versionId: "1.0|beta" });
	});

	it("parses the destination-branch underscore format", () => {
		expect(
			parseDownloadTaskId("download_instance-1_sodium_mc1.21"),
		).toEqual({ projectId: "sodium", versionId: "mc1.21" });
	});

	it("returns null for unrelated task ids", () => {
		expect(parseDownloadTaskId("launch|instance-1")).toBeNull();
		expect(parseDownloadTaskId("download|only-two")).toBeNull();
	});
});
