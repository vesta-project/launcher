const KB = 1024;
const MB = KB * 1024;
const GB = MB * 1024;

export function formatBytes(bytes: number | null | undefined): string {
	if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) {
		return "0 bytes";
	}
	if (bytes >= GB) {
		return `${(bytes / GB).toFixed(2)} GB`;
	}
	if (bytes >= MB) {
		return `${(bytes / MB).toFixed(2)} MB`;
	}
	if (bytes >= KB) {
		return `${(bytes / KB).toFixed(2)} KB`;
	}
	return `${bytes} bytes`;
}

/** Compact formatter for inline stats; returns null when the value is not displayable. */
export function formatBytesCompact(
	value: number | null | undefined,
): string | null {
	if (value == null || !Number.isFinite(value) || value < 0) {
		return null;
	}
	const units = ["B", "KB", "MB", "GB", "TB"];
	let size = value;
	let idx = 0;
	while (size >= 1024 && idx < units.length - 1) {
		size /= 1024;
		idx += 1;
	}
	const rounded = idx === 0 ? `${Math.round(size)}` : size.toFixed(1);
	return `${rounded} ${units[idx]}`;
}

export function formatPercent(part: number, total: number): string {
	if (total <= 0 || part <= 0) {
		return "0%";
	}
	return `${Math.round((part / total) * 100)}%`;
}
