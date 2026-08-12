export type ParsedDownloadTaskId = {
	projectId: string;
	versionId: string;
};

const B64URL = /^[A-Za-z0-9_-]+$/;

function decodeBase64Url(value: string): string | null {
	if (!value || !B64URL.test(value)) return null;
	const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
	try {
		if (typeof atob === "function") {
			const binary = atob(padded);
			const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
			return new TextDecoder("utf-8").decode(bytes);
		}
		return Buffer.from(padded, "base64").toString("utf8");
	} catch {
		return null;
	}
}

/**
 * Parse `download|{target}|{projectB64}|{versionB64}` or legacy task id formats.
 * New pipe-format fields are base64url-encoded to avoid delimiter collisions.
 */
export function parseDownloadTaskId(
	taskId: string,
): ParsedDownloadTaskId | null {
	if (taskId.startsWith("download|")) {
		const parts = taskId.split("|");
		if (parts.length === 4) {
			const projectId = decodeBase64Url(parts[2]);
			const versionId = decodeBase64Url(parts[3]);
			if (projectId && versionId) {
				return { projectId, versionId };
			}
		}
		return null;
	}

	if (taskId.startsWith("download_")) {
		const parts = taskId.split("_");
		if (parts.length >= 4 && parts[2] && parts[3]) {
			return {
				projectId: parts[2],
				versionId: parts[3],
			};
		}
	}

	return null;
}
