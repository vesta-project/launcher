import { createSignal, createResource } from "solid-js";
import { invoke } from "@tauri-apps/api/core";

export interface GithubRelease {
	tag_name: string;
	name: string;
	body: string;
	published_at: string;
	html_url: string;
}

const fetchChangelog = async (): Promise<GithubRelease[]> => {
	try {
		const releases = await invoke<GithubRelease[]>("get_changelog");
		
		// If the response is not an array (which shouldn't happen with Vec return type,
		// but defensive programming is better), handle it.
		if (!Array.isArray(releases)) {
			console.error("Changelog fetch returned non-array response:", releases);
			return [];
		}

		return releases;
	} catch (e) {
		console.error("Failed to fetch changelog:", e);
		// Return empty array instead of throwing to avoid UI crash, 
		// but UI can check changelog.error if needed
		return [];
	}
};

// Resource for automatic fetching and caching
const [changelog, { refetch }] = createResource<GithubRelease[]>(fetchChangelog);

export { changelog, refetch as refetchChangelog };

/**
 * Trigger pre-fetching of the changelog data.
 * This should be called early in the app lifecycle.
 */
export function prefetchChangelog() {
    // Accessing the resource triggers the fetch if not already started
    changelog();
}
