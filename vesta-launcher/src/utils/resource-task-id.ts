export type ParsedDownloadTaskId = {
	projectId: string;
	versionId: string;
};

/** Parse `download|{target}|{projectId}|{versionId}` or the older underscore form. */
export function parseDownloadTaskId(
	taskId: string,
): ParsedDownloadTaskId | null {
	if (taskId.startsWith("download|")) {
		const parts = taskId.split("|");
		if (parts.length >= 4 && parts[2] && parts[3]) {
			return {
				projectId: parts[2],
				versionId: parts.slice(3).join("|"),
			};
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
