import type { PolymorphicProps } from "@kobalte/core/polymorphic";
import * as SeparatorPrimitive from "@kobalte/core/separator";
import { cn } from "@utils/ui";
import type { ValidComponent } from "solid-js";
import { splitProps } from "solid-js";
import styles from "./separator.module.css";

type SeparatorRootProps<T extends ValidComponent = "hr"> =
	SeparatorPrimitive.SeparatorRootProps<T> & { class?: string | undefined };

const Separator = <T extends ValidComponent = "hr">(
	props: PolymorphicProps<T, SeparatorRootProps<T>>,
) => {
	const [local, others] = splitProps(props as SeparatorRootProps, [
		"class",
		"orientation",
	]);
	return (
		<SeparatorPrimitive.Root
			orientation={local.orientation ?? "horizontal"}
			class={cn(
				styles.separator,
				local.orientation === "vertical"
					? styles["separator--vertical"]
					: styles["separator--horizontal"],
				local.class,
			)}
			{...others}
		/>
	);
};

export { Separator };
