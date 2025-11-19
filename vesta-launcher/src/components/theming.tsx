import { JSX } from "solid-js";

// Initialise css variables that are overridden
export function initTheme() {
	let theme: { [key: string]: string } = {
		"font-xxsmall": "0.75rem",
		"font-xsmall": "0.85rem",
		"font-small": "1rem",
		"font-medium": "1.25rem",
		"font-large": "2rem",
		"font-xlarge": "4rem",
		"color__primary-hue": "0",
		"background-opacity": "0.1",
	};

	/*const themeString = Object.entries(theme)
		.map(([key, value]) => `--${key}: ${value}`)
		.join(";");*/

	const root = document.documentElement;

	for (const [key, value] of Object.entries(theme)) {
		root.style.setProperty(`--${key}`, value);
	}

	return;
}
