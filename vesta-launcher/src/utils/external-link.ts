import { open } from "@tauri-apps/plugin-shell";
import { dialogStore } from "@stores/dialog-store";

/**
 * Whitelist for URLs that don't need a warning.
 * Primarily Microsoft login URLs.
 */
const WHITELIST_PATTERNS = [
	"microsoft.com/link",
	"login.live.com",
	"login.microsoftonline.com",
];

/**
 * Checks if a URL is whitelisted (e.g., Microsoft login)
 */
function isWhitelisted(url: string): boolean {
	try {
		const lowerUrl = url.toLowerCase();
		return WHITELIST_PATTERNS.some((pattern) => lowerUrl.includes(pattern));
	} catch {
		return false;
	}
}

/**
 * Opens a URL in the default browser, with a confirmation dialog if it's not whitelisted.
 *
 * @param url The URL to open
 * @param options Options for the opening process
 */
export async function openExternal(
	url: string,
	options: {
		/** If true, the warning will be skipped regardless of the whitelist */
		skipWarning?: boolean;
		/** Custom title for the dialog */
		title?: string;
		/** Custom description message */
		description?: string;
	} = {},
): Promise<void> {
	if (!url) return;

	if (options.skipWarning || isWhitelisted(url)) {
		await open(url);
		return;
	}

	const confirmed = await dialogStore.confirm(
		options.title ?? "Open External Link",
		options.description ??
			`This link will open in your default web browser:\n\n${url}\n\nDo you want to continue?`,
		{
			okLabel: "Open Link",
			cancelLabel: "Stay in App",
			severity: "question",
		},
	);

	if (confirmed) {
		await open(url);
	}
}
