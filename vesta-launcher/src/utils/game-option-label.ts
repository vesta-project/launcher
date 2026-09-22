const ACRONYMS = new Set([
	"ao",
	"fov",
	"fps",
	"gui",
	"gl",
	"gpu",
	"cpu",
	"ui",
	"rgb",
	"msaa",
	"vbo",
]);

/** Format a physical options.txt key for display without changing the key. */
export function formatGameOptionName(key: string): string {
	const words = key
		.replace(/^key_key\./, "")
		.replace(/^key_/, "")
		.replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
		.replace(/([a-z\d])([A-Z])/g, "$1 $2")
		.replace(/[_.:-]+/g, " ")
		.trim()
		.split(/\s+/)
		.filter(Boolean);
	const label = words
		.map((word) => {
			const lower = word.toLowerCase();
			return ACRONYMS.has(lower) ? lower.toUpperCase() : lower;
		})
		.join(" ");
	return label ? label.charAt(0).toUpperCase() + label.slice(1) : key;
}
