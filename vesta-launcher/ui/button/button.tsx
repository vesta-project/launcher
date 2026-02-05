import { PolymorphicProps } from "@kobalte/core";
import * as ButtonPrimitive from "@kobalte/core/button";
import { ChildrenProp } from "@ui/props";
import {
	Tooltip,
	TooltipContent,
	TooltipPlacement,
	TooltipTrigger,
} from "@ui/tooltip/tooltip";
import { children, mergeProps, Show, splitProps } from "solid-js";
import styles from "./button.module.css";

interface ButtonProps
	extends PolymorphicProps<
		"button",
		ButtonPrimitive.ButtonRootProps & ChildrenProp
	> {
	color?: "none" | "primary" | "secondary" | "destructive" | "warning";
	variant?: "solid" | "outline" | "ghost" | "shadow";
	size?: "sm" | "md" | "lg" | "xl" | "icon";
	icon_only?: boolean;
	onClick?: (e: MouseEvent) => void;
	tooltip_text?: string;
	tooltip_placement?: TooltipPlacement;
}

function Button(p: ButtonProps) {
	const c = children(() => p.children);
	const props = mergeProps(
		{
			color: "none",
			variant: "solid",
			size: "md",
			icon_only: false,
			tooltip_placement: "top" as TooltipPlacement,
		},
		p,
	);
	const [local, rest] = splitProps(props, [
		"color",
		"variant",
		"size",
		"icon_only",
		"children",
		"tooltip_text",
		"tooltip_placement",
		"class",
		"onClick",
		"style",
	]);

	const handleClick = (e: MouseEvent) => {
		if (local.onClick) {
			local.onClick(e);
		}
	};

	return (
		<Tooltip placement={props.tooltip_placement}>
			<TooltipTrigger
				as={ButtonPrimitive.Button}
				classList={{
					[styles["launcher-button"]]: true,
					[styles["launcher-button--sm"]]: local.size === "sm",
					[styles["launcher-button--md"]]: local.size === "md",
					[styles["launcher-button--lg"]]: local.size === "lg",
					[styles["launcher-button--xl"]]: local.size === "xl",
					[styles["launcher-button--solid"]]: local.variant === "solid",
					[styles["launcher-button--outline"]]: local.variant === "outline",
					[styles["launcher-button--ghost"]]: local.variant === "ghost",
					[styles["launcher-button--shadow"]]: local.variant === "shadow",
					[styles["launcher-button--icon-only"]]: local.icon_only,
					[local.class ?? ""]: true,
				}}
				style={typeof local.style === "string" 
					? `--button-color: ${local.color != "none" ? "var(--" + local.color + ")" : "hsla(var(--accent-base) / 1)"}; ${local.style}`
					: {
						"--button-color": local.color != "none" ? "var(--" + local.color + ")" : "hsla(var(--accent-base) / 1)",
						...(local.style as any)
					}
				}
				onClick={handleClick}
				disabled={props.disabled}
				{...(rest as ButtonPrimitive.ButtonRootProps)}
			>
				{c()}
			</TooltipTrigger>
			<Show when={props.tooltip_text}>
				<TooltipContent>{props.tooltip_text}</TooltipContent>
			</Show>
		</Tooltip>
	);
}

export default Button;
