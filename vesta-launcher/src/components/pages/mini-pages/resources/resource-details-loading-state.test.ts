import { describe, expect, it } from "vitest";
import { getResourceDetailsLoadingState } from "./resource-details-loading-state";

describe("resource details loading state", () => {
	it("shows the established fetching overlay while a cold project loads", () => {
		expect(
			getResourceDetailsLoadingState({
				hasProject: false,
				hasRouteIdentity: true,
				loading: true,
				hasError: false,
			}),
		).toEqual({
			showPage: true,
			showError: false,
			showNotFound: false,
			showOverlay: true,
		});
	});

	it("keeps existing project content mounted during refresh", () => {
		const state = getResourceDetailsLoadingState({
			hasProject: true,
			hasRouteIdentity: true,
			loading: true,
			hasError: false,
		});
		expect(state.showPage).toBe(true);
		expect(state.showOverlay).toBe(false);
	});

	it("shows loading feedback while retrying without cached project data", () => {
		const state = getResourceDetailsLoadingState({
			hasProject: false,
			hasRouteIdentity: true,
			loading: true,
			hasError: true,
		});
		expect(state.showPage).toBe(true);
		expect(state.showOverlay).toBe(true);
	});

	it("blocks only for settled errors or missing resources", () => {
		expect(
			getResourceDetailsLoadingState({
				hasProject: false,
				hasRouteIdentity: true,
				loading: false,
				hasError: true,
			}),
		).toMatchObject({ showPage: false, showError: true, showOverlay: true });
		expect(
			getResourceDetailsLoadingState({
				hasProject: false,
				hasRouteIdentity: false,
				loading: false,
				hasError: false,
			}),
		).toMatchObject({ showNotFound: true, showOverlay: true });
	});
});
