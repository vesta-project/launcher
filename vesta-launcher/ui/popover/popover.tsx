import { PolymorphicProps } from "@kobalte/core";
import * as PopoverPrimitive from "@kobalte/core/popover";
import { ChildrenProp, ClassProp } from "@ui/props";
import clsx from "clsx";
import { splitProps, ValidComponent } from "solid-js";
import "./popover.css";

const PopoverTrigger = PopoverPrimitive.Trigger;
const PopoverAnchor = PopoverPrimitive.Anchor;
const PopoverCloseButton = PopoverPrimitive.CloseButton;

function Popover(props: PopoverPrimitive.PopoverRootProps) {
	return <PopoverPrimitive.Root gutter={4} {...props} />;
}

type PopoverContent = PopoverPrimitive.PopoverContentProps & ClassProp;

function PopoverContent<T extends ValidComponent = "div">(
	props: PolymorphicProps<T, PopoverContent>,
) {
	const [local, others] = splitProps(props as PopoverContent, ["class"]);
	return (
		<PopoverPrimitive.Portal>
			<PopoverPrimitive.Content
				class={clsx("popover__content", local.class)}
				{...others}
			/>
		</PopoverPrimitive.Portal>
	);
}

export {
	Popover,
	PopoverTrigger,
	PopoverAnchor,
	PopoverCloseButton,
	PopoverContent,
};
