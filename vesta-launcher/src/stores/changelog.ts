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
		return await invoke("get_changelog");
	} catch (e) {
		console.error("Failed to fetch changelog:", e);
		throw e;
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
