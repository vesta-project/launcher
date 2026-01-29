export function formatDate(dateStr?: string | null) {
	if (!dateStr) return "Unknown";
	try {
		return new Date(dateStr).toLocaleDateString(undefined, {
			year: "numeric",
			month: "short",
			day: "numeric",
		});
	} catch (e) {
		return "Unknown";
	}
}
