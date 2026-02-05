import type { Component, ValidComponent } from "solid-js";
import { splitProps } from "solid-js";

import type { PolymorphicProps } from "@kobalte/core/polymorphic";
import * as PopoverPrimitive from "@kobalte/core/popover";

import { clsx } from "clsx";

import styles from "./popover.module.css";

const PopoverTrigger = PopoverPrimitive.Trigger;
const PopoverAnchor = PopoverPrimitive.Anchor;
const PopoverCloseButton = PopoverPrimitive.CloseButton;

const Popover: Component<PopoverPrimitive.PopoverRootProps> = (props) => {
	return <PopoverPrimitive.Root gutter={4} {...props} />;
};

type PopoverContentProps<T extends ValidComponent = "div"> =
	PopoverPrimitive.PopoverContentProps<T> & { class?: string | undefined };

const PopoverContent = <T extends ValidComponent = "div">(
	props: PolymorphicProps<T, PopoverContentProps<T>>,
) => {
	const [local, others] = splitProps(props as PopoverContentProps, ["class"]);
	return (
		<PopoverPrimitive.Portal>
			<PopoverPrimitive.Content
				class={clsx(
					styles["popover__content"],
					"liquid-glass",
					"outline-none",
					local.class,
				)}
				{...others}
			/>
		</PopoverPrimitive.Portal>
	);
};

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor, PopoverCloseButton };
