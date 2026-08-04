/* @refresh skip */

import { render, screen } from "@solidjs/testing-library";
import { lazy } from "solid-js";
import { describe, expect, it } from "vitest";
import { MiniRouter } from "./mini-router";

describe("MiniRouter lazy route loading", () => {
	it("shows project loading feedback before resource details has mounted", () => {
		const PendingResourceDetails = lazy(
			() => new Promise<{ default: () => null }>(() => undefined),
		);
		const router = new MiniRouter({
			paths: {
				"/resource-details": {
					element: PendingResourceDetails,
					name: "Resource Details",
				},
			},
			currentPath: "/resource-details",
			initialParams: { name: "Fabric API" },
		});

		render(() => router.getRouterView());

		expect(screen.getByText("Fetching project details...")).toBeTruthy();
		expect(screen.getByText("Fabric API")).toBeTruthy();
		expect(document.querySelector("[data-mini-route-loading]")).toBeTruthy();
	});
});
