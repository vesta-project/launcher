import { cleanup, render, screen } from "@solidjs/testing-library";
import type { RecognizedSource } from "@stores/resources";
import { afterEach, describe, expect, it } from "vitest";
import { ManualSourceLabel } from "./ManualSourceLabel";

const source: RecognizedSource = {
	platform: "modrinth",
	projectId: "project",
	versionId: "version",
	versionNumber: "1.0",
	displayName: "Recognized pack",
	webUrl: "https://modrinth.com/resourcepack/project",
};
afterEach(cleanup);

describe("manual source label", () => {
	it("renders nothing without a confirmed provider match", () => {
		const result = render(() => <ManualSourceLabel />);
		expect(result.container.textContent).toBe("");
	});
	it("distinguishes source archive evidence from installed release identity", () => {
		render(() => <ManualSourceLabel source={source} originalArtifact />);
		const label = screen.getByText(
			"Source archive: Recognized pack (modrinth, 1.0)",
			{ normalizer: (text) => text.replace(/[⁨⁩]/g, "") },
		);
		expect(label.getAttribute("title")).toMatch(
			/does not prove the download website/,
		);
		expect(screen.queryByRole("link")).toBeNull();
		expect(screen.queryByRole("button")).toBeNull();
	});
	it("labels exact-byte matches without offering an implicit update action", () => {
		render(() => <ManualSourceLabel source={source} />);
		expect(
			screen.getByText("Recognized source: Recognized pack (modrinth, 1.0)", {
				normalizer: (text) => text.replace(/[⁨⁩]/g, ""),
			}),
		).toBeTruthy();
		expect(screen.queryByRole("button")).toBeNull();
	});
});
