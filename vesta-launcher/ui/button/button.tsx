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
	console.log("[Button] Component rendering with props:", {
		disabled: p.disabled,
		onClick: !!p.onClick,
		children: typeof p.children,
	});

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
	]);

	const handleClick = (e: MouseEvent) => {
		console.log("[Button] NATIVE CLICK EVENT RECEIVED", e);
		console.log("[Button] Click event fired", {
			disabled: props.disabled,
			onClick: !!local.onClick,
		});
		if (local.onClick) {
			console.log("[Button] Calling onClick handler");
			local.onClick();
		} else {
			console.log("[Button] No onClick handler found!");
		}
	};

	return (
		<Tooltip placement={props.tooltip_placement}>
			<TooltipTrigger
				as={ButtonPrimitive.Button}
				classList={{
					"launcher-button": true,
					"launcher-button--sm": local.size === "sm",
					"launcher-button--md": local.size === "md",
					"launcher-button--lg": local.size === "lg",
					"launcher-button--solid": local.variant === "solid",
					"launcher-button--outline": local.variant === "outline",
					"launcher-button--ghost": local.variant === "ghost",
					"launcher-button--icon-only": local.icon_only,
					[local.class ?? ""]: true,
				}}
				style={{
					"--button-color":
						local.color != "none" ? "var(--" + local.color + ")" : "",
				}}
				onClick={handleClick}
				onMouseDown={(e: MouseEvent) =>
					console.log("[Button] MouseDown event", e)
				}
				onMouseUp={(e: MouseEvent) => console.log("[Button] MouseUp event", e)}
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
