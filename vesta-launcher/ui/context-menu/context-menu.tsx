import { PolymorphicProps } from "@kobalte/core";
import * as ContextMenuPrimitive from "@kobalte/core/context-menu";
import { ChildrenProp, ClassProp } from "@ui/props";
import clsx from "clsx";
import {
	type ComponentProps,
	children,
	splitProps,
	ValidComponent,
} from "solid-js";
import "./context-menu.css";

function ContextMenu(props: ContextMenuPrimitive.ContextMenuRootProps) {
	return <ContextMenuPrimitive.ContextMenu gutter={4} {...props} />;
}

const ContextMenuTrigger = ContextMenuPrimitive.Trigger;
const ContextMenuPortal = ContextMenuPrimitive.Portal;

type ContextMenuContentProps = ContextMenuPrimitive.ContextMenuContentProps &
	ClassProp &
	ChildrenProp;

function ContextMenuContent<T extends ValidComponent = "div">(
	props: PolymorphicProps<T, ContextMenuContentProps>,
) {
	const [_, rest] = splitProps(props as ContextMenuContentProps, ["class"]);

	return (
		<ContextMenuPrimitive.Portal>
			<ContextMenuPrimitive.Content
				class={clsx("context-menu__content liquid-glass", props.class)}
				{...rest}
			/>
		</ContextMenuPrimitive.Portal>
	);
}

function ContextMenuLabel(props: ComponentProps<"div">) {
	const [_, rest] = splitProps(props, ["class", "children"]);

	return (
		<div class={clsx("context-menu__label", props.class)} {...rest}>
			{props.children}
		</div>
	);
}

type ContextMenuItemProps = ContextMenuPrimitive.ContextMenuItemProps &
	ClassProp;

function ContextMenuItem<T extends ValidComponent = "div">(
	props: PolymorphicProps<T, ContextMenuItemProps>,
) {
	const [_, rest] = splitProps(props as ContextMenuItemProps, ["class"]);

	return <ContextMenuPrimitive.Item class={"context-menu__item"} {...rest} />;
}

const ContextMenuItemLabel = ContextMenuPrimitive.ItemLabel;

function ContextMenuShortcut(props: ComponentProps<"span">) {
	const [_, rest] = splitProps(props, ["class"]);

	return <span class={clsx("context-menu__shortcut", props.class)} {...rest} />;
}

type ContextMenuSeparatorProps =
	ContextMenuPrimitive.ContextMenuSeparatorProps & ClassProp;

function ContextMenuSeparator<T extends ValidComponent = "hr">(
	props: PolymorphicProps<T, ContextMenuSeparatorProps>,
) {
	const [, rest] = splitProps(props as ContextMenuSeparatorProps, ["class"]);
	return (
		<ContextMenuPrimitive.Separator
			class={"context-menu__separator"}
			{...rest}
		/>
	);
}

const ContextMenuSub = ContextMenuPrimitive.Sub;

type ContextMenuSubTriggerProps =
	ContextMenuPrimitive.ContextMenuSubTriggerProps & ChildrenProp & ClassProp;

function ContextMenuSubTrigger<T extends ValidComponent = "div">(
	props: PolymorphicProps<T, ContextMenuSubTriggerProps>,
) {
	const [_, rest] = splitProps(props as ContextMenuSubTriggerProps, [
		"class",
		"children",
	]);
	return (
		<ContextMenuPrimitive.SubTrigger
			class={"context-menu__sub-trigger"}
			{...rest}
		>
			{props.children}
			<svg
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				style={"width: 16px;"}
			>
				<path d="M9 6l6 6l-6 6" />
			</svg>
		</ContextMenuPrimitive.SubTrigger>
	);
}

type ContextMenuSubContentProps =
	ContextMenuPrimitive.ContextMenuSubContentProps & ClassProp;

function ContextMenuSubContent<T extends ValidComponent = "div">(
	props: PolymorphicProps<T, ContextMenuSubContentProps>,
) {
	const [, rest] = splitProps(props as ContextMenuSubContentProps, ["class"]);
	return (
		<ContextMenuPrimitive.Portal>
			<ContextMenuPrimitive.SubContent
				class={clsx("context-menu__sub-content liquid-glass", props.class)}
				{...rest}
			/>
		</ContextMenuPrimitive.Portal>
	);
}

type ContextMenuCheckboxItemProps =
	ContextMenuPrimitive.ContextMenuCheckboxItemProps & ClassProp & ChildrenProp;

function ContextMenuCheckboxItem<T extends ValidComponent = "div">(
	props: PolymorphicProps<T, ContextMenuCheckboxItemProps>,
) {
	const [, rest] = splitProps(props as ContextMenuCheckboxItemProps, [
		"class",
		"children",
	]);

	return (
		<ContextMenuPrimitive.CheckboxItem class={"context-menu__select"} {...rest}>
			<span class="context-menu__select__span">
				<ContextMenuPrimitive.ItemIndicator>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						class="size-4"
						style={"width: 12px;"}
					>
						<path d="M5 12l5 5l10 -10" />
					</svg>
				</ContextMenuPrimitive.ItemIndicator>
			</span>
			{props.children}
		</ContextMenuPrimitive.CheckboxItem>
	);
}

const ContextMenuGroup = ContextMenuPrimitive.Group;

type ContextMenuGroupLabelProps =
	ContextMenuPrimitive.ContextMenuGroupLabelProps & ClassProp;

function ContextMenuGroupLabel<T extends ValidComponent = "span">(
	props: PolymorphicProps<T, ContextMenuGroupLabelProps>,
) {
	const [, rest] = splitProps(props as ContextMenuGroupLabelProps, ["class"]);
	return (
		<ContextMenuPrimitive.GroupLabel
			class={"context-menu__group-label"}
			{...rest}
		/>
	);
}

const ContextMenuRadioGroup = ContextMenuPrimitive.RadioGroup;

type ContextMenuRadioItemProps =
	ContextMenuPrimitive.ContextMenuRadioItemProps & ClassProp & ChildrenProp;

function ContextMenuRadioItem<T extends ValidComponent = "div">(
	props: PolymorphicProps<T, ContextMenuRadioItemProps>,
) {
	const [, rest] = splitProps(props as ContextMenuRadioItemProps, [
		"class",
		"children",
	]);

	return (
		<ContextMenuPrimitive.RadioItem class={"context-menu__select"} {...rest}>
			<span class="context-menu__select__span">
				<ContextMenuPrimitive.ItemIndicator>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 24 24"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						class="size-2 fill-current"
						style={"fill: currentColor; width: 8px;"}
					>
						<path d="M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0" />
					</svg>
				</ContextMenuPrimitive.ItemIndicator>
			</span>
			{props.children}
		</ContextMenuPrimitive.RadioItem>
	);
}

export {
	ContextMenu,
	ContextMenuLabel,
	ContextMenuTrigger,
	ContextMenuPortal,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuItemLabel,
	ContextMenuShortcut,
	ContextMenuSeparator,
	ContextMenuSub,
	ContextMenuSubTrigger,
	ContextMenuSubContent,
	ContextMenuCheckboxItem,
	ContextMenuGroup,
	ContextMenuGroupLabel,
	ContextMenuRadioGroup,
	ContextMenuRadioItem,
};
