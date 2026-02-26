import { PolymorphicProps } from "@kobalte/core";
import * as ToggleGroupPrimitive from "@kobalte/core/toggle-group";
import { ChildrenProp, ClassProp } from "@ui/props";
import clsx from "clsx";
import { children, splitProps, ValidComponent } from "solid-js";
import styles from "./toggle-group.module.css";

type ToggleGroupRootProps<T extends ValidComponent = "div"> =
	ToggleGroupPrimitive.ToggleGroupRootProps<T> &
		ClassProp &
		ChildrenProp;

function ToggleGroup<T extends ValidComponent = "div">(
	props: PolymorphicProps<T, ToggleGroupRootProps<T>>,
) {
	const [local, rest] = splitProps(props as any, ["class", "children"]);

	return (
		<ToggleGroupPrimitive.Root
			class={clsx(styles["toggle-group"], local.class)}
			{...rest}
		>
			{local.children}
		</ToggleGroupPrimitive.Root>
	);
}

type ToggleGroupItemProps = ToggleGroupPrimitive.ToggleGroupItemProps &
	ClassProp &
	ChildrenProp & {
		value: string;
	};

function ToggleGroupItem<T extends ValidComponent = "button">(
	props: PolymorphicProps<T, ToggleGroupItemProps>,
) {
	const [local, rest] = splitProps(props as any, [
		"class",
		"children",
		"value",
	]);
	return (
		<ToggleGroupPrimitive.Item
			value={local.value}
			aria-label={local.value}
			class={clsx(styles["toggle-group__item"], local.class)}
			{...rest}
		>
			{local.children}
		</ToggleGroupPrimitive.Item>
	);
}

export { ToggleGroup, ToggleGroupItem };
