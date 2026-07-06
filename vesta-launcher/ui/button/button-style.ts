export type ButtonColor =
	| "none"
	| "primary"
	| "secondary"
	| "destructive"
	| "warning";

export function getButtonStyleVars(color: ButtonColor) {
	const cv =
		color === "none"
			? "var(--secondary-low)"
			: color === "secondary"
				? "var(--surface-raised)"
				: `var(--${color})`;
	const fg =
		color === "none" || color === "secondary"
			? "var(--text-primary)"
			: "var(--text-on-accent)";
	const txt =
		color !== "none" && color !== "secondary" ? cv : "var(--text-primary)";
	const bdr =
		color === "none" || color === "secondary"
			? "var(--border-subtle)"
			: "transparent";

	return {
		"--button-color": cv,
		"--button-fg": fg,
		"--button-border": bdr,
		"--button-text": txt,
	};
}
