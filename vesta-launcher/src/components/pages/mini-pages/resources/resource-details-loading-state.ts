export interface ResourceDetailsLoadingInput {
	hasProject: boolean;
	hasRouteIdentity: boolean;
	loading: boolean;
	hasError: boolean;
}

export interface ResourceDetailsLoadingState {
	showPage: boolean;
	showError: boolean;
	showNotFound: boolean;
	showOverlay: boolean;
}

export function getResourceDetailsLoadingState(
	input: ResourceDetailsLoadingInput,
): ResourceDetailsLoadingState {
	const showError = input.hasError && !input.loading;
	const showNotFound = !input.loading && !input.hasProject && !input.hasError;
	const showColdLoad = input.loading && !input.hasProject;
	return {
		showPage:
			(input.hasProject || input.hasRouteIdentity) &&
			!showError &&
			!showNotFound,
		showError,
		showNotFound,
		showOverlay: showColdLoad || showError || showNotFound,
	};
}
