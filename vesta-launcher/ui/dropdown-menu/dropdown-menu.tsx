import type { PolymorphicProps } from "@kobalte/core";
import * as DropdownMenuPrimitive from "@kobalte/core/dropdown-menu";
import type { ChildrenProp, ClassProp } from "@ui/props";
import clsx from "clsx";
import { type ComponentProps, splitProps, type ValidComponent } from "solid-js";
import styles from "./dropdown-menu.module.css";

function DropdownMenu(props: DropdownMenuPrimitive.DropdownMenuRootProps) {
	return <DropdownMenuPrimitive.Root gutter={4} flip={false} {...props} />;
}

const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
const DropdownMenuGroup = DropdownMenuPrimitive.Group;
const DropdownMenuSub = DropdownMenuPrimitive.Sub;
const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup;
const DropdownMenuPortal = DropdownMenuPrimitive.Portal;

type DropdownMenuContentProps = DropdownMenuPrimitive.DropdownMenuContentProps &
	ClassProp &
	ChildrenProp;

function DropdownMenuContent<T extends ValidComponent = "div">(
	props: PolymorphicProps<T, DropdownMenuContentProps>,
) {
	const [local, rest] = splitProps(props as DropdownMenuContentProps, [
		"class",
		"children",
	]);

	return (
		<DropdownMenuPrimitive.Portal>
			<DropdownMenuPrimitive.Content
				class={clsx(
					styles["dropdown-menu__content"],
					"liquid-glass",
					local.class,
				)}
				{...rest}
			>
				{local.children}
			</DropdownMenuPrimitive.Content>
		</DropdownMenuPrimitive.Portal>
	);
}

type DropdownMenuItemProps = DropdownMenuPrimitive.DropdownMenuItemProps &
	ClassProp &
	ChildrenProp & {
		inset?: boolean;
	};

function DropdownMenuItem<T extends ValidComponent = "div">(
	props: PolymorphicProps<T, DropdownMenuItemProps>,
) {
	const [local, rest] = splitProps(props as DropdownMenuItemProps, [
		"class",
		"children",
		"inset",
	]);

	return (
		<DropdownMenuPrimitive.Item
			class={clsx(
				styles["dropdown-menu__item"],
				local.inset && styles["dropdown-menu__item--inset"],
				local.class,
			)}
			{...rest}
		>
			{local.children}
		</DropdownMenuPrimitive.Item>
	);
}

type DropdownMenuGroupLabelProps =
	DropdownMenuPrimitive.DropdownMenuGroupLabelProps & ClassProp;

function DropdownMenuGroupLabel<T extends ValidComponent = "span">(
	props: PolymorphicProps<T, DropdownMenuGroupLabelProps>,
) {
	const [local, rest] = splitProps(props as DropdownMenuGroupLabelProps, [
		"class",
	]);
	return (
		<DropdownMenuPrimitive.GroupLabel
			class={clsx(styles["dropdown-menu__group-label"], local.class)}
			{...rest}
		/>
	);
}

type DropdownMenuItemLabelProps =
	DropdownMenuPrimitive.DropdownMenuItemLabelProps & ClassProp;

function DropdownMenuItemLabel<T extends ValidComponent = "div">(
	props: PolymorphicProps<T, DropdownMenuItemLabelProps>,
) {
	const [local, rest] = splitProps(props as DropdownMenuItemLabelProps, [
		"class",
	]);
	return (
		<DropdownMenuPrimitive.ItemLabel
			class={clsx(styles["dropdown-menu__item-label"], local.class)}
			{...rest}
		/>
	);
}

type DropdownMenuSeparatorProps =
	DropdownMenuPrimitive.DropdownMenuSeparatorProps & ClassProp;

function DropdownMenuSeparator<T extends ValidComponent = "hr">(
	props: PolymorphicProps<T, DropdownMenuSeparatorProps>,
) {
	const [local, rest] = splitProps(props as DropdownMenuSeparatorProps, [
		"class",
	]);
	return (
		<DropdownMenuPrimitive.Separator
			class={clsx(styles["dropdown-menu__separator"], local.class)}
			{...rest}
		/>
	);
}

