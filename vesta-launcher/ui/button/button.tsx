import { PolymorphicProps } from "@kobalte/core";
import * as ButtonPrimitive from "@kobalte/core/button";
import { ChildrenProp } from "@ui/props";
import {
	Tooltip,
	TooltipContent,
	TooltipPlacement,
	TooltipTrigger,
} from "@ui/tooltip/tooltip";
import { Show, children, mergeProps, splitProps } from "solid-js";
import "./button.css";

interface ButtonProps
	extends PolymorphicProps<
		"button",
		ButtonPrimitive.ButtonRootProps & ChildrenProp
	> {
	color?: "none" | "primary" | "secondary" | "destructive" | "warning";
	variant?: "solid" | "outline" | "ghost";
	size?: "sm" | "md" | "lg";
	icon_only?: boolean;
	onClick?: () => void;
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
	const [_, rest] = splitProps(props, [
		"color",
		"variant",
		"size",
		"icon_only",
		"children",
		"tooltip_text",
		"tooltip_placement",
		"class",
	]);

	return (
		<Tooltip placement={props.tooltip_placement}>
			<TooltipTrigger
				as={ButtonPrimitive.Button}
				classList={{
					"launcher-button": true,
					"launcher-button--sm": props.size === "sm",
					"launcher-button--md": props.size === "md",
					"launcher-button--lg": props.size === "lg",
					"launcher-button--solid": props.variant === "solid",
					"launcher-button--outline": props.variant === "outline",
					"launcher-button--ghost": props.variant === "ghost",
					"launcher-button--icon-only": props.icon_only,
					[props.class ?? ""]: true,
				}}
				style={{
					"--button-color":
						props.color != "none" ? "var(--" + props.color + ")" : "",
				}}
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
