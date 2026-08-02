/* @refresh skip */

import { render, screen, waitFor } from "@solidjs/testing-library";
import { createNonSuspendingLoader } from "@utils/non-suspending-loader";
import { createSignal, Suspense } from "solid-js";
import { describe, expect, it } from "vitest";

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}

describe("createNonSuspendingLoader", () => {
	it("keeps its page painted while enhancement data is pending", async () => {
		const request = deferred<string>();

		const Probe = () => {
			const state = createNonSuspendingLoader(
				() => "instance",
				() => request.promise,
				"initial",
			);
			return <span data-testid="value">{state.value()}</span>;
		};

		render(() => (
			<Suspense fallback={<span data-testid="fallback">Blanked page</span>}>
				<Probe />
			</Suspense>
		));

		expect(screen.queryByTestId("fallback")).toBeNull();
		expect(screen.getByTestId("value").textContent).toBe("initial");

		request.resolve("ready");
		await waitFor(() => {
			expect(screen.getByTestId("value").textContent).toBe("ready");
		});
	});

	it("ignores stale results after the source changes", async () => {
		const first = deferred<string>();
		const second = deferred<string>();
		const [source, setSource] = createSignal("first");

		const Probe = () => {
			const state = createNonSuspendingLoader(
				source,
				(key) => (key === "first" ? first.promise : second.promise),
				"initial",
			);
			return <span data-testid="value">{state.value()}</span>;
		};

		render(() => <Probe />);
		setSource("second");
		first.resolve("stale");
		second.resolve("current");

		await waitFor(() => {
			expect(screen.getByTestId("value").textContent).toBe("current");
		});
	});
});