function DropdownMenuShortcut(props: ComponentProps<"span">) {
	const [local, rest] = splitProps(props, ["class"]);
	return (
		<span
			class={clsx(styles["dropdown-menu__shortcut"], local.class)}
			{...rest}
		/>
	);
}

type DropdownMenuSubTriggerProps =
	DropdownMenuPrimitive.DropdownMenuSubTriggerProps & ClassProp & ChildrenProp;

function DropdownMenuSubTrigger<T extends ValidComponent = "div">(
	props: PolymorphicProps<T, DropdownMenuSubTriggerProps>,
) {
	const [local, rest] = splitProps(props as DropdownMenuSubTriggerProps, [
		"class",
		"children",
	]);
	return (
		<DropdownMenuPrimitive.SubTrigger
			class={clsx(styles["dropdown-menu__sub-trigger"], local.class)}
			{...rest}
		>
			{local.children}
			<svg
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				style={{ width: "16px" }}
			>
				<path d="M9 6l6 6l-6 6" />
			</svg>
		</DropdownMenuPrimitive.SubTrigger>
	);
}

type DropdownMenuSubContentProps =
	DropdownMenuPrimitive.DropdownMenuSubContentProps & ClassProp & ChildrenProp;

function DropdownMenuSubContent<T extends ValidComponent = "div">(
	props: PolymorphicProps<T, DropdownMenuSubContentProps>,
) {
	const [local, rest] = splitProps(props as DropdownMenuSubContentProps, [
		"class",
		"children",
	]);
	return (
		<DropdownMenuPrimitive.Portal>
			<DropdownMenuPrimitive.SubContent
				class={clsx(
					styles["dropdown-menu__content"],
					"liquid-glass",
					local.class,
				)}
				{...rest}
			>
				{local.children}
			</DropdownMenuPrimitive.SubContent>
		</DropdownMenuPrimitive.Portal>
	);
}

type DropdownMenuCheckboxItemProps =
	DropdownMenuPrimitive.DropdownMenuCheckboxItemProps &
		ClassProp &
		ChildrenProp;

function DropdownMenuCheckboxItem<T extends ValidComponent = "div">(
	props: PolymorphicProps<T, DropdownMenuCheckboxItemProps>,
) {
	const [local, rest] = splitProps(props as DropdownMenuCheckboxItemProps, [
		"class",
		"children",
	]);

	return (
		<DropdownMenuPrimitive.CheckboxItem
			class={clsx(styles["dropdown-menu__select"], local.class)}
			{...rest}
		>
			<span class={styles["dropdown-menu__select-indicator"]}>
				<DropdownMenuPrimitive.ItemIndicator>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						style={{ width: "12px" }}
					>
						<path d="M5 12l5 5l10 -10" />
					</svg>
				</DropdownMenuPrimitive.ItemIndicator>
			</span>
			{local.children}
		</DropdownMenuPrimitive.CheckboxItem>
	);
}

type DropdownMenuRadioItemProps =
	DropdownMenuPrimitive.DropdownMenuRadioItemProps & ClassProp & ChildrenProp;

function DropdownMenuRadioItem<T extends ValidComponent = "div">(
	props: PolymorphicProps<T, DropdownMenuRadioItemProps>,
) {
	const [local, rest] = splitProps(props as DropdownMenuRadioItemProps, [
		"class",
		"children",
	]);

	return (
		<DropdownMenuPrimitive.RadioItem
			class={clsx(styles["dropdown-menu__select"], local.class)}
			{...rest}
		>
			<span class={styles["dropdown-menu__select-indicator"]}>
				<DropdownMenuPrimitive.ItemIndicator>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 24 24"
						stroke="currentColor"
						stroke-width="2"
						fill="currentColor"
						stroke-linecap="round"
						stroke-linejoin="round"
						style={{ width: "8px" }}
					>
						<circle cx="12" cy="12" r="9" />
					</svg>
				</DropdownMenuPrimitive.ItemIndicator>
			</span>
			{local.children}
		</DropdownMenuPrimitive.RadioItem>
	);
}

export {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuGroupLabel,
	DropdownMenuItem,
	DropdownMenuItemLabel,
	DropdownMenuPortal,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuShortcut,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
};
