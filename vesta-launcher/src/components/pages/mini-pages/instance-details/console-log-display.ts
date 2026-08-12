import type { LogFileInfo } from "@stores/console";
import { formatBytesCompact } from "@utils/format-bytes";

export function basename(path?: string | null): string | null {
	if (!path) return null;
	return path.split(/[/\\]/).filter(Boolean).pop() || null;
}

export function formatLogFileMetadata(file?: LogFileInfo | null): string | null {
	if (!file) return null;
	const timestamp = file.last_modified > 10_000_000_000 ? file.last_modified : file.last_modified * 1000;
	const modified = new Date(timestamp);
	if (!Number.isFinite(modified.getTime())) return formatBytesCompact(file.size);
	return `Modified ${modified.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} · ${formatBytesCompact(file.size)}`;
}

export function getConsoleLogDisplay(input: {
	isLive: boolean;
	currentLogPath?: string | null;
	history: LogFileInfo[];
	instanceSlug: string;
}) {
	const selected = input.currentLogPath
		? input.history.find((file) => file.path === input.currentLogPath)
		: undefined;
	const file = selected ?? (!input.isLive ? input.history[0] : undefined);
	const title = basename(input.currentLogPath) ?? file?.name ?? (input.isLive ? "latest.log" : `${input.instanceSlug}.log`);
	return { title, metadata: formatLogFileMetadata(file), file, live: input.isLive };
}
