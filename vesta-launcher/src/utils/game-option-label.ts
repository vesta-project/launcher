// Presentation only: never change the key used to read or write options.txt.
export function formatGameOptionName(key: string): string {
	const words = key
		.replace(/^key_key\./, "")
		.replace(/^key_/, "")
		.replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
		.replace(/([a-z\d])([A-Z])/g, "$1 $2")
		.replace(/[_.:-]+/g, " ")
		.trim()
		.split(/\s+/);
	const acronyms = new Set([
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
		"x",
		"y",
	]);
	const label = words
		.map((word) =>
			acronyms.has(word.toLowerCase()) || /^[A-Z\d]{2,}$/.test(word)
				? word.toUpperCase()
				: word.toLowerCase(),
		)
		.join(" ");
	return label.charAt(0).toUpperCase() + label.slice(1);
}
