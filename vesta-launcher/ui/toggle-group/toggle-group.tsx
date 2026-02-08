import { PolymorphicProps } from "@kobalte/core";
import * as ToggleGroupPrimitive from "@kobalte/core/toggle-group";
import { ChildrenProp, ClassProp } from "@ui/props";
import clsx from "clsx";
import { children, splitProps, ValidComponent } from "solid-js";
import styles from "./toggle-group.module.css";

type ToggleGroupRootProps<T extends ValidComponent = "div"> = ToggleGroupPrimitive.ToggleGroupRootProps<T> &
	ClassProp &
	ChildrenProp & {
		onChange?: (value: string | string[] | null) => void;
	};

function ToggleGroup<T extends ValidComponent = "div">(
	props: PolymorphicProps<T, ToggleGroupRootProps<T>>,
) {
	const [local, rest] = splitProps(props as any, [
		"class",
		"children",
		"onChange",
	]);

	return (
		<ToggleGroupPrimitive.ToggleGroup
			class={clsx(styles["toggle-group"], local.class)}
			onValueChange={local.onChange}
			{...rest}
		>
			{local.children}
		</ToggleGroupPrimitive.ToggleGroup>
	);
}

type ToggleGroupItemProps = ToggleGroupPrimitive.ToggleGroupItemProps &
	ClassProp & ChildrenProp;

function ToggleGroupItem<T extends ValidComponent = "button">(
	props: PolymorphicProps<T, ToggleGroupItemProps>,
) {
	const [local, rest] = splitProps(props, [
		"class",
		"children",
	]);
	return (
		<ToggleGroupPrimitive.Item
			aria-label={props.value}
			class={clsx(styles["toggle-group__item"], props.class)}
			{...rest}
		>
			{local.children}
		</ToggleGroupPrimitive.Item>
	);
}

export { ToggleGroup, ToggleGroupItem };
