const ALLOWED_NAVIGATE_PATHS = new Set([
	"/config",
	"/changelog",
	"/install",
	"/install/source",
	"/install/import",
	"/modding-guide",
	"/resources",
	"/login",
	"/file-drop",
]);

export function isAllowedNavigatePath(path: string): boolean {
	return ALLOWED_NAVIGATE_PATHS.has(path);
}

export function generateVestaDeepLink(
	path: string,
	params: Record<string, string> = {},
): string {
	if (path === "/instance" && params.slug) {
		const searchParams = new URLSearchParams({ slug: params.slug });
		return `vesta://open-instance?${searchParams.toString()}`;
	}

	if (path === "/resource-details" && params.platform && params.projectId) {
		return `vesta://open-resource/${params.platform}/${params.projectId}`;
	}

	if (path === "/install") {
		const searchParams = new URLSearchParams(params);
		return `vesta://install?${searchParams.toString()}`;
	}

	if (path === "/config") {
		const searchParams = new URLSearchParams({ path: "/config" });
		return `vesta://open?${searchParams.toString()}`;
	}

	if (ALLOWED_NAVIGATE_PATHS.has(path)) {
		const searchParams = new URLSearchParams({ path, ...params });
		return `vesta://open?${searchParams.toString()}`;
	}

	throw new Error(`Cannot generate deep link for unsupported path: ${path}`);
}
