export type ParsedDownloadTaskId = {
	target: string | null;
	platform: string | null;
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
 * Parse `download|{target}|{platform}|{projectB64}|{versionB64}`, the earlier
 * pipe format without a platform, or the legacy underscore format. Parsing
 * from the final separators keeps raw `|` characters in world names intact.
 */
export function parseDownloadTaskId(
	taskId: string,
): ParsedDownloadTaskId | null {
	if (taskId.startsWith("download|")) {
		const prefixLength = "download|".length;
		const versionSeparator = taskId.lastIndexOf("|");
		const projectSeparator = taskId.lastIndexOf("|", versionSeparator - 1);
		if (
			projectSeparator < prefixLength ||
			versionSeparator <= projectSeparator + 1
		)
			return null;

		const projectId = decodeBase64Url(
			taskId.slice(projectSeparator + 1, versionSeparator),
		);
		const versionId = decodeBase64Url(taskId.slice(versionSeparator + 1));
		if (!projectId || !versionId) return null;

		let target = taskId.slice(prefixLength, projectSeparator);
		let platform: string | null = null;
		const platformSeparator = target.lastIndexOf("|");
		if (platformSeparator >= 0) {
			const candidate = target.slice(platformSeparator + 1).toLowerCase();
			if (["modrinth", "curseforge", "smithed"].includes(candidate)) {
				platform = candidate;
				target = target.slice(0, platformSeparator);
			}
		}
		if (!target) return null;
		return { target, platform, projectId, versionId };
	}

	if (taskId.startsWith("download_")) {
		const parts = taskId.split("_");
		if (parts.length >= 4 && parts[2] && parts[3]) {
			return {
				target: parts[1] || null,
				platform: null,
				projectId: parts[2],
				versionId: parts[3],
			};
		}
	}

	return null;
}
