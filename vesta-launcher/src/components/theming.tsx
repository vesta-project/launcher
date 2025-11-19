import { JSX } from "solid-js";

// Initialise css variables that are overridden
export function initTheme() {
	const root = document.documentElement;
	const style = root.style;

	// Set all properties at once for better performance
	style.setProperty("--font-xxsmall", "0.75rem");
	style.setProperty("--font-xsmall", "0.85rem");
	style.setProperty("--font-small", "1rem");
	style.setProperty("--font-medium", "1.25rem");
	style.setProperty("--font-large", "2rem");
	style.setProperty("--font-xlarge", "4rem");
	style.setProperty("--color__primary-hue", "0");
	style.setProperty("--background-opacity", "0.1");
}
