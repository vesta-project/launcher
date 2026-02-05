import { PolymorphicProps } from "@kobalte/core";
import * as TooltipPrimitive from "@kobalte/core/tooltip";
import { ChildrenProp, ClassProp } from "@ui/props";
import { children, splitProps, ValidComponent } from "solid-js";
import styles from "./tooltip.module.css";

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
	const [local, others] = splitProps(props, ["class", "children"]);
	const c = children(() => props.children);
	return (
		<TooltipPrimitive.Portal>
			<TooltipPrimitive.Content class={styles["tooltip__content"]} {...others}>
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
