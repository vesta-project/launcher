import { cleanup, render, screen } from "@solidjs/testing-library";
import type { SandboxHostSupport } from "@utils/sandbox-host";
import { afterEach, describe, expect, it } from "vitest";
import { SandboxHostNotice } from "./sandbox-policy-ui";

const support: SandboxHostSupport = {
	hostOs: "linux",
	enforcementAvailable: true,
	enforcementBackend: "bubblewrap",
	bubblewrapAvailable: true,
	bubblewrapPath: "/usr/bin/bwrap",
	missingRequirementMessage: null,
};

describe("SandboxHostNotice", () => {
	afterEach(cleanup);

	it("explains the Paranoid playback tradeoff on Linux", () => {
		render(() => <SandboxHostNotice support={support} />);
		expect(screen.getByRole("alert").textContent).toContain(
			"On Linux, Paranoid blocks microphone access by also disabling game audio playback.",
		);
	});

	it.each([
		"windows",
		"macos",
	])("does not warn about playback on %s", (hostOs) => {
		render(() => <SandboxHostNotice support={{ ...support, hostOs }} />);
		expect(screen.queryByRole("alert")).toBeNull();
	});

	it("prioritizes unavailable enforcement over the Linux playback notice", () => {
		render(() => (
			<SandboxHostNotice
				support={{
					...support,
					enforcementAvailable: false,
					missingRequirementMessage: "Install bubblewrap.",
				}}
			/>
		));
		expect(screen.getByRole("alert").textContent).toBe("Install bubblewrap.");
	});

	it("does not claim a host limitation before support has loaded", () => {
		render(() => <SandboxHostNotice support={undefined} />);
		expect(screen.queryByRole("alert")).toBeNull();
	});
});
