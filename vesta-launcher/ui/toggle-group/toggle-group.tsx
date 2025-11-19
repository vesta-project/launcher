import { PolymorphicProps } from "@kobalte/core";
import * as ToggleGroupPrimitive from "@kobalte/core/toggle-group";
import { ChildrenProp, ClassProp } from "@ui/props";
import clsx from "clsx";
import { ValidComponent, children, splitProps } from "solid-js";
import "./toggle-group.css";

type ToggleGroupRootProps = ToggleGroupPrimitive.ToggleGroupRootProps &
	ClassProp &
	ChildrenProp;

function ToggleGroup<T extends ValidComponent = "div">(
	props: PolymorphicProps<T, ToggleGroupRootProps>,
) {
	const [_, rest] = splitProps(props as ToggleGroupRootProps, [
		"class",
		"children",
	]);
	return (
		<ToggleGroupPrimitive.ToggleGroup
			class={clsx("toggle-group", props.class)}
			{...rest}
		>
			{props.children}
		</ToggleGroupPrimitive.ToggleGroup>
	);
}

type ToggleGroupItemProps = ToggleGroupPrimitive.ToggleGroupItemProps &
	ClassProp;

function ToggleGroupItem<T extends ValidComponent = "button">(
	props: PolymorphicProps<T, ToggleGroupItemProps>,
) {
	const [_, rest] = splitProps(props as ToggleGroupItemProps, [
		"class",
		"children",
	]);
	return (
		<ToggleGroupPrimitive.Item
			aria-label={props.value}
			class={clsx("toggle-group__item", props.class)}
			{...rest}
		>
			{props.children}
		</ToggleGroupPrimitive.Item>
	);
}

export { ToggleGroup, ToggleGroupItem };
