import { Component, ComponentProps, splitProps, Show } from "solid-js";
import styles from "./badge.module.css";

export interface BadgeProps extends ComponentProps<"div"> {
	variant?:
		| "default"
		| "secondary"
		| "outline"
		| "success"
		| "warning"
		| "error"
		| "info"
		| "accent"
		| "surface"
		| "theme";
	round?: boolean;
	pill?: boolean;
	clickable?: boolean;
	active?: boolean;
	dot?: boolean;
}

export const Badge: Component<BadgeProps> = (p) => {
	const [local, others] = splitProps(p, [
		"variant",
		"round",
		"pill",
		"clickable",
		"active",
		"dot",
		"class",
		"classList",
	]);

	const variant = () => local.variant || "default";

	return (
		<div
			class={`${styles.badge} ${local.class || ""}`}
			classList={{
				[styles[`badge--variant-${variant()}`]]: true,
				[styles["badge--round"]]: local.round,
				[styles["badge--pill"]]: local.pill,
				[styles["badge--clickable"]]: local.clickable,
				[styles["badge--active"]]: local.active,
				[styles["badge--has-dot"]]: local.dot,
				...local.classList,
			}}
			{...others}
		>
			<Show when={local.dot}>
				<span class={styles["badge__dot"]} />
			</Show>
			{p.children}
		</div>
	);
};
