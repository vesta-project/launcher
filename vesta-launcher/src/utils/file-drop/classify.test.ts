/**
 * classifyDroppedPaths tests with a MOCKED invoke. They check the wrapper's
 * contract only (no IPC, graceful failure, no paths in errors). They are NOT
 * proof that the Rust command classifies native paths correctly.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));

import { classifyDroppedPaths } from "./classify";

beforeEach(() => {
	mocks.invoke.mockReset();
});

describe("classifyDroppedPaths", () => {
	it("returns an empty list without invoking anything for empty input", async () => {
		await expect(classifyDroppedPaths([])).resolves.toEqual([]);
		expect(mocks.invoke).not.toHaveBeenCalled();
	});

	it("forwards the paths to the classify command and returns its result", async () => {
		const result = [
			{ path: "/a/file.zip", kind: "file", isSymlink: false },
			{ path: "/a/dir", kind: "directory", isSymlink: true },
		];
		mocks.invoke.mockResolvedValueOnce(result);

		await expect(
			classifyDroppedPaths(["/a/file.zip", "/a/dir"]),
		).resolves.toEqual(result);
		expect(mocks.invoke).toHaveBeenCalledWith("classify_dropped_paths", {
			paths: ["/a/file.zip", "/a/dir"],
		});
	});

	it("resolves every path as inaccessible when invoke fails, without throwing", async () => {
		mocks.invoke.mockRejectedValueOnce(new Error("/Users/u/secret.zip"));

		const result = await classifyDroppedPaths(["/Users/u/secret.zip", "/b"]);

		expect(result).toEqual([
			{ path: "/Users/u/secret.zip", kind: "inaccessible", isSymlink: false },
			{ path: "/b", kind: "inaccessible", isSymlink: false },
		]);
	});

	it("treats a malformed response as inaccessible", async () => {
		mocks.invoke.mockResolvedValueOnce({ unexpected: true });

		await expect(classifyDroppedPaths(["/c"])).resolves.toEqual([
			{ path: "/c", kind: "inaccessible", isSymlink: false },
		]);
	});
});
