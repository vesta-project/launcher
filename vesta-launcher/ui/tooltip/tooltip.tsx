import { PolymorphicProps } from "@kobalte/core";
import * as TooltipPrimitive from "@kobalte/core/tooltip";
import { ChildrenProp, ClassProp } from "@ui/props";
import { ValidComponent, children, splitProps } from "solid-js";
import "./tooltip.css";

type BasePlacement = "top" | "bottom" | "left" | "right";
type Placement =
	| BasePlacement
	| `${BasePlacement}-start`
	| `${BasePlacement}-end`;

function Tooltip(props: TooltipPrimitive.TooltipRootProps) {
	return <TooltipPrimitive.Root gutter={4} closeDelay={100} {...props} />;
}

function TooltipContent(
	props: TooltipPrimitive.TooltipContentProps & ClassProp & ChildrenProp,
) {
	const [_, others] = splitProps(props, ["class", "children"]);
	const c = children(() => props.children);
	return (
		<TooltipPrimitive.Portal>
			<TooltipPrimitive.Content class={"tooltip__content"} {...others}>
				{c()}
			</TooltipPrimitive.Content>
		</TooltipPrimitive.Portal>
	);
}

const TooltipTrigger = TooltipPrimitive.Trigger;

export {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
	type Placement as TooltipPlacement,
};
